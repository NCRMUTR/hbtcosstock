/* ══════════════════════════════════════════════════════════════════════════
   api.js — ชั้นกลางระหว่างหน้าเว็บกับหลังบ้าน

   ไฟล์นี้เป็น "ขอบเขต" เพียงจุดเดียวที่รู้ว่าหลังบ้านคืออะไร
   ถ้าวันหนึ่งย้ายจาก Google Apps Script ไป Firestore หรือ REST API อื่น
   แก้แค่ไฟล์นี้ไฟล์เดียว — หน้าจอทั้งหมดไม่ต้องแก้

   ── ข้อจำกัดสำคัญของ Apps Script ──
   ส่งได้เฉพาะคำขอแบบ simple request เท่านั้น เพราะ GAS ไม่รองรับ CORS preflight
     • ต้องใช้ Content-Type: text/plain  (ส่ง JSON เป็น string)
     • ห้ามใส่ header เอง เช่น Authorization  → session จึงส่งไปใน body
   ══════════════════════════════════════════════════════════════════════════ */

const CFG = window.APP_CONFIG;
const SESSION_KEY = 'hbt.session';
const USER_KEY    = 'hbt.user';

let session = null;
let user    = null;

/* ── เก็บ session ไว้ให้ปิดเบราว์เซอร์แล้วยังไม่ต้องล็อกอินใหม่ ──────────── */

function load() {
  try {
    session = localStorage.getItem(SESSION_KEY);
    const u = localStorage.getItem(USER_KEY);
    user = u ? JSON.parse(u) : null;
  } catch { session = null; user = null; }
}
load();

export function getUser()    { return user; }
export function hasSession() { return !!session; }
export function isAdmin()    { return !!user && user.role === 'admin'; }
export function can(minRole) {
  const order = ['admin', 'staff', 'viewer'];
  if (!user) return false;
  return order.indexOf(user.role) <= order.indexOf(minRole);
}

export function setSession(s, u) {
  session = s; user = u;
  try {
    localStorage.setItem(SESSION_KEY, s);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  } catch { /* โหมดส่วนตัวของเบราว์เซอร์อาจเขียนไม่ได้ — ยังใช้งานต่อได้ในแท็บนี้ */ }
}

export function clearSession() {
  session = null; user = null;
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(USER_KEY);
  } catch { /* ไม่เป็นไร */ }
}

/* ── ข้อผิดพลาดที่สื่อสารกับผู้ใช้ได้ ────────────────────────────────────── */

export class ApiError extends Error {
  constructor(message, code, data) {
    super(message);
    this.name = 'ApiError';
    this.code = code || 'ERROR';
    this.data = data;          // ข้อมูลประกอบจากหลังบ้าน เช่น รหัสสารเดิมตอนเจอชื่อซ้ำ
  }
}

/** รหัสที่หมายถึง "ต้องล็อกอินใหม่" */
const REAUTH = ['NO_SESSION', 'BAD_SESSION', 'BAD_SIGNATURE', 'EXPIRED',
                'SESSION_STALE',    // สิทธิ์/รหัสผ่านถูกเปลี่ยน หรือถูกสั่งออกจากระบบทุกเครื่อง
                'DISABLED',         // บัญชีถูกระงับระหว่างใช้งาน
                'NOT_REGISTERED'];  // บัญชีถูกถอดสิทธิ์ออกจากระบบ
export function needsReauth(code) { return REAUTH.indexOf(code) !== -1; }

/* ── เรียกคำสั่ง ─────────────────────────────────────────────────────────── */

