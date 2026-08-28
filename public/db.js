// Firestore 연동 계층. 화면 코드(app.js)는 이 파일만 알고, Firebase SDK 를 직접 부르지 않는다.
//
// - 데이터 모델은 docs/ARCHITECTURE.md 「데이터 모델」을 따른다
// - 보안은 firestore.rules 가 담당한다. 여기서 uid 를 확인하는 건 경로를 만들기 위해서지
//   방어가 아니다 — 방어선은 서버 쪽 규칙 하나뿐이다
// - 오프라인 퍼시스턴스를 켠다. 지하철·헬스장에서 입력한다 (AGENTS.md 절대규칙 6)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {
  getAuth, signInAnonymously, onIdTokenChanged, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  linkWithCredential, EmailAuthProvider,
  sendEmailVerification, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp,
  limit, orderBy,
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';

import { firebaseConfig } from '/src/firebaseConfig.js';
import { normalizeSearchFoodsResponse } from '/src/lib/searchFoodsResponse.js';
import { planMergeRestore, validateExportEnvelope } from '/src/lib/dataTransfer.js';
import { toMyBarcodeRecord, fromMyBarcodeRecord, myBarcodeDocId } from '/src/lib/myBarcodeCache.js';
import { withoutRecentEntry } from '/src/lib/recentEntries.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// persistentLocalCache 를 initializeFirestore 시점에 넘긴다.
// 구버전의 enableIndexedDbPersistence() 는 deprecated 이고, getFirestore() 뒤에 켜면
// 이미 시작된 인스턴스라 실패한다.
//
// tabManager 는 single 로 쓴다. 이 앱은 iOS 홈화면 PWA — 브라우저 탭이 여러 개
// 동시에 열릴 일이 없다. multiple 은 탭 간 「주 탭」 리스(lease)를 IndexedDB로
// 협상하는 오버헤드가 매 실행마다 붙는데, 여기선 그 협상 상대가 없어서 순수 비용이다.
// (2026-08-18: 아이폰 PWA에서 "열 때마다 느리다" 제보 — 이게 원인인지는 아직 실기기로
// 확인 못 했다. offline 퍼시스턴스 자체는 그대로 켜져 있다, 절대규칙 6 그대로.)
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
});

// ── 인증 ──────────────────────────────────────────────────────────────
// 상태는 「없음 / 비회원(익명) / 회원(이메일 링크됨)」 세 가지다.
// 비회원→회원은 linkWithCredential 이라 uid 가 유지된다 — 데이터가 한 바이트도 안 움직이고
// 보안 규칙도 그대로 성립한다. 설계는 docs/superpowers/specs/2026-08-13-auth-guest-member-design.md.

function snapshotUser(user) {
  if (!user) return null;
  return {
    uid: user.uid,
    isAnonymous: user.isAnonymous,
    email: user.email,
    emailVerified: user.emailVerified,
  };
}

/** 인증 상태 구독. 로그인·로그아웃·링크 성공 때마다 불린다. 해지 함수를 돌려준다. */
export function observeAuth(cb) {
  // 익명 계정에 이메일 자격을 연결하면 uid 는 그대로라 onAuthStateChanged 가
  // 다시 불리지 않을 수 있다. 토큰 변경까지 관찰해야 회원 전환 직후 UI가 갱신된다.
  return onIdTokenChanged(auth, (user) => cb(snapshotUser(user)));
}

/** 비회원으로 시작 — 익명 계정을 만든다. */
export async function startGuest() {
  const { user } = await signInAnonymously(auth);
  return user.uid;
}

/**
 * 회원가입.
 * - 비회원 사용 중이면 linkWithCredential → uid 유지, 데이터 유지
 * - 로그인 안 된 상태(게이트에서 바로 가입)면 새 계정 생성
 * 가입 직후 인증 메일을 보낸다. 메일 발송 실패는 가입 자체를 되돌리지 않는다 —
 * 계정은 이미 만들어졌고, 재발송 버튼이 설정 화면에 있다.
 */
export async function signUp(email, password) {
  const current = auth.currentUser;
  let user;

  if (current && current.isAnonymous) {
    const credential = EmailAuthProvider.credential(email, password);
    ({ user } = await linkWithCredential(current, credential));
  } else {
    ({ user } = await createUserWithEmailAndPassword(auth, email, password));
  }

  try {
    await sendEmailVerification(user);
  } catch (err) {
    console.error('[meal-calendar] 인증 메일 발송 실패 — 설정에서 재발송할 수 있다', err);
  }
  return user.uid;
}

