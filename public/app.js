import { buildMonthGrid, dayStatus } from '/src/lib/calendarGrid.js';
import { buildGoalProfile, ImpossibleTargetError } from '/src/lib/metabolism.js';
import { calcDayTotals } from '/src/lib/dayTotals.js';
import { scaleNutrients } from '/src/lib/units.js';
import { validateSignUpForm } from '/src/lib/authValidation.js';
import { authErrorMessage, validationMessage } from '/src/lib/authMessages.js';
import {
  parseQuickFoodInput, selectBestFood, hasNameMatch, SERVING_SOURCE_LABELS,
} from '/src/lib/quickFoodInput.js';

// db.js 는 동적 import 로 부른다 — 정적으로 import 하면 그 안의 Firebase SDK(gstatic CDN)가
// 전부 받아질 때까지 이 모듈 전체의 실행이 밀린다. 캘린더 그리드는 네트워크 없이 그릴 수 있는데
// 첫 화면이 몇 초씩 빈 채로 있었던 이유가 이거였다 — 실기기 실측으로 발견.
let db = null;
const dbReady = import('/public/db.js').then((mod) => { db = mod; });

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
  // 「아직 모름」. 미기록과 구분해야 한다 — 로딩·실패를 미기록으로 그리면
  // 사용자가 기록이 사라졌다고 읽는다.
  unknown: { symbol: '·', text: '…' },
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
  auth: null, // null | { uid, isAnonymous, email, emailVerified }
  bootedUid: null, // 마지막으로 데이터를 읽은 uid. null 이면 아직 안 읽었다 (I2 — uid 로 키를 잡는다)
  // 'idle' | 'loading' | 'error'. 「아직 모름」과 「기록 없음」은 다른 상태다 —
  // 이걸 구분하지 않으면 로딩 중인 달이 「미기록」으로 그려져서 사용자가 기록이
  // 날아갔다고 믿는다. 실기기에서 실제로 그렇게 오해했다 (2026-08-13).
  // 초기값이 'loading' 인 게 중요하다. start() 는 인증이 풀리기 전에 renderMonth() 를 먼저
  // 부르는데(그리드를 즉시 보여주려고), 이때 'idle' 이면 아직 아무것도 안 읽은 빈 Map 을
  // 「전부 미기록」으로 그린다 — 고치려는 증상 그 자체다.
  monthState: 'loading',
};

const el = {
  monthLabel: document.getElementById('monthLabel'),
  monthNotice: document.getElementById('monthNotice'),
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
  manualRatio: document.getElementById('manualRatio'),
  entrySheet: document.getElementById('entryForm'),
  entryForm: document.getElementById('manualEntryForm'),
  entryTitle: document.getElementById('entryTitle'),
  entryError: document.getElementById('entryError'),
  quickPresets: document.getElementById('quickPresets'),
  presetChips: document.getElementById('presetChips'),
  quickRecent: document.getElementById('quickRecent'),
  recentChips: document.getElementById('recentChips'),
  copyYesterday: document.getElementById('copyYesterday'),
  entryChooser: document.getElementById('entryChooser'),
  searchForm: document.getElementById('foodSearchForm'),
  searchInput: document.getElementById('searchInput'),
  searchStatus: document.getElementById('searchStatus'),
  searchResults: document.getElementById('searchResults'),
  portionPrompt: document.getElementById('portionPrompt'),
  portionTitle: document.getElementById('portionTitle'),
  portionAmount: document.getElementById('portionAmount'),
  portionPreview: document.getElementById('portionPreview'),
  servingChips: document.getElementById('servingChips'),
  servingNote: document.getElementById('servingNote'),
  confirmPortion: document.getElementById('confirmPortion'),
  cancelPortion: document.getElementById('cancelPortion'),
  authGate: document.getElementById('authGate'),
  guestStart: document.getElementById('guestStart'),
  gateSignUpForm: document.getElementById('gateSignUpForm'),
  gateSignInForm: document.getElementById('gateSignInForm'),
  gateError: document.getElementById('gateError'),
  gateTabSignUp: document.getElementById('gateTabSignUp'),
  gateTabSignIn: document.getElementById('gateTabSignIn'),
  gateForgot: document.getElementById('gateForgot'),
  accountSection: document.getElementById('accountSection'),
  accountGuest: document.getElementById('accountGuest'),
  accountMember: document.getElementById('accountMember'),
  accountEmail: document.getElementById('accountEmail'),
  verifyWarn: document.getElementById('verifyWarn'),
  resendVerify: document.getElementById('resendVerify'),
  upgradeForm: document.getElementById('upgradeForm'),
  upgradeError: document.getElementById('upgradeError'),
  memberNotice: document.getElementById('memberNotice'),
  signOutBtn: document.getElementById('signOutBtn'),
  switchAccountBtn: document.getElementById('switchAccountBtn'),
  conflictPrompt: document.getElementById('conflictPrompt'),
  conflictText: document.getElementById('conflictText'),
  conflictAbandon: document.getElementById('conflictAbandon'),
  conflictCancel: document.getElementById('conflictCancel'),
};

