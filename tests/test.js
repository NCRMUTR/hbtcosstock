/**
 * test.js — ทดสอบหลังบ้าน HBT Raw Material Stock v2 (ไฟล์ .gs จริง) ผ่านประตู doPost
 * รัน:  node tests/test.js
 *
 * ตัวจำลองใน harness.js เข้มเท่า Apps Script จริงในเรื่องที่เคยทำให้ระบบพังจริง:
 *   · ชีตมีขอบเขตแถว/คอลัมน์ (ชีตใหม่ = 1000 × 26) เขียนเกินต้องขยายก่อน
 *   · เซลล์รับได้เฉพาะค่าพื้นฐานกับ Date
 */
'use strict';
const H = require('./harness');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; return; }
  fail++; failures.push(name + (extra ? '  → ' + extra : ''));
  console.log('  ❌ ' + name + (extra ? '  → ' + extra : ''));
}
function eq(a, b, name) {
  ok(JSON.stringify(a) === JSON.stringify(b), name, 'ได้ ' + JSON.stringify(a) + ' ต้องการ ' + JSON.stringify(b));
}
function section(t) { console.log('\n▸ ' + t); }

/** เรียกผ่าน doPost จริง → { ok, data|error } */
function call(action, payload, session) {
  const out = doPost({ postData: { contents: JSON.stringify({ action, payload: payload || {}, session: session || null }) } });
  return JSON.parse(out.getContent());
}
function good(action, payload, session) {
  const r = call(action, payload, session);
  if (!r.ok) throw new Error(action + ' ล้มเหลว: ' + r.error.code + ' ' + r.error.message);
  return r.data;
}
function bad(action, payload, session, code, name) {
  const r = call(action, payload, session);
  ok(!r.ok && (!code || r.error.code === code),
     name || (action + ' ต้องถูกปฏิเสธ' + (code ? ' (' + code + ')' : '')),
     r.ok ? 'สำเร็จทั้งที่ไม่ควร' : r.error.code + ': ' + r.error.message);
  return r;
}

const CLIENT_ID = 'test.apps.googleusercontent.com';
const ADMIN = 'admin@rmutr.ac.th';

/** ลงทะเบียน ID token ปลอมที่ "Google" จะตอบรับ */
function mockToken(token, email, over) {
  H.TOKENS.set(token, Object.assign({
    aud: CLIENT_ID, email: email, email_verified: 'true', hd: 'rmutr.ac.th'
  }, over || {}));
  return token;
}

function fresh() {
  H.reset();
  H._props.set('SPREADSHEET_ID', 'x');
  H._props.set('OAUTH_CLIENT_ID', CLIENT_ID);
  H._props.set('BOOTSTRAP_ADMIN', ADMIN);
  return setupSpreadsheet();
}

function loginAs(email, over) {
  mockToken('tok-' + email, email, over);
  return call('login', { idToken: 'tok-' + email });
}
function sessionOf(email) {
  const r = loginAs(email);
  if (!r.ok) throw new Error('ล็อกอิน ' + email + ' ไม่ได้: ' + r.error.code + ' ' + r.error.message);
  return r.data.session;
}

console.log('━'.repeat(60));
console.log('  HBT Raw Material Stock v2 — ทดสอบหลังบ้าน');
console.log('━'.repeat(60));

// ═══════════════════════════════════════════════════════════════════════════
section('ติดตั้งระบบ');
const log = fresh();
ok(/ติดตั้งเรียบร้อย/.test(log), 'setupSpreadsheet รันผ่าน');
['Materials', 'Lots', 'Transactions', 'Settings', 'Users', 'AuditLog'].forEach(n => {
  ok(!!H.SS.getSheetByName(n), 'สร้างชีต ' + n);
});
ok(!!H._props.get('SESSION_SECRET'), 'สร้าง SESSION_SECRET อัตโนมัติ');
ok(readTable_('USERS').length === 1, 'มีผู้ดูแลระบบคนแรก 1 คน');
eq(readTable_('USERS')[0].Email, ADMIN, 'อีเมลผู้ดูแลระบบคนแรกถูกต้อง');

// หัวตารางตรงกับ SCHEMA ทุกคอลัมน์
Object.keys(SHEETS).forEach(key => {
  const sheet = H.SS.getSheetByName(SHEETS[key]);
  const want  = SCHEMA[key];
  const have  = sheet.getRange(1, 1, 1, want.length).getValues()[0];
  ok(JSON.stringify(have) === JSON.stringify(want), 'หัวตาราง ' + SHEETS[key] + ' ตรงกับ SCHEMA');
});

ok(/✅/.test(healthCheck()) && !/❌/.test(healthCheck()), 'healthCheck ผ่าน');

const again = setupSpreadsheet();
ok(/ติดตั้งเรียบร้อย/.test(again), 'รัน setupSpreadsheet ซ้ำได้โดยไม่พัง');
ok(readTable_('USERS').length === 1, 'รันซ้ำแล้วไม่สร้างผู้ดูแลซ้ำ');

// ═══════════════════════════════════════════════════════════════════════════
section('ล็อกอินด้วย Google Sign-In');
bad('login', {}, null, 'NO_TOKEN', 'ไม่ส่ง idToken');
bad('login', { idToken: 'ไม่มีในระบบ' }, null, 'BAD_TOKEN', 'token ที่ Google ไม่รับรอง');

mockToken('t-wrongaud', ADMIN, { aud: 'other.apps.googleusercontent.com' });
bad('login', { idToken: 't-wrongaud' }, null, 'WRONG_AUDIENCE', 'token ออกให้แอปอื่น');

mockToken('t-unverified', ADMIN, { email_verified: 'false' });
bad('login', { idToken: 't-unverified' }, null, 'EMAIL_UNVERIFIED', 'อีเมลยังไม่ยืนยัน');

mockToken('t-outside', 'someone@gmail.com', { hd: '' });
bad('login', { idToken: 't-outside' }, null, null, 'อีเมลนอกโดเมนองค์กร');

mockToken('t-stranger', 'stranger@rmutr.ac.th');
bad('login', { idToken: 't-stranger' }, null, null, 'อยู่ในโดเมนแต่ไม่มีใน Users');

const A = sessionOf(ADMIN);
ok(!!A, 'ผู้ดูแลระบบล็อกอินได้');
const me = good('me', {}, A);
eq(me.user.email, ADMIN, 'me คืนอีเมลถูกต้อง');
eq(me.user.role, 'admin', 'me คืนสิทธิ์ admin');

// ═══════════════════════════════════════════════════════════════════════════
section('session และสิทธิ์');
bad('users.list', {}, null, 'NO_SESSION', 'ไม่มี session เรียก API ที่ต้องล็อกอินไม่ได้');
bad('users.list', {}, 'ของปลอม.aaa.bbb', null, 'session ที่แก้ไข/ปลอม');

const parts = A.split('.');
bad('users.list', {}, parts[0] + '.ลายเซ็นผิด', null, 'ลายเซ็น session ไม่ถูกต้อง');

good('ping');
ok(typeof good('version', {}, A).version === 'number', 'version คืนเลขเวอร์ชัน');

// ═══════════════════════════════════════════════════════════════════════════
section('จัดการผู้ใช้');
good('users.add', { email: 'staff.a@rmutr.ac.th', name: 'สมชาย ใจดี', role: 'staff' }, A);
good('users.add', { email: 'view.b@rmutr.ac.th', name: 'มาลี ดูงาน', role: 'viewer' }, A);
ok(good('users.list', {}, A).users.length === 3, 'มีผู้ใช้ 3 คน');

bad('users.add', { email: 'staff.a@rmutr.ac.th', name: 'ซ้ำ', role: 'staff' }, A, null, 'เพิ่มอีเมลซ้ำไม่ได้');
bad('users.add', { email: 'outsider@gmail.com', name: 'นอกโดเมน', role: 'staff' }, A, null, 'เพิ่มอีเมลนอกโดเมนไม่ได้');
bad('users.add', { email: 'x@rmutr.ac.th', name: 'สิทธิ์เพี้ยน', role: 'superuser' }, A, null, 'สิทธิ์ที่ไม่มีในระบบ');

const S = sessionOf('staff.a@rmutr.ac.th');
let V = sessionOf('view.b@rmutr.ac.th');
bad('users.add', { email: 'y@rmutr.ac.th', name: 'y', role: 'staff' }, S, null, 'staff เพิ่มผู้ใช้ไม่ได้');
bad('users.list', {}, V, null, 'viewer ดูรายชื่อผู้ใช้ไม่ได้');
ok(good('snapshot', {}, V).version !== undefined, 'viewer ดูข้อมูลสต๊อกได้');

good('users.update', { email: 'view.b@rmutr.ac.th', name: 'มาลี ดูงาน (แก้ไข)' }, A);
eq(good('users.list', {}, A).users.filter(u => u.email === 'view.b@rmutr.ac.th')[0].name,
   'มาลี ดูงาน (แก้ไข)', 'แก้ชื่อผู้ใช้ได้');

good('users.setStatus', { email: 'view.b@rmutr.ac.th', status: 'DISABLED' }, A);
bad('login', { idToken: 'tok-view.b@rmutr.ac.th' }, null, null, 'บัญชีที่ปิดใช้งานล็อกอินไม่ได้');
// สำคัญ: คนที่ถูกปิดบัญชีต้องใช้ session ที่ถืออยู่ต่อไม่ได้ทันที ไม่ใช่รอครบ 8 ชั่วโมง
bad('snapshot', {}, V, null, 'ปิดบัญชีแล้ว session ที่ค้างอยู่ใช้ต่อไม่ได้ทันที');
good('users.setStatus', { email: 'view.b@rmutr.ac.th', status: 'ACTIVE' }, A);
ok(loginAs('view.b@rmutr.ac.th').ok, 'เปิดใช้งานกลับแล้วล็อกอินได้');
// เปิดบัญชีกลับก็ยังต้องล็อกอินใหม่ — session เดิมถูกตัดไปแล้ว
bad('snapshot', {}, V, 'SESSION_STALE', 'เปิดบัญชีกลับแล้ว session เดิมยังใช้ไม่ได้ ต้องล็อกอินใหม่');
V = sessionOf('view.b@rmutr.ac.th');
ok(good('snapshot', {}, V).version !== undefined, 'ล็อกอินใหม่แล้วใช้งานได้ปกติ');

bad('users.setStatus', { email: ADMIN, status: 'DISABLED' }, A, null, 'ปิดบัญชี admin คนสุดท้ายไม่ได้');
bad('users.update', { email: ADMIN, role: 'staff' }, A, null, 'ลดสิทธิ์ admin คนสุดท้ายไม่ได้');

// ═══════════════════════════════════════════════════════════════════════════
section('รายการตัวเลือก (Settings)');
good('settings.add', { type: 'Room', value: 'Room 999' }, A);
ok(getSettingsMap_().Room.indexOf('Room 999') !== -1, 'เพิ่มห้องใหม่เข้ารายการตัวเลือก');
bad('settings.add', { type: 'Room', value: 'Room 999' }, A, 'DUPLICATE', 'เพิ่มค่าซ้ำถูกปฏิเสธ');
eq(getSettingsMap_().Room.filter(v => v === 'Room 999').length, 1, 'ไม่มีรายการซ้ำในรายการตัวเลือก');
good('settings.remove', { type: 'Room', value: 'Room 999' }, A);
ok(getSettingsMap_().Room.indexOf('Room 999') === -1, 'ลบออกจากรายการตัวเลือกได้');
bad('settings.add', { type: 'ไม่มีชนิดนี้', value: 'x' }, A, null, 'ชนิดตัวเลือกที่ไม่รู้จัก');
bad('settings.add', { type: 'Room', value: '' }, A, null, 'ค่าว่าง');
bad('settings.add', { type: 'Room', value: 'Room 1' }, V, null, 'viewer แก้รายการตัวเลือกไม่ได้');