export async function signInWithPassword(email, password) {
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  return user.uid;
}

export function signOutUser() {
  return signOut(auth);
}

export function resendVerification() {
  const { currentUser } = auth;
  if (!currentUser) throw new Error('db: 로그인 상태가 아니다');
  return sendEmailVerification(currentUser);
}

/**
 * 서버에서 사용자 상태를 다시 읽어 `emailVerified` 를 갱신한다.
 *
 * **왜 필요한가:** `observeAuth` 는 `onIdTokenChanged` 라 **토큰이 바뀔 때만** 불린다.
 * 그런데 인증 메일 링크는 **다른 브라우저 컨텍스트**에서 열린다(PWA 가 아니라 사파리).
 * 거기서 인증이 끝나도 앱 쪽 토큰은 그대로라 콜백이 영영 안 불린다 —
 * 앱을 껐다 켜야 반영되던 게 이 때문이다 (2026-08-14 사용자 제보).
 *
 * 부수 효과로 「인증 메일 다시 보내기」 버튼도 고쳐진다. 그 버튼은 `emailVerified`
 * 로 숨기는데 값이 낡아서 계속 보였고, 이미 인증된 사람이 눌러서
 * `auth/too-many-requests` 를 맞고 있었다. 두 증상이 같은 원인이었다.
 *
 * 할 일이 없으면(비로그인·익명·이미 인증됨) **네트워크를 타지 않고** `null` 을 준다.
 *
 * @returns 갱신된 사용자 스냅샷 | null
 */
export async function refreshVerification() {
  const { currentUser } = auth;
  if (!currentUser || currentUser.isAnonymous || currentUser.emailVerified) return null;
  await currentUser.reload();
  return snapshotUser(auth.currentUser);
}

export function sendReset(email) {
  return sendPasswordResetEmail(auth, email);
}

/**
 * 이 계정에 기록이 있나. 이메일 중복 충돌에서 「갈아타도 되는지」 판정에 쓴다.
 * 읽기 2회로 끝낸다 — goals·presets 는 따로 세지 않는다 (목표를 저장했으면 profile 이
 * 반드시 있고, 프리셋을 만들었으면 days 나 recentEntries 가 이미 차 있다).
 */
export async function hasAnyData() {
  const uid = requireUid();

  const userDoc = await getDoc(doc(db, 'users', uid));
  if (userDoc.exists()) {
    const data = userDoc.data();
    if (data.profile) return true;
    if (Array.isArray(data.recentEntries) && data.recentEntries.length > 0) return true;
  }

  const daysSnapshot = await getDocs(query(collection(db, 'users', uid, 'days'), limit(1)));
  return !daysSnapshot.empty;
}

/** 거부 문구에 「기록 N건」을 숫자로 박기 위해서다. 충돌 분기에서만 부른다. */
export async function countDays() {
  const snapshot = await getDocs(collection(db, 'users', requireUid(), 'days'));
  return snapshot.size;
}

function requireUid() {
  const { currentUser } = auth;
  if (!currentUser) {
    throw new Error('db: 인증 전에는 읽고 쓸 수 없다');
  }
  return currentUser.uid;
}

// ── 프로필 ────────────────────────────────────────────────────────────
// users/{uid} 문서의 profile 필드. 온보딩 입력값 원본이다 (계산 결과 아님).

export async function loadProfile() {
  const snapshot = await getDoc(doc(db, 'users', requireUid()));
  return snapshot.exists() ? (snapshot.data().profile ?? null) : null;
}

export async function saveProfile(profile) {
  await setDoc(
    doc(db, 'users', requireUid()),
    { profile: { ...profile, updatedAt: serverTimestamp() } },
    { merge: true },
  );
}

// ── 목표 ──────────────────────────────────────────────────────────────
// users/{uid}/goals/{effectiveFrom} — 목표는 바뀌므로 덮어쓰지 않고 이력으로 쌓는다.
// effectiveFrom 은 YYYY-MM-DD 로컬 날짜다 (절대규칙 5).

export async function saveGoal(effectiveFrom, goal) {
  await setDoc(doc(db, 'users', requireUid(), 'goals', effectiveFrom), {
    ...goal,
    effectiveFrom,
    createdAt: serverTimestamp(),
  });
}

