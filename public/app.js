import { buildMonthGrid, dayStatus } from '/src/lib/calendarGrid.js';
import { buildGoalProfile, ImpossibleTargetError } from '/src/lib/metabolism.js';
import { calcDayTotals } from '/src/lib/dayTotals.js';
import * as db from '/public/db.js';

const FALLBACK_TARGET_KCAL = 2000; // 목표를 아직 안 정한 사용자용. 저장되지 않는다
const LEGACY_PROFILE_KEY = 'meal-calendar:profile-v1'; // Phase 2 의 localStorage. 1회 이관 후 지운다

const SLOT_LABELS = [
  ['breakfast', '아침'],
  ['lunch', '점심'],
  ['dinner', '저녁'],
  ['snack', '간식'],
];

const STATUS_LABEL = {
  under: { symbol: '▽', text: '미달' },
  ok: { symbol: '●', text: '달성' },
  over: { symbol: '△', text: '초과' },
  none: { symbol: '·', text: '미기록' },
};

function todayLocalDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const state = {
  year: Number(todayLocalDate().slice(0, 4)),
  month: Number(todayLocalDate().slice(5, 7)), // 1~12
  monthData: new Map(), // 'YYYY-MM-DD' -> day 문서
  goal: null, // 현재 유효한 목표 (없으면 null)
  openDate: null, // 일간 상세로 열어둔 날짜
  pendingSlot: null, // 항목 추가 중인 슬롯 키
};

const el = {
  monthLabel: document.getElementById('monthLabel'),
  grid: document.getElementById('grid'),
  detail: document.getElementById('dayDetail'),
  detailDate: document.getElementById('detailDate'),
  totalKcal: document.getElementById('totalKcal'),
  kcalBar: document.getElementById('kcalBar'),
  macroRow: document.getElementById('macroRow'),
  slots: document.getElementById('slots'),
  saveState: document.getElementById('saveState'),
  settings: document.getElementById('settings'),
  profileForm: document.getElementById('profileForm'),
  formError: document.getElementById('formError'),
  formResult: document.getElementById('formResult'),
  entrySheet: document.getElementById('entryForm'),
  entryForm: document.getElementById('manualEntryForm'),
  entryTitle: document.getElementById('entryTitle'),
  entryError: document.getElementById('entryError'),
};

function targetKcal() {
  return state.goal?.kcal ?? FALLBACK_TARGET_KCAL;
}

function emptySlots() {
  return { breakfast: [], lunch: [], dinner: [], snack: [] };
}

// ── 저장 상태 표시 ────────────────────────────────────────────────────
// 실패한 쓰기를 조용히 삼키지 않는다 (AGENTS.md 절대규칙 6).
function setSaveState(kind, text) {
  if (!kind) {
    el.saveState.hidden = true;
    return;
  }
  el.saveState.hidden = false;
  el.saveState.className = `save-state ${kind}`;
  el.saveState.textContent = text;
}

// ── 캘린더 ────────────────────────────────────────────────────────────

function renderMonth() {
  const today = todayLocalDate();
  const target = targetKcal();
  el.monthLabel.textContent = `${state.year}년 ${state.month}월`;

  const cells = buildMonthGrid({ year: state.year, month: state.month, weekStartsOn: 0 });
  el.grid.innerHTML = '';

  for (const cell of cells) {
    const day = state.monthData.get(cell.date);
    const kcal = day?.totals?.kcal ?? 0;
    const hasRecord = Boolean(day) && kcal > 0;
    const status = dayStatus({ kcal, targetKcal: target, hasRecord });
    const label = STATUS_LABEL[status];

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `day day-${status}${cell.inCurrentMonth ? '' : ' day-outside'}${cell.date === today ? ' day-today' : ''}`;
    button.dataset.date = cell.date;
    button.setAttribute(
      'aria-label',
      `${cell.date}, ${label.text}${hasRecord ? `, ${kcal}kcal` : ''}`,
    );
    button.innerHTML = `
      <span class="day-num">${cell.dayOfMonth}</span>
      <span class="day-kcal">${hasRecord ? Math.round(kcal) : ''}</span>
      <span class="day-badge">${label.symbol} ${label.text}</span>
    `;
    button.addEventListener('click', () => openDayDetail(cell.date));
    el.grid.appendChild(button);
  }
}

