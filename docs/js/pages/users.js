/* ══════════════════════════════════════════════════════════════════════════
   pages/users.js — จัดการผู้ใช้ (เฉพาะผู้ดูแลระบบ)

   มีบัญชี 2 ชนิดในหน้าเดียว:
     · บัญชี Google   — ล็อกอินด้วยอีเมลองค์กร ระบบไม่เก็บรหัสผ่าน
     · บัญชีรหัสผ่าน  — ชื่อผู้ใช้ + รหัสผ่านที่ตั้งให้ สำหรับคนที่ไม่มีอีเมลองค์กร
   ══════════════════════════════════════════════════════════════════════════ */

import { api, getUser } from '../api.js';
import {
  $, esc, toast, withBusy, fmtDateTime, fmtNum, confirmAction,
  openModal, readForm
} from '../ui.js';

const CFG = window.APP_CONFIG;
const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ', staff: 'เจ้าหน้าที่', viewer: 'ดูอย่างเดียว' };

let list = [];
let addKind = 'GOOGLE';

/** ตัวชี้ผู้ใช้ที่หลังบ้านเข้าใจ — อีเมล หรือ ชื่อผู้ใช้ อย่างใดอย่างหนึ่ง */
function refOf(u) {
  return u.kind === 'PASSWORD' ? { username: u.username } : { email: u.email };
}
function idOf(u) { return u.kind === 'PASSWORD' ? u.username : u.email; }
function findBy(kind, id) {
  return list.find(u => u.kind === kind && idOf(u) === id);
}

export function render(root) {
  root.innerHTML = `
    <div class="view-head">
      <h1>ผู้ใช้ระบบ</h1>
      <p>หน้านี้กำหนดว่าใครเข้าระบบได้และทำอะไรได้</p>
    </div>

    <div class="panel">
      <h2>เพิ่มผู้ใช้</h2>

      <div class="seg" id="kind-seg" role="tablist">
        <button type="button" role="tab" data-kind="GOOGLE"   aria-selected="true">บัญชี Google</button>
        <button type="button" role="tab" data-kind="PASSWORD" aria-selected="false">บัญชีรหัสผ่าน</button>
      </div>

      <form id="add-form" autocomplete="off"><div id="add-fields"></div>
        <div class="form-actions">
          <button class="btn" type="submit">เพิ่มผู้ใช้</button>
        </div>
      </form>
    </div>

    <div class="panel">
      <h2>รายชื่อผู้ใช้</h2>
      <div id="u-list"><p class="muted">กำลังโหลด…</p></div>
    </div>
  `;

  $('#kind-seg').addEventListener('click', e => {
    const b = e.target.closest('[data-kind]');
    if (!b || b.dataset.kind === addKind) return;
    addKind = b.dataset.kind;
    paintAddForm();
  });
  $('#add-form').addEventListener('submit', add);
  $('#u-list').addEventListener('click', onListClick);
  $('#u-list').addEventListener('change', onRoleChange);

  paintAddForm();
  load();
}

function roleOptions(kind, selected) {
  const roles = kind === 'PASSWORD' ? ['staff', 'viewer'] : ['staff', 'viewer', 'admin'];
  const note  = {
    staff:  'เจ้าหน้าที่ — เพิ่ม เบิก แก้ไขข้อมูล',
    viewer: 'ดูอย่างเดียว — ค้นหาและดาวน์โหลด',
    admin:  'ผู้ดูแลระบบ — ทำได้ทุกอย่าง'
  };
  return roles.map(r =>
    `<option value="${r}"${selected === r ? ' selected' : ''}>${note[r]}</option>`).join('');
}