/**
 * 주어진 날짜에 유효한 목표를 찾는다 — effectiveFrom 이 그 날짜 이하인 것 중 가장 최근.
 * 없으면 null. 문서 ID 가 곧 날짜라 ID 로 정렬·비교한다.
 */
export async function loadGoalFor(dateStr) {
  const goalsRef = collection(db, 'users', requireUid(), 'goals');
  const snapshot = await getDocs(query(goalsRef, where('effectiveFrom', '<=', dateStr)));
  if (snapshot.empty) return null;

  let latest = null;
  snapshot.forEach((entry) => {
    const data = entry.data();
    if (!latest || data.effectiveFrom > latest.effectiveFrom) latest = data;
  });
  return latest;
}

// ── 하루 기록 ─────────────────────────────────────────────────────────
// users/{uid}/days/{YYYY-MM-DD}

const EMPTY_SLOTS = { breakfast: [], lunch: [], dinner: [], snack: [] };

export async function loadDay(dateStr) {
  const snapshot = await getDoc(doc(db, 'users', requireUid(), 'days', dateStr));
  if (!snapshot.exists()) return null;

  const data = snapshot.data();
  return { ...data, slots: { ...EMPTY_SLOTS, ...(data.slots ?? {}) } };
}

/**
 * 한 달치를 한 번에. 캘린더가 30~31칸을 그리므로 날마다 요청하지 않는다.
 * 문서 ID 가 YYYY-MM-DD 라 문자열 범위 비교가 곧 날짜 범위 비교다.
 */
export async function loadMonth(year, month) {
  const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  const daysRef = collection(db, 'users', requireUid(), 'days');
  const snapshot = await getDocs(query(
    daysRef,
    where('date', '>=', `${prefix}-01`),
    where('date', '<=', `${prefix}-31`),
  ));

  const byDate = new Map();
  snapshot.forEach((entry) => byDate.set(entry.id, entry.data()));
  return byDate;
}

export async function loadDaysByKeys(keys) {
  if (!Array.isArray(keys)) throw new TypeError('keys must be an array');
  const loaded = await Promise.all(keys.map((key) => loadDay(key)));
  return loaded.filter(Boolean);
}

/**
 * 하루 문서를 통째로 쓴다. totals 는 호출부가 계산해서 넘긴다 —
 * 여기서 계산하면 순수 로직(dayTotals.js)이 네트워크 계층에 섞인다.
 */
export async function saveDay(dateStr, { slots, totals, weightKg }) {
  const payload = {
    date: dateStr, // 쿼리용. 문서 ID 와 같은 값이지만 where 절에 쓰려면 필드로도 있어야 한다
    slots,
    totals,
    updatedAt: serverTimestamp(),
  };
  if (weightKg !== undefined) payload.weightKg = weightKg;

  await setDoc(doc(db, 'users', requireUid(), 'days', dateStr), payload, { merge: true });
}

// ── 프리셋 ────────────────────────────────────────────────────────────
// users/{uid}/presets/{presetId} — 1-Click 고정 식품.

/**
 * 프리셋 문서에서 항목 배열을 꺼낸다. 스키마 두 형태를 모두 받는다.
 * 구형(`entry` 하나)과 신형(`entries` 배열)이 섞여 있는 게 정상이다 — 마이그레이션을 안 했다.
 */
export function presetEntries(preset) {
  if (preset?.schemaVersion === 2 && preset?.slots) {
    if (preset.kind === 'meal') return preset.slots[preset.sourceSlot] ?? [];
    return Object.values(preset.slots).flatMap((entries) => Array.isArray(entries) ? entries : []);
  }
  if (Array.isArray(preset?.entries)) return preset.entries;
  return preset?.entry ? [preset.entry] : [];
}

export async function listPresets() {
  const snapshot = await getDocs(collection(db, 'users', requireUid(), 'presets'));
  return snapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
    .sort((a, b) => (a.label < b.label ? -1 : 1));
}

/**
 * 프리셋 저장. `entries` 는 항목 **배열**이다 — 한 끼 조합을 통째로 담는다.
 *
 * 예전 스키마는 `entry`(항목 하나)였다. **그 문서들을 고치지 않는다** —
 * 마이그레이션은 되돌리기 어렵고, 읽는 쪽에서 두 형태를 다 받으면 그만이다
 * (`presetEntries()` 참조). 새로 저장하는 것만 `entries` 를 쓴다.
 */