// ═══════════════════════════════════════════════════════════════════════════
section('นำเข้า CSV จากระบบเดิม');
const CSV_HEAD = 'Code,INCI Name,Trade Name,CAS No.,State,Function,Supplier,Shelf,Room,Total W.(g),Label W.(g),Receive Date,Expire Date,ปีงบประมาณ,ราคา,Unit';
const CSV = [
  CSV_HEAD,
  '#2601/0001,Glycerin,Glycerin 99%,56-81-5,Liquid,Humectant,ABC Chemical,Shelf A,Room 101,1000,750,2026-01-15,2029-01-15,2569,450,g',
  '#2601/0002,Xanthan Gum,Keltrol CG,11138-66-2,Powder,Thickener,XYZ Trading,Shelf B,Room 101,500,500,2026-02-01,2028-02-01,2569,890,g',
  '#2601/0003,Glycerin,Glycerin 99%,56-81-5,Liquid,Humectant,ABC Chemical,Shelf A,Room 102,2500,2000,2026-03-01,2029-03-01,2569,980,g'
].join('\n');

const pv = good('import.preview', { csv: CSV }, A);
eq(pv.totalRows, 3, 'ตรวจไฟล์เจอ 3 แถว');
eq(pv.newMaterials, 2, 'สารชนิดใหม่ 2 ตัว (Glycerin ซ้ำกัน 2 ล็อต)');
const beforeLots = readTable_('LOTS').length;
ok(beforeLots === 0, 'ก่อนยืนยัน ยังไม่มีข้อมูลล็อตในชีต');

bad('import.commit', { csv: CSV, fingerprint: 'ผิด' }, A, null, 'fingerprint ไม่ตรงต้องถูกปฏิเสธ');
const cm = good('import.commit', { csv: CSV, fingerprint: pv.fingerprint }, A);
ok(readTable_('LOTS').length === 3, 'นำเข้าแล้วมี 3 ล็อต');
ok(readTable_('MATERIALS').length === 2, 'นำเข้าแล้วมีสาร 2 ชนิด');
{
  // นำเข้าสร้าง RECEIVE ตามน้ำหนักที่รับมา และถ้ายอดคงเหลือปัจจุบันต่างจากนั้น
  // จะเติม ADJUST อีกแถวให้ยอดตรงกับความจริง (แถว 1 และ 3 ของไฟล์ตัวอย่างเป็นแบบนั้น)
  const txns = readTable_('TRANSACTIONS');
  eq(txns.filter(t => t.Type === 'RECEIVE').length, 3, 'นำเข้าแล้วมีรายการรับเข้า 3 รายการ');
  eq(txns.filter(t => t.Type === 'ADJUST').length, 2, 'เติมรายการปรับยอดให้ล็อตที่เหลือไม่เท่าที่รับมา');
  const bal = computeBalances_();
  const byCode = {};
  readTable_('LOTS').forEach(l => { byCode[l.LegacyCode] = bal[l.LotID] || 0; });
  eq(byCode['#2601/0001'], 750, 'ยอดคงเหลือตรงกับ Label W. ของแถวที่ 1');
  eq(byCode['#2601/0002'], 500, 'ยอดคงเหลือตรงกับ Label W. ของแถวที่ 2');
  eq(byCode['#2601/0003'], 2000, 'ยอดคงเหลือตรงกับ Label W. ของแถวที่ 3');
}
ok(getSettingsMap_().Room.indexOf('Room 101') !== -1, 'นำเข้าแล้วเพิ่มห้องเข้ารายการตัวเลือกให้เอง');

bad('import.preview', { csv: 'ก,ข,ค\n1,2,3' }, A, null, 'CSV ที่ไม่มีคอลัมน์ที่จำเป็น');
bad('import.commit', { csv: CSV, fingerprint: pv.fingerprint }, V, null, 'viewer นำเข้าไม่ได้');

const lots = readTable_('LOTS');
const L1 = lots.filter(l => l.LegacyCode === '#2601/0001')[0];
ok(!!L1, 'ค้นล็อตจาก Code เดิมของระบบเก่าได้');
eq(String(L1.Room), 'Room 101', 'เก็บห้องถูกต้อง');
eq(String(L1.Shelf), 'Shelf A', 'เก็บชั้นถูกต้อง');

// ═══════════════════════════════════════════════════════════════════════════
section('รายการเคลื่อนไหว (เบิก / คืน / ปรับยอด / จำหน่าย)');
const balAt = id => computeBalances_()[id] || 0;
const lotId = L1.LotID;
const start = balAt(lotId);
ok(start > 0, 'ล็อตมียอดคงเหลือหลังนำเข้า', String(start));

const t1 = good('txn.post', { lotId, type: 'ISSUE', qty: 100, person: 'สมชาย', purpose: 'เตรียมสูตร A' }, S);
eq(balAt(lotId), start - 100, 'เบิก 100 แล้วยอดลดลง 100');
eq(t1.balanceAfter, start - 100, 'ค่า balanceAfter ที่ตอบกลับตรงกับยอดจริง');

good('txn.post', { lotId, type: 'RETURN', qty: 40, person: 'สมชาย' }, S);
eq(balAt(lotId), start - 60, 'คืน 40 แล้วยอดเพิ่มกลับ');

bad('txn.post', { lotId, type: 'ISSUE', qty: 999999 }, S, 'INSUFFICIENT', 'เบิกเกินยอดคงเหลือไม่ได้');
bad('txn.post', { lotId, type: 'ISSUE', qty: 'ไม่ใช่ตัวเลข' }, S, 'BAD_QTY', 'จำนวนไม่ใช่ตัวเลข');
bad('txn.post', { lotId, type: 'FLY' }, S, 'BAD_TYPE', 'ชนิดรายการที่ไม่รู้จัก');
bad('txn.post', { lotId: 'LOT-ไม่มีจริง', type: 'ISSUE', qty: 1 }, S, 'NOT_FOUND', 'ล็อตที่ไม่มีในระบบ');
bad('txn.post', { type: 'ISSUE', qty: 1 }, S, 'NO_LOT', 'ไม่ระบุล็อต');
bad('txn.post', { lotId, type: 'ISSUE', qty: 1 }, V, null, 'viewer เบิกของไม่ได้');

// ADJUST รับค่าติดลบได้ (ใช้ตอนนับสต็อกแล้วหาย)
const beforeAdj = balAt(lotId);
good('txn.post', { lotId, type: 'ADJUST', qty: -25, notes: 'นับสต็อกประจำปี' }, S);
eq(balAt(lotId), beforeAdj - 25, 'ปรับยอดติดลบได้');

// จำหน่ายออก
const L2 = lots.filter(l => l.LegacyCode === '#2601/0002')[0];
const bal2 = balAt(L2.LotID);
good('txn.post', { lotId: L2.LotID, type: 'DISPOSE', qty: bal2, notes: 'หมดอายุ' }, S);
eq(balAt(L2.LotID), 0, 'จำหน่ายออกแล้วยอดเหลือ 0');

// ค้นด้วย Code เดิมก็โพสต์รายการได้
const t2 = good('txn.post', { lotId: '#2601/0003', type: 'ISSUE', qty: 10 }, S);
ok(!!t2.txnId, 'โพสต์รายการโดยอ้างด้วย Code เดิมได้');

// ═══════════════════════════════════════════════════════════════════════════
section('ยกเลิกรายการที่ลงผิด');
const balBeforeCancel = balAt(lotId);
good('txn.cancel', { txnId: t1.txnId, reason: 'ลงผิดล็อต' }, S);
eq(balAt(lotId), balBeforeCancel + 100, 'ยกเลิกรายการเบิกแล้วยอดกลับคืน');

const cancelled = readTable_('TRANSACTIONS').filter(t => t.TxnID === t1.txnId)[0];
eq(String(cancelled.Status).toUpperCase(), 'CANCELLED', 'รายการเดิมถูกทำเครื่องหมายว่ายกเลิกแล้ว');

bad('txn.cancel', { txnId: t1.txnId }, S, null, 'ยกเลิกรายการเดิมซ้ำไม่ได้');
bad('txn.cancel', { txnId: 'TXN-ไม่มีจริง' }, S, null, 'ยกเลิกรายการที่ไม่มีในระบบ');
bad('txn.cancel', { txnId: t2.txnId }, V, null, 'viewer ยกเลิกรายการไม่ได้');