async function loadMonthData() {
  try {
    state.monthData = await db.loadMonth(state.year, state.month);
  } catch (err) {
    console.error('[meal-calendar] 월 데이터 로드 실패', err);
    state.monthData = new Map();
  }
  renderMonth();
}

// ── 일간 상세 ─────────────────────────────────────────────────────────

function currentDay() {
  return state.monthData.get(state.openDate) ?? { slots: emptySlots(), totals: null };
}

function renderDayDetail() {
  const day = currentDay();
  const slots = { ...emptySlots(), ...(day.slots ?? {}) };
  const totals = calcDayTotals(slots);
  const target = targetKcal();

  el.detailDate.textContent = state.openDate;
  el.totalKcal.textContent = `${Math.round(totals.kcal)} / ${target} kcal`;
  el.kcalBar.style.width = `${Math.min(100, Math.round((totals.kcal / target) * 100))}%`;

  el.macroRow.textContent = state.goal
    ? `탄 ${Math.round(totals.carbG)}/${state.goal.carbG}g · 단 ${Math.round(totals.proteinG)}/${state.goal.proteinG}g · 지 ${Math.round(totals.fatG)}/${state.goal.fatG}g`
    : `탄 ${Math.round(totals.carbG)}g · 단 ${Math.round(totals.proteinG)}g · 지 ${Math.round(totals.fatG)}g`;

  el.slots.innerHTML = '';
  for (const [key, label] of SLOT_LABELS) {
    const entries = slots[key] ?? [];
    const section = document.createElement('section');
    section.className = 'slot';

    const head = document.createElement('div');
    head.className = 'slot-head';
    head.innerHTML = `<h3>${label}</h3>`;
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'slot-add';
    addButton.textContent = '+ 추가';
    addButton.addEventListener('click', () => openEntryForm(key, label));
    head.appendChild(addButton);
    section.appendChild(head);

    const list = document.createElement('div');
    list.className = 'slot-items';
    if (entries.length === 0) {
      list.textContent = '— 아직 기록 없음';
    } else {
      entries.forEach((entry, index) => {
        const line = document.createElement('div');
        line.className = 'entry-line';

        const name = document.createElement('span');
        name.className = 'entry-name';
        name.textContent = `${entry.name} ${entry.amountG}g`;

        const kcal = document.createElement('span');
        kcal.className = 'entry-kcal';
        kcal.textContent = `${Math.round(entry.kcal)} kcal`;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'entry-del';
        remove.setAttribute('aria-label', `${entry.name} 삭제`);
        remove.textContent = '×';
        remove.addEventListener('click', () => removeEntry(key, index));

        line.append(name, kcal, remove);
        list.appendChild(line);
      });
    }
    section.appendChild(list);
    el.slots.appendChild(section);
  }
}

async function openDayDetail(dateStr) {
  state.openDate = dateStr;
  setSaveState(null);

  // 월 조회에 없던 날이어도 개별 조회로 한 번 더 확인한다 (다른 기기에서 방금 쓴 경우)
  if (!state.monthData.has(dateStr)) {
    try {
      const day = await db.loadDay(dateStr);
      if (day) state.monthData.set(dateStr, day);
    } catch (err) {
      console.error('[meal-calendar] 하루 조회 실패', err);
    }
  }

  renderDayDetail();
  el.detail.hidden = false;
}

