import { buildMonthGrid, dayStatus } from '/src/lib/calendarGrid.js';
import { buildGoalProfile, ImpossibleTargetError } from '/src/lib/metabolism.js';
import { calcDayTotals } from '/src/lib/dayTotals.js';
import { scaleNutrients } from '/src/lib/units.js';
import { summarizeWeightTrend } from '/src/lib/weightTrend.js';
import { buildCandidatePool, buildCachedFoodCandidates, buildRouletteProposal } from '/src/lib/roulette.js';
import { estimateServingFromCategory } from '/src/lib/servingEstimate.js';
import { validateSignUpForm } from '/src/lib/authValidation.js';
import { authErrorMessage, validationMessage } from '/src/lib/authMessages.js';
import {
  parseQuickFoodInput, splitQuickFoodInput, selectBestFood, hasNameMatch, SERVING_SOURCE_LABELS,
} from '/src/lib/quickFoodInput.js';
import { monthDashboardSummary, progressPercent, servingChoiceOptions } from '/src/lib/uiDashboard.js';
import { parseOffProduct } from '/src/lib/offParser.js';
import {
  buildOpenFoodFactsUrl, normalizeRetailBarcode, sharedCatalogRecordToFood, toBarcodeFood,
} from '/src/lib/barcodeProduct.js';
import { resolveBarcodeSources } from '/public/barcodeLookupFlow.js';
import { createSearchResult } from '/public/searchResult.js';
import {
  buildPartialNutritionProvenance, formNumber, showPartialNutritionEntry,
} from '/public/partialNutritionEntry.js';
import { searchResultStatus } from '/public/searchStatus.js';
import {
  addMultiSearches, resolveMultiSearches, restoreMultiSearchLeftovers,
  runSingleSearchConsumer,
} from '/public/searchSelectionGate.js';

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
  monthAverage: document.getElementById('monthAverage'),
  monthRecorded: document.getElementById('monthRecorded'),
  monthOnTarget: document.getElementById('monthOnTarget'),
  monthWeight: document.getElementById('monthWeight'),
  monthNotice: document.getElementById('monthNotice'),
  weightTrend: document.getElementById('weightTrend'),
  dayWeight: document.getElementById('dayWeight'),
  weightState: document.getElementById('weightState'),
  openRoulette: document.getElementById('openRoulette'),
  roulettePrompt: document.getElementById('roulettePrompt'),
  rouletteResult: document.getElementById('rouletteResult'),
  rouletteNotice: document.getElementById('rouletteNotice'),
  acceptRoulette: document.getElementById('acceptRoulette'),
  rerollRoulette: document.getElementById('rerollRoulette'),
  closeRoulette: document.getElementById('closeRoulette'),
  grid: document.getElementById('grid'),
  detail: document.getElementById('dayDetail'),
  detailDate: document.getElementById('detailDate'),
  totalKcal: document.getElementById('totalKcal'),
  kcalTarget: document.getElementById('kcalTarget'),
  calorieGauge: document.getElementById('calorieGauge'),
  carbMetric: document.getElementById('carbMetric'),
  proteinMetric: document.getElementById('proteinMetric'),
  fatMetric: document.getElementById('fatMetric'),
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
  partialNutritionNote: document.getElementById('partialNutritionNote'),
  quickPresets: document.getElementById('quickPresets'),
  presetChips: document.getElementById('presetChips'),
  quickMeals: document.getElementById('quickMeals'),
  mealPresetChips: document.getElementById('mealPresetChips'),
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
  multiConfirm: document.getElementById('multiConfirm'),
  confirmList: document.getElementById('confirmList'),
  confirmMultiAdd: document.getElementById('confirmMultiAdd'),
  cancelMultiConfirm: document.getElementById('cancelMultiConfirm'),
  addSuccess: document.getElementById('addSuccess'),
  successCard: document.getElementById('successCard'),
  successNote: document.getElementById('successNote'),
  fixAmountBtn: document.getElementById('fixAmountBtn'),
  doneAddBtn: document.getElementById('doneAddBtn'),
  barcodeOpen: document.getElementById('barcodeOpen'),
  barcodeScanner: document.getElementById('barcodeScanner'),
  barcodeVideo: document.getElementById('barcodeVideo'),
  barcodeCanvas: document.getElementById('barcodeCanvas'),
  barcodeStatus: document.getElementById('barcodeStatus'),
  barcodeCancel: document.getElementById('barcodeCancel'),
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
  askPrompt: document.getElementById('askPrompt'),
  askTitle: document.getElementById('askTitle'),
  askInput: document.getElementById('askInput'),
  askOk: document.getElementById('askOk'),
  askCancel: document.getElementById('askCancel'),
};

function targetKcal() {
  return state.goal?.kcal ?? FALLBACK_TARGET_KCAL;
}

function emptySlots() {
  return { breakfast: [], lunch: [], dinner: [], snack: [] };
}