function targetKcal() {
  return state.goal?.kcal ?? FALLBACK_TARGET_KCAL;
}

function emptySlots() {
  return { breakfast: [], lunch: [], dinner: [], snack: [] };
}

function buildEntry({
  foodKey, name, amountG, kcal, carbG, proteinG, fatG, addedBy, estimate, matchedFoodName,
}) {
  return {
    foodKey: foodKey ?? `manual_${crypto.randomUUID()}`,
    name, amountG, kcal, carbG, proteinG, fatG,
    addedBy,
    at: new Date().toISOString(),
    ...(estimate ? { estimate } : {}),
    // 빠른 기록으로 검색 결과가 실제 매칭된 식품명 — g 명시 경로에서도 항상 남긴다 (I5).
    // 사용자가 뜻한 이름(entry.name)과 다를 수 있으므로 어떤 식품의 숫자가 들어갔는지 추적한다.
    ...(matchedFoodName ? { matchedFoodName } : {}),
  };
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

  // 아직 안 읽었거나 읽기에 실패했으면 「미기록」이라고 말하지 않는다.
  // 모르는 것을 없다고 단정하는 표시다 (절대규칙 7).
  const known = state.monthState === 'idle';
  el.monthNotice.hidden = known;
  if (state.monthState === 'loading') {
    el.monthNotice.className = 'month-notice';
    el.monthNotice.textContent = '기록을 불러오는 중…';
  } else if (state.monthState === 'error') {
    el.monthNotice.className = 'month-notice month-notice-error';
    el.monthNotice.textContent = '기록을 불러오지 못했습니다. 아래 달력은 비어 보이지만 지워진 것이 아닙니다.';
  }

  for (const cell of cells) {
    const day = state.monthData.get(cell.date);
    const kcal = day?.totals?.kcal ?? 0;
    const hasRecord = Boolean(day) && kcal > 0;
    const status = known ? dayStatus({ kcal, targetKcal: target, hasRecord }) : 'unknown';
    const label = STATUS_LABEL[status];

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `day day-${status}${cell.inCurrentMonth ? '' : ' day-outside'}${cell.date === today ? ' day-today' : ''}`;
    button.dataset.date = cell.date;
    button.setAttribute(
      'aria-label',
      `${cell.date}, ${label.text}${known && hasRecord ? `, ${kcal}kcal` : ''}`,
    );
    button.innerHTML = `
      <span class="day-num">${cell.dayOfMonth}</span>
      <span class="day-kcal">${known && hasRecord ? Math.round(kcal) : ''}</span>
      <span class="day-badge">${label.symbol} ${label.text}</span>
    `;
    button.addEventListener('click', () => openDayDetail(cell.date));
    el.grid.appendChild(button);
  }
}

