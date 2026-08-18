// Cloud Functions — 식약처 API 프록시. 키를 아는 곳은 여기뿐이다 (AGENTS.md 절대규칙 1).
// docs/ARCHITECTURE.md 「Cloud Functions 엔드포인트」 참조.
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

import { parseMfdsFoodItem, resolveServing } from './shared/mfdsParser.js';
import {
  mergeCatalogAndMfdsResults,
  queryCatalogFoods as queryCatalogFoodsFromFirestore,
} from './shared/franchiseCatalog.js';
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

function mfdsItemToSearchFood(item) {
  const serving = resolveServing(item);
  return {
    foodKey: `mfds_${item.foodCode}`,
    name: item.name,
    category: item.category,
    per100g: item.per100g,
    basis: item.basis,
    maker: item.maker,
    isFranchise: item.isFranchise,
    serving,
    servingNote: item.servingNote ?? null,
  };
}

/** Runs the existing MFDS search plan and retains diagnostics if every attempt fails. */
export async function searchMfdsFoods(q) {
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
      attempts.push({ ...entry, count: null, failed: true });
      continue;
    }
    skippedTotal += result.skippedCount;
    attempts.push({ ...entry, count: result.parsed.length });
    if (result.parsed.length > 0) {
      batches.push(result.parsed);
      break;
    }
  }

  if (batches.length === 0 && attempts.every((attempt) => attempt.failed)) {
    const error = new Error('식약처 API 호출에 실패했다');
    error.attempts = attempts;
    error.skipped = skippedTotal;
    throw error;
  }

  const cacheItems = rankSearchResults(mergeSearchResults(batches), q);
  return {
    items: cacheItems.map(mfdsItemToSearchFood),
    cacheItems,
    attempts,
    skipped: skippedTotal,
  };
}

/**
 * Merges independently-failable catalog and MFDS searches into the stable API
 * response payload. Dependencies are injectable for deterministic tests.
 */
export async function runSearchFoods(q, {
  queryCatalogFoods = (query) => queryCatalogFoodsFromFirestore(getFirestore(), query),
  searchMfdsFoods: findMfdsFoods = searchMfdsFoods,
  cacheFoodItems: cache = cacheFoodItems,
} = {}) {
  const [catalogOutcome, mfdsOutcome] = await Promise.allSettled([
    queryCatalogFoods(q),
    findMfdsFoods(q),
  ]);

  if (catalogOutcome.status === 'rejected') {
    logger.error('[catalog] 질의 실패', catalogOutcome.reason);
  }
  if (mfdsOutcome.status === 'rejected') {
    logger.error('[mfds] 전체 질의 실패', mfdsOutcome.reason);
  }
  if (catalogOutcome.status === 'rejected' && mfdsOutcome.status === 'rejected') {
    throw Object.assign(new Error('식약처 API와 프랜차이즈 카탈로그 호출에 실패했다'), { status: 502 });
  }

  const catalog = catalogOutcome.status === 'fulfilled'
    ? catalogOutcome.value
    : { items: [], hasMore: false };
  const mfds = mfdsOutcome.status === 'fulfilled'
    ? mfdsOutcome.value
    : {
      items: [],
      cacheItems: [],
      attempts: mfdsOutcome.reason?.attempts ?? [],
      skipped: mfdsOutcome.reason?.skipped ?? 0,
    };
  const items = mergeCatalogAndMfdsResults(catalog.items, mfds.items, q);

  if (mfdsOutcome.status === 'fulfilled') {
    try {
      await cache(mfds.cacheItems ?? []);
    } catch (err) {
      logger.error('[mfds] foods/ 캐시 쓰기 실패', err);
    }
  }

  const response = {
    items,
    hasMore: catalog.hasMore === true,
    attempts: mfds.attempts,
    skipped: mfds.skipped,
  };
  if (catalogOutcome.status === 'rejected') response.catalogUnavailable = true;
  if (mfdsOutcome.status === 'rejected') response.mfdsUnavailable = true;
  return response;
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

    try {
      res.status(200).json(await runSearchFoods(q));
    } catch (err) {
      res.status(err.status ?? 502).json({ error: err.message ?? '검색 결과를 가져오지 못했다' });
    }
  },
);
