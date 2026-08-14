// Cloud Functions — 식약처 API 프록시. 키를 아는 곳은 여기뿐이다 (AGENTS.md 절대규칙 1).
// docs/ARCHITECTURE.md 「Cloud Functions 엔드포인트」 참조.
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

import { parseMfdsFoodItem, resolveServing } from './shared/mfdsParser.js';
import { buildSearchPlan } from './shared/searchPlan.js';
import { mergeSearchResults, rankSearchResults } from './shared/searchResults.js';

initializeApp();

const MFDS_BASE_URL = 'https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02';

async function requireAuth(req) {
  const header = req.get('Authorization') ?? '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    throw { status: 401, message: '로그인이 필요하다 (Authorization 헤더 없음)' };
  }
  try {
    return await getAuth().verifyIdToken(match[1]);
  } catch {
    throw { status: 401, message: '로그인이 만료됐거나 유효하지 않다' };
  }
}

// MFDS 응답 한 건이 파싱 실패해도 검색 전체를 죽이지 않는다 — 그 항목만 건너뛴다.
//
// **건너뛴 개수를 반드시 돌려준다.** 2026-08-13 에 이걸 세지 않아서 큰 버그를 놓쳤다:
// 파서가 `SERVING_SIZE='100mL'` 를 거부해서 **음료가 통째로(표본의 20%) 사라지고 있었는데**,
// 여기서 조용히 건너뛰니 사용자 눈에는 그냥 「검색 결과 없음」이었다.
// 조용히 삼키는 코드는 버그를 은폐한다 (절대규칙 7).
function parseItemsLeniently(rawItems) {
  const parsed = [];
  const skipped = [];
  for (const raw of rawItems) {
    try {
      parsed.push(parseMfdsFoodItem(raw));
    } catch (err) {
      skipped.push({ foodCd: raw?.FOOD_CD, error: err.message });
    }
  }
  if (skipped.length > 0) {
    logger.warn('[mfds] 항목 파싱 실패, 건너뜀', { count: skipped.length, samples: skipped.slice(0, 3) });
  }
  return { parsed, skippedCount: skipped.length };
}

/** 식약처 API 를 한 번 호출해서 파싱된 항목 배열을 돌려준다. 실패는 throw 한다. */
async function fetchOnePlan(planEntry) {
  const url = new URL(MFDS_BASE_URL);
  // MFDS_API_KEY 는 공공데이터포털에서 발급된 그대로(퍼센트 인코딩된 상태)로 저장돼있다.
  // URLSearchParams.set() 은 값을 다시 인코딩하므로, 그대로 넣으면 이중 인코딩돼 키가 깨진다
  // ("등록되지 않은 서비스키" 에러로 실측됨). 먼저 디코딩해서 원본으로 되돌린 뒤 넣는다.
  url.searchParams.set('serviceKey', decodeURIComponent(process.env.MFDS_API_KEY));
  url.searchParams.set('type', 'json');
  url.searchParams.set('numOfRows', '20');
  url.searchParams.set('pageNo', '1');
  for (const [key, value] of Object.entries(planEntry)) url.searchParams.set(key, value);

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const body = await response.json();

  // totalCount 0 은 정상(검색 결과 없음)이지 API 에러가 아니다 — resultCode 로만 구분한다
  if (body.header?.resultCode === undefined) {
    logger.error('[mfds] 예상 밖 응답 형태', body);
    throw new Error('식약처 API 응답을 이해할 수 없다');
  }

  if ((body.body?.totalCount ?? 0) === 0 || !body.body?.items) {
    return { parsed: [], skippedCount: 0 };
  }

  // 실측(2026-08-13): body.items 가 { item: [...] } 래퍼 없이 배열 자체로 올 때가 있다.
  const rawItemsField = body.body.items;
  let rawItems;
  if (Array.isArray(rawItemsField)) {
    rawItems = rawItemsField;
  } else if (Array.isArray(rawItemsField?.item)) {
    rawItems = rawItemsField.item;
  } else if (rawItemsField?.item) {
    rawItems = [rawItemsField.item];
  } else {
    logger.error('[mfds] items 형태를 이해할 수 없다', rawItemsField);
    throw new Error('식약처 API 응답을 이해할 수 없다');
  }

  return parseItemsLeniently(rawItems);
}