async function loadMonthData() {
  state.monthState = 'loading';
  renderMonth(); // 기다리게 하지 않고 「불러오는 중」을 먼저 보여준다
  await dbReady;
  try {
    state.monthData = await db.loadMonth(state.year, state.month);
    state.monthState = 'idle';
  } catch (err) {
    console.error('[meal-calendar] 월 데이터 로드 실패', err);
    // monthData 를 비우지 않는다 — 이전 달 데이터가 남는 게, 없다고 거짓말하는 것보다 낫다.
    // 어차피 monthState 가 'error' 라 화면은 판정을 보류한다.
    state.monthState = 'error';
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
        if (entry.estimate) {
          name.textContent = `${entry.name} ${entry.estimate.displayAmount} · 추정`;
        } else {
          name.textContent = `${entry.name} ${entry.amountG}g`;
        }
        // 빠른 기록이 실제로 매칭한 식품명 — g 명시 경로에도 남긴다 (I5)
        if (entry.matchedFoodName) {
          name.title = entry.estimate
            ? `${entry.estimate.sourceLabel} · ${entry.matchedFoodName}`
            : `검색에서 매칭된 식품: ${entry.matchedFoodName}`;
        }

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
  await dbReady;

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
  await dbReady;
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

async function addEntryToSlot(slotKey, entry) {
  const day = currentDay();
  const slots = { ...emptySlots(), ...(day.slots ?? {}) };
  slots[slotKey] = [...slots[slotKey], entry];
  await persistDay(slots);

  db.pushRecentEntry(entry).catch((err) => {
    console.error('[meal-calendar] 최근 항목 갱신 실패 (기록 자체는 저장됐다)', err);
  });
}

document.getElementById('closeDetail').addEventListener('click', () => {
  el.detail.hidden = true;
  state.openDate = null;
});

// ── 항목 추가 ─────────────────────────────────────────────────────────

function renderChip(container, { text, onAdd, onDelete }) {
  const chip = document.createElement('div');
  chip.className = 'chip';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'chip-add';
  addBtn.textContent = text;
  addBtn.addEventListener('click', onAdd);
  chip.appendChild(addBtn);

  if (onDelete) {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'chip-del';
    delBtn.setAttribute('aria-label', '프리셋 삭제');
    delBtn.textContent = '×';
    delBtn.addEventListener('click', onDelete);
    chip.appendChild(delBtn);
  }

  container.appendChild(chip);
}

async function renderQuickPicks() {
  await dbReady;
  el.presetChips.innerHTML = '';
  el.recentChips.innerHTML = '';

  try {
    const presets = await db.listPresets();
    el.quickPresets.hidden = presets.length === 0;
    for (const preset of presets) {
      renderChip(el.presetChips, {
        text: `${preset.label} · ${Math.round(preset.entry.kcal)}kcal`,
        onAdd: async () => {
          el.entrySheet.hidden = true;
          await addEntryToSlot(state.pendingSlot, buildEntry({ ...preset.entry, addedBy: 'preset' }));
        },
        onDelete: async () => {
          await db.deletePreset(preset.id);
          renderQuickPicks();
        },
      });
    }
  } catch (err) {
    console.error('[meal-calendar] 프리셋 조회 실패', err);
  }

  try {
    const recent = await db.loadRecentEntries();
    el.quickRecent.hidden = recent.length === 0;
    for (const item of recent) {
      renderChip(el.recentChips, {
        text: `${item.name} · ${Math.round(item.kcal)}kcal`,
        onAdd: async () => {
          el.entrySheet.hidden = true;
          await addEntryToSlot(state.pendingSlot, buildEntry({ ...item, addedBy: item.addedBy ?? 'manual' }));
        },
      });
    }
  } catch (err) {
    console.error('[meal-calendar] 최근 항목 조회 실패', err);
  }
}

function openEntryForm(slotKey, slotLabel) {
  state.pendingSlot = slotKey;
  el.entryTitle.textContent = `${slotLabel} 항목 추가`;
  el.entryForm.reset();
  el.entryError.hidden = true;
  el.entrySheet.hidden = false;
  el.searchInput.value = '';
  el.searchResults.innerHTML = '';
  el.searchStatus.hidden = true;
  showPortionPrompt(false);
  renderQuickPicks();
}

document.getElementById('closeEntry').addEventListener('click', () => {
  el.entrySheet.hidden = true;
  state.pendingSlot = null;
});

// ── 빠른 기록 + 식약처 검색 ──────────────────────────────────────────

function showPortionPrompt(show) {
  el.entryChooser.hidden = show;
  el.portionPrompt.hidden = !show;
}

el.searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await dbReady;

  const parsed = parseQuickFoodInput(el.searchInput.value);
  if (parsed.reason === 'empty' || parsed.reason === 'food-required') return;
  if (parsed.reason === 'invalid-amount') {
    el.searchStatus.hidden = false;
    el.searchStatus.textContent = '수량은 0보다 크게 입력해주세요.';
    return;
  }
  const q = parsed.query;

  el.searchResults.innerHTML = '';
  el.searchStatus.hidden = false;
  el.searchStatus.textContent = parsed.ok ? '대표 중량으로 계산 중…' : '검색 중…';

  let items;
  try {
    items = await db.searchFoods(q);
  } catch (err) {
    console.error('[meal-calendar] 검색 실패', err);
    el.searchStatus.textContent = `검색 실패 — ${err.message}`;
    return;
  }

  if (items.length === 0) {
    el.searchStatus.textContent = '검색 결과 없음. 수동 입력을 이용해라.';
    return;
  }

  // 이름이 정말로 맞아떨어지는 후보가 있을 때만 자동 기록한다. selectBestFood 의 foods[0]
  // 폴백(이름이 전혀 안 맞는데 그냥 첫 결과를 고른 경우)은 확인 없이 쓰지 않는다 (I5) —
  // 엉뚱한 식품의 영양값이 조용히 들어갈 수 있기 때문이다.
  if (parsed.ok && hasNameMatch(parsed.query, items)) {
    const food = selectBestFood(parsed.query, items);
    const added = await addSearchedFood(food, parsed.amountG, parsed);
    if (!added) {
      el.searchStatus.hidden = false;
      el.searchStatus.textContent = '일부 영양값이 없어 확인이 필요합니다.';
    }
    return;
  }

  el.searchStatus.hidden = true;
  if (parsed.ok) {
    el.searchStatus.hidden = false;
    el.searchStatus.textContent = '정확히 일치하는 이름이 없습니다. 아래에서 골라주세요.';
  } else if (parsed.reason === 'unsupported-serving') {
    el.searchStatus.hidden = false;
    el.searchStatus.textContent = '이 단위는 아직 자동 환산하지 못합니다. 음식을 고른 뒤 g을 입력해주세요.';
  }

  for (const food of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-result';
    const kcalText = food.per100g.kcal == null ? '?' : Math.round(food.per100g.kcal);
    button.innerHTML = `
      <span class="r-name">${food.name}</span>
      <span class="r-meta">${food.category ?? ''} · 100g당 ${kcalText}kcal</span>
    `;
    // parsed.ok 면 사용자가 이미 입력한 양(g 명시든 개수 추정 환산이든)을 그대로 넘긴다 —
    // 이름을 못 찾았다고 이미 알려준 수량까지 지우고 100g 기본값으로 되돌리지 않는다.
    button.addEventListener('click', () => openPortionPrompt(food, parsed.ok ? parsed.amountG : undefined));
    el.searchResults.appendChild(button);
  }
});