// ═══════════════════════════════════════════════════════════════════════════
section('เพิ่มสารและรับเข้าล็อตใหม่ผ่านหน้าเว็บ');
{
  // ── สาร ────────────────────────────────────────────────────────────────
  const m1 = good('material.save', {
    inci: 'Sodium Hyaluronate', trade: 'HA-LMW', cas: '9067-32-7',
    func: 'Humectant', state: 'Powder', unit: 'g', defaultSupplier: 'Siam Ingredients',
    sds: 'https://example.com/sds/ha.pdf', hazard: '', storageCondition: '2-8C'
  }, S);
  ok(m1.created && /^MAT-/.test(m1.materialId), 'staff สร้างสารใหม่ได้', JSON.stringify(m1));
  ok(getSettingsMap_().Function.indexOf('Humectant') !== -1, 'ค่าที่กรอกเข้ารายการตัวเลือกให้เอง');

  bad('material.save', { inci: '' }, S, 'NO_NAME', 'ไม่กรอกชื่อ INCI');
  bad('material.save', { inci: 'X', sds: 'javascript:alert(1)' }, S, 'BAD_URL', 'ลิงก์ SDS ที่ไม่ใช่ http(s)');
  bad('material.save', { inci: 'Sodium Hyaluronate', trade: 'HA-LMW' }, S, 'DUPLICATE_MATERIAL', 'สร้างสารชื่อซ้ำไม่ได้');

  // ข้อผิดพลาดต้องบอกรหัสสารเดิมกลับมา เพื่อให้หน้าเว็บเสนอ "รับเข้าเป็นล็อตใหม่"
  const dupRes = call('material.save', { inci: 'Sodium Hyaluronate', trade: 'HA-LMW' }, S);
  eq(dupRes.error.data && dupRes.error.data.materialId, m1.materialId, 'บอกรหัสสารเดิมกลับมาด้วย');

  // ชื่อการค้าต่างกัน = คนละสาร
  const m2 = good('material.save', { inci: 'Sodium Hyaluronate', trade: 'HA-HMW', unit: 'g' }, S);
  ok(m2.created, 'ชื่อ INCI เดียวกันแต่ชื่อการค้าต่างกัน สร้างได้');

  // แก้ไขสาร
  const up = good('material.save', { materialId: m1.materialId, hazard: 'Irritant' }, S);
  ok(!up.created, 'แก้ไขสารเดิมไม่ใช่การสร้างใหม่');
  eq(readTable_('MATERIALS').filter(m => m.MaterialID === m1.materialId)[0].Hazard, 'Irritant', 'แก้ไขค่าแล้วบันทึกจริง');
  eq(readTable_('MATERIALS').filter(m => m.MaterialID === m1.materialId)[0].INCIName, 'Sodium Hyaluronate',
     'ช่องที่ไม่ได้ส่งมาต้องไม่ถูกล้าง');
  bad('material.save', { materialId: m1.materialId, inci: 'Sodium Hyaluronate', trade: 'HA-HMW' }, S,
      'DUPLICATE_MATERIAL', 'แก้ชื่อไปชนกับสารอื่นไม่ได้');
  bad('material.save', { materialId: 'MAT-99999', inci: 'X' }, S, 'NOT_FOUND', 'สารที่ไม่มีในระบบ');
  bad('material.save', { inci: 'ผู้ดูอย่างเดียว' }, V, null, 'viewer สร้างสารไม่ได้');

  // ── ล็อต ───────────────────────────────────────────────────────────────
  const before = readTable_('TRANSACTIONS').length;
  const nl = good('lot.save', {
    materialId: m1.materialId, qty: 500, room: 'Room 101', shelf: 'Shelf C',
    supplier: 'Siam Ingredients', supplierLotNo: 'SL-2026-01', unitPrice: 1250,
    receiveDate: '2026-10-01', expireDate: '2028-10-01', fiscalYear: '2570',
    legacyCode: '#2610/9001', notes: 'ล็อตทดสอบ'
  }, S);
  ok(nl.created && /^LOT-2570-/.test(nl.lotId), 'รับเข้าล็อตใหม่ได้ และรหัสล็อตอิงปีงบ', nl.lotId);
  eq(computeBalances_()[nl.lotId], 500, 'ยอดคงเหลือของล็อตใหม่เท่ากับจำนวนที่รับเข้า');
  eq(readTable_('TRANSACTIONS').length, before + 1, 'ลงบัญชีรับเข้าให้อัตโนมัติ 1 แถว');
  const rcv = readTable_('TRANSACTIONS').filter(t => t.LotID === nl.lotId)[0];
  eq(String(rcv.Type), 'RECEIVE', 'รายการที่ลงให้เป็นชนิดรับเข้า');
  ok(getSettingsMap_().Shelf.indexOf('Shelf C') !== -1, 'ชั้นวางใหม่เข้ารายการตัวเลือกให้เอง');

  // เบิกจากล็อตที่เพิ่งรับเข้าได้ทันที
  good('txn.post', { lotId: nl.lotId, type: 'ISSUE', qty: 50 }, S);
  eq(computeBalances_()[nl.lotId], 450, 'เบิกจากล็อตที่สร้างใหม่ได้ทันที');

  bad('lot.save', { materialId: m1.materialId, qty: 0 }, S, 'BAD_QTY', 'จำนวนรับเข้าต้องมากกว่า 0');
  bad('lot.save', { materialId: m1.materialId, qty: -5 }, S, 'BAD_NUMBER', 'จำนวนติดลบ');
  bad('lot.save', { qty: 10 }, S, 'NO_MATERIAL', 'ไม่ระบุสาร');
  bad('lot.save', { materialId: 'MAT-99999', qty: 10 }, S, 'NOT_FOUND', 'สารที่ไม่มีในระบบ');
  bad('lot.save', { materialId: m1.materialId, qty: 10, legacyCode: '#2610/9001' }, S,
      'DUPLICATE_CODE', 'รหัสเดิมบนขวดซ้ำกับล็อตอื่นไม่ได้');
  bad('lot.save', { materialId: m1.materialId, qty: 10, receiveDate: 'ไม่ใช่วันที่' }, S, 'BAD_DATE', 'วันที่ผิดรูปแบบ');
  bad('lot.save', { materialId: m1.materialId, qty: 10 }, V, null, 'viewer รับเข้าล็อตไม่ได้');

  // สร้างสารใหม่พร้อมรับเข้าล็อตแรกในคำสั่งเดียว
  const combo = good('lot.save', {
    material: { inci: 'Tocopheryl Acetate', trade: 'Vitamin E Acetate', cas: '7695-91-2', unit: 'mL' },
    qty: 250, room: 'Cold Room', shelf: 'Shelf A'
  }, S);
  ok(combo.created && combo.materialId, 'สร้างสารใหม่พร้อมล็อตแรกในคำสั่งเดียวได้');
  eq(computeBalances_()[combo.lotId], 250, 'ยอดคงเหลือของชุดที่สร้างพร้อมกันถูกต้อง');

  // ── แก้ไขล็อต ──────────────────────────────────────────────────────────
  good('lot.save', { lotId: nl.lotId, room: 'Room 102', shelf: 'Shelf B', notes: 'ย้ายที่แล้ว' }, S);
  const moved = readTable_('LOTS').filter(l => l.LotID === nl.lotId)[0];
  eq(String(moved.Room), 'Room 102', 'แก้ห้องของล็อตได้');
  eq(String(moved.Shelf), 'Shelf B', 'แก้ชั้นวางของล็อตได้');
  eq(Number(moved.QtyReceived), 500, 'จำนวนที่รับเข้าไม่ถูกแตะ');
  eq(computeBalances_()[nl.lotId], 450, 'แก้ข้อมูลล็อตแล้วยอดคงเหลือไม่เปลี่ยน');

  bad('lot.save', { lotId: nl.lotId, qty: 999 }, S, 'QTY_LOCKED', 'แก้จำนวนที่รับเข้าของล็อตเดิมไม่ได้');
  bad('lot.save', { lotId: 'LOT-ไม่มีจริง', room: 'x' }, S, 'NOT_FOUND', 'ล็อตที่ไม่มีในระบบ');

  // ล็อตที่สร้างใหม่ต้องโผล่ใน snapshot ให้หน้าเว็บเห็น
  const sn = good('snapshot', {}, A);
  const iLot = sn.lots.fields.indexOf('LotID');
  ok(sn.lots.rows.some(r => r[iLot] === nl.lotId), 'ล็อตใหม่อยู่ใน snapshot');
  ok(sn.balances[nl.lotId] === 450, 'snapshot ส่งยอดคงเหลือของล็อตใหม่มาถูกต้อง');
}

section('ประวัติการเคลื่อนไหว (route history)');
{
  const h = good('history', { lotId }, A);
  ok(h.txns.length > 0, 'ดึงประวัติของล็อตได้', JSON.stringify(h.total));
  ok(h.txns.every(t => t.lotId === lotId), 'ประวัติมีแต่รายการของล็อตที่ขอ');
  ok(h.txns[0].type !== undefined && h.txns[0].balanceAfter !== undefined, 'ประวัติมีชนิดรายการและยอดคงเหลือ');

  // เรียงใหม่สุดขึ้นก่อน
  const times = h.txns.map(t => new Date(t.recordedAt || t.txnAt).getTime());
  ok(times.every((v, i) => i === 0 || times[i - 1] >= v), 'เรียงรายการใหม่สุดขึ้นก่อน');

  ok(h.txns.some(t => t.status === 'CANCELLED'), 'ประวัติยังเก็บรายการที่ยกเลิกไว้ให้ตรวจสอบย้อนหลัง');

  // อ้างด้วย Code เดิมบนขวดก็ดูประวัติได้
  const byCode = good('history', { lotId: '#2601/0001' }, A);
  eq(byCode.total, h.total, 'ดูประวัติด้วยรหัสเดิมบนขวดได้ผลเดียวกัน');

  // ดูรวมทั้งสาร (Glycerin มี 2 ล็อต)
  const byMat = good('history', { materialId: L1.MaterialID }, A);
  ok(byMat.total > h.total, 'ดูประวัติรวมทุกล็อตของสารเดียวกันได้', byMat.total + ' vs ' + h.total);

  eq(good('history', { lotId, limit: 2 }, A).txns.length, 2, 'จำกัดจำนวนรายการที่ดึงได้');
  ok(good('history', { lotId }, V).txns.length > 0, 'viewer ดูประวัติได้');
  bad('history', {}, A, 'NO_TARGET', 'ไม่ระบุล็อตหรือสาร');
  bad('history', { lotId: 'LOT-ไม่มีจริง' }, A, 'NOT_FOUND', 'ล็อตที่ไม่มีในระบบ');
  bad('history', { lotId }, null, 'NO_SESSION', 'ไม่ล็อกอินดูประวัติไม่ได้');
}

section('สถานะบนชั้น (On Shelf / Eliminate)');
good('lot.setShelfState', { lotIds: [lotId], state: 'Eliminate' }, S);
eq(String(readTable_('LOTS').filter(l => l.LotID === lotId)[0].ShelfState), 'Eliminate', 'เปลี่ยนสถานะเป็น Eliminate');
good('lot.setShelfState', { lotIds: [lotId], state: 'On Shelf' }, S);
eq(String(readTable_('LOTS').filter(l => l.LotID === lotId)[0].ShelfState), 'On Shelf', 'เปลี่ยนกลับเป็น On Shelf');

const many = good('lot.setShelfState', { lotIds: lots.map(l => l.LotID), state: 'Eliminate' }, S);
ok(many.updated === 3, 'เปลี่ยนสถานะหลายรายการพร้อมกันได้', JSON.stringify(many));
good('lot.setShelfState', { lotIds: lots.map(l => l.LotID), state: 'On Shelf' }, S);

bad('lot.setShelfState', { lotIds: [lotId], state: 'ไม่มีสถานะนี้' }, S, 'BAD_STATE', 'สถานะที่ไม่รู้จัก');
bad('lot.setShelfState', { lotIds: [], state: 'On Shelf' }, S, 'NO_SELECTION', 'ไม่เลือกรายการ');
bad('lot.setShelfState', { lotIds: [lotId], state: 'On Shelf' }, V, null, 'viewer เปลี่ยนสถานะไม่ได้');

