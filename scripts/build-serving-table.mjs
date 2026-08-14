#!/usr/bin/env node
// 카테고리별 「1인분 대표 중량」 표를 **실제 식약처 응답에서** 만든다.
//
// 왜 필요한가:
//   조리음식의 8%는 1인분을 모른다(Z10500 도 NUTRI_AMOUNT_SERVING 도 못 쓰는 경우).
//   그때 화면이 할 수 있는 말이 "직접 g 을 재서 넣으세요" 뿐인데, **사용자는 자기가 먹은
//   라멘이 몇 g 인지 모른다.** 실제로 세 번 같은 불만이 나왔다 (2026-08-14).
//
//   숫자를 지어내면 절대규칙 2 위반이다. 그래서 **같은 카테고리의 아는 값들에서** 뽑는다.
//   이 스크립트가 그 표를 만들고, 표에는 언제·몇 건에서 나왔는지(provenance)를 같이 박는다.
//
// 왜 스크립트인가: Codex 실행 환경은 네트워크가 막혀 있다. 표 생성은 Claude/사람이 하고,
//   표를 쓰는 순수 함수만 Codex 가 만든다.
//
// 사용: node scripts/build-serving-table.mjs > src/data/servingByCategory.json

import { readFileSync } from 'node:fs';
import { parseMfdsFoodItem, resolveServing } from '../src/lib/mfdsParser.js';

const BASE = 'https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02';
const MIN_SAMPLES = 5; // 이보다 적은 카테고리는 표에 넣지 않는다 — 대표값이라 부를 수 없다

// 카테고리를 고르게 덮도록 질의를 섞는다. 한 종류만 뜨면 그 종류에만 맞는 표가 나온다.
const QUERIES = [
  '라멘', '라면', '국수', '우동', '파스타', '만두', '냉면', '칼국수',
  '밥', '김밥', '비빔밥', '덮밥', '볶음밥', '주먹밥', '초밥',
  '찌개', '전골', '국', '탕', '국밥',
  '죽', '스프', '샐러드', '무침', '나물',
  '볶음', '구이', '조림', '튀김', '전',
];

function readKey() {
  const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const line = raw.split('\n').find((l) => l.startsWith('MFDS_API_KEY='));
  if (!line) { console.error('.env 에 MFDS_API_KEY 가 없다.'); process.exit(2); }
  // 포털 키는 이미 URL 인코딩돼 있다. 다시 인코딩하면 "등록되지 않은 서비스키"가 된다
  return decodeURIComponent(line.slice('MFDS_API_KEY='.length).trim());
}

async function fetchPage(key, name, pageNo) {
  const url = new URL(BASE);
  url.searchParams.set('serviceKey', key);
  url.searchParams.set('type', 'json');
  url.searchParams.set('numOfRows', '100');
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('FOOD_NM_KR', name);
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${name} p${pageNo}`);
  const items = (await res.json()).body?.items ?? [];
  return Array.isArray(items) ? items : (items.item ?? []);
}

const key = readKey();
const byCategory = new Map();
let dishCount = 0, knownCount = 0, parseFailed = 0;
const seen = new Set(); // 같은 식품이 여러 질의에 걸린다 — FOOD_CD 로 중복 제거

for (const name of QUERIES) {
  for (const pageNo of [1, 2]) { // 페이지 2까지 — 표본을 넓힌다
    let items;
    try { items = await fetchPage(key, name, pageNo); }
    catch (err) { console.error(`질의 실패 ${name} p${pageNo}: ${err.message}`); continue; }
    if (items.length === 0) break;

    for (const raw of items) {
      if (seen.has(raw.FOOD_CD)) continue;
      seen.add(raw.FOOD_CD);
      let food;
      try { food = parseMfdsFoodItem(raw); } catch { parseFailed++; continue; }
      if (food.foodGroup !== 'dish') continue; // 조리음식만 — 가공식품은 포장에 표기가 있다
      dishCount++;
      const serving = resolveServing(food);
      if (!serving) continue;
      knownCount++;
      const cat = food.category;
      if (!cat) continue;
      const bucket = byCategory.get(cat) ?? { g: [], mL: [] };
      bucket[serving.unit].push(serving.amount);
      byCategory.set(cat, bucket);
    }
  }
}

// 중앙값 — 평균이 아니다. 간편조리세트(1669g) 같은 이상치가 평균은 망가뜨리지만
// 중앙값은 못 망가뜨린다.
function median(sorted) {
  const mid = Math.floor(sorted.length / 2);
  const v = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(v * 10) / 10;
}

const categories = {};
for (const [cat, bucket] of [...byCategory].sort()) {
  for (const unit of ['g', 'mL']) {
    const vals = bucket[unit].slice().sort((a, b) => a - b);
    if (vals.length < MIN_SAMPLES) continue;
    (categories[cat] ??= {})[unit] = {
      median: median(vals),
      sampleCount: vals.length,
      min: vals[0],
      max: vals[vals.length - 1],
      p25: median(vals.slice(0, Math.ceil(vals.length / 2))),
      p75: median(vals.slice(Math.floor(vals.length / 2))),
    };
  }
}

console.log(JSON.stringify({
  _comment: '자동 생성. 손으로 고치지 말 것 — scripts/build-serving-table.mjs 를 다시 돌린다.',
  provenance: {
    generatedAt: new Date().toISOString(),
    source: '식품의약품안전처 통합식품영양성분 (공공데이터포털)',
    queries: QUERIES,
    pagesPerQuery: 2,
    uniqueFoodsSeen: seen.size,
    dishCount,
    knownServingCount: knownCount,
    parseFailed,
    minSamplesPerCategory: MIN_SAMPLES,
    note: '조리음식(DB_GRP_CM=D)만 집계. 중앙값이며 평균이 아니다 — 간편조리세트 같은 이상치를 견딘다.',
  },
  categories,
}, null, 2));
console.error(`\n완료: 고유식품 ${seen.size} · 조리음식 ${dishCount} · 1인분앎 ${knownCount} · 카테고리 ${Object.keys(categories).length}`);