function buildEntry({
  foodKey, name, amountG, kcal, carbG, proteinG, fatG, addedBy, estimate, matchedFoodName,
  source, barcode, nutritionProvenance,
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
    ...(source ? { source } : {}),
    ...(barcode ? { barcode } : {}),
    ...(nutritionProvenance ? { nutritionProvenance } : {}),
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
  const summary = monthDashboardSummary(
    known ? [...state.monthData.entries()].map(([date, day]) => ({ ...day, date })) : [],
    target,
  );
  el.monthAverage.textContent = summary.averageKcal === null ? '—' : `${summary.averageKcal} kcal`;
  el.monthRecorded.textContent = `${summary.recordedDays}일`;
  el.monthOnTarget.textContent = `${summary.onTargetDays}일`;
  el.monthWeight.textContent = summary.latestWeightKg === null ? '—' : `${summary.latestWeightKg}kg`;
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
      <span class="day-ring"><span class="day-num">${cell.dayOfMonth}</span></span>
      <span class="day-kcal">${known && hasRecord ? Math.round(kcal) : ''}</span>
      <span class="day-badge">${label.symbol} ${label.text}</span>
    `;
    button.querySelector('.day-ring').style.setProperty(
      '--ring-progress',
      known && hasRecord ? progressPercent(kcal, target) : 0,
    );
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
  renderWeightTrend();
}

// ── 일간 상세 ─────────────────────────────────────────────────────────

function currentDay() {
  return state.monthData.get(state.openDate) ?? { slots: emptySlots(), totals: null };
}

function renderDayDetail() {
  const day = currentDay();
  // 입력 중이면 덮어쓰지 않는다 — 타이핑하는 값을 서버 값으로 밀어내면 안 된다
  if (document.activeElement !== el.dayWeight) {
    el.dayWeight.value = typeof day.weightKg === 'number' ? day.weightKg : '';
    el.weightState.textContent = '';
  }
  const slots = { ...emptySlots(), ...(day.slots ?? {}) };
  const totals = calcDayTotals(slots);
  const target = targetKcal();

  el.detailDate.textContent = state.openDate;
  el.totalKcal.textContent = `${Math.round(totals.kcal)} kcal`;
  el.kcalTarget.textContent = `목표 ${target} kcal`;
  el.calorieGauge.style.setProperty('--gauge-progress', progressPercent(totals.kcal, target));
  el.carbMetric.textContent = state.goal
    ? `${Math.round(totals.carbG)}/${state.goal.carbG}g`
    : `${Math.round(totals.carbG)}g`;
  el.proteinMetric.textContent = state.goal
    ? `${Math.round(totals.proteinG)}/${state.goal.proteinG}g`
    : `${Math.round(totals.proteinG)}g`;
  el.fatMetric.textContent = state.goal
    ? `${Math.round(totals.fatG)}/${state.goal.fatG}g`
    : `${Math.round(totals.fatG)}g`;

  el.slots.innerHTML = '';
  for (const [key, label] of SLOT_LABELS) {
    const entries = slots[key] ?? [];
    const section = document.createElement('section');
    section.className = 'slot';

    const head = document.createElement('div');
    head.className = 'slot-head';
    head.innerHTML = `<h3>${label}</h3>`;
    // 지금 담긴 한 끼를 통째로 즐겨찾기에 저장한다.
    // 조합을 별도 화면에서 조립하게 하지 않는다 — 이미 먹은 걸 그대로 남기는 게 자연스럽다.
    if (entries.length > 0) {
      const saveMeal = document.createElement('button');
      saveMeal.type = 'button';
      saveMeal.className = 'slot-save';
      saveMeal.textContent = '★ 저장';
      saveMeal.title = '이 끼니를 즐겨찾기에 저장';
      saveMeal.addEventListener('click', () => saveMealAsPreset(label, entries));
      head.appendChild(saveMeal);
    }

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
    setSaveState('failed', '저장하지 못했습니다. 화면에는 보이지만 서버에 올라가지 않았습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.');
  }
}

// ── 룰렛 (Phase 6) ────────────────────────────────────────────────────
// solver 는 src/lib/roulette.js. 여기서는 입력을 모으고 결과를 그리고 수락을 받는다.
//
// **결과는 제안이다.** 사용자가 「이대로 기록하기」를 눌러야 저장된다 (SPEC).

let rouletteProposal = null;

/** 슬롯 목표 대비 오차를 % 로. 목표가 0 이면 표시하지 않는다. */
function fitLabel(macros, target) {
  if (!target || !(target.kcal > 0)) return '';
  const diff = Math.round(((macros.kcal - target.kcal) / target.kcal) * 100);
  const sign = diff > 0 ? '+' : '';
  return `목표 ${target.kcal}kcal 대비 ${sign}${diff}%`;
}

function renderRouletteResult() {
  el.rouletteResult.innerHTML = '';
  el.acceptRoulette.hidden = true;
  el.rouletteNotice.hidden = true;

  if (!rouletteProposal) return;

  if (!rouletteProposal.ok) {
    el.rouletteNotice.hidden = false;
    el.rouletteNotice.className = 'month-notice month-notice-error';
    el.rouletteNotice.textContent = rouletteProposal.reason === 'over-budget'
      ? '오늘 목표를 이미 채웠습니다. 룰렛을 돌리지 않습니다.'
      : '빈 슬롯이 없습니다. 이미 네 끼가 다 기록돼 있습니다.';
    return;
  }

  // 후보가 부족하면 억지로 채우지 않는다 — 채운 슬롯 수를 그대로 말한다 (절대규칙 7)
  if (rouletteProposal.filledSlotCount === 0) {
    el.rouletteNotice.hidden = false;
    el.rouletteNotice.className = 'month-notice';
    el.rouletteNotice.textContent =
      '넣을 후보가 없습니다. 프리셋을 저장하거나 몇 번 기록하면 그걸로 제안합니다.';
    return;
  }

  const labels = Object.fromEntries(SLOT_LABELS);
  for (const [slotKey, slot] of Object.entries(rouletteProposal.slots)) {
    const section = document.createElement('section');
    section.className = 'roulette-slot';
    const kcal = Math.round(slot.macros.kcal);
    section.innerHTML = `<h3>${labels[slotKey] ?? slotKey}<span>${kcal} kcal</span></h3>`;

    if (slot.entries.length === 0) {
      const p = document.createElement('p');
      p.className = 'roulette-empty';
      p.textContent = '— 채우지 못했습니다 (맞는 후보 없음)';
      section.appendChild(p);
    } else {
      for (const entry of slot.entries) {
        const line = document.createElement('div');
        line.className = 'entry-line';
        line.innerHTML = `<span class="entry-name">${entry.name} ${entry.amountG}g</span>`
          + `<b class="entry-kcal">${Math.round(entry.kcal)} kcal</b>`;
        section.appendChild(line);
      }
      const fit = document.createElement('div');
      fit.className = 'roulette-fit';
      fit.textContent = fitLabel(slot.macros, slot.targetMacros);
      section.appendChild(fit);
    }
    el.rouletteResult.appendChild(section);
  }

  el.acceptRoulette.hidden = false;
}

async function runRoulette(seed) {
  await dbReady;
  const day = currentDay();
  const slots = { ...emptySlots(), ...(day.slots ?? {}) };
  const totals = day.totals ?? calcDayTotals(slots);
  const goal = state.goal;

  el.rouletteNotice.hidden = false;
  el.rouletteNotice.className = 'month-notice';
  el.rouletteNotice.textContent = '후보를 모으는 중…';
  el.rouletteResult.innerHTML = '';
  el.acceptRoulette.hidden = true;

  let presets = [];
  let recent = [];
  let dislikes = [];
  try {
    [presets, recent, dislikes] = await Promise.all([
      db.listPresets(), db.loadRecentEntries(), db.loadDislikes(),
    ]);
  } catch (err) {
    console.error('[meal-calendar] 룰렛 입력 조회 실패', err);
    el.rouletteNotice.className = 'month-notice month-notice-error';
    el.rouletteNotice.textContent = '후보를 불러오지 못했습니다. 네트워크를 확인해주세요.';
    return;
  }

  // 검색 캐시는 후보를 넓히는 보너스지 핵심 기능이 아니다 — 실패해도 프리셋/최근항목만으로
  // 계속 진행한다(functions/index.js의 foods/ 캐시 쓰기 실패 처리와 같은 원칙).
  let cachedFoods = [];
  try {
    cachedFoods = await db.loadCachedFoods();
  } catch (err) {
    console.error('[meal-calendar] 검색 캐시 조회 실패 — 프리셋/최근항목만으로 진행', err);
  }

  // 목표가 없으면 룰렛의 기준이 없다. 지어내지 않는다
  if (!goal) {
    el.rouletteNotice.className = 'month-notice month-notice-error';
    el.rouletteNotice.textContent = '먼저 ⚙ 에서 목표를 설정해주세요. 목표가 없으면 배분할 기준이 없습니다.';
    return;
  }

  const remainingMacros = {
    kcal: goal.kcal - totals.kcal,
    carbG: goal.carbG - totals.carbG,
    proteinG: goal.proteinG - totals.proteinG,
    fatG: goal.fatG - totals.fatG,
  };
  const emptySlotKeys = SLOT_LABELS.map(([k]) => k).filter((k) => (slots[k] ?? []).length === 0);

  // 프리셋은 신·구 스키마가 섞여 있다 — presetEntries 가 둘 다 받는다
  const normalizedPresets = presets.map((p) => ({
    id: p.id, label: p.label, entries: db.presetEntries(p),
  })).filter((p) => p.entries.length > 0);

  rouletteProposal = buildRouletteProposal({
    remainingMacros,
    emptySlots: emptySlotKeys,
    candidatePool: [
      ...buildCandidatePool(normalizedPresets, recent),
      ...buildCachedFoodCandidates(cachedFoods),
    ],
    dislikes,
    seed,
  });
  renderRouletteResult();
}

/** 시드는 날짜 + 시각에서 만든다. 「다시 돌리기」가 매번 다른 결과를 내야 한다. */
function newRouletteSeed() {
  return (Date.now() >>> 0);
}

el.openRoulette.addEventListener('click', () => {
  el.roulettePrompt.hidden = false;
  runRoulette(newRouletteSeed());
});

el.rerollRoulette.addEventListener('click', () => runRoulette(newRouletteSeed()));

el.closeRoulette.addEventListener('click', () => {
  el.roulettePrompt.hidden = true;
  rouletteProposal = null;
});

el.acceptRoulette.addEventListener('click', async () => {
  if (!rouletteProposal?.ok) return;
  const day = currentDay();
  const slots = { ...emptySlots(), ...(day.slots ?? {}) };

  for (const [slotKey, slot] of Object.entries(rouletteProposal.slots)) {
    if (slot.entries.length === 0) continue;
    slots[slotKey] = [
      ...slots[slotKey],
      ...slot.entries.map((e) => buildEntry({ ...e, addedBy: 'roulette' })),
    ];
  }

  el.roulettePrompt.hidden = true;
  rouletteProposal = null;
  await persistDay(slots);
});

// ── 체중 (Phase 5) ────────────────────────────────────────────────────
// 하루 문서에 숫자 하나. ROADMAP: "체중이 유일한 결과 지표다" — 매크로 추이는 안 만든다.

let weightSaveTimer = null;

/** 입력이 멎고 800ms 뒤에 저장한다. 타이핑 중에 매 글자마다 쓰지 않는다. */
function scheduleWeightSave() {
  clearTimeout(weightSaveTimer);
  weightSaveTimer = setTimeout(saveDayWeight, 800);
}

async function saveDayWeight() {
  await dbReady;
  const raw = el.dayWeight.value.trim();

  // 빈칸은 「안 잼」이다. 0 으로 저장하면 추세가 무너진다 —
  // 지우는 동작은 지원하지 않는다(되돌리기 어려운 삭제라 별도 설계가 필요하다).
  if (raw === '') {
    el.weightState.textContent = '';
    return;
  }

  const weightKg = Number(raw);
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    el.weightState.textContent = '숫자로 입력해 주세요';
    return;
  }

  const day = { ...currentDay(), weightKg, date: state.openDate };
  state.monthData.set(state.openDate, day);
  el.weightState.textContent = '저장 중…';

  try {
    await db.saveDay(state.openDate, {
      slots: day.slots ?? emptySlots(),
      totals: day.totals ?? calcDayTotals(day.slots ?? emptySlots()),
      weightKg,
    });
    el.weightState.textContent = '저장됨';
    renderWeightTrend();
  } catch (err) {
    console.error('[meal-calendar] 체중 저장 실패', err);
    // 조용히 넘어가지 않는다 (절대규칙 6)
    el.weightState.textContent = '저장 실패';
  }
}

/**
 * 로드된 달의 체중 기록으로 추세를 그린다.
 *
 * **`direction === 'unknown'` 을 「변화 없음」으로 그리지 않는다.**
 * 표본이 1개거나 전부 같은 날짜면 기울기를 낼 수 없고, 그때 0 으로 때우면
 * 화면이 "체중 변화 없음"이라고 거짓말한다 (절대규칙 7).
 */
function renderWeightTrend() {
  const points = [...state.monthData.entries()]
    .filter(([, day]) => typeof day?.weightKg === 'number' && day.weightKg > 0)
    .map(([date, day]) => ({ date, weightKg: day.weightKg }));

  if (points.length === 0) {
    el.weightTrend.hidden = true;
    return;
  }

  const trend = summarizeWeightTrend(points);
  el.weightTrend.hidden = false;

  const latest = `<b>${trend.latestKg}kg</b> <span>(${trend.latestDate})</span>`;

  if (trend.direction === 'unknown') {
    // 수치를 지어내지 않는다. 무엇이 부족한지만 말한다
    el.weightTrend.innerHTML = `${latest} · 기록 ${trend.sampleCount}일 — `
      + '추세를 내려면 다른 날짜에도 기록이 필요하다';
    return;
  }

  const arrow = { down: '▼', up: '▲', flat: '—' }[trend.direction];
  const sign = trend.kgPerWeek > 0 ? '+' : '';
  el.weightTrend.innerHTML = `${latest} · ${arrow} 주당 <b>${sign}${trend.kgPerWeek}kg</b>`
    + ` <span>(${trend.spanDays}일 · ${trend.sampleCount}회 기록)</span>`;
}

el.dayWeight.addEventListener('input', scheduleWeightSave);
// 포커스를 뗄 때는 기다리지 않고 바로 저장한다 — 시트를 닫고 나가버릴 수 있다
el.dayWeight.addEventListener('blur', () => { clearTimeout(weightSaveTimer); saveDayWeight(); });

async function removeEntry(slotKey, index) {
  const day = currentDay();
  const slots = { ...emptySlots(), ...(day.slots ?? {}) };
  slots[slotKey] = slots[slotKey].filter((_, i) => i !== index);
  await persistDay(slots);
}

/**
 * 앱 내 텍스트 입력 시트. 확인하면 문자열, 취소하면 null 로 resolve 한다.
 * window.prompt 대체 — 그건 iOS standalone PWA 에서 신뢰할 수 없다.
 */
function askText(title, initial = '') {
  return new Promise((resolve) => {
    el.askTitle.textContent = title;
    el.askInput.value = initial;
    el.askPrompt.hidden = false;
    el.askInput.focus();
    el.askInput.select();

    const done = (value) => {
      el.askPrompt.hidden = true;
      el.askOk.removeEventListener('click', onOk);
      el.askCancel.removeEventListener('click', onCancel);
      el.askInput.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onOk = () => done(el.askInput.value);
    const onCancel = () => done(null);
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    el.askOk.addEventListener('click', onOk);
    el.askCancel.addEventListener('click', onCancel);
    el.askInput.addEventListener('keydown', onKey);
  });
}

/** 지금 슬롯에 담긴 것을 조합 프리셋으로 저장한다. */
async function saveMealAsPreset(slotLabel, entries) {
  await dbReady;
  const suggested = entries.length === 1
    ? entries[0].name
    : `${slotLabel} 세트 (${entries.length}개)`;
  // prompt() 를 쓰지 않는다 — 브라우저 모달은 iOS standalone PWA 에서 막히거나
  // 앱 흐름을 얼려버린다. 앱 내 시트로 받는다.
  const name = await askText('즐겨찾기 이름', suggested);
  if (name === null) return;   // 취소
  if (!name.trim()) return;

  // 저장용으로 필요한 필드만 남긴다. at/foodKey 같은 그때만 유효한 값은 빼고,
  // 불러올 때 buildEntry 가 새로 만든다
  const payload = entries.map(({ name: n, amountG, kcal, carbG, proteinG, fatG }) => ({
    name: n, amountG, kcal, carbG, proteinG, fatG,
  }));

  try {
    await db.savePreset(name.trim(), payload);
    setSaveState('pending', `즐겨찾기 「${name.trim()}」 저장됨`);
    setTimeout(() => setSaveState(null), 2500);
  } catch (err) {
    console.error('[meal-calendar] 즐겨찾기 저장 실패', err);
    setSaveState('failed', '즐겨찾기를 저장하지 못했습니다. 네트워크를 확인해 주세요.');
  }
}

/**
 * 여러 항목을 **한 번의 쓰기로** 넣는다.
 * 하나씩 addEntryToSlot 을 반복하면 쓰기가 N 번 나가고, 중간에 실패하면
 * 일부만 들어간 상태로 남는다. 조합 프리셋은 전부 들어가거나 전부 안 들어가야 한다.
 */
async function addEntriesToSlot(slotKey, entries) {
  if (entries.length === 0) return;
  const day = currentDay();
  const slots = { ...emptySlots(), ...(day.slots ?? {}) };
  slots[slotKey] = [...slots[slotKey], ...entries];
  await persistDay(slots);

  // 최근 항목은 개별로 쌓는다 — 실패해도 기록 자체는 이미 저장됐다
  for (const entry of entries) {
    db.pushRecentEntry(entry).catch((err) => {
      console.error('[meal-calendar] 최근 항목 갱신 실패', err);
    });
  }
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

function renderChip(container, { text, onAdd, onDelete, variant = '' }) {
  const chip = document.createElement('div');
  chip.className = `chip${variant ? ` ${variant}` : ''}`;

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
  el.mealPresetChips.innerHTML = '';
  el.recentChips.innerHTML = '';

  try {
    const presets = await db.listPresets();
    const singlePresets = [];
    const mealPresets = [];
    for (const preset of presets) {
      // 구형(entry 하나)과 신형(entries 배열)이 섞여 있다 — db.presetEntries 가 둘 다 받는다
      const entries = db.presetEntries(preset);
      (entries.length > 1 ? mealPresets : singlePresets).push({ preset, entries });
    }
    el.quickPresets.hidden = singlePresets.length === 0;
    el.quickMeals.hidden = mealPresets.length === 0;
    for (const { preset, entries } of [...singlePresets, ...mealPresets]) {
      const kcal = Math.round(entries.reduce((sum, e) => sum + (e.kcal ?? 0), 0));
      const countLabel = entries.length > 1 ? ` · ${entries.length}개` : '';
      renderChip(entries.length > 1 ? el.mealPresetChips : el.presetChips, {
        text: `${preset.label}${countLabel} · ${kcal}kcal`,
        variant: entries.length > 1 ? 'meal-preset' : '',
        onAdd: async () => {
          el.entrySheet.hidden = true;
          await addEntriesToSlot(
            state.pendingSlot,
            entries.map((e) => buildEntry({ ...e, addedBy: 'preset' })),
          );
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
  stopBarcodeScanner();
  state.pendingSlot = slotKey;
  el.entryTitle.textContent = `${slotLabel} 항목 추가`;
  el.entryForm.reset();
  el.entryError.hidden = true;
  manualEntryContext = null;
  el.partialNutritionNote.hidden = true;
  el.entrySheet.hidden = false;
  el.searchInput.value = '';
  el.searchResults.innerHTML = '';
  el.searchStatus.hidden = true;
  lastAddedInfo = null;
  multiConfirmResolved = [];
  showPortionPrompt(false);
  renderQuickPicks();
}

document.getElementById('closeEntry').addEventListener('click', () => {
  stopBarcodeScanner();
  el.entrySheet.hidden = true;
  state.pendingSlot = null;
});

// ── 빠른 기록 + 식약처 검색 ──────────────────────────────────────────

// entryForm 시트 안의 패널은 항상 하나만 보인다. 바코드는 카메라를 쓰므로 패널을
// 벗어나는 순간 스트림도 반드시 닫는다.
// 항상 하나만 보인다 — 하나를 열 때 나머지 세 개를 확실히 닫아서 겹쳐 보이는 걸 막는다.
function showEntryPanel(panel) {
  el.entryChooser.hidden = panel !== 'chooser';
  el.barcodeScanner.hidden = panel !== 'barcode';
  el.portionPrompt.hidden = panel !== 'portion';
  el.multiConfirm.hidden = panel !== 'multiConfirm';
  el.addSuccess.hidden = panel !== 'addSuccess';
}

function showPortionPrompt(show) {
  showEntryPanel(show ? 'portion' : 'chooser');
}

const ZXING_READER_URL = 'https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.3/dist/iife/reader/index.js';
const BARCODE_FORMATS = ['EAN13', 'EAN8', 'UPCA', 'UPCE'];
let zxingReaderPromise = null;
let barcodeStream = null;
let barcodeFrame = null;
let barcodeSession = 0;

function loadZxingReader() {
  if (globalThis.ZXingWASM?.readBarcodes) return Promise.resolve(globalThis.ZXingWASM);
  if (zxingReaderPromise) return zxingReaderPromise;

  zxingReaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ZXING_READER_URL;
    script.async = true;
    script.onload = () => {
      if (globalThis.ZXingWASM?.readBarcodes) resolve(globalThis.ZXingWASM);
      else reject(new Error('ZXingWASM.readBarcodes was not registered'));
    };
    script.onerror = () => reject(new Error('zxing-wasm reader failed to load'));
    document.head.appendChild(script);
  }).catch((error) => {
    zxingReaderPromise = null;
    throw error;
  });
  return zxingReaderPromise;
}

/**
 * 스캔을 멈춘다. **카메라 스트림은 살려둔다.**
 *
 * 전에는 여기서 `track.stop()` 으로 스트림을 버렸다. 그러면 다시 열 때 `getUserMedia`
 * 가 새로 불리고 **iOS 가 매번 카메라 권한을 다시 묻는다.** 스캔을 두 번 하면 두 번
 * 묻는다(2026-08-19 사용자 제보). 트랙을 끄기만 하면 프레임은 안 오면서 권한은 유지된다.
 *
 * 카메라를 실제로 놓아주는 것은 `releaseCamera()` 이고, 앱이 백그라운드로 갈 때 부른다 —
 * 안 쓰는 동안 카메라를 잡고 있지 않기 위해서다.
 */
/**
 * 프레임만 멈춘다. **`barcodeSession` 을 건드리지 않는다** — 판독에 성공한 직후처럼
 * 그 세션으로 이어서 할 일이 남은 자리에서 부르기 때문이다. 세션을 올려버리면
 * 뒤따르는 `resolveBarcodeProduct(barcode, session)` 이 자기 세션이 낡았다고 보고
 * 조용히 빠져나간다.
 */
function pauseCameraFrames() {
  if (barcodeFrame !== null) cancelAnimationFrame(barcodeFrame);
  barcodeFrame = null;
  for (const track of barcodeStream?.getTracks?.() ?? []) track.enabled = false;
  el.barcodeVideo.pause();
  // srcObject 는 비우지 않는다 — 다시 열 때 같은 스트림을 그대로 쓴다.
}

function stopBarcodeScanner() {
  barcodeSession += 1;
  pauseCameraFrames();
}

/** 카메라를 실제로 놓아준다. 다음에 열면 권한을 다시 묻는다. */
function releaseCamera() {
  stopBarcodeScanner();
  for (const track of barcodeStream?.getTracks?.() ?? []) track.stop();
  barcodeStream = null;
  el.barcodeVideo.srcObject = null;
}

/** 살아있는 카메라 스트림이 있나. 트랙이 하나라도 죽었으면 새로 받아야 한다. */
function hasLiveCamera() {
  return Boolean(barcodeStream)
    && barcodeStream.getVideoTracks().some((track) => track.readyState === 'live');
}

function showBarcodeManual(message, name = '') {
  stopBarcodeScanner();
  el.entryForm.reset();
  el.entryForm.name.value = name;
  showEntryPanel('chooser');
  el.searchStatus.className = 'search-status search-status-warning';
  el.searchStatus.textContent = message;
  el.searchStatus.hidden = false;
}

async function resolveBarcodeProduct(barcode, session) {
  el.barcodeStatus.textContent = '제품 정보를 확인하고 있습니다.';
  const result = await resolveBarcodeSources(barcode, {
    async lookupShared(code) {
      const record = await db.lookupBarcode(code);
      return record === null ? null : sharedCatalogRecordToFood(record);
    },
    async lookupOff(code) {
      const response = await fetch(buildOpenFoodFactsUrl(code));
      if (!response.ok) throw new Error(`Open Food Facts HTTP ${response.status}`);
      const parsed = parseOffProduct(await response.json());
      return parsed === null ? null : toBarcodeFood(parsed);
    },
  });
  if (session !== barcodeSession) return;
  if (result.food === null) {
    const message = result.sharedUnavailable && result.offUnavailable
      ? '제품 조회 서비스에 연결하지 못했습니다. 직접 입력해 주세요.'
      : '공용 바코드 DB와 Open Food Facts에서 제품을 찾지 못했습니다. 직접 입력해 주세요.';
    showBarcodeManual(message);
    return;
  }

  stopBarcodeScanner();
  openPortionPrompt(result.food);
}

async function scanBarcodeFrame(zxing, session) {
  if (session !== barcodeSession || !barcodeStream) return;
  const { videoWidth, videoHeight } = el.barcodeVideo;
  if (videoWidth > 0 && videoHeight > 0) {
    const width = Math.min(videoWidth, 960);
    const height = Math.round(videoHeight * width / videoWidth);
    el.barcodeCanvas.width = width;
    el.barcodeCanvas.height = height;
    const context = el.barcodeCanvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(el.barcodeVideo, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    const results = await zxing.readBarcodes(image, {
      formats: BARCODE_FORMATS,
      maxNumberOfSymbols: 1,
      tryHarder: true,
    });
    if (session !== barcodeSession || !barcodeStream) return;
    const barcode = normalizeRetailBarcode(results);
    if (barcode) {
      // 읽었으면 프레임만 멈춘다. 스트림은 살려둬서 다시 열 때 권한을 안 묻게 한다.
      // 세션은 그대로 둔다 — 바로 아래 resolveBarcodeProduct 가 이 세션으로 판정한다.
      pauseCameraFrames();
      await resolveBarcodeProduct(barcode, session);
      return;
    }
  }
  if (session === barcodeSession && barcodeStream) {
    barcodeFrame = requestAnimationFrame(() => {
      scanBarcodeFrame(zxing, session).catch((error) => {
        console.error('[meal-calendar] 바코드 판독 실패', error);
        showBarcodeManual('카메라를 사용할 수 없습니다. 직접 입력해 주세요.');
      });
    });
  }
}

async function startBarcodeScanner() {
  stopBarcodeScanner();
  const session = barcodeSession;
  showEntryPanel('barcode');
  el.barcodeStatus.textContent = '';

  try {
    const zxing = await loadZxingReader();
    if (session !== barcodeSession) return;

    // 살아있는 스트림이 있으면 그대로 쓴다. 이때는 getUserMedia 를 부르지 않으므로
    // **iOS 가 권한을 다시 묻지 않는다.** 스캔을 여러 번 해도 한 번만 묻게 되는 지점이다.
    if (hasLiveCamera()) {
      for (const track of barcodeStream.getTracks()) track.enabled = true;
    } else {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (session !== barcodeSession) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      barcodeStream = stream;
    }
    el.barcodeVideo.srcObject = barcodeStream;
    await el.barcodeVideo.play();
    await scanBarcodeFrame(zxing, session);
  } catch (error) {
    console.error('[meal-calendar] 바코드 카메라 시작 실패', error);
    if (session === barcodeSession) {
      showBarcodeManual('카메라를 사용할 수 없습니다. 직접 입력해 주세요.');
    }
  }
}

el.barcodeOpen.addEventListener('click', startBarcodeScanner);

// 앱이 백그라운드로 가면 카메라를 놓아준다. 스캔 사이에는 스트림을 살려두지만
// (권한을 다시 안 묻게 하려고) **안 쓰는 동안 카메라를 잡고 있지는 않는다.**
// iOS 는 백그라운드에서 트랙을 알아서 죽이기도 하는데, 그 경우 readyState 가
// 'ended' 가 되므로 hasLiveCamera() 가 false 를 주고 다음 열 때 새로 받는다.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') releaseCamera();
});
el.barcodeCancel.addEventListener('click', () => {
  stopBarcodeScanner();
  showEntryPanel('chooser');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopBarcodeScanner();
});

/**
 * 한 줄에 여러 음식(`반숙란 2개, 우유 200g`)을 넣었을 때, 조각마다 검색·매칭만
 * 해보고 **아무것도 저장하지 않는다.** 저장은 사용자가 화면3(확인 목록)에서
 * "N개 모두 추가"를 눌러야 일어난다 (절대규칙 2 — 지어낸 값을 조용히 넣지 않는다,
 * 여기서는 "조용히 저장하지 않는다"로 확장한 것).
 */
async function resolveMultiPieces(pieces) {
  return resolveMultiSearches({
    pieces,
    searchFoods: (query) => db.searchFoods(query),
    // 'unsupported-serving' 은 「단위는 알아들었는데 대표 중량 표에 없다」는 뜻이다.
    // DB 의 1인분을 확인해 개수로 환산할 기회는 남긴다.
    isUsable: (piece) => piece.parsed.ok || piece.parsed.reason === 'unsupported-serving',
    resolveCandidates: resolveMultiCandidates,
    onSearchError(piece, err) {
      console.error('[meal-calendar] 검색 실패', piece.text, err);
    },
  });
}

function resolveMultiCandidates(piece, items) {
  // 이름이 실제로 맞아떨어질 때만 자동 기록 후보로 삼는다 — 엉뚱한 식품의 숫자가 들어가면 안 된다
  if (items.length === 0 || !hasNameMatch(piece.parsed.query, items)) {
    return { text: piece.text, ok: false };
  }

  const food = selectBestFood(piece.parsed.query, items);

  let amountG = piece.parsed.amountG;
  let quickInput = piece.parsed;
  if (!piece.parsed.ok) {
    // DB 가 1인분을 모르면 여기서도 포기한다. 개수를 g 으로 바꿀 근거가 없다
    if (!food.serving) return { text: piece.text, ok: false };
    // count 는 발주 18 이 붙여준다. 없으면 곱할 수가 없으니 포기한다 —
    // undefined 를 곱해서 NaN 을 기록하는 것보다 "못 알아들었다"가 낫다
    const count = piece.parsed.count;
    if (!Number.isFinite(count) || count <= 0) return { text: piece.text, ok: false };
    amountG = food.serving.amount * count;
    quickInput = {
      ...piece.parsed,
      ok: true,
      amountG,
      displayAmount: `${count}개`,
      estimated: true,
      servingSource: 'mfds-serving',
    };
  }

  // 미리 보여줄 kcal·완전성 판정. addSearchedFood 가 저장 시점에 똑같은 계산을
  // 다시 하므로(단일 진실 소스), 여기 값은 화면 표시 전용이고 저장 여부를 좌우하지 않는다.
  const scaled = scaleNutrients(food.per100g, amountG);
  const incomplete = Object.values(scaled).some((value) => value === null);

  return {
    text: piece.text,
    ok: true,
    incomplete,
    food,
    amountG,
    quickInput,
    kcal: scaled.kcal,
    name: quickInput.query ?? food.name,
    displayAmount: quickInput.estimated ? quickInput.displayAmount : `${amountG}g`,
    estimated: Boolean(quickInput.estimated),
  };
}

let multiConfirmResolved = [];

async function showMultiConfirm(pieces) {
  el.searchStatus.hidden = false;
  el.searchStatus.textContent = '확인하는 중…';
  multiConfirmResolved = await resolveMultiPieces(pieces);
  el.searchStatus.hidden = true;
  renderMultiConfirm();
  showEntryPanel('multiConfirm');
}

function renderMultiConfirm() {
  el.confirmList.innerHTML = '';
  let usable = 0;

  for (const r of multiConfirmResolved) {
    const item = document.createElement('div');
    if (!r.ok) {
      item.className = 'confirm-item failed';
      const name = document.createElement('div');
      name.className = 'confirm-name';
      name.textContent = r.text;
      const result = document.createElement('div');
      result.className = 'confirm-result';
      result.textContent = r.message ?? '못 알아들었습니다';
      item.append(name, result);
    } else if (r.incomplete) {
      item.className = 'confirm-item failed';
      item.innerHTML = `
        <div class="confirm-name">${r.name}<small>${r.displayAmount}</small></div>
        <div class="confirm-result">DB에 탄단지 없음 · 직접 입력 필요</div>
      `;
    } else {
      usable += 1;
      item.className = `confirm-item ${r.estimated ? 'estimated' : 'confirmed'}`;
      const resultText = r.estimated
        ? `참고값 ${r.displayAmount}으로 추정 · ${Math.round(r.kcal)} kcal`
        : `${Math.round(r.kcal)} kcal · 확인됨`;
      item.innerHTML = `
        <div class="confirm-name">${r.name}<small>${r.displayAmount}</small></div>
        <div class="confirm-result">${resultText}</div>
      `;
    }
    el.confirmList.appendChild(item);
  }

  el.confirmMultiAdd.disabled = usable === 0;
  el.confirmMultiAdd.textContent = usable > 0 ? `${usable}개 모두 추가` : '추가할 항목 없음';
}

el.cancelMultiConfirm.addEventListener('click', () => {
  multiConfirmResolved = [];
  showEntryPanel('chooser');
});

el.confirmMultiAdd.addEventListener('click', async () => {
  const summary = await addMultiSearches({
    resolved: multiConfirmResolved,
    addEntry: (result) => addSearchedFood(
      result.food, result.amountG, result.quickInput, { batch: true },
    ),
  });
  multiConfirmResolved = [];

  if (summary.leftover.length === 0) {
    showEntryPanel('chooser');
    el.searchStatus.hidden = false;
    el.searchStatus.textContent = `${summary.added}개 추가했습니다.`;
    el.searchInput.value = '';
    el.entrySheet.hidden = true;
    state.pendingSlot = null;
    return;
  }

  // 남은 조각을 입력칸에 되돌려준다 — 다시 타이핑하게 만들지 않는다
  showEntryPanel('chooser');
  restoreMultiSearchLeftovers({
    summary,
    input: el.searchInput,
    status: el.searchStatus,
  });
});

el.searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await dbReady;

  // 구분자가 있으면 다중 처리로 간다. 하나뿐이면 기존 흐름 그대로 —
  // 단일 입력은 검색 결과를 보여주고 고르게 하는 경로가 이미 잘 돌고 있다
  const pieces = splitQuickFoodInput(el.searchInput.value);
  if (pieces.length > 1) {
    await showMultiConfirm(pieces);
    return;
  }

  const parsed = parseQuickFoodInput(el.searchInput.value);
  if (parsed.reason === 'empty' || parsed.reason === 'food-required') return;
  if (parsed.reason === 'invalid-amount') {
    el.searchStatus.hidden = false;
    el.searchStatus.textContent = '수량은 0보다 크게 입력해주세요.';
    return;
  }
  const q = parsed.query;

  el.searchResults.innerHTML = '';
  el.searchStatus.className = 'search-status';
  el.searchStatus.hidden = false;
  el.searchStatus.textContent = parsed.ok ? '대표 중량으로 계산 중…' : '검색 중…';

  try {
    await runSingleSearchConsumer({
      response: await db.searchFoods(q),
      status: el.searchStatus,
      continueWithCandidates: async ({ items, hasMore }) => {
        await continueSingleSearch({ items, hasMore, parsed, q });
      },
    });
  } catch (err) {
    console.error('[meal-calendar] 검색 실패', err);
    el.searchStatus.textContent = `검색 실패 — ${err.message}`;
  }
});

async function continueSingleSearch({ items, hasMore, parsed, q }) {
  if (items.length === 0) {
    // 식약처 DB 는 브랜드 메뉴를 거의 안 담는다 — `서브웨이`·`서가원 김밥` 은 이름·제조사
    // 어느 쪽으로 찾아도 0건이다(2026-08-14 실측). 그건 검색으로 못 푼다.
    // 그래서 「없다」로 끝내지 않고 **한 번 넣으면 다음부터 1탭**이라는 길을 알려준다.
    el.searchStatus.className = 'search-status search-status-warning';
    el.searchStatus.textContent =
      '식약처 DB에 없는 음식입니다. 프랜차이즈 메뉴는 대부분 등록돼 있지 않습니다. 아래에 한 번만 넣어두면 다음부터 1탭으로 기록됩니다.';
    el.entryForm.name.value = q;
    el.entryForm.saveAsPreset.checked = true;
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

  // 대표중량 표에 없는 단위(`김밥 1개`)라도 DB 가 1인분을 알면 개수를 곱한다.
  // 다중 입력(resolveMultiPieces)에는 이 다리가 이미 있었는데 단일 입력에는 없어서,
  // **쉼표를 붙이면 되고 안 붙이면 안 되는** 상태였다. 같은 입력은 같게 동작해야 한다.
  if (parsed.reason === 'unsupported-serving' && hasNameMatch(parsed.query, items)) {
    const food = selectBestFood(parsed.query, items);
    const count = parsed.count;
    if (food.serving && Number.isFinite(count) && count > 0) {
      const amountG = food.serving.amount * count;
      const added = await addSearchedFood(food, amountG, {
        ...parsed,
        ok: true,
        amountG,
        displayAmount: `${count}${parsed.unit ?? '개'}`,
        estimated: true,
        servingSource: 'mfds-serving',
      });
      if (added) {
        // 성공했으면 「검색 중…」을 지운다. 안 지우면 기록됐는데도 아직 도는 것처럼 보인다
        el.searchStatus.hidden = true;
        el.searchInput.value = '';
        return;
      }
      // 영양값이 불완전해서 못 넣었다 — 아래 검색 결과로 내려가되 이유를 정확히 말한다
      el.searchStatus.hidden = false;
      el.searchStatus.textContent = 'DB에 탄단지가 없어 직접 입력이 필요합니다.';
    }
  }

  const resultStatus = searchResultStatus({ hasMore, parsed });
  el.searchStatus.hidden = resultStatus === null;
  if (resultStatus !== null) {
    el.searchStatus.className = 'search-status';
    el.searchStatus.textContent = resultStatus;
  }

  const servingTable = await loadServingTable();
  for (const food of items) {
    let servingLabel = '';
    if (food.serving) {
      servingLabel = `1인분 ${food.serving.amount}${food.serving.unit}`;
    } else if (servingTable) {
      try {
        const estimate = estimateServingFromCategory(food, servingTable);
        if (estimate) {
          servingLabel = `참고값 ${estimate.amount}${estimate.unit}`;
        }
      } catch (err) {
        console.error('[meal-calendar] 검색 결과 참고값 계산 실패', err);
      }
    }
    // parsed.ok 면 사용자가 이미 입력한 양(g 명시든 개수 추정 환산이든)을 그대로 넘긴다 —
    // 이름을 못 찾았다고 이미 알려준 수량까지 지우고 100g 기본값으로 되돌리지 않는다.
    el.searchResults.appendChild(createSearchResult(document, food, {
      servingLabel,
      onSelect: () => openPortionPrompt(food, parsed.ok ? parsed.amountG : undefined),
    }));
  }
}

let selectedFood = null;
let manualEntryContext = null;

function fillManualEntry(food, amountG, scaled) {
  const { numericFields } = showPartialNutritionEntry({
    form: el.entryForm,
    notice: el.partialNutritionNote,
    food,
    amountG,
    scaled,
    showManualForm: () => showPortionPrompt(false),
  });
  manualEntryContext = {
    source: food.source,
    numericFields,
  };
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.batch] 다중 입력 루프 안인가.
 *   true 면 **수동입력 폼을 띄우지 않고 시트도 닫지 않는다** — 루프 도중에 화면을
 *   갈아치우면 다음 조각의 진행 표시가 숨겨진 곳에 찍히고, 폼이 덮어써진다.
 *   대신 false 를 돌려주면 호출부가 「못 넣은 조각」으로 모아서 끝에 보여준다.
 */
async function addSearchedFood(food, amountG, quickInput = null, { batch = false } = {}) {
  const scaled = scaleNutrients(food.per100g, amountG);
  if (Object.values(scaled).some((value) => value === null)) {
    if (!batch) fillManualEntry(food, amountG, scaled);
    return false;
  }

  // batch(다중입력 커밋 중)에서는 슬롯을 안 지운다 — 다음 조각도 같은 슬롯에 넣어야 한다.
  // 지웠더니 두 번째 조각에서 slots[null] 이 되어 "not iterable" 로 터졌다.
  const slotKey = state.pendingSlot;
  showPortionPrompt(false);

  // Firestore 는 undefined 필드를 거부한다 — setDoc 이 통째로 실패해서 기록이 안 들어간다.
  // 라벨 표에 없는 source 를 만나도 저장은 되어야 한다. 표기는 없어도 숫자는 남는 게 낫다.
  const estimate = quickInput?.estimated ? {
    displayAmount: quickInput.displayAmount ?? '',
    source: quickInput.servingSource ?? null,
    sourceLabel: SERVING_SOURCE_LABELS[quickInput.servingSource] ?? null,
  } : null;

  const entryName = quickInput?.query ?? food.name;
  await addEntryToSlot(slotKey, buildEntry({
    foodKey: food.foodKey,
    name: entryName,
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
    source: food.source,
    barcode: food.barcode,
  }));

  if (!batch) {
    // addEntryToSlot → persistDay 가 state.monthData 를 낙관적으로 먼저 갱신하므로,
    // await 이 끝난 지금 이 슬롯의 마지막 항목이 방금 넣은 항목이다.
    const entries = currentDay().slots?.[slotKey] ?? [];
    showAddSuccess({
      slotKey,
      index: entries.length - 1,
      name: entryName,
      displayAmount: estimate?.displayAmount || `${amountG}g`,
      kcal: scaled.kcal,
      estimate,
    });
  }
  return true;
}

let lastAddedInfo = null;

/** 화면5 — 추가 직후. 「완료」로 닫거나 「양 고치기」로 방금 넣은 걸 지우고 다시 입력한다. */
function showAddSuccess(info) {
  lastAddedInfo = info;
  el.successCard.innerHTML = `
    <strong>${Math.round(info.kcal)} kcal 추가됨</strong>
    <span>${info.name} · ${info.displayAmount}</span>
  `;
  if (info.estimate) {
    el.successNote.hidden = false;
    el.successNote.textContent =
      '추정으로 넣은 항목은 「추정」 표시가 남습니다. 실제 무게를 알게 되면 「양 고치기」로 다시 넣을 수 있습니다.';
  } else {
    el.successNote.hidden = true;
  }
  showEntryPanel('addSuccess');
}

el.doneAddBtn.addEventListener('click', () => {
  lastAddedInfo = null;
  el.entrySheet.hidden = true;
  state.pendingSlot = null;
});

el.fixAmountBtn.addEventListener('click', async () => {
  if (!lastAddedInfo) return;
  const { slotKey, index, name } = lastAddedInfo;
  lastAddedInfo = null;
  await removeEntry(slotKey, index);
  showEntryPanel('chooser');
  el.searchInput.value = name;
  el.searchInput.focus();
});

function renderPortionPreview() {
  const amountG = Number(el.portionAmount.value);
  if (!Number.isFinite(amountG) || amountG < 0) {
    el.portionPreview.textContent = '양을 숫자로 입력해 주세요.';
    return;
  }
  // 양이 비었을 때 0kcal 을 띄우면 **DB에 값이 없는 것처럼 보인다.** 바코드로 찍으면
  // 1인분을 모르는 채 오므로(OFF는 serving 을 안 준다) 이 화면이 기본 상태인데,
  // 실제로는 100g당 값을 이미 받아온 상태다. 그걸 보여줘야 "스캔이 됐다"가 전달된다.
  // 추측이 아니라 조회해온 실제 값이라 절대규칙 2·7에 걸리지 않는다.
  if (el.portionAmount.value.trim() === '' || amountG === 0) {
    const per100 = selectedFood.per100g ?? {};
    const basis = selectedFood.basis === 'ml' ? 'mL' : 'g';
    el.portionPreview.innerHTML = `
      양을 입력하면 계산됩니다.<br>
      <b>100${basis}당</b> ${per100.kcal ?? '?'} kcal
      (탄 ${per100.carbG ?? '?'}g · 단 ${per100.proteinG ?? '?'}g · 지 ${per100.fatG ?? '?'}g)
    `;
    return;
  }
  const scaled = scaleNutrients(selectedFood.per100g, amountG);
  el.portionPreview.innerHTML = `
    <b>${scaled.kcal ?? '?'}</b> kcal
    (탄 ${scaled.carbG ?? '?'}g · 단 ${scaled.proteinG ?? '?'}g · 지 ${scaled.fatG ?? '?'}g)
    ${Object.values(scaled).some((v) => v === null) ? '<br>일부 값이 DB에 없다 — 추가 후 수동으로 채워라.' : ''}
  `;
}

// 카테고리 대표 중량표는 **필요할 때만** 받는다. 조리음식의 83%는 1인분을 알아서
// 이 경로를 안 탄다 — 처음부터 받으면 대부분의 사용자가 안 쓰는 5.8KB를 매번 문다.
let servingTablePromise = null;
function loadServingTable() {
  servingTablePromise ??= fetch('/src/data/servingByCategory.json')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .catch((err) => {
      // 실패해도 화면은 죽지 않는다 — 참고값이 없을 뿐 직접 입력은 그대로 된다.
      // 다음에 다시 시도할 수 있게 캐시를 비운다.
      console.error('[meal-calendar] 1인분 참고표 로드 실패', err);
      servingTablePromise = null;
      return null;
    });
  return servingTablePromise;
}

/**
 * 1인분을 모를 때 **같은 분류의 대표 중량**을 참고값으로 띄운다.
 *
 * 왜: 「실제 무게를 확인해서 입력하세요」는 거짓말은 아니지만, 자기가 먹은 라멘이
 * 몇 g 인지 모르는 사람에게 아무 답이 아니다. 같은 불만이 세 번 나왔다 (2026-08-14).
 *
 * **숫자를 지어내지 않는다** — 전부 식약처 응답에서 뽑은 값이고(`scripts/build-serving-table.mjs`),
 * 표본 수·범위를 같이 보여줘서 사용자가 얼마나 믿을지 스스로 판단하게 한다.
 * 승인된 추가 흐름에서는 「한 그릇」을 명시적으로 선택한 상태로 시작한다. 사용자가
 * 다른 그릇 수나 정확한 g 값을 고르면 그 선택으로 즉시 다시 계산한다.
 */
async function renderCategoryEstimate(food) {
  const table = await loadServingTable();
  if (!table) return;
  // 사용자가 그 사이 다른 음식을 골랐으면 그 화면에 남의 숫자를 그리지 않는다
  if (selectedFood !== food) return;

  let estimate;
  try {
    estimate = estimateServingFromCategory(food, table);
  } catch (err) {
    console.error('[meal-calendar] 1인분 추정 실패', err);
    return;
  }
  if (!estimate) return;

  el.servingNote.textContent =
    `1인분 정보가 없어 같은 분류(${estimate.category})의 대표 중량으로 계산합니다.`;
  el.servingNote.hidden = false;

  const options = servingChoiceOptions(estimate);

  el.servingChips.innerHTML = '';
  for (const option of options) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `portion-choice${option.selected ? ' selected' : ''}`;
    chip.textContent = option.label;
    chip.addEventListener('click', () => {
      for (const sibling of el.servingChips.children) sibling.classList.remove('selected');
      chip.classList.add('selected');
      el.portionAmount.value = option.amount;
      renderPortionPreview();
    });
    el.servingChips.appendChild(chip);
  }
  el.portionAmount.value = estimate.amount;
  renderPortionPreview();
  el.servingChips.hidden = options.length === 0;
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
  if (food.servingNote) {
    el.servingNote.textContent = `1회 제공량 표기: ${food.servingNote}`;
    el.servingNote.hidden = false;
  } else if (!serving) {
    // 1인분을 모르는 채로 조용히 100g을 채우면 그럴듯해 보이는 틀린 숫자가 된다
    // (라멘이 100g으로 잡히는 것과 같은 부류) — 절대규칙7, 알린다.
    // 다만 「직접 재서 넣으세요」로 끝내면 **무게를 모르는 사람에게 아무 답이 아니다.**
    // 같은 분류의 대표 중량을 참고값으로 덧붙인다 (아래 renderCategoryEstimate).
    // 「아래 참고값을 누르거나」라고 쓰면 안 된다 — 참고값 칩은 renderCategoryEstimate 가
    // 식약처 분류를 찾았을 때만 생긴다. **바코드(OFF) 제품은 분류가 없어서 칩이 하나도
    // 안 나오는데** 화면은 없는 것을 가리키고 있었다(2026-08-19 실기기 제보).
    // 칩이 실제로 생기면 renderCategoryEstimate 가 이 문구를 자기 것으로 덮는다.
    el.servingNote.textContent = '1인분 정보 없음 — 먹은 양을 직접 입력하세요.';
    el.servingNote.hidden = false;
  } else {
    el.servingNote.hidden = true;
  }
  if (!serving) {
    renderCategoryEstimate(food);
    return;
  }

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
  // 1인분을 알면 그걸 기본값으로. 모르면 아무것도 추측하지 않고 빈칸으로 둔다 — 절대규칙7.
  el.portionAmount.value = amountG ?? food.serving?.amount ?? '';
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
  // 빈칸은 Number('')===0 이라 이전엔 0g/0kcal 로 조용히 저장됐다 — 0 초과를 요구한다.
  if (!Number.isFinite(amountG) || amountG <= 0) return;

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
    amountG: formNumber(data, 'amountG'),
    kcal: formNumber(data, 'kcal'),
    carbG: formNumber(data, 'carbG'),
    proteinG: formNumber(data, 'proteinG'),
    fatG: formNumber(data, 'fatG'),
  };

  const invalid = ['amountG', 'kcal', 'carbG', 'proteinG', 'fatG']
    .find((field) => !Number.isFinite(fields[field]) || fields[field] < 0);
  if (!fields.name || invalid) {
    el.entryError.hidden = false;
    el.entryError.textContent = invalid
      ? `${invalid} 값이 올바르지 않다. 0 이상의 숫자를 넣어라.`
      : '이름을 입력해 주세요.';
    return;
  }

  const saveAsPreset = data.get('saveAsPreset') === 'on';
  const slotKey = state.pendingSlot;
  const nutritionProvenance = manualEntryContext
    ? buildPartialNutritionProvenance({
      numericFields: manualEntryContext.numericFields,
      source: manualEntryContext.source,
      fields,
    })
    : null;
  el.entrySheet.hidden = true;
  state.pendingSlot = null;

  await addEntryToSlot(slotKey, buildEntry({
    ...fields,
    addedBy: 'manual',
    source: manualEntryContext?.source,
    nutritionProvenance,
  }));
  manualEntryContext = null;

  if (saveAsPreset) {
    const { name, amountG, kcal, carbG, proteinG, fatG } = fields;
    db.savePreset(fields.name, [{ name, amountG, kcal, carbG, proteinG, fatG }]).catch((err) => {
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
      ? '이 조합으로는 목표를 계산할 수 없습니다. 단백질·지방이 칼로리를 넘어서 탄수화물이 음수가 됩니다. 목적이나 체중을 다시 확인해 주세요.'
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

  // 메일 링크로 인증하고 앱으로 돌아왔을 때 「⚠ 이메일 미인증」이 안 사라지던 것을 고친다.
  // 인증은 다른 브라우저 컨텍스트(사파리)에서 일어나서 앱 쪽 토큰이 안 바뀌고,
  // observeAuth(onIdTokenChanged)는 토큰이 바뀔 때만 불린다 — 그래서 영영 안 불렸다.
  //
  // **폴링하지 않는다.** 주기적으로 두드리면 auth/too-many-requests 를 더 자주 만든다.
  // 앱이 포그라운드로 돌아온 그 순간에만 한 번 확인한다 — 사용자가 메일에서
  // 돌아오는 경로가 정확히 이것이다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    db.refreshVerification()
      .then((user) => {
        if (!user) return; // 확인할 게 없었다(비로그인·익명·이미 인증됨)
        return applyAuthState(user);
      })
      .catch((err) => {
        // 배경 확인이라 실패해도 화면을 막지 않는다. 다음 포그라운드 복귀 때 다시 해본다.
        console.error('[meal-calendar] 인증 상태 재확인 실패', err);
      });
  });
}

start();

// 홈 화면 앱(standalone PWA)은 사파리의 왼쪽 끝 스와이프-뒤로가기가 없다 —
// 주소창·탭 히스토리 자체가 없어서다. 열린 시트 중 가장 안쪽 것부터
// 기존 「‹ 뒤로」 버튼을 그대로 눌러서 같은 동작을 흉내낸다.
const closeDetailBtn = document.getElementById('closeDetail');
const closeEntryBtn = document.getElementById('closeEntry');
const closeSettingsBtn = document.getElementById('closeSettings');

function swipeGoBack() {
  if (!el.portionPrompt.hidden) { el.cancelPortion.click(); return; }
  if (!el.askPrompt.hidden) { el.askCancel.click(); return; }
  if (!el.entrySheet.hidden) { closeEntryBtn.click(); return; }
  if (!el.roulettePrompt.hidden) { el.closeRoulette.click(); return; }
  if (!el.settings.hidden) { closeSettingsBtn.click(); return; }
  if (!el.detail.hidden) { closeDetailBtn.click(); return; }
}

const EDGE_SWIPE_ZONE_PX = 24;
const SWIPE_BACK_THRESHOLD_PX = 60;
let swipeStartX = null;
let swipeStartY = null;

document.addEventListener('touchstart', (event) => {
  const touch = event.touches[0];
  swipeStartX = touch.clientX <= EDGE_SWIPE_ZONE_PX ? touch.clientX : null;
  swipeStartY = touch.clientY;
}, { passive: true });

document.addEventListener('touchend', (event) => {
  if (swipeStartX === null) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - swipeStartX;
  const dy = Math.abs(touch.clientY - swipeStartY);
  swipeStartX = null;
  if (dx < SWIPE_BACK_THRESHOLD_PX || dy > dx) return; // 대각선·세로 스크롤은 무시
  swipeGoBack();
}, { passive: true });

// 서비스워커 등록 + **새 배포를 실제로 집어오는 것까지.**
//
// 등록만 해두면 부족하다. sw.js 는 skipWaiting/clients.claim 이라 새 워커가 제어권은
// 가져가지만, **이미 로드된 페이지는 옛 JS 모듈을 메모리에 들고 그대로 돈다.** 아무도
// 새로고침을 시키지 않는다. 게다가 iOS 홈화면 PWA 를 백그라운드에서 복귀시키면 load
// 이벤트가 다시 안 뛰어서 새 sw.js 를 확인조차 안 한다.
//
// 그래서 배포할 때마다 사용자가 앱을 완전히 죽여야 했다. 2026-08-19 하루에만 세 번
// 「고쳤는데 폰에서 안 보인다」가 반복됐고, 그때마다 코드를 의심하느라 시간을 썼다.
// (2026-08-14 「라멘 89kcal」도 뿌리는 같은 문제였다.)
if ('serviceWorker' in navigator) {
  // 최초 설치 때는 controller 가 없다가 생긴다. 그때 새로고침하면 무한 루프가 된다 —
  // 「원래 있던 워커가 새 워커로 바뀐 경우」에만 새로고침한다.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    let registration;
    try {
      registration = await navigator.serviceWorker.register('/sw.js');
    } catch (err) {
      console.error('[meal-calendar] SW 등록 실패', err);
      return;
    }
    // 포그라운드로 돌아올 때마다 새 배포가 있는지 물어본다. 이게 없으면 홈화면 PWA 는
    // 앱을 죽였다 켜기 전까지 영원히 옛 코드를 돈다.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      registration.update().catch((err) => {
        console.error('[meal-calendar] SW 갱신 확인 실패', err);
      });
    });
  });
}