let selectedFood = null;

function fillManualEntry(food, amountG, scaled) {
  el.entryForm.reset();
  el.entryForm.name.value = food.name;
  el.entryForm.amountG.value = amountG;
  if (scaled.kcal != null) el.entryForm.kcal.value = scaled.kcal;
  if (scaled.carbG != null) el.entryForm.carbG.value = scaled.carbG;
  if (scaled.proteinG != null) el.entryForm.proteinG.value = scaled.proteinG;
  if (scaled.fatG != null) el.entryForm.fatG.value = scaled.fatG;
  showPortionPrompt(false);
}

async function addSearchedFood(food, amountG, quickInput = null) {
  const scaled = scaleNutrients(food.per100g, amountG);
  if (Object.values(scaled).some((value) => value === null)) {
    fillManualEntry(food, amountG, scaled);
    return false;
  }

  const slotKey = state.pendingSlot;
  el.entrySheet.hidden = true;
  state.pendingSlot = null;
  showPortionPrompt(false);

  const estimate = quickInput?.estimated ? {
    displayAmount: quickInput.displayAmount,
    source: quickInput.servingSource,
    sourceLabel: SERVING_SOURCE_LABELS[quickInput.servingSource],
  } : null;

  await addEntryToSlot(slotKey, buildEntry({
    foodKey: food.foodKey,
    name: quickInput?.query ?? food.name,
    amountG,
    kcal: scaled.kcal,
    carbG: scaled.carbG,
    proteinG: scaled.proteinG,
    fatG: scaled.fatG,
    addedBy: quickInput ? 'quick' : 'search',
    estimate,
    // 빠른 기록에서만 남긴다 — 직접 검색(quickInput=null)은 entry.name 이 이미 food.name 이라
    // 중복이다. g 명시든 개수 추정이든 상관없이 항상 남긴다 (I5, 예전엔 추정 경로에만 있었다).
    matchedFoodName: quickInput ? food.name : null,
  }));
  return true;
}

function renderPortionPreview() {
  const amountG = Number(el.portionAmount.value);
  if (!Number.isFinite(amountG) || amountG < 0) {
    el.portionPreview.textContent = '양을 올바르게 입력해라.';
    return;
  }
  const scaled = scaleNutrients(selectedFood.per100g, amountG);
  el.portionPreview.innerHTML = `
    <b>${scaled.kcal ?? '?'}</b> kcal
    (탄 ${scaled.carbG ?? '?'}g · 단 ${scaled.proteinG ?? '?'}g · 지 ${scaled.fatG ?? '?'}g)
    ${Object.values(scaled).some((v) => v === null) ? '<br>일부 값이 DB에 없다 — 추가 후 수동으로 채워라.' : ''}
  `;
}

/**
 * 1인분을 아는 식품이면 「1개」 버튼들을 띄운다.
 *
 * 100g 단위 입력은 실사용과 안 맞는다 — 밥 한 줄 기록하려고 그램수를 잴 수는 없다.
 * 서버가 `serving`(= resolveServing 결과)을 실어 보내면 그 배수로 받는다.
 * **`serving` 이 null 이면 아무것도 추측하지 않고 지금처럼 g 을 받는다** —
 * 포장 총중량을 1회분으로 때우면 프로틴 1kg 통이 3,950kcal 로 기록된다.
 */
function renderServingChips(food) {
  const serving = food.serving;
  el.servingChips.innerHTML = '';
  el.servingChips.hidden = !serving;
  el.servingNote.hidden = !food.servingNote;
  if (food.servingNote) el.servingNote.textContent = `1회 제공량 표기: ${food.servingNote}`;
  if (!serving) return;

  // 단위가 mL 여도 per100g 는 100mL 기준이라(basis) 같은 산술이 성립한다
  const unit = serving.unit ?? 'g';
  for (const [label, mult] of [['½개', 0.5], ['1개', 1], ['1½개', 1.5], ['2개', 2]]) {
    const amount = Math.round(serving.amount * mult * 10) / 10;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = `${label} · ${amount}${unit}`;
    chip.addEventListener('click', () => {
      el.portionAmount.value = amount;
      renderPortionPreview();
    });
    el.servingChips.appendChild(chip);
  }
}

function openPortionPrompt(food, amountG) {
  selectedFood = food;
  el.portionTitle.textContent = food.name;
  renderServingChips(food);
  // 1인분을 알면 그걸 기본값으로. 모르면 예전처럼 100 에서 시작한다
  el.portionAmount.value = amountG ?? food.serving?.amount ?? 100;
  renderPortionPreview();
  showPortionPrompt(true);
}