// ═══════════════════════════════════════════════════════════════════════════
section('ที่เก็บแบบลำดับชั้น (Places)');
let PL = {};
{
  PL.room = good('place.save', { name: 'ห้องแลป 204', kind: 'ROOM' }, S).placeId;
  ok(/^PL-/.test(PL.room), 'สร้างห้องได้', PL.room);
  PL.cab = good('place.save', { name: 'ตู้เก็บสารไวไฟ', kind: 'CABINET', parentId: PL.room,
                                zone: { x: 0.1, y: 0.2, w: 0.3, h: 0.5 }, color: '#0b5d73' }, S).placeId;
  PL.sh1 = good('place.save', { name: 'ชั้น 1', kind: 'SHELF', parentId: PL.cab, zone: { x: 0.05, y: 0.05, w: 0.9, h: 0.2 } }, S).placeId;
  PL.sh2 = good('place.save', { name: 'ชั้น 2', kind: 'SHELF', parentId: PL.cab, zone: { x: 0.05, y: 0.30, w: 0.9, h: 0.2 } }, S).placeId;
  ok(activePlaces_().length >= 4, 'มีที่เก็บ 4 ระดับในตาราง');

  // ชนิดที่เก็บเว้นว่าง = ลึกลงอีกหนึ่งระดับจากพ่อให้เอง
  const box = good('place.save', { name: 'กล่องตัวอย่าง', parentId: PL.sh1 }, S);
  eq(box.kind, 'BOX', 'เว้นชนิดว่างแล้วระบบเลือกระดับถัดไปให้เอง');

  // ── กฎลำดับชั้น ────────────────────────────────────────────────────────
  bad('place.save', { name: 'ห้องซ้อนห้อง', kind: 'ROOM', parentId: PL.room }, S, 'BAD_HIERARCHY', 'ห้องซ้อนในห้องไม่ได้');
  bad('place.save', { name: 'ชั้นลอย', kind: 'SHELF', parentId: 'PL-99999' }, S, 'NOT_FOUND', 'ที่เก็บแม่ที่ไม่มีจริง');
  bad('place.save', { placeId: PL.cab, parentId: PL.sh1 }, S, 'BAD_HIERARCHY', 'ย้ายตู้เข้าไปในชั้นของตัวเองไม่ได้');
  bad('place.save', { placeId: PL.room, parentId: PL.room }, S, 'BAD_HIERARCHY', 'ย้ายเข้าไปในตัวเองไม่ได้');
  bad('place.save', { placeId: PL.cab, kind: 'BOX' }, S, 'BAD_HIERARCHY', 'เปลี่ยนชนิดจนลูกไม่ลึกกว่าไม่ได้');
  bad('place.save', { name: 'ชั้น 1', kind: 'SHELF', parentId: PL.cab }, S, 'DUPLICATE_PLACE', 'ชื่อซ้ำในระดับเดียวกันไม่ได้');
  bad('place.save', { name: '' }, S, 'NO_NAME', 'ไม่กรอกชื่อ');
  bad('place.save', { name: 'สีเพี้ยน', color: 'แดง' }, S, 'BAD_COLOR', 'รูปแบบสีไม่ถูกต้อง');
  bad('place.save', { name: 'ห้องของคนดูอย่างเดียว' }, V, null, 'viewer สร้างที่เก็บไม่ได้');

  // ── ตำแหน่งปุ่มบนรูป ───────────────────────────────────────────────────
  bad('place.save', { name: 'ปุ่มล้นกรอบ', parentId: PL.cab, zone: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 } }, S, 'BAD_ZONE', 'ปุ่มล้นออกนอกรูป');
  bad('place.save', { name: 'ปุ่มจิ๋ว', parentId: PL.cab, zone: { x: 0.1, y: 0.1, w: 0.001, h: 0.001 } }, S, 'BAD_ZONE', 'ปุ่มเล็กเกินไป');
  bad('place.save', { name: 'ปุ่มลอย', kind: 'ROOM', zone: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }, S, 'BAD_ZONE', 'ที่เก็บบนสุดวางปุ่มไม่ได้');

  const zoned = readTable_('PLACES').filter(x => x.PlaceID === PL.sh1)[0];
  eq(Number(zoned.W), 0.9, 'บันทึกขนาดปุ่มเป็นสัดส่วนของรูป');
  good('place.save', { placeId: PL.sh1, zone: null }, S);
  eq(String(readTable_('PLACES').filter(x => x.PlaceID === PL.sh1)[0].W), '', 'ส่ง zone เป็น null = เอาปุ่มออกจากรูป');
  good('place.save', { placeId: PL.sh1, zone: { x: 0.05, y: 0.05, w: 0.9, h: 0.2 } }, S);

  eq(placePath_(activePlaces_(), PL.sh2).join(' › '), 'ห้องแลป 204 › ตู้เก็บสารไวไฟ › ชั้น 2', 'เส้นทางที่เก็บถูกต้อง');
}

section('ย้ายล็อตเข้าที่เก็บ (MOVE)');
{
  const lotsNow = readTable_('LOTS');
  const a = String(lotsNow[0].LotID), b = String(lotsNow[1].LotID);

  const mv = good('lot.move', { lotIds: [a, b], toPlaceId: PL.sh1, person: 'สมชาย' }, S);
  eq(mv.moved, 2, 'ย้าย 2 ล็อตพร้อมกันได้');
  const after = readTable_('LOTS').filter(l => String(l.LotID) === a)[0];
  eq(String(after.PlaceID), PL.sh1, 'ล็อตถูกผูกกับที่เก็บใหม่');
  eq(String(after.Room), 'ห้องแลป 204', 'ข้อความ Room เดิมถูกอัปเดตให้ตรง (รายงานเก่ายังใช้ได้)');
  eq(String(after.Shelf), 'ตู้เก็บสารไวไฟ › ชั้น 1', 'ข้อความ Shelf เดิมถูกอัปเดตให้ตรง');

  // บันทึกเป็นรายการ MOVE ในประวัติ โดยไม่กระทบยอดคงเหลือ
  const balBefore = computeBalances_()[a];
  const hist = good('history', { lotId: a }, S);
  const moveTxn = hist.txns.filter(t => t.type === 'MOVE')[0];
  ok(!!moveTxn, 'มีรายการย้ายที่ในประวัติ');
  eq(moveTxn.qty, 0, 'รายการย้ายที่ไม่กระทบยอดคงเหลือ');
  ok(/ชั้น 1/.test(moveTxn.notes), 'หมายเหตุบอกปลายทางที่ย้ายไป', moveTxn.notes);
  eq(computeBalances_()[a], balBefore, 'ยอดคงเหลือไม่เปลี่ยนหลังย้ายที่');

  // ยกเลิกรายการย้ายไม่ได้ (เพราะทำเครื่องหมายยกเลิกไม่ได้ย้ายของกลับจริง)
  bad('txn.cancel', { txnId: moveTxn.txnId }, S, 'CANNOT_CANCEL_MOVE', 'ยกเลิกรายการย้ายที่ไม่ได้');

  bad('lot.move', { lotIds: [a], toPlaceId: PL.sh1 }, S, 'NOTHING', 'ย้ายไปที่เดิมซ้ำ = ไม่มีอะไรให้ย้าย');
  bad('lot.move', { lotIds: [a], toPlaceId: 'PL-99999' }, S, 'NOT_FOUND', 'ที่เก็บปลายทางที่ไม่มีจริง');
  bad('lot.move', { lotIds: [], toPlaceId: PL.sh1 }, S, 'NO_SELECTION', 'ไม่เลือกล็อต');
  bad('lot.move', { lotIds: [a], toPlaceId: '' }, S, 'NO_PLACE', 'ไม่เลือกปลายทาง');
  bad('lot.move', { lotIds: [b], toPlaceId: PL.sh2 }, V, null, 'viewer ย้ายของไม่ได้');

  // ล็อตที่ไม่มีจริงถูกข้าม ไม่ทำให้ทั้งชุดล้ม
  const mix = good('lot.move', { lotIds: [a, 'LOT-ไม่มีจริง'], toPlaceId: PL.sh2 }, S);
  eq([mix.moved, mix.skipped], [1, 1], 'ล็อตที่ไม่มีจริงถูกข้าม ส่วนที่เหลือย้ายสำเร็จ');

  // แก้ชื่อที่เก็บ → ข้อความบนล็อตต้องตามไปด้วย
  good('place.save', { placeId: PL.cab, name: 'ตู้ไวไฟ A' }, S);
  eq(String(readTable_('LOTS').filter(l => String(l.LotID) === a)[0].Shelf), 'ตู้ไวไฟ A › ชั้น 2',
     'เปลี่ยนชื่อตู้แล้วข้อความบนล็อตที่อยู่ข้างในตามไปด้วย');
}

section('ลบที่เก็บ');
{
  bad('place.delete', { placeId: PL.room }, S, 'NOT_EMPTY', 'ลบห้องที่ยังมีตู้ข้างในไม่ได้');
  bad('place.delete', { placeId: PL.sh2 }, S, 'NOT_EMPTY', 'ลบชั้นที่ยังมีของอยู่ไม่ได้');
  bad('place.delete', { placeId: 'PL-99999' }, S, 'NOT_FOUND', 'ลบที่เก็บที่ไม่มีจริง');

  const tmp = good('place.save', { name: 'ชั้นว่างเปล่า', kind: 'SHELF', parentId: PL.cab }, S).placeId;
  good('place.delete', { placeId: tmp }, S);
  ok(!activePlaces_().some(x => String(x.PlaceID) === tmp), 'ลบที่เก็บว่างได้');
  ok(good('snapshot', {}, A).places.rows.every(r => r[0] !== tmp), 'ที่เก็บที่ลบแล้วหายจาก snapshot');
  bad('place.delete', { placeId: tmp }, S, 'NOT_FOUND', 'ลบซ้ำไม่ได้');
}

