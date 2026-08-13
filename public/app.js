import { buildMonthGrid, dayStatus } from '/src/lib/calendarGrid.js';

// Phase 1 — 더미 데이터. Firestore 연동은 Phase 3.
const DUMMY_TARGET_KCAL = 2000;

function todayLocalDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 날짜 문자열을 시드로 쓰는 결정적 의사난수 — 매번 같은 더미 값이 나오게 한다.
// 뒤에 정수 해시 avalanche(finalizer)를 붙인다 — 안 붙이면 "2026-08-01"과 "2026-08-02"처럼
// 끝 한 글자만 다른 문자열이 거의 같은 해시값이 되어(마지막 곱셈이 한 번뿐이라) 날짜별 값이
// 랜덤이 아니라 계단식으로 증가해 보인다.
function seededRatio(dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i += 1) {
    hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x45d9f3b);
  hash ^= hash >>> 16;
  hash >>>= 0;
  return (hash % 1000) / 1000; // 0.000 ~ 0.999
}

function dummyDayRecord(dateStr, today) {
  // 오늘 이후 날짜는 기록이 없다고 가정 (더미 데이터의 "현재 시점" 흉내)
  if (dateStr > today) return { hasRecord: false, kcal: 0 };
  // 7일에 한 번은 미기록으로 섞는다 — '없음' 상태도 그리드에서 보이게
  if (seededRatio(dateStr + 'skip') < 1 / 7) return { hasRecord: false, kcal: 0 };

  const ratio = 0.6 + seededRatio(dateStr) * 0.7; // 0.6 ~ 1.3 사이로 흩뿌린다
  return { hasRecord: true, kcal: Math.round(DUMMY_TARGET_KCAL * ratio) };
}

const STATUS_LABEL = {
  under: { symbol: '▽', text: '미달' },
  ok: { symbol: '●', text: '달성' },
  over: { symbol: '△', text: '초과' },
  none: { symbol: '·', text: '미기록' },
};

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

const state = {
  year: Number(todayLocalDate().slice(0, 4)),
  month: Number(todayLocalDate().slice(5, 7)), // 1~12
};

const monthLabelEl = document.getElementById('monthLabel');
const gridEl = document.getElementById('grid');
const detailEl = document.getElementById('dayDetail');
const detailDateEl = document.getElementById('detailDate');
const totalKcalEl = document.getElementById('totalKcal');
const kcalBarEl = document.getElementById('kcalBar');

function renderMonth() {
  const today = todayLocalDate();
  monthLabelEl.textContent = `${state.year}년 ${state.month}월`;

  const cells = buildMonthGrid({ year: state.year, month: state.month, weekStartsOn: 0 });
  gridEl.innerHTML = '';

  for (const cell of cells) {
    const record = dummyDayRecord(cell.date, today);
    const status = dayStatus({
      kcal: record.kcal,
      targetKcal: DUMMY_TARGET_KCAL,
      hasRecord: record.hasRecord,
    });
    const label = STATUS_LABEL[status];

    const el = document.createElement('button');
    el.type = 'button';
    el.className = `day day-${status}${cell.inCurrentMonth ? '' : ' day-outside'}${cell.date === today ? ' day-today' : ''}`;
    el.dataset.date = cell.date;
    el.setAttribute('aria-label', `${cell.date}, ${label.text}${record.hasRecord ? `, ${record.kcal}kcal` : ''}`);
    el.innerHTML = `
      <span class="day-num">${cell.dayOfMonth}</span>
      <span class="day-kcal">${record.hasRecord ? record.kcal : ''}</span>
      <span class="day-badge">${label.symbol} ${label.text}</span>
    `;
    el.addEventListener('click', () => openDayDetail(cell.date, record));
    gridEl.appendChild(el);
  }
}

function openDayDetail(dateStr, record) {
  detailDateEl.textContent = dateStr;
  totalKcalEl.textContent = `${record.hasRecord ? record.kcal : 0} / ${DUMMY_TARGET_KCAL} kcal`;
  const pct = Math.min(100, Math.round(((record.hasRecord ? record.kcal : 0) / DUMMY_TARGET_KCAL) * 100));
  kcalBarEl.style.width = `${pct}%`;
  detailEl.hidden = false;
}

document.getElementById('closeDetail').addEventListener('click', () => {
  detailEl.hidden = true;
});

document.getElementById('prevMonth').addEventListener('click', () => {
  state.month -= 1;
  if (state.month < 1) { state.month = 12; state.year -= 1; }
  renderMonth();
});

document.getElementById('nextMonth').addEventListener('click', () => {
  state.month += 1;
  if (state.month > 12) { state.month = 1; state.year += 1; }
  renderMonth();
});

renderMonth();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('[meal-calendar] SW 등록 실패', err);
    });
  });
}
