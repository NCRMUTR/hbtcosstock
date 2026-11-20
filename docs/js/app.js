/* ══════════════════════════════════════════════════════════════════════════
   app.js — จุดเริ่มต้นของหน้าเว็บ: ล็อกอิน แล้วประกอบเมนูตามสิทธิ์ผู้ใช้
   ══════════════════════════════════════════════════════════════════════════ */

import { getUser, isAdmin, can } from './api.js';
import { initAuth, showApp, signOut } from './auth.js';
import { $, esc, icon, toast, installImgFallback } from './ui.js';
import { changePasswordDialog } from './dialogs.js';

import * as stock  from './pages/stock.js';
import * as imp    from './pages/import.js';
import * as users  from './pages/users.js';
import * as settings from './pages/settings.js';
import * as mapPage from './pages/map.js';

const PAGES = {
  map:    { label: 'แผนผัง',        icon: icon.map,    mod: mapPage, role: 'viewer' },
  stock:  { label: 'คลังสารเคมีและวัสดุ', icon: icon.search, mod: stock,  role: 'viewer' },
  import: { label: 'นำเข้าข้อมูล',  icon: icon.upload, mod: imp,    role: 'admin'  },
  users:  { label: 'ผู้ใช้ระบบ',    icon: icon.users,  mod: users,  role: 'admin'  },
  settings: { label: 'ตัวเลือก',   icon: icon.gear,   mod: settings, role: 'staff' }
};

let current = null;

/* ── ชื่อระบบ ────────────────────────────────────────────────────────────── */
// ชื่อจริงตกลงกันตอนติดตั้ง จึงอ่านจาก config.js แทนการเขียนตายไว้ใน HTML
// (HTML มีค่าเดียวกับค่าตั้งต้นไว้แล้ว หน้าจอจึงไม่กะพริบตอนโหลด)
(function applyBranding() {
  const cfg = window.APP_CONFIG || {};
  const name = String(cfg.APP_NAME || 'Lab Chem Stock');
  const tag  = String(cfg.APP_TAGLINE || 'คลังสารเคมีและวัสดุ');
  document.title = name;
  document.querySelectorAll('[data-app-name]').forEach(el => { el.textContent = name; });
  document.querySelectorAll('[data-app-tagline]').forEach(el => { el.textContent = tag; });
})();

/* ── เริ่มต้น ────────────────────────────────────────────────────────────── */

initAuth(user => {
  buildRail(user);
  showApp();
  installImgFallback(window.APP_CONFIG.PHOTO_FALLBACK_URL);
  go(routeFromHash() || 'stock');
});

/** ปุ่ม "ดูบนแผนผัง" จากหน้ารายละเอียดล็อต */
window.addEventListener('hbt:showOnMap', e => {
  const placeId = (e.detail || {}).placeId;
  if (!placeId) return;
  mapPage.focusPlace(placeId);
  go('map');
});

window.addEventListener('hashchange', () => {
  const p = routeFromHash();
  if (p && p !== current) go(p);
});

function routeFromHash() {
  const key = (location.hash || '').replace(/^#\/?/, '');
  return PAGES[key] ? key : null;
}

/* ── แถบเมนู ─────────────────────────────────────────────────────────────── */

function buildRail(user) {
  const allowed = Object.keys(PAGES).filter(k => can(PAGES[k].role));

  $('#rail-nav').innerHTML = allowed.map(k => `
    <button data-page="${k}">${PAGES[k].icon}<span>${esc(PAGES[k].label)}</span></button>
  `).join('');

  $('#rail-nav').addEventListener('click', e => {
    const b = e.target.closest('[data-page]');
    if (b) go(b.dataset.page);
  });

  // บัญชีรหัสผ่านไม่มีอีเมล — แสดงชื่อผู้ใช้แทน
  const who      = user.email || user.username || '';
  const initials = (user.name || who || '?').trim().charAt(0).toUpperCase();
  $('#who').innerHTML = `
    <div class="who-dot" aria-hidden="true">${esc(initials)}</div>
    <div class="who-id">
      <b>${esc(user.name)}</b>
      <span title="${esc(who)}">${esc(who)}</span>
    </div>
    ${user.kind === 'PASSWORD'
      ? '<button class="link-btn" id="btn-chpass">เปลี่ยนรหัสผ่าน</button>' : ''}`;

  const chpass = $('#btn-chpass');
  if (chpass) chpass.addEventListener('click', changePasswordDialog);

  $('#role-line').textContent =
    ({ admin: 'ผู้ดูแลระบบ', staff: 'เจ้าหน้าที่', viewer: 'ดูอย่างเดียว' })[user.role] || user.role;

  $('#btn-signout').addEventListener('click', signOut);
}

/* ── เปลี่ยนหน้า ─────────────────────────────────────────────────────────── */

function go(key) {
  const page = PAGES[key];
  if (!page) return;

  if (!can(page.role)) {
    toast(page.role === 'admin' ? 'หน้านี้สำหรับผู้ดูแลระบบเท่านั้น'
                                : 'หน้านี้สำหรับเจ้าหน้าที่ขึ้นไปเท่านั้น', 'risk');
    return;
  }

  current = key;
  if (location.hash !== '#/' + key) history.replaceState(null, '', '#/' + key);

  document.querySelectorAll('#rail-nav button').forEach(b => {
    if (b.dataset.page === key) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });

  const main = $('#main');
  main.innerHTML = '';
  page.mod.render(main);
  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}