export async function savePreset(label, entries) {
  const presetId = crypto.randomUUID();
  await setDoc(doc(db, 'users', requireUid(), 'presets', presetId), {
    label,
    entries,
    createdAt: serverTimestamp(),
  });
  return presetId;
}

export async function saveStructuredPreset(preset) {
  const presetId = crypto.randomUUID();
  await setDoc(doc(db, 'users', requireUid(), 'presets', presetId), preset);
  return presetId;
}

export async function deletePreset(presetId) {
  await deleteDoc(doc(db, 'users', requireUid(), 'presets', presetId));
}

// ── 기피 식품 ─────────────────────────────────────────────────────────
// users/{uid}.dislikes — foodKey 배열. 룰렛이 이걸 제외한다.

export async function loadDislikes() {
  const snapshot = await getDoc(doc(db, 'users', requireUid()));
  return snapshot.exists() ? (snapshot.data().dislikes ?? []) : [];
}

// ── 최근 항목 ─────────────────────────────────────────────────────────
// users/{uid}.recentEntries — 최신순, 이름 기준 dedupe, 최대 10개.
// 별도 컬렉션·쿼리를 안 쓴다 — 이 정도 개수는 문서 하나에 배열로 두는 게
// 훨씬 싸고, days/ 전체를 스캔할 필요가 없다.

const RECENT_ENTRIES_LIMIT = 10;

export async function loadRecentEntries() {
  const snapshot = await getDoc(doc(db, 'users', requireUid()));
  return snapshot.exists() ? (snapshot.data().recentEntries ?? []) : [];
}

export async function pushRecentEntry(entry) {
  const current = await loadRecentEntries();
  const deduped = withoutRecentEntry(current, entry.name);
  const next = [entry, ...deduped].slice(0, RECENT_ENTRIES_LIMIT);
  await setDoc(doc(db, 'users', requireUid()), { recentEntries: next }, { merge: true });
}

export async function deleteRecentEntry(name) {
  const current = await loadRecentEntries();
  const next = withoutRecentEntry(current, name);
  await setDoc(doc(db, 'users', requireUid()), { recentEntries: next }, { merge: true });
}

export async function clearRecentEntries() {
  await setDoc(doc(db, 'users', requireUid()), { recentEntries: [] }, { merge: true });
}

const CACHED_FOODS_LIMIT = 200;

// `foods/` 는 사용자 전용이 아니라 공용 검색 캐시다(경로가 users/{uid} 밑이 아니다) —
// 지금까지 누군가 한 번이라도 검색한 음식 전부. 룰렛 후보 풀을 넓히는 데 쓴다
// (docs/orders/23-cached-food-roulette-candidates.md). 읽기는 firestore.rules 가
// 로그인한 사용자에게 열어뒀고, 쓰기는 Cloud Functions 만 한다 — 여기선 안 쓴다.
export async function loadCachedFoods(maxCount = CACHED_FOODS_LIMIT) {
  const snapshot = await getDocs(query(
    collection(db, 'foods'),
    orderBy('fetchedAt', 'desc'),
    limit(maxCount),
  ));
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      foodKey: docSnap.id,
      name: data.name,
      per100g: data.per100g,
      basis: data.basis,
      foodGroup: data.foodGroup,
      totalAmount: data.totalAmount,
      totalUnit: data.totalUnit,
      servingAmount: data.servingAmount,
      servingUnit: data.servingUnit,
    };
  });
}

// ── 날짜 유틸 ─────────────────────────────────────────────────────────

function shiftDate(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12); // 정오로 고정 — DST 경계에서 날짜가 안 밀린다
  date.setDate(date.getDate() + deltaDays);
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function previousDate(dateStr) {
  return shiftDate(dateStr, -1);
}

// ── 식품 검색 (Phase 7) ───────────────────────────────────────────────
// Cloud Functions 프록시를 부른다. 키는 서버에만 있다 — 여기서는 인증 토큰만 붙인다
// (functions/index.js 가 검증한다. AGENTS.md 절대규칙 1).