section('รูปภาพ (Drive)');
{
  // รูป JPEG 1x1 จริง (ไบต์หัวไฟล์ถูกต้อง) สำหรับทดสอบ
  const JPG = 'ffd8ffe000104a46494600010100000100010000ffdb004300ffc00011080001000101011100ffc40014000100000000000000000000000000000009ffda0008010100003f00d2cf20';
  const toB64 = hex => Buffer.from(hex, 'hex').toString('base64');

  const up = good('photo.upload', { ownerType: 'PLACE', ownerId: PL.cab, data: toB64(JPG), width: 1, height: 1 }, S);
  ok(/^PH-/.test(up.photoId) && up.fileId, 'อัปโหลดรูปของตู้ได้', JSON.stringify(up));
  eq(H.DRIVE.files.size, 1, 'ไฟล์ถูกเก็บลง Drive จริง 1 ไฟล์');
  const file = H.DRIVE.files.get(up.fileId);
  eq(file.sharing, ['ANYONE_WITH_LINK', 'VIEW'], 'ตั้งสิทธิ์ให้หน้าเว็บแสดงรูปได้');

  bad('photo.upload', { ownerType: 'PLACE', ownerId: PL.cab, data: 'bm90LWFuLWltYWdl' }, S, 'BAD_IMAGE', 'ไฟล์ที่ไม่ใช่รูป');
  bad('photo.upload', { ownerType: 'PLACE', ownerId: PL.cab, data: '' }, S, 'NO_DATA', 'ไม่ส่งข้อมูลรูป');
  bad('photo.upload', { ownerType: 'ROOM', ownerId: PL.cab, data: toB64(JPG) }, S, 'BAD_OWNER', 'ชนิดเจ้าของรูปที่ไม่รู้จัก');
  bad('photo.upload', { ownerType: 'PLACE', ownerId: 'PL-99999', data: toB64(JPG) }, S, 'NOT_FOUND', 'เจ้าของรูปที่ไม่มีจริง');
  bad('photo.upload', { ownerType: 'PLACE', ownerId: PL.cab, data: toB64(JPG) }, V, null, 'viewer อัปโหลดรูปไม่ได้');
  eq(H.DRIVE.files.size, 1, 'อัปโหลดที่ล้มเหลวไม่ทิ้งไฟล์ค้างใน Drive');

  // รูปหลัก = รูปที่ Sort น้อยที่สุด
  const up2 = good('photo.upload', { ownerType: 'PLACE', ownerId: PL.cab, data: toB64(JPG), width: 1, height: 1 }, S);
  good('photo.update', { photoId: up2.photoId, makeCover: true, caption: 'รูปหน้าตู้' }, S);
  const sorted = activePhotosOf_('PLACE', PL.cab).sort((x, y) => (parseInt(x.Sort, 10) || 0) - (parseInt(y.Sort, 10) || 0));
  eq(String(sorted[0].PhotoID), up2.photoId, 'ตั้งเป็นรูปหลักแล้วมาเป็นรูปแรก');
  eq(String(sorted[0].Caption), 'รูปหน้าตู้', 'บันทึกคำบรรยายรูป');

  // เพดานจำนวนรูปต่อรายการ
  for (let i = activePhotosOf_('PLACE', PL.cab).length; i < MAX_PHOTOS_PER_OWNER; i++) {
    good('photo.upload', { ownerType: 'PLACE', ownerId: PL.cab, data: toB64(JPG) }, S);
  }
  bad('photo.upload', { ownerType: 'PLACE', ownerId: PL.cab, data: toB64(JPG) }, S, 'PHOTO_LIMIT', 'เกินจำนวนรูปสูงสุดต่อรายการ');

  good('photo.delete', { photoId: up.photoId }, S);
  ok(!activePhotosOf_('PLACE', PL.cab).some(ph => String(ph.PhotoID) === up.photoId), 'ลบรูปออกจากระบบแล้ว');
  ok(H.DRIVE.files.get(up.fileId).trashed, 'ไฟล์ถูกย้ายไปถังขยะใน Drive ด้วย');
  bad('photo.delete', { photoId: up.photoId }, S, 'NOT_FOUND', 'ลบรูปซ้ำไม่ได้');

  // ── รูปของล็อตและของสาร (หน้าเว็บเพิ่งเปิดให้ใช้ในรุ่นนี้) ──────────────
  const lotPh = good('photo.upload', { ownerType: 'LOT', ownerId: lotId, data: toB64(JPG), width: 4, height: 3 }, S);
  ok(/^PH-/.test(lotPh.photoId), 'แนบรูปกับล็อตได้');
  eq(activePhotosOf_('LOT', lotId).length, 1, 'รูปผูกกับล็อตที่ถูกต้อง');
  eq(activePhotosOf_('PLACE', PL.cab).filter(ph => String(ph.PhotoID) === lotPh.photoId).length, 0,
     'รูปของล็อตไม่ไปปนกับรูปของที่เก็บ');

  const matId = readTable_('LOTS').filter(l => String(l.LotID) === lotId)[0].MaterialID;
  const matPh = good('photo.upload', { ownerType: 'MATERIAL', ownerId: matId, data: toB64(JPG), width: 4, height: 3 }, S);
  eq(activePhotosOf_('MATERIAL', matId).length, 1, 'แนบรูปกับสารได้');

  bad('photo.upload', { ownerType: 'LOT', ownerId: 'LOT-ไม่มีจริง', data: toB64(JPG) }, S, 'NOT_FOUND',
      'แนบรูปกับล็อตที่ไม่มีจริงไม่ได้');
  bad('photo.upload', { ownerType: 'MATERIAL', ownerId: 'MAT-99999', data: toB64(JPG) }, S, 'NOT_FOUND',
      'แนบรูปกับสารที่ไม่มีจริงไม่ได้');

  // เพดานนับแยกกันต่อเจ้าของ ไม่ใช่นับรวมทั้งระบบ
  for (let i = 1; i < MAX_PHOTOS_PER_OWNER; i++) {
    good('photo.upload', { ownerType: 'LOT', ownerId: lotId, data: toB64(JPG) }, S);
  }
  bad('photo.upload', { ownerType: 'LOT', ownerId: lotId, data: toB64(JPG) }, S, 'PHOTO_LIMIT',
      'ล็อตหนึ่งแนบได้ไม่เกิน ' + MAX_PHOTOS_PER_OWNER + ' รูป');
  ok(good('photo.upload', { ownerType: 'MATERIAL', ownerId: matId, data: toB64(JPG) }, S).photoId,
     'ล็อตเต็มโควตาแล้ว สารเดียวกันยังแนบรูปได้ (นับแยกกัน)');

  // รูปของล็อตเข้า snapshot ให้หน้าเว็บเอาไปแสดงเป็นรูปย่อ
  const snapPh = good('snapshot', {}, V).photos;
  const iOwner = snapPh.fields.indexOf('OwnerType'), iOwnerId = snapPh.fields.indexOf('OwnerID');
  ok(snapPh.rows.some(r => r[iOwner] === 'LOT' && String(r[iOwnerId]) === lotId),
     'snapshot ส่งรูปของล็อตไปให้หน้าเว็บด้วย');
  ok(snapPh.fields.indexOf('Width') !== -1 && snapPh.fields.indexOf('Height') !== -1,
     'snapshot มีขนาดรูป ใช้กันหน้าเว็บกระตุกตอนโหลด');

  good('photo.delete', { photoId: matPh.photoId }, S);
  eq(activePhotosOf_('LOT', lotId).length, MAX_PHOTOS_PER_OWNER, 'ลบรูปของสารไม่กระทบรูปของล็อต');

  // ลบที่เก็บ → รูปของที่เก็บนั้นถูกลบตาม
  const pTmp = good('place.save', { name: 'ตู้ชั่วคราว', kind: 'CABINET', parentId: PL.room }, S).placeId;
  const pPh = good('photo.upload', { ownerType: 'PLACE', ownerId: pTmp, data: toB64(JPG) }, S);
  good('place.delete', { placeId: pTmp }, S);
  ok(!activePhotosOf_('PLACE', pTmp).length, 'ลบที่เก็บแล้วรูปของมันถูกลบตาม');
  ok(H.DRIVE.files.get(pPh.fileId).trashed, 'ไฟล์รูปของที่เก็บที่ถูกลบไปอยู่ถังขยะ');
}

section('snapshot และ cache');
const snap = good('snapshot', {}, A);
// เทียบกับชีตจริง ไม่ผูกกับตัวเลขตายตัว เพราะหัวข้อก่อนหน้าเพิ่มข้อมูลเข้ามาด้วย
eq(snap.materials.rows.length, readTable_('MATERIALS').length, 'snapshot มีสารครบตามชีต');
eq(snap.lots.rows.length, readTable_('LOTS').filter(l => String(l.Status).toUpperCase() !== 'DELETED').length,
   'snapshot มีล็อตครบตามชีต');
ok(!!snap.balances, 'snapshot มียอดคงเหลือ');
ok(!!snap.settings, 'snapshot มีรายการตัวเลือก');
ok(snap.lots.fields.indexOf('LotID') !== -1, 'snapshot ส่งชื่อคอลัมน์มาด้วย');
ok(!!snap.places && !!snap.photos, 'snapshot มีที่เก็บและรูปภาพ');

const v1 = good('version', {}, A).version;
good('settings.add', { type: 'Room', value: 'Room 777' }, A);
ok(good('version', {}, A).version !== v1, 'บันทึกข้อมูลแล้วเลขเวอร์ชันเปลี่ยน');
ok(good('snapshot', {}, A).settings.Room.indexOf('Room 777') !== -1, 'snapshot ใหม่เห็นค่าที่เพิ่งเพิ่ม');

// snapshot ต้องไม่มีรหัสผ่าน/ความลับใด ๆ หลุดออกไป
const snapStr = JSON.stringify(good('snapshot', {}, A));
ok(snapStr.indexOf(H._props.get('SESSION_SECRET')) === -1, 'snapshot ไม่มี SESSION_SECRET หลุดออกไป');