async function cacheFoodItems(items) {
  const db = getFirestore();
  const batch = db.batch();
  for (const item of items) {
    const ref = db.collection('foods').doc(`mfds_${item.foodCode}`);
    batch.set(ref, {
      source: 'mfds',
      code: item.foodCode,
      name: item.name,
      category: item.category,
      per100g: item.per100g,
      basis: item.basis,
      maker: item.maker ?? null,
      isFranchise: item.isFranchise ?? false,
      foodGroup: item.foodGroup ?? null,
      // 1회분 판정에 필요한 원자료를 그대로 둔다. resolveServing 규칙이 나중에 바뀌어도
      // 캐시를 다시 받지 않고 재판정할 수 있다
      totalAmount: item.totalAmount ?? null,
      totalUnit: item.totalUnit ?? null,
      servingAmount: item.servingAmount ?? null,
      servingUnit: item.servingUnit ?? null,
      fetchedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
}

export const searchFoods = onRequest(
  { secrets: ['MFDS_API_KEY'], region: 'asia-northeast3', cors: false },
  async (req, res) => {
    try {
      await requireAuth(req);
    } catch (err) {
      res.status(err.status ?? 401).json({ error: err.message ?? '인증 실패' });
      return;
    }

    const q = String(req.query.q ?? '').trim();
    if (!q) {
      res.status(400).json({ error: 'q 쿼리 파라미터가 필요하다' });
      return;
    }

    // 검색어를 통째로 한 번 던지면 브랜드명이 앞에 붙는 순간 0건이 된다 —
    // `서가원 김밥` 0건인데 `김밥` 은 2,840건이다 (2026-08-13 실측).
    // buildSearchPlan 이 「원문 → 브랜드+식품 → 브랜드만 → 식품만」 순서로 계획을 준다.
    const plan = buildSearchPlan(q);
    const batches = [];
    const attempts = [];
    let skippedTotal = 0;

    for (const entry of plan) {
      let result;
      try {
        result = await fetchOnePlan(entry);
      } catch (err) {
        logger.error('[mfds] 질의 실패', { entry, error: err.message });
        // 한 시도가 실패해도 다음 시도를 해본다. 전부 실패하면 아래에서 502 를 낸다
        attempts.push({ ...entry, count: null, failed: true });
        continue;
      }
      skippedTotal += result.skippedCount;
      attempts.push({ ...entry, count: result.parsed.length });
      if (result.parsed.length > 0) {
        batches.push(result.parsed);
        break; // 결과가 나오면 멈춘다. 뒤 계획은 더 넓은(덜 정확한) 질의다
      }
    }

    if (batches.length === 0 && attempts.every((a) => a.failed)) {
      res.status(502).json({ error: '식약처 API 호출에 실패했다' });
      return;
    }

    const items = rankSearchResults(mergeSearchResults(batches), q);

    try {
      await cacheFoodItems(items);
    } catch (err) {
      // 캐싱 실패해도 검색 결과는 준다 — 캐시는 최적화지 기능이 아니다
      logger.error('[mfds] foods/ 캐시 쓰기 실패', err);
    }

    res.status(200).json({
      items: items.map((item) => {
        const serving = resolveServing(item);
        return {
          foodKey: `mfds_${item.foodCode}`,
          name: item.name,
          category: item.category,
          per100g: item.per100g,
          basis: item.basis, // 'g' | 'mL' — per100g 가 100g 기준인지 100mL 기준인지
          maker: item.maker,
          isFranchise: item.isFranchise,
          // 1회분을 알면 화면이 「1개」로 받고, 모르면(null) g 을 직접 받는다.
          // 모르는 걸 총중량으로 때우지 않는다 — 프로틴 1kg 통이 3,950kcal 로 기록된다
          serving, // { amount, unit, source } | null
          servingNote: item.servingNote ?? null, // '드레싱 15g, 덮밥소스 165g' 같은 원문
        };
      }),
      // 어떤 질의로 몇 건이 나왔는지. 「왜 이게 나왔지」를 화면·로그에서 설명할 수 있다
      attempts,
      // 파싱 실패로 버린 개수. 0 이 아니면 무언가 놓치고 있다는 신호다 — 숨기지 않는다
      skipped: skippedTotal,
    });
  },
);