async function persistDay(slots) {
  const totals = calcDayTotals(slots);
  const day = { ...currentDay(), slots, totals, date: state.openDate };
  state.monthData.set(state.openDate, day);

  renderDayDetail();
  renderMonth();
  setSaveState('pending', '저장 중…');

  try {
    await db.saveDay(state.openDate, { slots, totals });
    setSaveState(null);
  } catch (err) {
    console.error('[meal-calendar] 저장 실패', err);
    setSaveState('failed', '저장 실패 — 화면에는 반영됐지만 서버에 안 올라갔다. 네트워크 확인 후 다시 시도해라.');
  }
}

async function removeEntry(slotKey, index) {
  const day = currentDay();
  const slots = { ...emptySlots(), ...(day.slots ?? {}) };
  slots[slotKey] = slots[slotKey].filter((_, i) => i !== index);
  await persistDay(slots);
}

document.getElementById('closeDetail').addEventListener('click', () => {
  el.detail.hidden = true;
  state.openDate = null;
});

// ── 항목 추가 ─────────────────────────────────────────────────────────

function openEntryForm(slotKey, slotLabel) {
  state.pendingSlot = slotKey;
  el.entryTitle.textContent = `${slotLabel} 항목 추가`;
  el.entryForm.reset();
  el.entryError.hidden = true;
  el.entrySheet.hidden = false;
}

document.getElementById('closeEntry').addEventListener('click', () => {
  el.entrySheet.hidden = true;
  state.pendingSlot = null;
});

el.entryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  el.entryError.hidden = true;

  const data = new FormData(el.entryForm);
  const entry = {
    foodKey: `manual_${crypto.randomUUID()}`,
    name: String(data.get('name')).trim(),
    amountG: Number(data.get('amountG')),
    kcal: Number(data.get('kcal')),
    carbG: Number(data.get('carbG')),
    proteinG: Number(data.get('proteinG')),
    fatG: Number(data.get('fatG')),
    addedBy: 'manual',
    at: new Date().toISOString(),
  };

  const invalid = ['amountG', 'kcal', 'carbG', 'proteinG', 'fatG']
    .find((field) => !Number.isFinite(entry[field]) || entry[field] < 0);
  if (!entry.name || invalid) {
    el.entryError.hidden = false;
    el.entryError.textContent = invalid
      ? `${invalid} 값이 올바르지 않다. 0 이상의 숫자를 넣어라.`
      : '이름을 입력해라.';
    return;
  }

  const day = currentDay();
  const slots = { ...emptySlots(), ...(day.slots ?? {}) };
  slots[state.pendingSlot] = [...slots[state.pendingSlot], entry];

  el.entrySheet.hidden = true;
  state.pendingSlot = null;
  await persistDay(slots);
});

// ── 달 이동 ───────────────────────────────────────────────────────────

document.getElementById('prevMonth').addEventListener('click', () => {
  state.month -= 1;
  if (state.month < 1) { state.month = 12; state.year -= 1; }
  loadMonthData();
});

document.getElementById('nextMonth').addEventListener('click', () => {
  state.month += 1;
  if (state.month > 12) { state.month = 1; state.year += 1; }
  loadMonthData();
});

// ── 목표 설정 ─────────────────────────────────────────────────────────

function showResult(result) {
  el.formResult.hidden = false;
  el.formResult.innerHTML = `
    BMR <b>${result.bmr}</b> kcal · TDEE <b>${result.tdee}</b> kcal<br>
    목표 <b>${result.kcal}</b> kcal
    (탄 ${result.carbG}g · 단 ${result.proteinG}g · 지 ${result.fatG}g)
  `;
}

async function fillFormFromProfile() {
  let profile = null;
  try {
    profile = await db.loadProfile();
  } catch (err) {
    console.error('[meal-calendar] 프로필 조회 실패', err);
  }
  if (!profile) return;

  el.profileForm.sex.value = profile.sex;
  el.profileForm.heightCm.value = profile.heightCm;
  el.profileForm.weightKg.value = profile.weightKg;
  el.profileForm.birthYear.value = profile.birthYear;
  el.profileForm.weeklyWorkouts.value = String(profile.weeklyWorkouts);
  el.profileForm.goal.value = profile.goal;
  if (state.goal) showResult(state.goal);
}