export async function call(action, payload) {
  if (!CFG.GAS_URL || CFG.GAS_URL.indexOf('PASTE-YOUR') !== -1) {
    throw new ApiError(
      'ยังไม่ได้ตั้งค่า GAS_URL ในไฟล์ config.js\nดูวิธีตั้งค่าใน SETUP.md ขั้นที่ 4',
      'NOT_CONFIGURED'
    );
  }

  let res;
  try {
    res = await fetch(CFG.GAS_URL, {
      method: 'POST',
      // ต้องเป็น text/plain เท่านั้น มิฉะนั้นเบราว์เซอร์จะยิง preflight แล้ว GAS ตอบไม่ได้
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload: payload || {}, session }),
      redirect: 'follow'
    });
  } catch (e) {
    throw new ApiError(
      'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง',
      'NETWORK'
    );
  }

  if (!res.ok) {
    throw new ApiError('เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ' + res.status + ')', 'HTTP_' + res.status);
  }

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    // มักเกิดเมื่อ deploy GAS เป็น "Anyone with Google Account" แล้ว GAS ส่งหน้า login กลับมา
    throw new ApiError(
      'เซิร์ฟเวอร์ไม่ได้ตอบเป็นข้อมูล JSON\n' +
      'สาเหตุที่พบบ่อยที่สุด: Web App ถูก deploy เป็น "Anyone with Google Account"\n' +
      'ต้องตั้งเป็น "Anyone" (ดู SETUP.md ขั้นที่ 3)',
      'BAD_RESPONSE'
    );
  }

  if (!body.ok) {
    const err = body.error || {};
    if (needsReauth(err.code)) {
      // session ใช้ไม่ได้แล้ว (หมดอายุ / ถูกระงับ / ถูกตัดสิทธิ์ระหว่างใช้งาน)
      // ต้องพาผู้ใช้กลับไปหน้าล็อกอินทันที ไม่ปล่อยให้กดต่อแล้วขึ้น error ทุกปุ่ม
      clearSession();
      try {
        window.dispatchEvent(new CustomEvent('hbt:reauth', {
          detail: { code: err.code, message: err.message }
        }));
      } catch { /* เบราว์เซอร์เก่าที่ไม่มี CustomEvent */ }
    }
    throw new ApiError(err.message || 'เกิดข้อผิดพลาด', err.code, err.data);
  }

  return body.data;
}

/* ── คำสั่งที่หน้าจอเรียกใช้ ─────────────────────────────────────────────── */

export const api = {
  ping:          ()                 => call('ping'),
  login:         (idToken)          => call('login', { idToken }),
  loginPassword: (username, password) => call('login.password', { username, password }),
  passwordChange:(oldPassword, newPassword) => call('password.change', { oldPassword, newPassword }),
  logoutAll:     ()                 => call('logout.all'),
  me:            ()                 => call('me'),
  version:       ()                 => call('version'),
  snapshot:      ()                 => call('snapshot'),

  usersList:     ()                 => call('users.list'),
  usersAdd:      (p)                => call('users.add', p),
  usersUpdate:   (p)                => call('users.update', p),
  usersSetStatus:(ref, status)      => call('users.setStatus', Object.assign({ status }, ref)),
  usersResetPassword:(username, password) => call('users.resetPassword', { username, password }),

  settingsAdd:   (type, value)      => call('settings.add', { type, value }),
  settingsRemove:(type, value)      => call('settings.remove', { type, value }),

  importPreview: (p)                => call('import.preview', p),
  importCommit:  (p)                => call('import.commit', p),

  setShelfState: (lotIds, state)    => call('lot.setShelfState', { lotIds, state }),
  placeSave:     (p)                => call('place.save', p),
  placeDelete:   (placeId)          => call('place.delete', { placeId }),
  lotMove:       (lotIds, toPlaceId, notes) => call('lot.move', { lotIds, toPlaceId, notes }),

  photoUpload:   (p)                => call('photo.upload', p),
  photoUpdate:   (p)                => call('photo.update', p),
  photoDelete:   (photoId)          => call('photo.delete', { photoId }),

  materialSave:  (p)                => call('material.save', p),
  lotSave:       (p)                => call('lot.save', p),

  history:        (p) => call('history', p),
  txnPost:       (p)                => call('txn.post', p),
  txnCancel:     (txnId, reason)    => call('txn.cancel', { txnId, reason })
};
