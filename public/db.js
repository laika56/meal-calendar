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
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp,
  limit,
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';

import { firebaseConfig } from '/src/firebaseConfig.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// persistentLocalCache 를 initializeFirestore 시점에 넘긴다.
// 구버전의 enableIndexedDbPersistence() 는 deprecated 이고, getFirestore() 뒤에 켜면
// 이미 시작된 인스턴스라 실패한다.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
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

/** 목표 전체를 최신순으로. 아직 쓰는 화면은 없지만 추이·이력에서 쓴다. */
export async function loadAllGoals() {
  const snapshot = await getDocs(collection(db, 'users', requireUid(), 'goals'));
  return snapshot.docs
    .map((entry) => entry.data())
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
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

export async function listPresets() {
  const snapshot = await getDocs(collection(db, 'users', requireUid(), 'presets'));
  return snapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
    .sort((a, b) => (a.label < b.label ? -1 : 1));
}

export async function savePreset(label, entry) {
  const presetId = crypto.randomUUID();
  await setDoc(doc(db, 'users', requireUid(), 'presets', presetId), {
    label,
    entry,
    createdAt: serverTimestamp(),
  });
  return presetId;
}

export async function deletePreset(presetId) {
  await deleteDoc(doc(db, 'users', requireUid(), 'presets', presetId));
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
  const deduped = current.filter((item) => item.name !== entry.name);
  const next = [entry, ...deduped].slice(0, RECENT_ENTRIES_LIMIT);
  await setDoc(doc(db, 'users', requireUid()), { recentEntries: next }, { merge: true });
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
  const { items } = await res.json();
  return items;
}