el.portionAmount.addEventListener('input', () => {
  if (selectedFood) renderPortionPreview();
});

el.cancelPortion.addEventListener('click', () => {
  showPortionPrompt(false);
});

el.confirmPortion.addEventListener('click', async () => {
  const amountG = Number(el.portionAmount.value);
  if (!Number.isFinite(amountG) || amountG < 0) return;

  const scaled = scaleNutrients(selectedFood.per100g, amountG);
  if (Object.values(scaled).some((v) => v === null)) {
    // null 이 하나라도 있으면 그대로 못 넣는다 — 절대규칙7, 없는 값을 0으로 만들지 않는다.
    // 수동 입력으로 보내서 사람이 채우게 한다.
    fillManualEntry(selectedFood, amountG, scaled);
    return;
  }
  await addSearchedFood(selectedFood, amountG);
});

el.entryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  el.entryError.hidden = true;
  await dbReady;

  const data = new FormData(el.entryForm);
  const fields = {
    name: String(data.get('name')).trim(),
    amountG: Number(data.get('amountG')),
    kcal: Number(data.get('kcal')),
    carbG: Number(data.get('carbG')),
    proteinG: Number(data.get('proteinG')),
    fatG: Number(data.get('fatG')),
  };

  const invalid = ['amountG', 'kcal', 'carbG', 'proteinG', 'fatG']
    .find((field) => !Number.isFinite(fields[field]) || fields[field] < 0);
  if (!fields.name || invalid) {
    el.entryError.hidden = false;
    el.entryError.textContent = invalid
      ? `${invalid} 값이 올바르지 않다. 0 이상의 숫자를 넣어라.`
      : '이름을 입력해라.';
    return;
  }

  const saveAsPreset = data.get('saveAsPreset') === 'on';
  const slotKey = state.pendingSlot;
  el.entrySheet.hidden = true;
  state.pendingSlot = null;

  await addEntryToSlot(slotKey, buildEntry({ ...fields, addedBy: 'manual' }));

  if (saveAsPreset) {
    const { name, amountG, kcal, carbG, proteinG, fatG } = fields;
    db.savePreset(fields.name, { name, amountG, kcal, carbG, proteinG, fatG }).catch((err) => {
      console.error('[meal-calendar] 프리셋 저장 실패 (기록 자체는 저장됐다)', err);
    });
  }
});

