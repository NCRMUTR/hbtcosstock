/* ══════════════════════════════════════════════════════════════════════════
   auth.js — เข้าสู่ระบบด้วยบัญชี Google ขององค์กร

   ขั้นตอน
   -------
   1. Google Identity Services แสดงปุ่ม "ลงชื่อเข้าใช้ด้วย Google"
   2. ผู้ใช้เลือกบัญชี → GIS คืน ID Token (JWT) มาให้
   3. ส่ง ID Token ไปให้ GAS ตรวจ (โดเมน + รายชื่อผู้ได้รับอนุญาต)
   4. GAS คืน session token ของระบบเรา → เก็บไว้ใช้กับทุกคำขอหลังจากนี้
   ══════════════════════════════════════════════════════════════════════════ */

import { api, setSession, clearSession, getUser, hasSession } from './api.js';
import { $, toast, esc, withBusy } from './ui.js';

const CFG = window.APP_CONFIG;
let onSignedIn = null;
let gsiReady   = false;

/* ── รอให้สคริปต์ของ Google โหลดเสร็จ ────────────────────────────────────── */
function waitForGsi(timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if (window.google && google.accounts && google.accounts.id) return resolve();
      if (Date.now() - t0 > timeoutMs) {
        return reject(new Error('โหลดระบบล็อกอินของ Google ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต'));
      }
      setTimeout(poll, 120);
    })();
  });
}

/* ── เริ่มระบบล็อกอิน ────────────────────────────────────────────────────── */

export async function initAuth(callback) {
  onSignedIn = callback;
  watchReauth();

  // มี session เดิมอยู่แล้ว → ตรวจว่ายังใช้ได้ไหม
  if (hasSession()) {
    try {
      await api.me();
      onSignedIn(getUser());
      return;
    } catch {
      clearSession();   // หมดอายุหรือถูกถอนสิทธิ์ → ให้ล็อกอินใหม่
    }
  }

  showLogin();
  wirePasswordLogin();

  if (!CFG.CLIENT_ID || CFG.CLIENT_ID.indexOf('PASTE-YOUR') !== -1) {
    $('#gsi-button').innerHTML =
      '<div class="note note-risk" style="margin:0">' +
      '<b>ยังไม่ได้ตั้งค่า CLIENT_ID</b><br>' +
      'เปิดไฟล์ <code>config.js</code> แล้วใส่ Client ID จาก Google Cloud Console ' +
      '(ดู SETUP.md ขั้นที่ 2)</div>';
    return;
  }

  try {
    await waitForGsi();
  } catch (e) {
    $('#gsi-button').innerHTML =
      '<div class="note note-risk" style="margin:0">' + esc(e.message) + '</div>';
    return;
  }

  google.accounts.id.initialize({
    client_id:          CFG.CLIENT_ID,
    callback:           handleCredential,
    auto_select:        true,          // เคยเลือกบัญชีไว้แล้วให้เข้าต่อเลย
    cancel_on_tap_outside: false,
    context:            'signin'
  });

  google.accounts.id.renderButton($('#gsi-button'), {
    type:  'standard',
    theme: 'outline',
    size:  'large',
    shape: 'rectangular',
    text:  'signin_with',
    logo_alignment: 'left',
    width: 340
  });

  google.accounts.id.prompt();   // One Tap — ถ้าผู้ใช้ปิดไว้จะไม่มีอะไรเกิดขึ้น
  gsiReady = true;
}

/* ── ถูกตัดสิทธิ์ระหว่างใช้งาน ───────────────────────────────────────────── */

let reauthing = false;