document.getElementById('openSettings').addEventListener('click', () => {
  el.formError.hidden = true;
  el.settings.hidden = false;
  fillFormFromProfile();
});

document.getElementById('closeSettings').addEventListener('click', () => {
  el.settings.hidden = true;
});

el.profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  el.formError.hidden = true;

  const data = new FormData(el.profileForm);
  const profile = {
    sex: data.get('sex'),
    heightCm: Number(data.get('heightCm')),
    weightKg: Number(data.get('weightKg')),
    birthYear: Number(data.get('birthYear')),
    weeklyWorkouts: Number(data.get('weeklyWorkouts')),
    goal: data.get('goal'),
  };

  let result;
  try {
    result = buildGoalProfile({
      sex: profile.sex,
      heightCm: profile.heightCm,
      weightKg: profile.weightKg,
      age: new Date().getFullYear() - profile.birthYear,
      weeklyWorkouts: profile.weeklyWorkouts,
      goal: profile.goal,
    });
  } catch (err) {
    el.formError.hidden = false;
    el.formError.textContent = err instanceof ImpossibleTargetError
      ? '이 조합으로는 목표를 계산할 수 없다 (탄수화물이 음수가 됨). 목적이나 체중을 다시 확인해라.'
      : err.message;
    el.formResult.hidden = true;
    return;
  }

  showResult(result);

  const goal = { ...result, mode: profile.goal };
  try {
    await db.saveProfile(profile);
    await db.saveGoal(todayLocalDate(), goal);
    state.goal = goal;
    renderMonth();
  } catch (err) {
    console.error('[meal-calendar] 목표 저장 실패', err);
    el.formError.hidden = false;
    el.formError.textContent = '계산은 됐지만 저장에 실패했다. 네트워크 확인 후 다시 눌러라.';
  }
});

// ── Phase 2 → 3 이관 ──────────────────────────────────────────────────
// localStorage 에 있던 프로필을 Firestore 로 한 번 옮기고 지운다.
// 실패하면 localStorage 를 그대로 둔다 — 다음 실행에서 다시 시도한다.
async function migrateLegacyProfile() {
  const raw = localStorage.getItem(LEGACY_PROFILE_KEY);
  if (!raw) return;

  try {
    const { input, result } = JSON.parse(raw);
    if (!input || typeof result?.kcal !== 'number') {
      localStorage.removeItem(LEGACY_PROFILE_KEY);
      return;
    }
    if (await db.loadProfile()) {
      localStorage.removeItem(LEGACY_PROFILE_KEY); // 이미 서버에 있으면 로컬 것은 버린다
      return;
    }
    await db.saveProfile(input);
    await db.saveGoal(todayLocalDate(), { ...result, mode: input.goal });
    localStorage.removeItem(LEGACY_PROFILE_KEY);
    console.info('[meal-calendar] localStorage 프로필을 Firestore 로 옮겼다');
  } catch (err) {
    console.error('[meal-calendar] 프로필 이관 실패 — 다음 실행에서 다시 시도한다', err);
  }
}

// ── 시작 ──────────────────────────────────────────────────────────────

async function start() {
  renderMonth(); // 로그인 전에도 빈 그리드는 보여준다

  try {
    await db.signIn();
  } catch (err) {
    console.error('[meal-calendar] 로그인 실패', err);
    setSaveState('failed', '로그인 실패 — 기록을 저장할 수 없다.');
    return;
  }

  await migrateLegacyProfile();

  try {
    state.goal = await db.loadGoalFor(todayLocalDate());
  } catch (err) {
    console.error('[meal-calendar] 목표 조회 실패', err);
  }

  await loadMonthData();
}

start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('[meal-calendar] SW 등록 실패', err);
    });
  });
}