el.copyYesterday.addEventListener('click', async () => {
  await dbReady;
  const prevDateStr = db.previousDate(state.openDate);

  let prevDay;
  try {
    prevDay = await db.loadDay(prevDateStr);
  } catch (err) {
    console.error('[meal-calendar] 어제 조회 실패', err);
    return;
  }
  if (!prevDay || !prevDay.slots) return;

  const day = currentDay();
  const slots = { ...emptySlots(), ...(day.slots ?? {}) };
  for (const [key] of SLOT_LABELS) {
    const prevEntries = prevDay.slots[key] ?? [];
    const copies = prevEntries.map((entry) => buildEntry({
      name: entry.name, amountG: entry.amountG, kcal: entry.kcal,
      carbG: entry.carbG, proteinG: entry.proteinG, fatG: entry.fatG,
      addedBy: entry.addedBy ?? 'manual',
    }));
    slots[key] = [...slots[key], ...copies];
  }

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
  await dbReady;
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

// DECISIONS.md 2번의 되돌리는 조건: "수동 입력 비율이 30% 넘으면 상용 식품 DB를 다시 본다."
// 감으로 판단하지 않도록 이 비율을 앱이 직접 센다. 이번 달 로드된 데이터 기준 — 3개월
// 전체를 매번 스캔하면 비싸다. 판단은 사람이 직접 3개월 추이를 보고 한다.
function renderManualRatio() {
  let total = 0;
  let manual = 0;
  for (const day of state.monthData.values()) {
    for (const key of ['breakfast', 'lunch', 'dinner', 'snack']) {
      for (const entry of day.slots?.[key] ?? []) {
        total += 1;
        if (entry.addedBy === 'manual') manual += 1;
      }
    }
  }

  if (total === 0) {
    el.manualRatio.hidden = true;
    return;
  }
  const pct = Math.round((manual / total) * 100);
  el.manualRatio.hidden = false;
  el.manualRatio.textContent = `이번 달 수동 입력 비율: ${manual}/${total} (${pct}%)`
    + (pct > 30 ? ' — 30% 초과. 식품 DB 검색(Phase 7)을 앞당길 만하다.' : '');
}

document.getElementById('openSettings').addEventListener('click', () => {
  el.formError.hidden = true;
  el.settings.hidden = false;
  fillFormFromProfile();
  renderManualRatio();
});

let armTimer = null; // 2단계 확인의 '무장' 상태를 자동으로 풀기 위한 타이머 (I3)

function resetDestructiveConfirmations() {
  clearTimeout(armTimer);
  el.switchAccountBtn.dataset.armed = '';
  el.switchAccountBtn.textContent = '다른 계정으로 로그인';
  el.conflictAbandon.dataset.armed = '';
  el.conflictAbandon.textContent = '기록을 포기하고 그 계정으로 로그인';
}

/**
 * 2단계 확인의 1단계 — 버튼을 '무장'하고 경고 문구로 바꾼다.
 * 무장 상태를 무기한 유지하면, 시트를 열어둔 채 한참 있다가 실수로 같은 버튼을 스치는
 * 것만으로 되돌릴 수 없는 동작이 실행된다. 5초 뒤 자동으로 풀리게 한다 (I3).
 */
function armDestructive(button, warnLabel) {
  button.dataset.armed = 'yes';
  button.textContent = warnLabel;
  clearTimeout(armTimer);
  armTimer = setTimeout(resetDestructiveConfirmations, 5000);
}

function closeSettings() {
  resetDestructiveConfirmations();
  el.settings.hidden = true;
}

document.getElementById('closeSettings').addEventListener('click', closeSettings);

el.profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  el.formError.hidden = true;
  await dbReady;

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

// ── 인증 ──────────────────────────────────────────────────────────────
// observeAuth 콜백 하나가 게이트↔캘린더 전환과 설정 계정 섹션을 동시에 담당한다.
// 화면 상태를 두 군데서 따로 계산하면 어긋난다.

function showAuthError(target, message) {
  target.hidden = false;
  target.textContent = message;
}

function clearAuthError(target) {
  target.hidden = true;
  target.textContent = '';
}

/** 폼 검증 → 실패하면 문구를 띄우고 null 을 돌려준다. */
function readCredentialForm(form, errorBox) {
  const data = new FormData(form);
  const fields = {
    email: String(data.get('email') ?? '').trim(),
    password: String(data.get('password') ?? ''),
    confirm: String(data.get('confirm') ?? ''),
  };

  const verdict = validateSignUpForm(fields);
  if (!verdict.ok) {
    showAuthError(errorBox, validationMessage(verdict.field, verdict.reason));
    return null;
  }
  clearAuthError(errorBox);
  return fields;
}

function renderAccountSection(user) {
  el.conflictPrompt.hidden = true;
  el.upgradeForm.hidden = false;
  resetDestructiveConfirmations();
  clearAuthError(el.memberNotice); // 회원 전용 알림도 상태 전환마다 같이 비운다 (C2)

  if (!user) {
    el.accountSection.hidden = true; // 로그인 전에는 「계정」 빈 상자가 안 보이게 한다 (M6)
    el.accountGuest.hidden = true;
    el.accountMember.hidden = true;
    return;
  }

  el.accountSection.hidden = false;
  el.accountGuest.hidden = !user.isAnonymous;
  el.accountMember.hidden = user.isAnonymous;

  if (!user.isAnonymous) {
    el.accountEmail.textContent = user.email ?? '(이메일 없음)';
    el.verifyWarn.hidden = user.emailVerified;
    el.resendVerify.hidden = user.emailVerified;
  }
}

/**
 * 인증 상태가 바뀔 때마다 불린다.
 * user 가 있으면 게이트를 숨기고, 아직 그 uid 로 데이터를 안 읽었으면 그때 읽는다.
 * uid 로 키를 잡은 래치가 없으면 이메일 인증 상태 갱신 같은 사소한 변화마다 한 달치를 다시
 * 읽는다. 단순 boolean 이었으면 계정이 로그아웃 없이 바뀌는 경로(handleEmailInUse 의
 * 「빈 계정이면 갈아탄다」 분기)에서 새 uid 의 데이터를 다시 안 읽는 버그가 생긴다 (I2).
 */
async function applyAuthState(user) {
  state.auth = user;
  renderAccountSection(user);

  if (!user) {
    el.settings.hidden = true;
    el.authGate.hidden = false;
    state.bootedUid = null;
    return;
  }

  el.authGate.hidden = true;
  if (state.bootedUid === user.uid) return;
  state.bootedUid = user.uid;
  state.monthData = new Map(); // 계정이 바뀌었으면 이전 계정 데이터를 들고 있지 않는다
  state.goal = null;

  await migrateLegacyProfile();

  // 목표 조회와 월 데이터 조회는 서로 독립이다. 순차로 await 하면 네트워크 왕복 두 번을
  // 줄줄이 기다리게 되고, 모바일 회선에서 이게 첫 화면 지연으로 그대로 보인다.
  // 목표가 늦게 와도 loadMonthData 가 끝나면서 renderMonth 를 다시 부르므로 달성률은 맞는다.
  const goalLoad = db.loadGoalFor(todayLocalDate())
    .then((goal) => { state.goal = goal; })
    .catch((err) => { console.error('[meal-calendar] 목표 조회 실패', err); });

  await Promise.all([goalLoad, loadMonthData()]);
  renderMonth(); // 목표가 월 데이터보다 늦게 왔을 수 있다 — 최종 상태로 한 번 더 그린다
}

function selectGateTab(mode) {
  const isSignUp = mode === 'signup';
  el.gateTabSignUp.setAttribute('aria-selected', String(isSignUp));
  el.gateTabSignIn.setAttribute('aria-selected', String(!isSignUp));
  el.gateSignUpForm.hidden = !isSignUp;
  el.gateSignInForm.hidden = isSignUp;
  clearAuthError(el.gateError);
}

/**
 * 버튼을 잠그고 작업을 돌린다. 실패하면 문구를 띄운다 — 조용히 삼키지 않는다 (절대규칙 7).
 *
 * **주의:** 성공하면 errorBox 를 비우고 버튼 라벨을 원래대로 되돌린다.
 * 그러니 성공 안내 문구나 라벨 변경은 `action` **안에서 하지 말고**
 * 이 함수가 resolve 된 뒤에 한다 — 안에서 하면 여기서 덮어쓴다.
 */
async function runAuthAction(button, errorBox, action) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '처리 중…';
  try {
    await action();
    clearAuthError(errorBox);
  } catch (err) {
    console.error('[meal-calendar] 인증 실패', err);
    // authErrorMessage 는 code 가 문자열·null·undefined 가 아니면 TypeError 를 던진다.
    // err.code 가 숫자인 경우가 있다(브라우저 DOMException.code 등) — 여기서 그대로
    // authErrorMessage(err?.code) 를 부르면 인자 평가 중에 던지고, showAuthError 는 아예
    // 호출되지 못한 채 이 오류가 통째로 삼켜진다 (I1). 문자열일 때만 매핑을 쓴다.
    const code = typeof err?.code === 'string' ? err.code : null;
    showAuthError(
      errorBox,
      code ? authErrorMessage(code) : `문제가 생겼습니다. (${err?.message ?? err})`,
    );
    throw err;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function bindAuthHandlers() {
  el.gateTabSignUp.addEventListener('click', () => selectGateTab('signup'));
  el.gateTabSignIn.addEventListener('click', () => selectGateTab('signin'));

  el.guestStart.addEventListener('click', () => {
    runAuthAction(el.guestStart, el.gateError, () => db.startGuest()).catch(() => {});
  });

  el.gateSignUpForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = readCredentialForm(el.gateSignUpForm, el.gateError);
    if (!fields) return;
    const button = el.gateSignUpForm.querySelector('button[type="submit"]');
    runAuthAction(button, el.gateError, () => db.signUp(fields.email, fields.password))
      .catch(() => {});
  });

  el.gateSignInForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(el.gateSignInForm);
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    if (!email || !password) {
      showAuthError(el.gateError, '이메일과 비밀번호를 모두 입력해주세요.');
      return;
    }
    const button = el.gateSignInForm.querySelector('button[type="submit"]');
    runAuthAction(button, el.gateError, () => db.signInWithPassword(email, password))
      .catch(() => {});
  });

  el.gateForgot.addEventListener('click', () => {
    const email = String(new FormData(el.gateSignInForm).get('email') ?? '').trim();
    if (!email) {
      showAuthError(el.gateError, '재설정 메일을 받을 이메일을 먼저 입력해주세요.');
      return;
    }
    // 성공 문구는 runAuthAction 밖에서 띄운다 — 안에서 띄우면 성공 직후 clearAuthError 가 지운다
    runAuthAction(el.gateForgot, el.gateError, () => db.sendReset(email))
      .then(() => showAuthError(el.gateError, `${email} 로 재설정 메일을 보냈습니다.`))
      .catch(() => {});
  });

  // #upgradeError 는 #accountGuest 안에 있어서 회원 상태(#accountMember)에서는 조상이
  // 숨겨진다 — hidden = false 를 걸어도 화면에 안 나타난다. 회원 전용 액션은 #accountMember
  // 안의 #memberNotice 로 보낸다 (C2).
  el.resendVerify.addEventListener('click', () => {
    runAuthAction(el.resendVerify, el.memberNotice, () => db.resendVerification())
      .then(() => showAuthError(el.memberNotice, '인증 메일을 다시 보냈습니다.'))
      .catch(() => {});
  });

  el.signOutBtn.addEventListener('click', () => {
    runAuthAction(el.signOutBtn, el.memberNotice, () => db.signOutUser()).catch(() => {});
  });

  bindUpgradeHandlers();
}