function watchReauth() {
  window.addEventListener('hbt:reauth', e => {
    if (reauthing) return;              // คำขอหลายตัวล้มเหลวพร้อมกันก็แสดงครั้งเดียว
    reauthing = true;

    // ปิดหน้าต่างย่อยที่ค้างอยู่ ไม่งั้น modal จะบังหน้าล็อกอิน
    document.querySelectorAll('dialog[open]').forEach(d => {
      try { d.close(); } catch { /* ไม่เป็นไร */ }
    });

    showLogin();
    wirePasswordLogin();
    showLoginError((e.detail && e.detail.message) || 'กรุณาล็อกอินใหม่');

    // ไม่ให้ Google พาเข้าบัญชีเดิมอัตโนมัติ — บัญชีนั้นอาจถูกระงับไปแล้ว
    if (window.google && google.accounts && google.accounts.id) {
      try { google.accounts.id.disableAutoSelect(); } catch { /* ไม่เป็นไร */ }
    }
  });
}


/* ── ล็อกอินด้วยชื่อผู้ใช้ + รหัสผ่าน ────────────────────────────────────── */

let passWired = false;

function wirePasswordLogin() {
  if (passWired) return;
  passWired = true;

  const form  = $('#pass-login');
  const toPw  = $('#show-pass-login');
  const toGsi = $('#show-google-login');
  if (!form || !toPw) return;

  // สลับทั้งข้อความอธิบายและปุ่ม ไม่งั้นหน้าจอจะพูดถึง Google ทั้งที่กำลังกรอกรหัสผ่าน
  const show = pw => {
    form.classList.toggle('hidden', !pw);
    ['#google-copy', '#google-note'].forEach(sel => {
      const el = $(sel); if (el) el.classList.toggle('hidden', pw);
    });
    const pc = $('#pass-copy'); if (pc) pc.classList.toggle('hidden', !pw);
    if (toPw) toPw.parentElement.classList.toggle('hidden', pw);
    clearLoginError();
    if (pw) $('#li-user').focus();
  };

  toPw.addEventListener('click', () => show(true));
  if (toGsi) toGsi.addEventListener('click', () => show(false));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const username = $('#li-user').value.trim();
    const password = $('#li-pass').value;
    if (!username || !password) return;

    try {
      const res = await withBusy(() => api.loginPassword(username, password));
      setSession(res.session, res.user);
      $('#li-pass').value = '';
      toast('ยินดีต้อนรับ ' + res.user.name, 'ok');
      onSignedIn(res.user);
    } catch (err) {
      showLoginError(err.message);
      $('#li-pass').value = '';
      $('#li-pass').focus();
    }
  });
}


/* ── ได้ ID Token จาก Google แล้ว ────────────────────────────────────────── */

async function handleCredential(response) {
  if (!response || !response.credential) {
    toast('ไม่ได้รับข้อมูลยืนยันตัวตนจาก Google กรุณาลองอีกครั้ง', 'risk');
    return;
  }

  try {
    const res = await withBusy(() => api.login(response.credential));
    setSession(res.session, res.user);
    toast('ยินดีต้อนรับ ' + res.user.name, 'ok');
    onSignedIn(res.user);
  } catch (e) {
    showLoginError(e.message);
    // ถ้าบัญชีนี้ใช้ไม่ได้ ต้องยกเลิก auto_select ไม่ให้วนเข้าบัญชีเดิมซ้ำ
    if (gsiReady) { try { google.accounts.id.disableAutoSelect(); } catch { /* ไม่เป็นไร */ } }
  }
}

function clearLoginError() {
  const box = $('#login-error');
  if (box) box.classList.add('hidden');
}

function showLoginError(message) {
  const box = $('#login-error');
  if (!box) { toast(message, 'risk'); return; }
  box.className = 'note note-risk';
  box.textContent = message;
  box.classList.remove('hidden');
}

/* ── สลับหน้า ────────────────────────────────────────────────────────────── */

export function showLogin() {
  $('#login-view').classList.remove('hidden');
  $('#app-view').classList.add('hidden');
}

export function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
}

/* ── ออกจากระบบ ──────────────────────────────────────────────────────────── */

export function signOut() {
  clearSession();
  if (window.google && google.accounts && google.accounts.id) {
    try { google.accounts.id.disableAutoSelect(); } catch { /* ไม่เป็นไร */ }
  }
  location.reload();
}