export async function searchFoods(q) {
  requireUid();
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(`/api/foods/search?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `검색 실패 (${res.status})`);
  }
  return normalizeSearchFoodsResponse(await res.json());
}

// ── 내가 확인한 바코드 (users/{uid}/barcodes/{code}) ──────────────────
// 공용 캐시 `foods/` 가 아니라 내 영역이다. 개인 스캔 이력을 공용에 올리지 않는다.
// 국내 커버리지가 낮아(2026-08-26 실측: 공용 카탈로그 2,109개) 영양성분표를 직접
// 찍어 넣은 제품을 다음에 또 못 찾는 일이 실제로 난다. 그걸 막는다.

export async function loadMyBarcodeFood(code) {
  const uid = requireUid();
  const docId = myBarcodeDocId(code);
  if (docId === null) return null;
  const snapshot = await getDoc(doc(db, 'users', uid, 'barcodes', docId));
  return snapshot.exists() ? fromMyBarcodeRecord(snapshot.data()) : null;
}

export async function saveMyBarcodeFood(food) {
  const uid = requireUid();
  const record = toMyBarcodeRecord(food, new Date().toISOString());
  if (record === null) return false;
  const docId = myBarcodeDocId(record.barcode);
  if (docId === null) return false;
  await setDoc(doc(db, 'users', uid, 'barcodes', docId), record);
  return true;
}

export async function lookupBarcode(code) {
  requireUid();
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(`/api/foods/barcode?code=${encodeURIComponent(code)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `바코드 조회 실패 (${res.status})`);
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || !Object.hasOwn(body, 'item') || (body.item !== null && typeof body.item !== 'object')) {
    throw new Error('바코드 조회 응답을 이해할 수 없습니다.');
  }
  return body.item;
}

export async function lookupBarcodeIdentity(code) {
  requireUid();
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(`/api/foods/barcode?code=${encodeURIComponent(code)}&includeIdentity=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `바코드 식별 조회 실패 (${res.status})`);
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || !Object.hasOwn(body, 'identity')
    || (body.identity !== null && typeof body.identity !== 'object')) {
    throw new Error('바코드 식별 응답을 이해할 수 없습니다.');
  }
  return body.identity;
}

export async function loadExportData() {
  const uid = requireUid();
  const [userSnapshot, goalsSnapshot, daysSnapshot, presetsSnapshot] = await Promise.all([
    getDoc(doc(db, 'users', uid)),
    getDocs(collection(db, 'users', uid, 'goals')),
    getDocs(collection(db, 'users', uid, 'days')),
    getDocs(collection(db, 'users', uid, 'presets')),
  ]);
  const user = userSnapshot.exists() ? userSnapshot.data() : {};
  const portableTimestamp = (value) => {
    if (typeof value === 'string') return value;
    if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
    return null;
  };
  return {
    profile: user.profile ?? null,
    goals: goalsSnapshot.docs.map((entry) => {
      const { createdAt: ignored, ...payload } = entry.data();
      return { ...payload, effectiveFrom: entry.id };
    }),
    days: daysSnapshot.docs.map((entry) => {
      const { updatedAt: ignored, ...payload } = entry.data();
      return { ...payload, date: entry.id };
    }),
    presets: presetsSnapshot.docs.map((entry) => {
      const { createdAt, ...payload } = entry.data();
      return { id: entry.id, ...payload, ...(createdAt ? { createdAt: portableTimestamp(createdAt) } : {}) };
    }),
    dislikes: user.dislikes ?? [],
    recentEntries: user.recentEntries ?? [],
  };
}

export async function restoreExportData(rawEnvelope) {
  const envelope = validateExportEnvelope(rawEnvelope);
  const current = await loadExportData();
  const plan = planMergeRestore(current, envelope);
  const uid = requireUid();
  const dayById = new Map(envelope.days.map((day) => [day.date, day]));
  const presetById = new Map(envelope.presets.map((preset) => [preset.id, preset]));
  const writes = [
    ...plan.daysToWrite.map((id) => {
      const { date, ...payload } = dayById.get(id);
      return setDoc(doc(db, 'users', uid, 'days', id), { ...payload, date });
    }),
    ...plan.presetsToWrite.map((id) => {
      const { id: ignored, ...payload } = presetById.get(id);
      return setDoc(doc(db, 'users', uid, 'presets', id), payload);
    }),
  ];
  const results = await Promise.allSettled(writes);
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) throw new AggregateError(failures.map((result) => result.reason), '일부 복구 쓰기에 실패했습니다.');
  return { ...plan, written: writes.length };
}