// ═══════════════════════════════════════════════════════════════════════════
section('บัญชีรหัสผ่าน (ควบคู่ Google Sign-In)');
{
  const PW  = 'LabTest2026x';
  const PW2 = 'LabTest2026y';

  // ── admin สร้างบัญชีรหัสผ่าน ──────────────────────────────────────────────
  const added = good('users.add',
    { kind: 'PASSWORD', username: 'somchai', password: PW, name: 'สมชาย ช่วยงาน', role: 'staff' }, A);
  eq(added.kind, 'PASSWORD', 'เพิ่มบัญชีรหัสผ่านได้');
  eq(added.email, '', 'บัญชีรหัสผ่านไม่มีอีเมล');

  // ── ข้อจำกัดตอนสร้าง ─────────────────────────────────────────────────────
  bad('users.add', { kind: 'PASSWORD', username: 'somchai', password: PW, name: 'ซ้ำ' }, A,
      'DUPLICATE', 'ชื่อผู้ใช้ซ้ำไม่ได้');
  bad('users.add', { kind: 'PASSWORD', username: 'bossman', password: PW, name: 'อยากเป็นแอดมิน', role: 'admin' }, A,
      'ROLE_TOO_HIGH', 'บัญชีรหัสผ่านเป็น admin ไม่ได้');
  bad('users.add', { kind: 'PASSWORD', username: 'สมชาย', password: PW, name: 'ชื่อไทย' }, A,
      'BAD_USERNAME', 'ชื่อผู้ใช้ต้องเป็น a-z ตัวเลข . _ -');
  bad('users.add', { kind: 'PASSWORD', username: 'ab', password: PW, name: 'สั้นเกิน' }, A,
      'BAD_USERNAME', 'ชื่อผู้ใช้สั้นเกินไป');
  bad('users.add', { kind: 'PASSWORD', username: 'weak1', password: 'abc1', name: 'รหัสสั้น' }, A,
      'WEAK_PASSWORD', 'รหัสผ่านสั้นเกินไป');
  bad('users.add', { kind: 'PASSWORD', username: 'weak2', password: 'abcdefghij', name: 'ไม่มีเลข' }, A,
      'WEAK_PASSWORD', 'รหัสผ่านต้องมีตัวเลข');
  bad('users.add', { kind: 'PASSWORD', username: 'student01', password: 'student01', name: 'รหัสเท่าชื่อ' }, A,
      'WEAK_PASSWORD', 'รหัสผ่านเหมือนชื่อผู้ใช้ไม่ได้');
  bad('users.add', { kind: 'PASSWORD', username: 'nopass', name: 'ไม่ใส่รหัส' }, A,
      'WEAK_PASSWORD', 'ต้องตั้งรหัสผ่านตอนสร้างบัญชี');

  // ── ล็อกอินด้วยรหัสผ่าน ──────────────────────────────────────────────────
  const P = good('login.password', { username: 'somchai', password: PW }).session;
  const pMe = good('me', {}, P).user;
  eq(pMe.kind, 'PASSWORD', 'ล็อกอินด้วยรหัสผ่านได้');
  eq(pMe.username, 'somchai', 'context มีชื่อผู้ใช้');
  eq(pMe.role, 'staff', 'ได้สิทธิ์ staff ตามที่ admin ตั้งไว้');
  eq(pMe.name, 'สมชาย ช่วยงาน', 'ชื่อมาจากตาราง Users ไม่ใช่จาก token');
  ok(good('login.password', { username: 'SomChai', password: PW }).session,
     'ชื่อผู้ใช้ไม่สนตัวพิมพ์เล็กใหญ่');

  // ── สิทธิ์ของบัญชีรหัสผ่าน ───────────────────────────────────────────────
  ok(good('snapshot', {}, P).version !== undefined, 'บัญชีรหัสผ่านดูข้อมูลสต๊อกได้');
  bad('users.list', {}, P, 'FORBIDDEN', 'บัญชีรหัสผ่านดูรายชื่อผู้ใช้ไม่ได้');
  bad('users.add', { email: 'z@rmutr.ac.th', name: 'z' }, P, 'FORBIDDEN', 'บัญชีรหัสผ่านเพิ่มผู้ใช้ไม่ได้');
  bad('import.commit', {}, P, 'FORBIDDEN', 'บัญชีรหัสผ่านนำเข้า CSV ไม่ได้');

  // ── ชื่อผู้ทำรายการในประวัติ ──────────────────────────────────────────────
  good('txn.post', { lotId, type: 'ISSUE', qty: 1, purpose: 'ทดสอบบัญชีรหัสผ่าน' }, P);
  const mine = readTable_('TRANSACTIONS').filter(t => String(t.RecordedBy) === 'user:somchai');
  ok(mine.length === 1, 'ประวัติบันทึกผู้ทำรายการเป็น user:somchai', 'พบ ' + mine.length + ' รายการ');

  // ── ปนบัญชีสองชนิดไม่ได้ ─────────────────────────────────────────────────
  bad('login.password', { username: 'admin', password: PW }, null, 'BAD_LOGIN',
      'บัญชี Google ล็อกอินด้วยรหัสผ่านไม่ได้');
  bad('login.password', { username: 'ไม่มีคนนี้', password: PW }, null, 'BAD_LOGIN',
      'ชื่อผู้ใช้ที่ไม่มีในระบบ');
  eq(call('login.password', { username: 'somchai', password: 'ผิดแน่นอน1' }).error.message,
     call('login.password', { username: 'ghost9', password: 'ผิดแน่นอน1' }).error.message,
     'ข้อความผิดพลาดเหมือนกัน ไม่บอกใบ้ว่าชื่อผู้ใช้ไหนมีจริง');
  bad('users.update', { email: 'x@rmutr.ac.th', username: 'somchai', name: 'ปนกัน' }, A,
      'AMBIGUOUS_USER', 'ระบุทั้งอีเมลและชื่อผู้ใช้พร้อมกันไม่ได้');
  bad('users.update', { username: 'somchai', role: 'admin' }, A,
      'ROLE_TOO_HIGH', 'เลื่อนบัญชีรหัสผ่านขึ้นเป็น admin ไม่ได้');

  // ── รหัสผ่านไม่เคยถูกเก็บเป็นข้อความ ──────────────────────────────────────
  const row = readTable_('USERS').filter(u => normUsername_(u.Username) === 'somchai')[0];
  ok(String(row.PassHash).indexOf(PW) === -1, 'ค่าแฮชไม่มีรหัสผ่านอยู่ในนั้น');
  ok(/^v1\$\d+\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(String(row.PassHash)), 'รูปแบบค่าแฮชถูกต้อง');
  let plain = false;
  H.SS.getSheets().forEach(s => { for (const v of s.cells.values()) if (String(v).includes(PW)) plain = true; });
  ok(!plain, 'ไม่มีรหัสผ่านเป็นข้อความอยู่ในชีตใดเลย');
  ok(Object.keys(good('users.list', {}, A).users[0]).indexOf('passHash') === -1,
     'users.list ไม่ส่งค่าแฮชออกไปหน้าเว็บ');
  eq(good('users.list', {}, A).users.filter(u => u.username === 'somchai')[0].kind, 'PASSWORD',
     'users.list บอกชนิดบัญชี');

  // ── ล็อกกันเดารหัส ───────────────────────────────────────────────────────
  good('users.add', { kind: 'PASSWORD', username: 'locktest', password: PW, name: 'ทดสอบล็อก' }, A);
  for (let i = 0; i < LOGIN_MAX_FAILS; i++) {
    bad('login.password', { username: 'locktest', password: 'ผิดอีกแล้ว9' }, null, 'BAD_LOGIN',
        'รหัสผิดครั้งที่ ' + (i + 1));
  }
  bad('login.password', { username: 'locktest', password: PW }, null, 'LOCKED',
      'ผิดครบ ' + LOGIN_MAX_FAILS + ' ครั้งแล้วถูกล็อก ทั้งที่รหัสถูก');
  ok(good('login.password', { username: 'somchai', password: PW }).session,
     'การล็อกมีผลเฉพาะบัญชีที่ถูกเดา ไม่กระทบคนอื่น');

  // ── admin ตั้งรหัสใหม่ให้ (กรณีลืมรหัส) ──────────────────────────────────
  good('users.resetPassword', { username: 'locktest', password: PW2 }, A);
  ok(good('login.password', { username: 'locktest', password: PW2 }).session,
     'ตั้งรหัสใหม่แล้วปลดล็อกให้ด้วย');
  bad('users.resetPassword', { username: 'locktest', password: 'สั้น1' }, A,
      'WEAK_PASSWORD', 'รหัสใหม่ที่อ่อนเกินไปถูกปฏิเสธ');
  bad('users.resetPassword', { username: 'ไม่มีคนนี้', password: PW2 }, A,
      'BAD_USERNAME', 'ตั้งรหัสให้บัญชีที่ไม่มีไม่ได้');
  bad('users.resetPassword', { username: 'somchai', password: PW2 }, P,
      'FORBIDDEN', 'ผู้ใช้ทั่วไปตั้งรหัสให้คนอื่นไม่ได้');

  // ── เจ้าตัวเปลี่ยนรหัสเอง ────────────────────────────────────────────────
  const P2 = good('login.password', { username: 'somchai', password: PW }).session;
  bad('password.change', { oldPassword: 'เดาไม่ถูก1', newPassword: PW2 }, P2,
      'BAD_LOGIN', 'เปลี่ยนรหัสต้องรู้รหัสเดิม');
  bad('password.change', { oldPassword: PW, newPassword: PW }, P2,
      'WEAK_PASSWORD', 'รหัสใหม่ซ้ำรหัสเดิมไม่ได้');
  bad('password.change', { oldPassword: PW, newPassword: PW2 }, A,
      'NOT_PASSWORD_ACCOUNT', 'บัญชี Google เปลี่ยนรหัสที่นี่ไม่ได้');

  const after = good('password.change', { oldPassword: PW, newPassword: PW2 }, P2);
  ok(after.session && after.session !== P2, 'เปลี่ยนรหัสแล้วได้ session ใหม่');
  bad('snapshot', {}, P2, 'SESSION_STALE', 'เปลี่ยนรหัสแล้ว session เดิมทุกเครื่องหลุดทันที');
  bad('snapshot', {}, P,  'SESSION_STALE', 'session ที่ค้างในเครื่องอื่นหลุดด้วย');
  ok(good('snapshot', {}, after.session).version !== undefined, 'session ใหม่ใช้งานได้');
  bad('login.password', { username: 'somchai', password: PW }, null, 'BAD_LOGIN', 'รหัสเดิมใช้ไม่ได้แล้ว');
  ok(good('login.password', { username: 'somchai', password: PW2 }).session, 'รหัสใหม่ใช้ได้');

  // ── ออกจากระบบทุกเครื่อง ─────────────────────────────────────────────────
  const P3 = good('login.password', { username: 'somchai', password: PW2 }).session;
  good('logout.all', {}, P3);
  bad('snapshot', {}, P3, 'SESSION_STALE', 'สั่งออกจากระบบทุกเครื่องแล้วใช้ต่อไม่ได้');
  ok(good('login.password', { username: 'somchai', password: PW2 }).session, 'ล็อกอินกลับเข้ามาใหม่ได้');

  // ── ปิดบัญชีรหัสผ่าน ─────────────────────────────────────────────────────
  const P4 = good('login.password', { username: 'somchai', password: PW2 }).session;
  good('users.setStatus', { username: 'somchai', status: 'DISABLED' }, A);
  bad('snapshot', {}, P4, null, 'ปิดบัญชีรหัสผ่านแล้ว session ที่ถืออยู่ใช้ต่อไม่ได้ทันที');
  bad('login.password', { username: 'somchai', password: PW2 }, null, 'DISABLED',
      'บัญชีรหัสผ่านที่ถูกปิดล็อกอินไม่ได้');
  good('users.setStatus', { username: 'somchai', status: 'ACTIVE' }, A);
  ok(good('login.password', { username: 'somchai', password: PW2 }).session, 'เปิดบัญชีกลับแล้วล็อกอินได้');

  // ── เปลี่ยนสิทธิ์แล้วต้องมีผลทันที ───────────────────────────────────────
  const P5 = good('login.password', { username: 'somchai', password: PW2 }).session;
  good('users.update', { username: 'somchai', role: 'viewer' }, A);
  bad('snapshot', {}, P5, 'SESSION_STALE', 'ลดสิทธิ์แล้ว session เดิมถูกตัด ไม่เหลือสิทธิ์ค้าง');
  const P6 = good('login.password', { username: 'somchai', password: PW2 }).session;
  eq(good('me', {}, P6).user.role, 'viewer', 'ล็อกอินใหม่ได้สิทธิ์ใหม่');
  bad('txn.post', { lotId, type: 'ISSUE', qty: 1 }, P6, 'FORBIDDEN', 'เหลือสิทธิ์ viewer เบิกของไม่ได้');
}

// ═══════════════════════════════════════════════════════════════════════════
section('ชีตโตเกินขอบเขตเริ่มต้น (1000 แถว)');
{
  // ชีตใหม่ของ Google มี 1000 แถว เขียนแถวที่ 1001 ไม่ได้ถ้าไม่ขยายก่อน
  // Transactions โตทุกครั้งที่เบิก/รับเข้า — เคสนี้จึงเกิดจริงแน่นอนเมื่อใช้ไปสักพัก
  const sheet = H.SS.getSheetByName(SHEETS.TRANSACTIONS);
  ok(sheet.getMaxRows() === 1000, 'ชีตเริ่มต้นมี 1000 แถวเหมือนของจริง', String(sheet.getMaxRows()));

  const before = readTable_('TRANSACTIONS').length;
  const batch = [];
  for (let i = 0; i < 1200; i++) {
    batch.push({
      TxnID: 'TXN-GROW-' + i, LotID: lotId, MaterialID: L1.MaterialID, Type: 'ADJUST',
      Qty: 0, BalanceAfter: 0, Person: 'test', TxnAt: new Date(), Status: 'CANCELLED',
      RecordedBy: ADMIN, RecordedAt: new Date()
    });
  }
  let grew = true, err = '';
  try { appendRows_('TRANSACTIONS', batch); } catch (e) { grew = false; err = e.message; }
  ok(grew, 'เขียนทะลุ 1000 แถวได้ (ขยายชีตให้อัตโนมัติ)', err);
  ok(sheet.getMaxRows() > 1000, 'ชีตถูกขยายจริง', String(sheet.getMaxRows()));
  ok(readTable_('TRANSACTIONS').length === before + 1200, 'อ่านข้อมูลที่เขียนไปกลับมาได้ครบ');

  // ยืนยันว่าตัวจำลองเข้มจริง
  let blocked = false;
  try { sheet.getRange(sheet.getMaxRows() + 5, 1, 1, 1).getValues(); }
  catch (e) { blocked = /out of bounds/.test(e.message); }
  ok(blocked, 'ตัวจำลองปฏิเสธการอ้างแถวเกินขอบเขตเหมือน Apps Script จริง');
}

// ═══════════════════════════════════════════════════════════════════════════
section('ค่าที่เขียนลงชีตต้องเป็นค่าพื้นฐานเสมอ');
{
  // เผลอส่ง object/array เข้าไปต้องไม่กลายเป็น "[object Object]" ในชีต
  fresh();
  const row = objToRow_('SETTINGS', { Type: 'Room', Value: { a: 1 }, Sort: [1, 2], Active: 'TRUE' });
  ok(row.every(v => v === '' || ['string', 'number', 'boolean'].indexOf(typeof v) !== -1 || v instanceof Date),
     'objToRow_ แปลงค่าที่ไม่ใช่ค่าพื้นฐานให้เรียบร้อย', JSON.stringify(row));
  ok(row.indexOf('[object Object]') === -1, 'ไม่มี "[object Object]" หลุดลงชีต');

  let threw = false;
  try {
    H.SS.getSheetByName(SHEETS.SETTINGS).getRange(500, 1, 1, 1).setValues([[{ x: 1 }]]);
  } catch (e) { threw = /Cannot convert/.test(e.message); }
  ok(threw, 'ตัวจำลองปฏิเสธการเขียน object ลงเซลล์เหมือน Apps Script จริง');
}