function paintAddForm() {
  markKindButtons();

  $('#add-fields').innerHTML = addKind === 'GOOGLE' ? `
    <p>ล็อกอินด้วยบัญชี Google โดเมน <code class="mono">@${esc(CFG.DOMAIN)}</code>
       — ระบบไม่เก็บรหัสผ่าน การยืนยันตัวตนเป็นหน้าที่ของ Google</p>
    <div class="row-3">
      <div class="field">
        <label for="u-email">อีเมล</label>
        <input id="u-email" name="email" type="email" required
               placeholder="somchai.j@${esc(CFG.DOMAIN)}">
      </div>
      <div class="field">
        <label for="u-name">ชื่อ-นามสกุล</label>
        <input id="u-name" name="name" type="text" required placeholder="สมชาย ใจดี">
      </div>
      <div class="field">
        <label for="u-role">สิทธิ์</label>
        <select id="u-role" name="role">${roleOptions('GOOGLE', 'staff')}</select>
      </div>
    </div>` : `
    <p>สำหรับคนที่ไม่มีอีเมล <code class="mono">@${esc(CFG.DOMAIN)}</code> เช่น นักศึกษาช่วยงาน
       — คุณตั้งรหัสผ่านให้ แล้วบอกเขาไปใช้ล็อกอิน</p>
    <div class="row-3">
      <div class="field">
        <label for="u-username">ชื่อผู้ใช้</label>
        <input id="u-username" name="username" type="text" required
               pattern="[A-Za-z0-9._\\-]{3,30}" placeholder="student01">
        <small class="hint">a-z ตัวเลข . _ - ยาว 3–30 ตัว (ไม่ต้องใส่อีเมล)</small>
      </div>
      <div class="field">
        <label for="u-name">ชื่อ-นามสกุล</label>
        <input id="u-name" name="name" type="text" required placeholder="สมชาย ช่วยงาน">
      </div>
      <div class="field">
        <label for="u-role">สิทธิ์</label>
        <select id="u-role" name="role">${roleOptions('PASSWORD', 'staff')}</select>
        <small class="hint">บัญชีรหัสผ่านเป็นผู้ดูแลระบบไม่ได้</small>
      </div>
    </div>
    <div class="row-2">
      <div class="field">
        <label for="u-pass">รหัสผ่าน</label>
        <input id="u-pass" name="password" type="text" required minlength="8" autocomplete="new-password">
        <small class="hint">ยาวอย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข — จดไว้ก่อนกดเพิ่ม
          เพราะระบบเก็บเป็นค่าที่ย้อนกลับไม่ได้ ดูรหัสเดิมภายหลังไม่ได้</small>
      </div>
    </div>`;
}

function markKindButtons() {
  document.querySelectorAll('#kind-seg [data-kind]').forEach(b => {
    b.setAttribute('aria-selected', String(b.dataset.kind === addKind));
  });
}

async function load() {
  try {
    const res = await withBusy(() => api.usersList());
    list = res.users;
    paint();
  } catch (e) {
    $('#u-list').innerHTML = `<div class="note note-risk">${esc(e.message)}</div>`;
  }
}

function paint() {
  if (!list.length) {
    $('#u-list').innerHTML = '<div class="empty"><b>ยังไม่มีผู้ใช้</b>เพิ่มผู้ใช้คนแรกจากแบบฟอร์มด้านบน</div>';
    return;
  }

  const me = getUser();
  const order = { admin: 0, staff: 1, viewer: 2 };
  const sorted = [...list].sort((a, b) =>
    (order[a.role] - order[b.role]) || String(a.name).localeCompare(String(b.name), 'th'));

  $('#u-list').innerHTML = `
    <div class="table-scroll">
      <table class="data">
        <thead><tr>
          <th>ชื่อ</th><th>บัญชีที่ใช้เข้าระบบ</th><th>สิทธิ์</th>
          <th>เข้าใช้ล่าสุด</th><th class="right">จำนวนครั้ง</th><th>สถานะ</th><th></th>
        </tr></thead>
        <tbody>${sorted.map(u => {
          const pw   = u.kind === 'PASSWORD';
          const id   = idOf(u);
          const self = me && (pw ? me.username === id : me.email === id);
          const off  = u.status !== 'ACTIVE';
          const attrs = `data-kind="${u.kind}" data-id="${esc(id)}"`;
          return `<tr${off ? ' class="s-elim"' : ''}>
            <td><b>${esc(u.name)}</b>${self ? ' <span class="tag tag-mute">คุณ</span>' : ''}</td>
            <td>
              <span class="mono" style="font-size:.84rem">${esc(id)}</span>
              <span class="tag ${pw ? 'tag-warn' : 'tag-mute'}">${pw ? 'รหัสผ่าน' : 'Google'}</span>
            </td>
            <td>
              <select ${attrs} data-role-sel aria-label="สิทธิ์ของ ${esc(u.name)}"
                      style="font-size:.84rem;padding:3px 6px">
                ${roleOptions(u.kind, u.role)}
              </select>
            </td>
            <td style="font-size:.84rem">${u.lastLogin ? fmtDateTime(u.lastLogin) : 'ยังไม่เคยเข้า'}</td>
            <td class="right num">${fmtNum(u.loginCount)}</td>
            <td>${off ? '<span class="tag tag-risk">ระงับ</span>'
                      : '<span class="tag tag-ok">ใช้งานได้</span>'}</td>
            <td class="right u-acts">
              ${pw ? `<button class="btn btn-ghost btn-sm" ${attrs} data-reset>ตั้งรหัสใหม่</button>` : ''}
              ${self ? '' : `<button class="btn btn-ghost btn-sm" ${attrs}
                   data-toggle data-to="${off ? 'ACTIVE' : 'DISABLED'}">
                   ${off ? 'คืนสิทธิ์' : 'ระงับ'}</button>`}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
}

