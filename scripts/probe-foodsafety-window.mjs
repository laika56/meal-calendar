// 식품안전나라 C005 / I2570 이 실제로 죽은 것인지, 시간대 제한인지 판정한다.
//
// data/barcode/sources.json 에 두 원천이 `temporarily-unavailable-error-503` 으로
// 박혀 있어 2026-08-19 게시에서 제외됐다. 그런데 2026-08-26 15:12 KST 에 찍으니
// HTTP 200 이고 본문이 이랬다:
//
//   ERROR-503 · "12시~19시에는 서비스가 일시적으로 원활하지 않을수있습니다"
//
// **영구 장애가 아니라 매일 그 시간대의 제한일 가능성이 높다.** 8/19 측정도 같은
// 시간대였다면 원천 두 개를 근거 없이 버린 것이 된다.
//
// 사용법:
//   node scripts/probe-foodsafety-window.mjs            # sample 키 (총건수는 못 본다)
//   MFDS_API_KEY=... node scripts/probe-foodsafety-window.mjs
//
// **19시 이후에 돌려야 의미가 있다.** 12~19시에 돌리면 그 구간의 답만 다시 얻는다.

const APIS = ['C005', 'I2570'];
const key = process.env.MFDS_API_KEY ?? 'sample';

function kstNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return { text: `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`, hour: Number(get('hour')) };
}

const now = kstNow();
console.log(`KST ${now.text} · 키: ${key === 'sample' ? 'sample(제한적)' : '실키'}`);
if (now.hour >= 12 && now.hour < 19) {
  console.log('⚠ 지금은 12~19시 구간이다. 여기서 나온 실패는 판정 근거가 못 된다.\n');
} else {
  console.log('✅ 12~19시 밖이다. 여기서도 실패하면 시간대 문제가 아니다.\n');
}

for (const api of APIS) {
  const url = `https://openapi.foodsafetykorea.go.kr/api/${key}/${api}/json/1/5`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const body = await res.json();
    const payload = body[api] ?? {};
    const result = payload.RESULT ?? {};
    const total = payload.total_count ?? '없음';
    const code = result.CODE ?? '없음';
    const alive = code === 'INFO-000' && Number(total) > 0;
    console.log(`${api}: HTTP ${res.status} · CODE ${code} · total ${total} → ${alive ? '✅ 살아있다' : '❌ 못 씀'}`);
    if (result.MSG) console.log(`      ${result.MSG}`);
    if (alive) {
      // 바코드 필드가 실제로 있는지까지 봐야 원천으로 쓸 수 있다.
      const rows = payload.row ?? [];
      const fields = rows.length > 0 ? Object.keys(rows[0]) : [];
      const barcodeFields = fields.filter((f) => /BAR|BRCD/u.test(f.toUpperCase()));
      console.log(`      필드 ${fields.length}개 · 바코드 후보: ${barcodeFields.join(', ') || '없음'}`);
    }
  } catch (error) {
    console.log(`${api}: 호출 자체 실패 — ${error.message}`);
  }
}

console.log('\n판정이 「살아있다」면 data/barcode/sources.json 의 measurementStatus 를 고치고');
console.log('scripts/measure-barcode-sources.mjs 로 분포부터 다시 센다.');