// ═══════════════════════════════════════════════════════════════════════════
section('ย้ายข้อมูล Room/Shelf เดิมเข้าตาราง Places (migratePlaces)');
{
  // จำลองสภาพก่อนอัปเกรด: มีล็อตที่มีแต่ข้อความ Room/Shelf ยังไม่มี PlaceID
  fresh();
  const Am = sessionOf(ADMIN);
  const CSV2 = [CSV_HEAD,
    '#2601/0100,Glycerin,Glycerin 99%,56-81-5,Liquid,Humectant,ABC,Shelf A,Room 101,1000,1000,2026-01-15,2029-01-15,2569,450,g',
    '#2601/0101,Xanthan Gum,Keltrol,11138-66-2,Powder,Thickener,XYZ,Shelf B,Room 101,500,500,2026-02-01,2028-02-01,2569,890,g',
    '#2601/0102,Niacinamide,Vit B3,98-92-0,Powder,Active,ABC,Shelf A,Room 102,250,250,2026-03-01,2029-03-01,2569,980,g',
    '#2601/0103,Allantoin,Allantoin USP,97-59-6,Powder,Soothing,XYZ,,Cold Room,100,100,2026-04-01,2028-04-01,2569,300,g'
  ].join('\n');
  const pv2 = good('import.preview', { csv: CSV2 }, Am);
  good('import.commit', { csv: CSV2, fingerprint: pv2.fingerprint }, Am);

  ok(readTable_('LOTS').every(l => !String(l.PlaceID || '')), 'ก่อนย้าย: ทุกล็อตยังไม่มี PlaceID');
  eq(activePlaces_().length, 0, 'ก่อนย้าย: ตาราง Places ว่าง');

  const log1 = migratePlaces();
  ok(/ย้ายข้อมูลที่เก็บเรียบร้อย/.test(log1), 'รัน migratePlaces ผ่าน');

  const places = activePlaces_();
  const rooms  = places.filter(p => !String(p.ParentID || ''));
  const shelves = places.filter(p => String(p.ParentID || ''));
  eq(rooms.length, 3, 'สร้างห้องตามที่มีจริง 3 ห้อง (Room 101, Room 102, Cold Room)');
  eq(shelves.length, 3, 'สร้างชั้นวาง 3 ชั้น (Shelf A ของสองห้องคนละตัว + Shelf B)');
  ok(rooms.every(p => String(p.Kind) === 'ROOM'), 'ห้องถูกตั้งชนิดเป็น ROOM');
  ok(shelves.every(p => String(p.Kind) === 'SHELF'), 'ชั้นถูกตั้งชนิดเป็น SHELF');

  // Shelf A ที่อยู่คนละห้อง ต้องเป็นคนละที่เก็บ (ไม่ใช่ตัวเดียวกัน)
  const shelfA = shelves.filter(p => String(p.Name) === 'Shelf A');
  eq(shelfA.length, 2, 'ชั้นชื่อซ้ำกันแต่อยู่คนละห้อง = คนละที่เก็บ');
  ok(shelfA[0].ParentID !== shelfA[1].ParentID, 'Shelf A ทั้งสองอยู่ใต้ห้องคนละห้อง');

  // ล็อตถูกผูกถูกที่
  const byCode = {};
  readTable_('LOTS').forEach(l => { byCode[String(l.LegacyCode)] = l; });
  ok(byCode['#2601/0100'].PlaceID, 'ล็อตได้ PlaceID แล้ว');
  eq(placePath_(places, byCode['#2601/0100'].PlaceID).join(' › '), 'Room 101 › Shelf A', 'ผูกล็อตเข้าชั้นถูกต้อง');
  eq(placePath_(places, byCode['#2601/0102'].PlaceID).join(' › '), 'Room 102 › Shelf A', 'ชั้นชื่อซ้ำถูกแยกตามห้องถูกต้อง');

  // ล็อตที่มีแต่ห้อง ไม่มีชั้น → ผูกกับห้องโดยตรง
  eq(placePath_(places, byCode['#2601/0103'].PlaceID).join(' › '), 'Cold Room', 'ล็อตที่ไม่มีชั้น ผูกกับห้องโดยตรง');

  // ข้อความเดิมต้องไม่ถูกแตะ
  eq(String(byCode['#2601/0100'].Room), 'Room 101', 'ช่อง Room เดิมยังอยู่ครบ');
  eq(String(byCode['#2601/0100'].Shelf), 'Shelf A', 'ช่อง Shelf เดิมยังอยู่ครบ');

  // รันซ้ำต้องไม่สร้างอะไรเพิ่ม
  const before = activePlaces_().length;
  migratePlaces();
  eq(activePlaces_().length, before, 'รัน migratePlaces ซ้ำไม่สร้างที่เก็บซ้ำ');

  // ล็อตที่รับเข้าใหม่หลังย้ายข้อมูล แล้วค่อยย้ายเข้าที่เก็บ ก็ยังทำงานร่วมกันได้
  const mat = readTable_('MATERIALS')[0];
  const nl = good('lot.save', { materialId: String(mat.MaterialID), qty: 100, room: 'Room 101', shelf: 'Shelf A' }, Am);
  const target = shelfA.filter(p => placePath_(places, p.PlaceID)[0] === 'Room 101')[0];
  good('lot.move', { lotIds: [nl.lotId], toPlaceId: String(target.PlaceID) }, Am);
  eq(String(readTable_('LOTS').filter(l => l.LotID === nl.lotId)[0].PlaceID), String(target.PlaceID),
     'ล็อตใหม่ย้ายเข้าที่เก็บที่ย้ายข้อมูลมาได้');
}

// ═══════════════════════════════════════════════════════════════════════════
section('ชนิดของ 3 แบบ (สารเคมี / วัสดุสิ้นเปลือง / ครุภัณฑ์)');
{
  fresh();
  const Ak = sessionOf(ADMIN);
  const matOf = id => readTable_('MATERIALS').filter(m => String(m.MaterialID) === id)[0];
  const lotCount = () => readTable_('LOTS').length;

  // ── คอลัมน์ต่อท้าย ไม่แทรกกลาง ─────────────────────────────────────────
  eq(SCHEMA.MATERIALS[SCHEMA.MATERIALS.length - 1], 'ItemKind', 'ItemKind อยู่ท้ายสุดของ SCHEMA.MATERIALS');
  eq(SCHEMA.MATERIALS.slice(0, 17).join(','),
     'MaterialID,INCIName,CASNo,TradeName,Function,State,Unit,DefaultSupplier,SDSLink,Hazard,' +
     'StorageCondition,Notes,Status,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt',
     '17 คอลัมน์เดิมอยู่ตำแหน่งเดิมทุกตัว');

  // ── สร้างรายการ ───────────────────────────────────────────────────────
  const chem = good('material.save', { inci: 'Ethanol', cas: '64-17-5', unit: 'mL' }, Ak);
  eq(String(matOf(chem.materialId).ItemKind), 'CHEMICAL', 'ไม่ระบุชนิด = บันทึกเป็น CHEMICAL ลงชีต');

  bad('material.save', { kind: 'CHEMICAL', trade: 'ไม่มีชื่อสาร' }, Ak, 'NO_NAME', 'สารเคมีต้องมีชื่อสาร');

  const paper = good('material.save', { kind: 'consumable', trade: 'Whatman No.1', unit: 'แผ่น' }, Ak);
  ok(paper.created, 'วัสดุสิ้นเปลืองไม่มีชื่อสาร/CAS ก็สร้างได้');
  eq(String(matOf(paper.materialId).ItemKind), 'CONSUMABLE', 'ชนิดตัวพิมพ์เล็กถูกปรับเป็นตัวใหญ่');
  eq(String(matOf(paper.materialId).CASNo), '', 'วัสดุสิ้นเปลืองไม่ต้องมี CAS');
  bad('material.save', { kind: 'CONSUMABLE' }, Ak, 'NO_NAME', 'วัสดุต้องมีชื่ออย่างน้อย 1 ช่อง');
  bad('material.save', { kind: 'CONSUMABLE', trade: 'Whatman No.1' }, Ak, 'DUPLICATE_MATERIAL',
      'วัสดุชื่อซ้ำก็สร้างซ้ำไม่ได้');
  bad('material.save', { kind: 'TOOL', inci: 'X' }, Ak, 'BAD_KIND', 'ชนิดที่ไม่รู้จักถูกปฏิเสธ');

  const beaker = good('material.save', { kind: 'EQUIPMENT', inci: 'บีกเกอร์ 250 mL' }, Ak);
  eq(String(matOf(beaker.materialId).Unit), 'pcs', 'ครุภัณฑ์ได้หน่วย pcs อัตโนมัติ');
  bad('material.save', { kind: 'EQUIPMENT', inci: 'ขวดวัดปริมาตร', unit: 'mL' }, Ak, 'BAD_UNIT',
      'ครุภัณฑ์ใช้หน่วยอื่นนอกจาก pcs ไม่ได้');
  ok(good('material.save', { kind: 'EQUIPMENT', inci: 'กระบอกตวง 100 mL', unit: 'PCS' }, Ak).created,
     'หน่วย PCS ตัวพิมพ์ใหญ่ถือเป็นหน่วยเดียวกัน');
  bad('material.save', { materialId: beaker.materialId, unit: 'g' }, Ak, 'BAD_UNIT',
      'แก้หน่วยของครุภัณฑ์เดิมเป็นอย่างอื่นไม่ได้');
  good('material.save', { materialId: beaker.materialId, notes: 'แก้หมายเหตุ' }, Ak);
  eq(String(matOf(beaker.materialId).ItemKind), 'EQUIPMENT', 'แก้ช่องอื่นแล้วชนิดเดิมไม่หาย');

  // ── ครุภัณฑ์นับเป็นชิ้น ───────────────────────────────────────────────
  const n0 = lotCount();
  bad('lot.save', { materialId: beaker.materialId, qty: 2.5 }, Ak, 'WHOLE_NUMBER_ONLY', 'รับเข้าครุภัณฑ์ 2.5 ชิ้นไม่ได้');
  eq(lotCount(), n0, 'รับเข้าทศนิยมถูกปฏิเสธก่อนเขียน — ไม่มีล็อตกำพร้าค้างในชีต');
  const bl = good('lot.save', { materialId: beaker.materialId, qty: 10 }, Ak);
  eq(computeBalances_()[bl.lotId], 10, 'รับเข้าครุภัณฑ์จำนวนเต็มได้');

  bad('txn.post', { lotId: bl.lotId, type: 'ISSUE', qty: 1 }, Ak, 'EQUIPMENT_NO_ISSUE', 'ครุภัณฑ์เบิกไม่ได้');
  bad('txn.post', { lotId: bl.lotId, type: 'RETURN', qty: 1 }, Ak, 'EQUIPMENT_NO_ISSUE', 'ครุภัณฑ์คืนไม่ได้');
  const issueErr = call('txn.post', { lotId: bl.lotId, type: 'ISSUE', qty: 1 }, Ak);
  ok(!issueErr.ok && /ย้ายที่เก็บ/.test(issueErr.error.message), 'ข้อความบอกทางออกให้ใช้ "ย้ายที่เก็บ"', JSON.stringify(issueErr));
  bad('txn.post', { lotId: bl.lotId, type: 'ADJUST', qty: -1.5 }, Ak, 'WHOLE_NUMBER_ONLY', 'ปรับยอดครุภัณฑ์เป็นทศนิยมไม่ได้');
  bad('txn.post', { lotId: bl.lotId, type: 'DISPOSE', qty: 0.5 }, Ak, 'WHOLE_NUMBER_ONLY', 'ทำลายครุภัณฑ์ครึ่งชิ้นไม่ได้');
  good('txn.post', { lotId: bl.lotId, type: 'DISPOSE', qty: 1, purpose: 'แตก' }, Ak);
  good('txn.post', { lotId: bl.lotId, type: 'ADJUST', qty: -1 }, Ak);
  eq(computeBalances_()[bl.lotId], 8, 'ทำลาย/ปรับยอดครุภัณฑ์เป็นจำนวนเต็มได้ ยอดจาก ledger ถูกต้อง');
  eq(readTable_('TRANSACTIONS').filter(t => t.LotID === bl.lotId).length, 3,
     'รายการที่ถูกปฏิเสธไม่ถูกลงบัญชี (มีแค่ รับเข้า + ทำลาย + ปรับยอด)');

  const room = good('place.save', { name: 'ห้องเครื่องแก้ว', kind: 'ROOM' }, Ak).placeId;
  eq(good('lot.move', { lotIds: [bl.lotId], toPlaceId: room }, Ak).moved, 1, 'ครุภัณฑ์ย้ายที่เก็บได้ตามปกติ');

  // ชนิดอื่นยังใช้ทศนิยมได้เหมือนเดิม
  const pl = good('lot.save', { materialId: paper.materialId, qty: 100 }, Ak);
  good('txn.post', { lotId: pl.lotId, type: 'ISSUE', qty: 2.5 }, Ak);
  eq(computeBalances_()[pl.lotId], 97.5, 'วัสดุสิ้นเปลืองเบิกเป็นทศนิยมได้');
  const cl = good('lot.save', { materialId: chem.materialId, qty: 12.5 }, Ak);
  good('txn.post', { lotId: cl.lotId, type: 'ISSUE', qty: 0.25 }, Ak);
  eq(computeBalances_()[cl.lotId], 12.25, 'สารเคมีเบิกเป็นทศนิยมได้');

  // ── เปลี่ยนชนิดของรายการเดิม ───────────────────────────────────────────
  bad('material.save', { materialId: chem.materialId, kind: 'EQUIPMENT' }, Ak, 'HAS_FRACTION',
      'มียอดทศนิยมค้างอยู่ เปลี่ยนเป็นครุภัณฑ์ไม่ได้');
  eq(String(matOf(chem.materialId).ItemKind), 'CHEMICAL', 'เปลี่ยนชนิดไม่สำเร็จแล้วชนิดเดิมไม่ถูกแตะ');

  const flask = good('material.save', { inci: 'ขวดรูปชมพู่ 250 mL', unit: 'g' }, Ak);
  good('lot.save', { materialId: flask.materialId, qty: 6 }, Ak);
  good('material.save', { materialId: flask.materialId, kind: 'EQUIPMENT' }, Ak);
  eq([String(matOf(flask.materialId).ItemKind), String(matOf(flask.materialId).Unit)], ['EQUIPMENT', 'pcs'],
     'เปลี่ยนเป็นครุภัณฑ์แล้วหน่วยถูกปรับเป็น pcs ให้เอง');

  good('material.save', { materialId: beaker.materialId, kind: 'CONSUMABLE' }, Ak);
  good('txn.post', { lotId: bl.lotId, type: 'ISSUE', qty: 1 }, Ak);
  eq(computeBalances_()[bl.lotId], 7, 'เปลี่ยนกลับเป็นวัสดุแล้วเบิกได้');

  // ── แถวเก่าที่เกิดก่อนมีคอลัมน์ ItemKind (ช่องว่าง) ─────────────────────
  appendRows_('MATERIALS', [{ MaterialID: 'MAT-90001', INCIName: 'Old Glycerin', Unit: 'g', Status: 'ACTIVE' }]);
  const ol = good('lot.save', { materialId: 'MAT-90001', qty: 5.5 }, Ak);
  good('txn.post', { lotId: ol.lotId, type: 'ISSUE', qty: 0.5 }, Ak);
  eq(computeBalances_()[ol.lotId], 5, 'แถวเก่าชนิดว่าง ทำงานแบบสารเคมี (รับ/เบิกทศนิยมได้)');

  const sk = good('snapshot', {}, Ak);
  const iK = sk.materials.fields.indexOf('ItemKind');
  const iM = sk.materials.fields.indexOf('MaterialID');
  ok(iK !== -1, 'snapshot ส่ง ItemKind ไปหน้าเว็บ');
  const kindIn = id => (sk.materials.rows.filter(r => r[iM] === id)[0] || [])[iK];
  eq(kindIn('MAT-90001'), 'CHEMICAL', 'แถวเก่าที่ชนิดว่าง snapshot ส่งเป็น CHEMICAL');
  eq(kindIn(paper.materialId), 'CONSUMABLE', 'snapshot ส่งชนิดวัสดุถูกต้อง');
  eq(kindIn(flask.materialId), 'EQUIPMENT', 'snapshot ส่งชนิดครุภัณฑ์ถูกต้อง');
}

