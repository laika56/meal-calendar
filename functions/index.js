// Cloud Functions — 식약처 API 프록시. 키를 아는 곳은 여기뿐이다 (AGENTS.md 절대규칙 1).
// docs/ARCHITECTURE.md 「Cloud Functions 엔드포인트」 참조.
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

import { parseMfdsFoodItem } from './shared/mfdsParser.js';

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

// MFDS 응답 한 건이 파싱 실패해도(예: SERVING_SIZE 가 100g 아닌 드문 케이스) 검색 전체를
// 죽이지 않는다 — 그 항목만 건너뛰고 로그를 남긴다. src/lib/mfdsParser.js(원본)의 strict
// 정책은 유지한다(그 파일을 안 고침). 여기서 개별 항목 단위로만 관대하게 처리한다.
function parseItemsLeniently(rawItems) {
  const parsed = [];
  for (const raw of rawItems) {
    try {
      parsed.push(parseMfdsFoodItem(raw));
    } catch (err) {
      logger.warn('[mfds] 항목 파싱 실패, 건너뜀', { foodCd: raw.FOOD_CD, error: err.message });
    }
  }
  return parsed;
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

    const url = new URL(MFDS_BASE_URL);
    // MFDS_API_KEY 는 공공데이터포털에서 발급된 그대로(퍼센트 인코딩된 상태)로 저장돼있다.
    // URLSearchParams.set() 은 값을 다시 인코딩하므로, 그대로 넣으면 이중 인코딩돼 키가 깨진다
    // ("등록되지 않은 서비스키" 에러로 실측됨). 먼저 디코딩해서 원본으로 되돌린 뒤 넣는다.
    url.searchParams.set('serviceKey', decodeURIComponent(process.env.MFDS_API_KEY));
    url.searchParams.set('type', 'json');
    url.searchParams.set('numOfRows', '20');
    url.searchParams.set('pageNo', '1');
    url.searchParams.set('FOOD_NM_KR', q);

    let mfdsResponse;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      mfdsResponse = await response.json();
    } catch (err) {
      logger.error('[mfds] API 호출 실패', err);
      res.status(502).json({ error: '식약처 API 호출에 실패했다' });
      return;
    }

    if (mfdsResponse.header?.resultCode !== '00') {
      // totalCount 0 은 정상(검색 결과 없음)이지 API 에러가 아니다 — resultCode 로만 구분한다
      if (mfdsResponse.header?.resultCode === undefined) {
        logger.error('[mfds] 예상 밖 응답 형태', mfdsResponse);
        res.status(502).json({ error: '식약처 API 응답을 이해할 수 없다' });
        return;
      }
    }

    const totalCount = mfdsResponse.body?.totalCount ?? 0;
    if (totalCount === 0 || !mfdsResponse.body?.items) {
      res.status(200).json({ items: [] });
      return;
    }

    // 실측(2026-08-13): body.items가 { item: [...] } 래퍼 없이 배열 자체로 올 때가 있다
    // (numOfRows=20 검색에서 확인됨). src/lib/mfdsParser.js의 parseMfdsSearchResponse도
    // orders/07로 같은 판별 로직을 갖게 됐다 — 여기서 직접 구현하는 이유는 개별 항목 파싱
    // 실패를 건너뛰는 관대한 처리(parseItemsLeniently)가 필요해서다. 그 strict 버전을 그대로
    // 쓰면 항목 하나가 안 맞아도 검색 전체가 죽는다.
    const rawItemsField = mfdsResponse.body.items;
    let rawItems;
    if (Array.isArray(rawItemsField)) {
      rawItems = rawItemsField;
    } else if (Array.isArray(rawItemsField?.item)) {
      rawItems = rawItemsField.item;
    } else if (rawItemsField?.item) {
      rawItems = [rawItemsField.item];
    } else {
      logger.error('[mfds] items 형태를 이해할 수 없다', rawItemsField);
      res.status(502).json({ error: '식약처 API 응답을 이해할 수 없다' });
      return;
    }
    const items = parseItemsLeniently(rawItems);

    try {
      await cacheFoodItems(items);
    } catch (err) {
      // 캐싱 실패해도 검색 결과는 준다 — 캐시는 최적화지 기능이 아니다
      logger.error('[mfds] foods/ 캐시 쓰기 실패', err);
    }

    res.status(200).json({
      items: items.map((item) => ({
        foodKey: `mfds_${item.foodCode}`,
        name: item.name,
        category: item.category,
        per100g: item.per100g,
      })),
    });
  },
);
