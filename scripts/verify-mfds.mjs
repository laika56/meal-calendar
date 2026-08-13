#!/usr/bin/env node
// 식약처 파서를 **실제 API 응답**에 돌려서 깨지는 게 없는지 본다.
//
// 왜 이게 따로 필요한가:
//   `npm test` 는 "구현이 테스트와 일치한다"만 증명한다. 명세 자체가 틀렸으면
//   테스트도 같이 틀리므로 아무것도 못 잡는다. 실제로 2026-08-13 에 발주 09 가
//   127/127 통과했는데 실데이터 325건 중 88건(27%)에서 예외로 죽었다.
//   그 88건은 전부 명세가 못 본 형태였다 — 100mL 기준, 천단위 쉼표, 자유텍스트.
//
// 그래서 **파서를 고치는 발주는 이 스크립트를 수용 기준으로 건다.**
// Claude 가 없어도 Codex 가 이걸 돌려서 스스로 판정할 수 있다.
//
// 사용:
//   node scripts/verify-mfds.mjs            # 기본 질의 세트
//   node scripts/verify-mfds.mjs 김밥 우유    # 질의 직접 지정
//
// .env 의 MFDS_API_KEY 를 읽는다. 키를 출력하지 않는다.

import { readFileSync } from 'node:fs';
import { parseMfdsFoodItem, resolveServing } from '../src/lib/mfdsParser.js';

const BASE = 'https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02';

// 질의를 여러 형태로 섞는다. 한 종류만 뜨면 그 종류에만 맞는 명세가 나온다 —
// 발주 04→07, 09→10, 10→11 이 전부 그래서 났다.
const DEFAULT_QUERIES = [
  { FOOD_NM_KR: '김밥' },      // 음식(가정식·급식·외식) — Z10500 이 1인분
  { FOOD_NM_KR: '프로틴' },    // 가공식품 — Z10500 이 포장 총량, 1회제공량 별도
  { FOOD_NM_KR: '우유' },      // 100mL 기준이 섞인다
  { FOOD_NM_KR: '라면' },      // NUTRI_AMOUNT_SERVING 자유텍스트가 나온다
  { FOOD_NM_KR: '과자' },      // 천단위 쉼표
  { MAKER_NM: '맥도날드' },     // 외식 프랜차이즈
  { MAKER_NM: '스타벅스' },     // 음료 다수
  { FOOD_NM_KR: '샐러드' },
];

function readApiKey() {
  let raw;
  try {
    raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  } catch {
    console.error('.env 를 못 읽었다. MFDS_API_KEY 가 있어야 한다.');
    process.exit(2);
  }
  const line = raw.split('\n').find((l) => l.startsWith('MFDS_API_KEY='));
  if (!line) {
    console.error('.env 에 MFDS_API_KEY 가 없다.');
    process.exit(2);
  }
  // 포털이 주는 키는 이미 URL 인코딩돼 있다. 다시 인코딩하면 "등록되지 않은 서비스키"가 된다.
  return decodeURIComponent(line.slice('MFDS_API_KEY='.length).trim());
}

async function fetchItems(key, params) {
  const url = new URL(BASE);
  url.searchParams.set('serviceKey', key);
  url.searchParams.set('type', 'json');
  url.searchParams.set('numOfRows', '100');
  url.searchParams.set('pageNo', '1');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${JSON.stringify(params)}`);
  const body = (await res.json()).body ?? {};
  const items = body.items ?? [];
  return Array.isArray(items) ? items : (items.item ?? []);
}

function causeOf(message) {
  // "... got X for FOOD_CD" 의 가변부를 떼어 원인별로 묶는다
  return message.replace(/got .*/, '').replace(/for .*/, '').trim();
}

const queries = process.argv.length > 2
  ? process.argv.slice(2).map((q) => ({ FOOD_NM_KR: q }))
  : DEFAULT_QUERIES;

const key = readApiKey();
const failures = new Map();
const servingSources = new Map();
let total = 0;
let parsed = 0;

for (const params of queries) {
  let items;
  try {
    items = await fetchItems(key, params);
  } catch (err) {
    console.error(`질의 실패 ${JSON.stringify(params)}: ${err.message}`);
    process.exit(2); // 네트워크 문제는 판정 불가다. 통과로 처리하지 않는다
  }

  for (const item of items) {
    total += 1;
    let food;
    try {
      food = parseMfdsFoodItem(item);
      parsed += 1;
    } catch (err) {
      const cause = causeOf(err.message);
      if (!failures.has(cause)) failures.set(cause, []);
      failures.get(cause).push({
        name: item.FOOD_NM_KR,
        SERVING_SIZE: item.SERVING_SIZE,
        Z10500: item.Z10500,
        NUTRI_AMOUNT_SERVING: item.NUTRI_AMOUNT_SERVING,
      });
      continue;
    }

    const serving = resolveServing(food);
    const source = serving ? serving.source : '(판정불가 — g 직접입력)';
    servingSources.set(source, (servingSources.get(source) ?? 0) + 1);
  }
}

console.log(`질의 ${queries.length}종 / 항목 ${total}건`);
console.log(`파싱 성공 ${parsed} · 실패 ${total - parsed}`);
console.log('\n1회분 판정 분포:');
for (const [source, n] of [...servingSources].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(4)}건  ${source}`);
}

if (failures.size === 0) {
  console.log('\n✅ 파싱 실패 0건.');
  process.exit(0);
}

console.log('\n❌ 파싱 실패 — 원인별:');
for (const [cause, list] of failures) {
  console.log(`\n▶ ${cause} → ${list.length}건`);
  for (const f of list.slice(0, 3)) {
    console.log(`     ${String(f.name).slice(0, 30)}`);
    console.log(`       SERVING_SIZE=${JSON.stringify(f.SERVING_SIZE)}`
      + ` Z10500=${JSON.stringify(f.Z10500)}`
      + ` 1회=${JSON.stringify(f.NUTRI_AMOUNT_SERVING)}`);
  }
}
console.log('\n실패한 값들은 대개 「명세가 못 본 형태」다. 파서를 억지로 통과시키지 말고');
console.log('그 형태를 어떻게 다룰지부터 정한다 — 부가 필드 하나 때문에 항목 전체를 죽이지 않는다.');
process.exit(1);