section('เติมชนิดของให้รายการเดิม (migrateItemKind)');
{
  fresh();
  // สภาพก่อนอัปเกรด: ชีต Materials ยังไม่มีหัวคอลัมน์ ItemKind
  const sh = H.SS.getSheetByName(SHEETS.MATERIALS);
  const kCol = SCHEMA.MATERIALS.indexOf('ItemKind') + 1;
  sh.getRange(1, kCol).setValue('');
  appendRows_('MATERIALS', [
    { MaterialID: 'MAT-00001', INCIName: 'Glycerin',  CASNo: '56-81-5', Unit: 'g', Status: 'ACTIVE' },
    { MaterialID: 'MAT-00002', INCIName: 'บีกเกอร์',  Unit: 'pcs', Status: 'ACTIVE', ItemKind: 'equipment' },
    { MaterialID: 'MAT-00003', INCIName: 'ไม่รู้ชนิด', Unit: 'g',   Status: 'ACTIVE', ItemKind: 'TOOL' },
    { MaterialID: 'MAT-00004', TradeName: 'ถุงมือ',  Unit: 'pcs', Status: 'ACTIVE', ItemKind: 'CONSUMABLE' }
  ]);

  let code = null;
  try { migrateItemKind(); } catch (e) { code = e.code; }
  eq(code, 'NO_HEADER', 'ยังไม่มีหัวคอลัมน์ = ไม่เขียนอะไร บอกให้รัน setupSpreadsheet ก่อน');
  eq(String(readTable_('MATERIALS')[0].ItemKind), '', 'ปฏิเสธแล้วไม่มีค่าถูกเขียนลงคอลัมน์ไร้หัว');

  setupSpreadsheet();
  const msg = migrateItemKind();
  ok(/เติมชนิดของเรียบร้อย/.test(msg), 'รัน migrateItemKind ผ่าน');
  const byId = {};
  readTable_('MATERIALS').forEach(m => { byId[m.MaterialID] = m; });
  eq(String(byId['MAT-00001'].ItemKind), 'CHEMICAL', 'แถวที่ชนิดว่างถูกเติม CHEMICAL');
  eq(String(byId['MAT-00002'].ItemKind), 'EQUIPMENT', 'ชนิดตัวพิมพ์เล็กถูกปรับเป็นตัวใหญ่');
  eq(String(byId['MAT-00003'].ItemKind), 'TOOL', 'ชนิดที่ไม่รู้จักไม่ถูกเดาแทน');
  ok(/MAT-00003/.test(msg), 'รายงานรหัสของรายการที่ชนิดไม่รู้จัก', msg);
  eq(String(byId['MAT-00004'].ItemKind), 'CONSUMABLE', 'ชนิดที่ถูกต้องอยู่แล้วไม่ถูกแตะ');
  eq([String(byId['MAT-00001'].INCIName), String(byId['MAT-00001'].CASNo), String(byId['MAT-00001'].Unit)],
     ['Glycerin', '56-81-5', 'g'], 'คอลัมน์อื่นของแถวเดิมอยู่ครบ');

  const tableBefore = JSON.stringify(readTable_('MATERIALS'));
  const msg2 = migrateItemKind();
  ok(/รายการเดิม 0 รายการ/.test(msg2), 'รันซ้ำแล้วไม่มีอะไรต้องเติม', msg2);
  eq(JSON.stringify(readTable_('MATERIALS')), tableBefore, 'รันซ้ำแล้วข้อมูลไม่เปลี่ยนแม้แต่ช่องเดียว');
  eq(readTable_('MATERIALS').length, 4, 'รันซ้ำไม่สร้างแถวเพิ่ม และไม่ลบแถวเดิม');
}

// ═══════════════════════════════════════════════════════════════════════════
section('ความสมบูรณ์ของข้อมูลหลังการทดสอบทั้งหมด');
{
  fresh();
  const Ax = sessionOf(ADMIN);
  const p2 = good('import.preview', { csv: CSV }, Ax);
  good('import.commit', { csv: CSV, fingerprint: p2.fingerprint }, Ax);

  // ยอดคงเหลือต้องเท่ากับผลรวม ledger เสมอ
  const lotsNow = readTable_('LOTS');
  const id = lotsNow[0].LotID;
  good('txn.post', { lotId: id, type: 'ISSUE', qty: 30 }, Ax);
  good('txn.post', { lotId: id, type: 'RETURN', qty: 5 }, Ax);

  const ledger = readTable_('TRANSACTIONS')
    .filter(t => t.LotID === id && String(t.Status).toUpperCase() === 'ACTIVE')
    .reduce((sum, t) => sum + parseFloat(t.Qty || 0), 0);
  eq(Math.round(computeBalances_()[id] * 10000) / 10000, Math.round(ledger * 10000) / 10000,
     'ยอดคงเหลือตรงกับผลรวมของ ledger');

  // ไม่มีความลับหลุดลงชีตใด ๆ
  const secret = H._props.get('SESSION_SECRET');
  let leaked = false;
  H.SS.getSheets().forEach(s => { for (const v of s.cells.values()) if (String(v).includes(secret)) leaked = true; });
  ok(!leaked, 'SESSION_SECRET ไม่หลุดลงชีต');

  // ทุกแถวของทุกตารางต้องมีจำนวนคอลัมน์ไม่เกิน SCHEMA
  Object.keys(SHEETS).forEach(key => {
    const sheet = H.SS.getSheetByName(SHEETS[key]);
    ok(sheet.getLastColumn() <= SCHEMA[key].length,
       'ชีต ' + SHEETS[key] + ' ไม่มีคอลัมน์เกิน SCHEMA',
       sheet.getLastColumn() + ' > ' + SCHEMA[key].length);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n' + '━'.repeat(60));
console.log(`ผ่าน ${pass}  ไม่ผ่าน ${fail}`);
if (fail) {
  console.log('\nรายการที่ไม่ผ่าน:');
  failures.forEach(f => console.log('  · ' + f));
  process.exit(1);
}
console.log('✅ ผ่านทั้งหมด');