async function add(e) {
  e.preventDefault();
  const f = readForm($('#add-form'));
  const p = addKind === 'PASSWORD'
    ? { kind: 'PASSWORD', username: f.username, password: f.password, name: f.name, role: f.role }
    : { kind: 'GOOGLE',   email: f.email,       name: f.name,         role: f.role };

  try {
    await withBusy(() => api.usersAdd(p));
    toast(`เพิ่ม ${f.name} เรียบร้อย`, 'ok');
    paintAddForm();
    await load();
  } catch (err) {
    toast(err.message, 'risk');
  }
}

/** ขอรหัสผ่านใหม่ 1 ช่อง — ไม่มีการยืนยันซ้ำเพราะ admin เห็นสิ่งที่พิมพ์อยู่แล้ว */
function askPassword(title, note) {
  return new Promise(resolve => {
    const m = openModal({
      title: esc(title),
      body: `<form id="pw-form" autocomplete="off">
        <div class="field">
          <label for="pw-new">รหัสผ่านใหม่</label>
          <input id="pw-new" name="password" type="text" required minlength="8"
                 autocomplete="new-password">
          <small class="hint">${esc(note)}</small>
        </div>
      </form>`,
      foot: `<button class="btn btn-ghost" data-close>ยกเลิก</button>
             <button class="btn" id="pw-ok">ตั้งรหัสผ่าน</button>`,
      onClose: r => resolve(r || null)
    });
    const submit = ev => {
      ev.preventDefault();
      const v = $('#pw-new', m.el).value;
      if (!v || v.length < 8) { toast('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร', 'risk'); return; }
      m.close(v);
    };
    $('#pw-form', m.el).addEventListener('submit', submit);
    $('#pw-ok', m.el).addEventListener('click', submit);
    $('#pw-new', m.el).focus();
  });
}

async function onListClick(e) {
  const b = e.target.closest('button[data-kind]');
  if (!b) return;
  const u = findBy(b.dataset.kind, b.dataset.id);
  if (!u) return;

  if (b.hasAttribute('data-reset')) {
    const pass = await askPassword('ตั้งรหัสใหม่ให้ ' + u.name,
      'จดไว้ก่อนกดตกลง แล้วบอกเจ้าตัว — ดูย้อนหลังไม่ได้ และเขาจะหลุดจากระบบทุกเครื่องทันที');
    if (!pass) return;
    try {
      await withBusy(() => api.usersResetPassword(u.username, pass));
      toast('ตั้งรหัสใหม่เรียบร้อย — แจ้งรหัสให้เจ้าตัวด้วย', 'ok');
      await load();
    } catch (err) { toast(err.message, 'risk'); }
    return;
  }

  if (b.hasAttribute('data-toggle')) {
    const to   = b.dataset.to;
    const verb = to === 'DISABLED' ? 'ระงับการใช้งานของ' : 'คืนสิทธิ์ให้';
    if (!confirmAction(`${verb} ${idOf(u)} ?`)) return;
    try {
      await withBusy(() => api.usersSetStatus(refOf(u), to));
      toast(to === 'DISABLED' ? 'ระงับการใช้งานแล้ว — หลุดจากระบบทันทีทุกเครื่อง' : 'คืนสิทธิ์แล้ว', 'ok');
      await load();
    } catch (err) { toast(err.message, 'risk'); }
  }
}

async function onRoleChange(e) {
  const sel = e.target.closest('select[data-role-sel]');
  if (!sel) return;

  const u = findBy(sel.dataset.kind, sel.dataset.id);
  if (!u) return;
  const role = sel.value;
  if (role === u.role) return;

  if (!confirmAction(
      `เปลี่ยนสิทธิ์ของ ${idOf(u)} เป็น "${ROLE_LABEL[role]}" ?\n` +
      'เจ้าตัวจะต้องล็อกอินใหม่ 1 ครั้ง')) {
    sel.value = u.role;
    return;
  }

  try {
    await withBusy(() => api.usersUpdate(Object.assign({ role }, refOf(u))));
    toast('เปลี่ยนสิทธิ์แล้ว', 'ok');
    await load();
  } catch (err) {
    toast(err.message, 'risk');
    sel.value = u.role;
  }
}