// 이메일이 이미 다른 계정에 쓰이고 있을 때 쓰는 보류 상태.
// 「기록을 포기하고 그 계정으로 로그인」을 눌렀을 때 어떤 자격으로 갈지 기억한다.
let pendingConflict = null;

const IN_USE_CODES = new Set([
  'auth/email-already-in-use',
  'auth/credential-already-in-use',
]);

/**
 * 중복 이메일 충돌 처리.
 * - 현재 익명 계정이 비어 있으면 손실이 없으므로 곧바로 갈아탄다
 * - 기록이 있으면 멈추고 「몇 건이 넘어가지 않는지」를 숫자로 보여준다 (절대규칙 7)
 */
async function handleEmailInUse(email, password) {
  if (!(await db.hasAnyData())) {
    await db.signInWithPassword(email, password);
    return;
  }

  const dayCount = await db.countDays();
  pendingConflict = { email, password };
  el.conflictText.textContent =
    `이 이메일은 이미 다른 계정에 쓰이고 있습니다. `
    + `이 기기의 기록 ${dayCount}일치는 그 계정으로 넘어가지 않고 사라집니다.`;
  el.conflictPrompt.hidden = false;
  el.upgradeForm.hidden = true;
}

function cancelConflict() {
  pendingConflict = null;
  resetDestructiveConfirmations();
  el.conflictPrompt.hidden = true;
  el.upgradeForm.hidden = false;
  clearAuthError(el.upgradeError);
}

function bindUpgradeHandlers() {
  el.upgradeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = readCredentialForm(el.upgradeForm, el.upgradeError);
    if (!fields) return;

    const button = el.upgradeForm.querySelector('button[type="submit"]');
    runAuthAction(button, el.upgradeError, async () => {
      try {
        await db.signUp(fields.email, fields.password);
      } catch (err) {
        if (!IN_USE_CODES.has(err?.code)) throw err;
        await handleEmailInUse(fields.email, fields.password);
      }
    }).catch(() => {});
  });

  el.conflictCancel.addEventListener('click', cancelConflict);

  // 2단계 확인. 첫 탭에서는 문구만 바꾸고, 같은 버튼을 한 번 더 눌러야 실행된다.
  el.conflictAbandon.addEventListener('click', () => {
    if (el.conflictAbandon.dataset.armed !== 'yes') {
      armDestructive(el.conflictAbandon, '정말 포기합니다 — 한 번 더 누르세요');
      return;
    }
    const credential = pendingConflict;
    if (!credential) return;
    // signOutUser() 를 먼저 부르지 않는다 (C1). 익명 계정은 로그아웃하는 순간 uid 를 되찾을
    // 방법이 없는데, 여기 넘어오는 password 는 방금 가입 폼에 사용자가 새로 입력한 값이라
    // 그 계정의 실제 비밀번호라는 보장이 전혀 없다. signInWithEmailAndPassword 는 다른
    // 사용자(익명 포함)가 로그인된 상태에서도 그대로 동작하며 currentUser 를 교체하므로
    // 명시적 로그아웃이 애초에 필요 없다 — 로그인이 실패해도 지금 익명 세션은 그대로 남아
    // 기록을 잃지 않는다.
    // 라벨 되돌리기도 runAuthAction 밖에서 한다 — finally 가 '무장된' 라벨로 복원해버린다
    runAuthAction(
      el.conflictAbandon,
      el.upgradeError,
      () => db.signInWithPassword(credential.email, credential.password),
    ).then(() => {
      pendingConflict = null;
      el.conflictAbandon.dataset.armed = '';
      el.conflictAbandon.textContent = '기록을 포기하고 그 계정으로 로그인';
    }).catch(() => {
      // 로그인 실패 — 익명 세션은 그대로다. 무장 상태만 풀어서 반무장 버튼으로 남기지 않는다.
      el.conflictAbandon.dataset.armed = '';
      el.conflictAbandon.textContent = '기록을 포기하고 그 계정으로 로그인';
    });
  });

  // 비회원 상태에서 「다른 계정으로 로그인」 — 게이트로 돌아가되 익명 세션을 버린다.
  // 이것도 2단계다. 익명 계정은 로그아웃하면 되찾을 수 없다.
  el.switchAccountBtn.addEventListener('click', () => {
    if (el.switchAccountBtn.dataset.armed !== 'yes') {
      armDestructive(el.switchAccountBtn, '지금 기록이 사라집니다 — 한 번 더 누르세요');
      return;
    }
    runAuthAction(el.switchAccountBtn, el.upgradeError, () => db.signOutUser())
      .then(() => {
        el.switchAccountBtn.dataset.armed = '';
        el.switchAccountBtn.textContent = '다른 계정으로 로그인';
        closeSettings();
      })
      .catch(() => {});
  });
}

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
  renderMonth(); // Firebase 도착 전에도 그리드부터 그린다 — 이게 이 함수의 핵심이다
  await dbReady;

  bindAuthHandlers();

  // 로그인 상태를 아직 모르는 동안에는 게이트를 띄우지 않는다 —
  // 띄웠다가 곧바로 숨기면 기존 사용자에게 로그인 화면이 깜빡인다.
  db.observeAuth((user) => {
    applyAuthState(user).catch((err) => {
      console.error('[meal-calendar] 인증 상태 처리 실패', err);
      setSaveState('failed', '초기화 실패 — 새로고침해주세요.');
    });
  });
}

start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('[meal-calendar] SW 등록 실패', err);
    });
  });
}
