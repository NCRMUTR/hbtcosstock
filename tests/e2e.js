/**
 * e2e.js — ทดสอบหน้าเว็บจริงด้วย Chromium  (ต้องรัน tests/restart.sh ก่อน)
 * เน้นกลุ่ม B: ปุ่มเบิก/คืน/ปรับยอด/จำหน่าย · รายละเอียด+ประวัติ · ยกเลิกรายการ · รายการตัวเลือก
 */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || 8799);
const BASE = `http://localhost:${PORT}/`;
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const SESS = JSON.parse(fs.readFileSync(path.join(__dirname, 'session.json'), 'utf8'));
const FIX_CAB  = path.join(__dirname, 'fixtures', 'cabinet.jpg');   // แนวตั้ง 1100x1400
const FIX_ROOM = path.join(__dirname, 'fixtures', 'room.jpg');      // แนวนอน 1400x950

let pass = 0, fail = 0;
const errors = [];
const ok = (c, n, x) => { if (c) pass++; else { fail++; console.log('  ❌ ' + n + (x ? ' → ' + x : '')); } };
const sec = t => console.log('\n▸ ' + t);

async function openAs(browser, who, opts) {
  const ctx = await browser.newContext(Object.assign(
    { viewport: { width: 1360, height: 900 }, locale: 'th-TH' }, opts || {}));
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('requestfailed', r => {
    if (!/fonts\.(googleapis|gstatic)|accounts\.google\.com|gsi\/client/.test(r.url())) {
      errors.push('[requestfailed] ' + r.url());
    }
  });
  // ข้าม Google Sign-In: ใส่ session ที่ถูกต้องลง localStorage โดยตรง
  // (authVerify_ ฝั่งเซิร์ฟเวอร์ยังตรวจลายเซ็นและสิทธิ์จริงทุกคำขอ)
  await ctx.addInitScript(s => {
    try {
      localStorage.setItem('hbt.session', s.session);
      localStorage.setItem('hbt.user', JSON.stringify(s.user));
    } catch (e) { /* ไม่เป็นไร */ }
  }, SESS[who]);
  await page.goto(BASE);
  await page.waitForSelector('#tbody tr', { timeout: 20000 });
  return page;
}

/** ปิดหน้าต่างย่อยที่ยังเปิดค้างให้หมด (dialog แบบ modal บังการคลิกนอกกรอบ) */
async function closeDialogs(page) {
  for (let i = 0; i < 5; i++) {
    if (await page.locator('dialog[open]').count() === 0) return;
    await page.locator('dialog[open] .modal-x').last().click({ force: true }).catch(() => {});
    await page.waitForTimeout(150);
  }
}

/** เปิดหน้าต่างเลือกไฟล์แล้วป้อนไฟล์ให้ (ดักที่ตัวเบราว์เซอร์ เพราะ input ถูกสร้างสด ๆ) */
async function choose(page, trigger, files) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await fc.setFiles(files);
}

/** เรียกหลังบ้านตรง ๆ เพื่อตรวจผลที่หน้าเว็บมองไม่เห็น เช่น ขนาดรูปที่เก็บจริง */
async function apiCall(action, payload, session) {
  const res = await fetch(BASE + 'exec', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action, payload: payload || {}, session: session || null })
  });
  const j = await res.json();
  if (!j.ok) throw new Error(action + ': ' + j.error.code + ' ' + j.error.message);
  return j.data;
}

/** รูปทั้งหมดของเจ้าของรายการหนึ่ง จาก snapshot ของจริง */
async function photosOfApi(ownerType, ownerId) {
  const snap = await apiCall('snapshot', {}, SESS.admin.session);
  const f = snap.photos.fields;
  return snap.photos.rows
    .filter(r => r[f.indexOf('OwnerType')] === ownerType && String(r[f.indexOf('OwnerID')]) === String(ownerId))
    .map(r => ({
      id: r[f.indexOf('PhotoID')], w: r[f.indexOf('Width')], h: r[f.indexOf('Height')],
      sort: r[f.indexOf('Sort')]
    }))
    .sort((a, b) => a.sort - b.sort);
}

const firstBalance = page =>
  page.$eval('#tbody tr:first-child .qty', el => Number(el.textContent.replace(/,/g, '')));

(async () => {
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH }
      : (fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {}));

  // ═══════════════════════════════════════════════════════════════════════
  sec('หน้าคลังสารเคมีและวัสดุ (เจ้าหน้าที่)');
  const page = await openAs(browser, 'staff');

  // ชื่อระบบมาจาก config.js — ตัวจำลองตั้งชื่อ "ระบบคลังทดสอบ" ไว้ ถ้าเห็นค่าตั้งต้นแปลว่าเขียนชื่อตายไว้
  ok(await page.title() === 'ระบบคลังทดสอบ', 'แท็บเบราว์เซอร์ใช้ชื่อระบบจาก config.js', await page.title());
  ok((await page.textContent('.rail-mark')).includes('ระบบคลังทดสอบ'), 'แถบเมนูใช้ชื่อระบบจาก config.js');
  ok((await page.textContent('.rail-mark')).includes('คลังสารเคมีและวัสดุ (จำลอง)'), 'คำอธิบายใต้ชื่อระบบมาจาก config.js');
  ok(await page.textContent('.view-head h1') === 'คลังสารเคมีและวัสดุ', 'หัวหน้าคลังใช้คำใหม่',
     await page.textContent('.view-head h1'));
  ok(/คลังสารเคมีและวัสดุ/.test(await page.textContent('#rail-nav')), 'เมนูใช้คำว่า "คลังสารเคมีและวัสดุ"');
  ok(await page.getAttribute('#q', 'placeholder') === 'ค้นหาสารเคมีและวัสดุ…', 'ช่องค้นหาใช้คำใหม่');
  {
    const seen = await page.evaluate(() => document.body.innerText);
    ok(!/วัตถุดิบ|HBT Raw Material|เครื่องสำอาง|ชื่อ INCI/.test(seen), 'หน้าคลังไม่เหลือคำศัพท์จากระบบเดิม',
       (seen.match(/.{0,20}(วัตถุดิบ|HBT Raw Material|เครื่องสำอาง|ชื่อ INCI).{0,20}/) || [''])[0]);
  }
  const rowCount = await page.locator('#tbody tr').count();
  ok(rowCount > 0, 'ตารางมีข้อมูล', String(rowCount));
  ok(await page.locator('#rail-nav button').count() === 3, 'staff เห็นเมนู 3 ปุ่ม (แผนผัง + คลัง + ตัวเลือก)',
     String(await page.locator('#rail-nav button').count()));
  // ครุภัณฑ์ตั้งใจให้มีแค่ปุ่มปรับยอด (ดูหัวข้อ "ชนิดของ") — ตรวจ 3 ปุ่มเฉพาะแถวสารเคมี
  const chemRow = '#tbody tr:has(.kind-chem)';
  ok(await page.locator(chemRow).first().locator('.qa').count() === 3, 'แต่ละแถวสารเคมีมีปุ่มลัด 3 ปุ่ม',
     String(await page.locator(chemRow).first().locator('.qa').count()));
  await page.screenshot({ path: SHOTS + '/01-stock.png' });

  // ═══════════════════════════════════════════════════════════════════════
  sec('ปุ่มลัด: เบิกใช้');
  await page.fill('#q', 'glycerin');
  await page.waitForTimeout(300);
  const before = await firstBalance(page);
  ok(before > 20, 'เลือกล็อตที่มีของพอทดสอบ', String(before));

  await page.click('#tbody tr:first-child .qa[data-tx="ISSUE"]');
  await page.waitForSelector('#tx-form [name=qty]');
  ok(/เบิกใช้/.test(await page.textContent('.modal-head h2')), 'หัวข้อหน้าต่างถูกต้อง');
  await page.fill('#tx-form [name=qty]', '10');
  await page.fill('#tx-form [name=purpose]', 'ทดสอบระบบ');
  await page.click('#tx-ok');
  await page.waitForSelector('.toast.is-ok', { timeout: 15000 });
  await page.waitForFunction(b => {
    const el = document.querySelector('#tbody tr:first-child .qty');
    return el && Number(el.textContent.replace(/,/g, '')) === b - 10;
  }, before, { timeout: 15000 });
  ok(true, 'เบิก 10 แล้วยอดในตารางลดลงทันที');

  // ═══════════════════════════════════════════════════════════════════════
  sec('ปุ่มลัด: คืนของ และ ปรับยอด');
  const afterIssue = await firstBalance(page);
  await page.click('#tbody tr:first-child .qa[data-tx="RETURN"]');
  await page.waitForSelector('#tx-form [name=qty]');
  await page.fill('#tx-form [name=qty]', '4');
  await page.click('#tx-ok');
  await page.waitForSelector('.toast.is-ok');
  await page.waitForFunction(b => {
    const el = document.querySelector('#tbody tr:first-child .qty');
    return el && Number(el.textContent.replace(/,/g, '')) === b + 4;
  }, afterIssue, { timeout: 15000 });
  ok(true, 'คืน 4 แล้วยอดเพิ่มกลับ');

  await page.click('#tbody tr:first-child .qa[data-tx="ADJUST"]');
  await page.waitForSelector('#tx-form [name=counted]');
  const shown = await page.inputValue('#tx-form [name=counted]');
  ok(Number(shown) === afterIssue + 4, 'ช่องปรับยอดตั้งค่าเริ่มต้นเป็นยอดปัจจุบัน', shown);
  await page.fill('#tx-form [name=counted]', '77');
  await page.fill('#tx-form [name=notes]', 'นับสต็อกประจำเดือน');
  await page.click('#tx-ok');
  await page.waitForSelector('.toast.is-ok');
  await page.waitForFunction(() => {
    const el = document.querySelector('#tbody tr:first-child .qty');
    return el && Number(el.textContent.replace(/,/g, '')) === 77;
  }, null, { timeout: 15000 });
  ok(true, 'ปรับยอดเป็น 77 แล้วตารางแสดงตรงกัน (ระบบคำนวณส่วนต่างให้เอง)');

  // ═══════════════════════════════════════════════════════════════════════
  sec('รายละเอียดล็อตและประวัติ');
  await page.click('#tbody tr:first-child .name-btn');
  await page.waitForSelector('dialog .kv');
  ok(/77/.test(await page.textContent('dialog .kv')), 'รายละเอียดแสดงยอดคงเหลือล่าสุด');
  await page.screenshot({ path: SHOTS + '/02-detail.png' });

  await page.click('dialog [data-tab="hist"]');
  await page.waitForSelector('dialog .hist li');
  const n = await page.locator('dialog .hist li').count();
  ok(n >= 4, 'ประวัติแสดงรายการครบ (รับเข้า + เบิก + คืน + ปรับยอด)', String(n));
  const histText = await page.textContent('dialog .hist');
  ok(/เบิกใช้/.test(histText) && /คืน/.test(histText) && /ปรับยอด/.test(histText),
     'ประวัติแสดงชื่อชนิดรายการเป็นภาษาไทย');
  ok(/นับสต็อกประจำเดือน/.test(histText), 'ประวัติเก็บหมายเหตุที่กรอกไว้');
  ok(/ทดสอบระบบ/.test(histText), 'ประวัติเก็บวัตถุประสงค์การเบิก');
  await page.screenshot({ path: SHOTS + '/03-history.png' });

  // ═══════════════════════════════════════════════════════════════════════
  sec('ยกเลิกรายการที่ลงผิด');
  const cancels = await page.locator('dialog .hist [data-cancel]').count();
  ok(cancels > 0, 'มีปุ่มยกเลิกในรายการที่ยกเลิกได้', String(cancels));
  ok(await page.locator('dialog .hist .h-RECEIVE [data-cancel]').count() === 0,
     'รายการรับเข้าไม่มีปุ่มยกเลิก (ต้องใช้วิธีอื่น)');

  await page.click('dialog .hist [data-cancel] >> nth=0');
  await page.waitForSelector('#rb-in');
  await page.fill('#rb-in', 'ลงผิดล็อต');
  await page.click('#rb-ok');
  await page.waitForSelector('.toast.is-ok');
  await page.waitForSelector('dialog .hist li.cancelled', { timeout: 15000 });
  ok(true, 'ยกเลิกรายการแล้ว ประวัติขึ้นว่ายกเลิกแล้ว');
  ok(/ยกเลิกแล้ว/.test(await page.textContent('dialog .hist')), 'มีป้ายกำกับว่ายกเลิกแล้ว');

  // ═══════════════════════════════════════════════════════════════════════
  sec('จำหน่ายออก');
  await page.click('dialog [data-tab="info"]');
  await page.waitForTimeout(200);
  await page.click('dialog [data-act="DISPOSE"]');
  await page.waitForSelector('#tx-form [name=notes]');
  await page.fill('#tx-form [name=notes]', 'หมดอายุ');
  await page.click('#tx-ok');
  await page.waitForSelector('.toast.is-ok');
  await page.waitForFunction(
    () => /หมด/.test(document.querySelector('dialog .detail-tags')?.textContent || ''),
    null, { timeout: 15000 });
  ok(true, 'จำหน่ายออกแล้วสถานะเปลี่ยนเป็น "หมด"');
  await closeDialogs(page);

  // ═══════════════════════════════════════════════════════════════════════
  sec('หน้ารายการตัวเลือก');
  await page.click('#rail-nav [data-page="settings"]');
  await page.waitForSelector('.set-block');
  ok(await page.locator('.set-block').count() === 7, 'มีรายการตัวเลือก 7 ชนิด',
     String(await page.locator('.set-block').count()));

  const roomBlock = page.locator('[data-type="Room"]');
  const roomsBefore = await roomBlock.locator('.chip').count();
  await roomBlock.locator('.add-row input').fill('Room 999');
  await roomBlock.locator('.add-row button').click();
  await page.waitForSelector('.toast.is-ok');
  await page.waitForFunction(c => document.querySelectorAll('[data-type="Room"] .chip').length === c + 1,
                             roomsBefore, { timeout: 15000 });
  ok(true, 'เพิ่มห้องใหม่เข้ารายการได้');
  ok(/Room 999/.test(await roomBlock.textContent()), 'ค่าที่เพิ่มแสดงในรายการ');
  // หลังบ้านอนุญาตให้ลบได้เฉพาะ admin — staff จึงต้องไม่เห็นปุ่มลบเลย
  ok(await roomBlock.locator('[data-rm]').count() === 0, 'staff ไม่เห็นปุ่มลบค่า (ตรงกับสิทธิ์ที่หลังบ้านกำหนด)');
  ok(/ต้องให้ผู้ดูแลระบบทำ/.test(await page.textContent('#main')), 'บอกผู้ใช้ว่าการลบต้องให้ผู้ดูแลระบบทำ');
  await page.screenshot({ path: SHOTS + '/04-settings.png' });

  await page.click('#rail-nav [data-page="stock"]');
  await page.waitForSelector('#tbody tr');
  ok((await page.locator('#f-room option').count()) > 1, 'ตัวกรองห้องยังทำงานปกติหลังแก้รายการตัวเลือก');

  // ═══════════════════════════════════════════════════════════════════════
  sec('เพิ่มสารใหม่เข้าคลัง');
  await page.fill('#q', '');                      // ล้างคำค้นเดิมก่อน
  await page.waitForFunction(() => document.querySelectorAll('.toast').length === 0, null, { timeout: 10000 });
  await page.click('#btn-add');
  await page.waitForSelector('#it-form [name=inci]');
  await page.fill('#it-form [name=inci]', 'Panthenol');
  await page.fill('#it-form [name=trade]', 'D-Panthenol 75%');
  await page.fill('#it-form [name=cas]', '81-13-0');
  await page.fill('#it-form [name=func]', 'Soothing');
  await page.fill('#it-form [name=unit]', 'mL');
  await page.fill('#it-form [name=qty]', '1000');
  await page.fill('#it-form [name=room]', 'Room 101');
  await page.fill('#it-form [name=shelf]', 'Shelf A');
  await page.fill('#it-form [name=supplier]', 'ABC Chemical');
  await page.fill('#it-form [name=legacyCode]', '#2610/7001');
  await page.click('#it-ok');
  await page.waitForSelector('.toast.is-ok', { timeout: 20000 });
  await page.fill('#q', 'panthenol');
  await page.waitForTimeout(400);
  ok(await page.locator('#tbody tr').count() === 1, 'เพิ่มสารใหม่แล้วค้นเจอ 1 รายการ',
     String(await page.locator('#tbody tr').count()));
  const newRow = await page.textContent('#tbody tr:first-child');
  ok(/1,000/.test(newRow), 'ยอดคงเหลือของล็อตใหม่เท่ากับจำนวนที่รับเข้า', newRow.replace(/\s+/g, ' ').slice(0, 120));
  ok(/#2610\/7001/.test(newRow), 'รหัสเดิมบนขวดถูกบันทึก');
  await page.screenshot({ path: SHOTS + '/07-added.png' });

  sec('เตือนเมื่อสารซ้ำ แล้วเสนอให้รับเข้าเป็นล็อตใหม่');
  await page.click('#btn-add');
  await page.waitForSelector('#it-form [name=inci]');
  await page.fill('#it-form [name=inci]', 'Panthenol');
  await page.waitForSelector('#sugg .sugg-item', { timeout: 10000 });
  ok(true, 'พิมพ์ชื่อซ้ำแล้วขึ้นรายการสารที่มีอยู่ให้เลือก');
  await page.screenshot({ path: SHOTS + '/08-duplicate-hint.png' });

  // ยืนยันว่าถ้าดันทุรังกดบันทึกทั้งที่ซ้ำ ระบบจะเตือนและเสนอปุ่มใช้สารเดิม
  await page.fill('#it-form [name=trade]', 'D-Panthenol 75%');
  await page.fill('#it-form [name=unit]', 'mL');
  await page.fill('#it-form [name=qty]', '500');
  await page.click('#it-ok');
  await page.waitForSelector('#it-dup', { timeout: 20000 });
  ok(/มีสารชื่อนี้อยู่แล้ว/.test(await page.textContent('#it-err')), 'หลังบ้านปฏิเสธสารซ้ำพร้อมบอกเหตุผล');
  await page.click('#it-dup');
  await page.waitForSelector('.modal-head h2:has-text("รับเข้าล็อตใหม่")', { timeout: 10000 });
  ok(await page.inputValue('#it-form [name=qty]') === '500', 'สลับเป็นโหมดรับเข้าล็อตใหม่โดยยังเก็บจำนวนที่กรอกไว้');
  await page.fill('#it-form [name=legacyCode]', '#2610/7002');
  await page.click('#it-ok');
  await page.waitForSelector('.toast.is-ok', { timeout: 20000 });
  await page.fill('#q', 'panthenol');
  await page.waitForTimeout(400);
  ok(await page.locator('#tbody tr').count() === 2, 'กลายเป็น 2 ล็อตของสารเดียวกัน (ไม่ได้สร้างสารซ้ำ)',
     String(await page.locator('#tbody tr').count()));

  sec('แก้ไขข้อมูลล็อต');
  await page.click('#tbody tr:first-child .name-btn');
  await page.waitForSelector('dialog .kv');
  await page.click('dialog [data-act="edit"]');
  await page.waitForSelector('#it-form [name=room]');
  ok(await page.locator('#it-form [name=qty]').count() === 0, 'โหมดแก้ไขไม่มีช่องจำนวนที่รับเข้า (ยอดมาจากบัญชี)');
  await page.fill('#it-form [name=room]', 'Cold Room');
  await page.fill('#it-form [name=shelf]', 'Shelf B');
  await page.click('#it-ok');
  await page.waitForSelector('.toast.is-ok', { timeout: 20000 });
  await page.waitForFunction(
    () => /Cold Room/.test(document.querySelector('dialog .kv')?.textContent || ''),
    null, { timeout: 15000 });
  ok(true, 'แก้ที่เก็บของล็อตแล้วรายละเอียดอัปเดตทันที');
  await closeDialogs(page);

  // ═══════════════════════════════════════════════════════════════════════
  sec('ชนิดของ: ตัวกรอง ป้ายสี และปุ่มที่ครุภัณฑ์ใช้ไม่ได้');
  {
    const setKind = async k => {
      await page.selectOption('#f-kind', k);
      await page.waitForTimeout(250);
    };
    await page.fill('#q', '');
    await page.waitForFunction(() => document.querySelectorAll('.toast').length === 0, null, { timeout: 10000 });

    const kindOpts = await page.$$eval('#f-kind option', os => os.map(o => o.value));
    ok(JSON.stringify(kindOpts) === JSON.stringify(['', 'CHEMICAL', 'CONSUMABLE', 'EQUIPMENT']),
       'ตัวกรองชนิดของมีครบ 3 ชนิด + ทุกชนิด', JSON.stringify(kindOpts));

    await setKind('EQUIPMENT');
    ok(await page.locator('#tbody tr').count() === 1, 'กรองครุภัณฑ์แล้วเหลือ 1 ล็อต',
       String(await page.locator('#tbody tr').count()));
    ok(/บีกเกอร์/.test(await page.textContent('#tbody tr:first-child')), 'แถวที่เหลือคือบีกเกอร์');
    ok(await page.locator('#tbody tr:first-child .tag.kind-equip').count() === 1, 'แถวครุภัณฑ์มีป้ายสีครุภัณฑ์');
    ok(await page.locator('#tbody tr:first-child .qa[data-tx="ISSUE"]').count() === 0, 'ครุภัณฑ์ไม่มีปุ่มลัดเบิก');
    ok(await page.locator('#tbody tr:first-child .qa[data-tx="RETURN"]').count() === 0, 'ครุภัณฑ์ไม่มีปุ่มลัดคืน');
    ok(await page.locator('#tbody tr:first-child .qa[data-tx="ADJUST"]').count() === 1, 'ครุภัณฑ์ยังปรับยอดได้');
    ok(/pcs/.test(await page.textContent('#tbody tr:first-child')), 'หน่วยของครุภัณฑ์เป็น pcs');

    // ปรับยอดครุภัณฑ์: ช่องตัวเลขรับเฉพาะจำนวนเต็ม
    await page.click('#tbody tr:first-child .qa[data-tx="ADJUST"]');
    await page.waitForSelector('#tx-form [name=counted]');
    ok(await page.getAttribute('#tx-form [name=counted]', 'step') === '1', 'ช่องนับได้จริงของครุภัณฑ์รับทีละ 1');
    await page.fill('#tx-form [name=counted]', '4.5');
    ok(await page.evaluate(() => !document.querySelector('#tx-form').checkValidity()),
       'กรอก 4.5 ชิ้นแล้วฟอร์มไม่ยอมส่ง');
    await closeDialogs(page);

    // รายละเอียด: ซ่อนเบิก/คืน และบอกให้ใช้ย้ายที่เก็บแทน
    await page.click('#tbody tr:first-child .name-btn');
    await page.waitForSelector('dialog .kv');
    ok(await page.locator('dialog [data-act="ISSUE"]').count() === 0, 'รายละเอียดครุภัณฑ์ไม่มีปุ่มเบิกใช้');
    ok(await page.locator('dialog [data-act="RETURN"]').count() === 0, 'รายละเอียดครุภัณฑ์ไม่มีปุ่มคืน');
    ok(/ย้ายที่เก็บ/.test(await page.textContent('dialog #equip-note') || ''), 'ขึ้นข้อความให้ใช้ "ย้ายที่เก็บ" แทน');
    ok(await page.locator('dialog [data-act="move"]').count() === 1, 'ปุ่มย้ายที่เก็บยังอยู่');
    ok(await page.locator('dialog .detail-tags .kind-equip').count() === 1, 'รายละเอียดมีป้ายชนิดของ');
    await page.screenshot({ path: SHOTS + '/20-equipment-detail.png' });
    await closeDialogs(page);

    // หลังบ้านปฏิเสธด้วย แม้จะยิงคำขอตรงโดยไม่ผ่านหน้าเว็บ
    let blocked = '';
    try { await apiCall('txn.post', { lotId: SESS.equipLot, type: 'ISSUE', qty: 1 }, SESS.staff.session); }
    catch (e) { blocked = e.message; }
    ok(/EQUIPMENT_NO_ISSUE/.test(blocked), 'ยิง API เบิกครุภัณฑ์ตรง ๆ ก็ถูกปฏิเสธ', blocked || 'สำเร็จทั้งที่ไม่ควร');

    await setKind('CONSUMABLE');
    ok(await page.locator('#tbody tr').count() === 1, 'กรองวัสดุสิ้นเปลืองแล้วเหลือ 1 ล็อต');
    ok(/Whatman/.test(await page.textContent('#tbody tr:first-child')), 'วัสดุที่ไม่มีชื่อสาร แสดงชื่อการค้าแทน');
    ok(await page.locator('#tbody tr:first-child .tag.kind-cons').count() === 1, 'แถววัสดุมีป้ายสีวัสดุ');
    ok(await page.locator('#tbody tr:first-child .qa[data-tx="ISSUE"]').count() === 1, 'วัสดุสิ้นเปลืองยังเบิกได้');

    await setKind('CHEMICAL');
    const chemRows = await page.locator('#tbody tr').count();
    ok(chemRows > 1 && await page.locator('#tbody .kind-equip, #tbody .kind-cons').count() === 0,
       'กรองสารเคมีแล้วไม่มีวัสดุ/ครุภัณฑ์ปน', String(chemRows));
    ok(await page.locator('#tbody tr .kind-chem').count() === chemRows, 'ทุกแถวสารเคมีมีป้ายสีสารเคมี');

    await setKind('');
    await page.fill('#q', 'ครุภัณฑ์');
    await page.waitForTimeout(300);
    ok(await page.locator('#tbody tr').count() === 1, 'พิมพ์ "ครุภัณฑ์" ในช่องค้นหาแล้วเจอ');
    await page.fill('#q', '');
    await page.waitForTimeout(250);
  }

  sec('ชนิดของ: ฟอร์มรับเข้า');
  {
    await page.click('#btn-add');
    await page.waitForSelector('#it-form [name=kind]');
    ok(await page.inputValue('#it-form [name=kind]') === 'CHEMICAL', 'ฟอร์มเริ่มที่ชนิดสารเคมี');
    ok(await page.locator('#it-form [name=cas]').count() === 1, 'สารเคมีมีช่อง CAS');

    await page.fill('#it-form [name=cas]', '00-00-0');            // ค่าที่จะถูกซ่อนไปเมื่อเปลี่ยนชนิด
    await page.selectOption('#it-form [name=kind]', 'EQUIPMENT');
    await page.waitForSelector('#it-form [name=unit][readonly]');
    ok(await page.locator('#it-form [name=cas]').count() === 0, 'ครุภัณฑ์ไม่มีช่อง CAS');
    ok(await page.inputValue('#it-form [name=unit]') === 'pcs', 'ครุภัณฑ์หน่วยล็อกเป็น pcs');
    ok(await page.getAttribute('#it-form [name=qty]', 'step') === '1', 'จำนวนรับเข้าครุภัณฑ์รับทีละ 1');
    ok(await page.getAttribute('#it-form [name=inci]', 'required') === null, 'ครุภัณฑ์ไม่บังคับชื่อสาร');

    await page.fill('#it-form [name=inci]', 'ขวดวัดปริมาตร 100 mL');
    await page.fill('#it-form [name=qty]', '2.5');
    ok(await page.evaluate(() => !document.querySelector('#it-form').checkValidity()), 'รับเข้า 2.5 ชิ้นแล้วฟอร์มไม่ยอมส่ง');
    await page.fill('#it-form [name=qty]', '5');
    await page.click('#it-ok');
    await page.waitForSelector('.toast.is-ok', { timeout: 20000 });
    await page.selectOption('#f-kind', 'EQUIPMENT');
    await page.waitForTimeout(300);
    ok(await page.locator('#tbody tr').count() === 2, 'ครุภัณฑ์ที่เพิ่มใหม่เข้าตัวกรองครุภัณฑ์',
       String(await page.locator('#tbody tr').count()));
    const snapK = await apiCall('snapshot', {}, SESS.admin.session);
    const mf = snapK.materials.fields;
    const added = snapK.materials.rows.filter(r => r[mf.indexOf('INCIName')] === 'ขวดวัดปริมาตร 100 mL')[0] || [];
    ok(added[mf.indexOf('ItemKind')] === 'EQUIPMENT' && added[mf.indexOf('Unit')] === 'pcs',
       'บันทึกเป็นครุภัณฑ์ หน่วย pcs', JSON.stringify(added));
    ok(added[mf.indexOf('CASNo')] === '', 'ค่า CAS ที่ซ่อนไปแล้วไม่ถูกส่งไปบันทึก', String(added[mf.indexOf('CASNo')]));

    // วัสดุสิ้นเปลืองที่ไม่กรอกชื่อเลย — ต้องบอกก่อนส่ง
    await page.click('#btn-add');
    await page.waitForSelector('#it-form [name=kind]');
    await page.selectOption('#it-form [name=kind]', 'CONSUMABLE');
    await page.waitForSelector('#it-form [name=inci]:not([required])');
    await page.fill('#it-form [name=qty]', '10');
    await page.click('#it-ok');
    await page.waitForFunction(() => /อย่างน้อย 1 ช่อง/.test(document.querySelector('#it-err')?.textContent || ''),
                               null, { timeout: 5000 });
    ok(true, 'วัสดุที่ไม่มีชื่อเลยถูกเตือนก่อนส่ง พร้อมบอกว่าต้องกรอกอะไร');
    await closeDialogs(page);
    await page.selectOption('#f-kind', '');
    await page.waitForTimeout(250);
  }

  sec('แผนผังที่เก็บ');
  await page.click('#rail-nav [data-page="map"]');
  await page.waitForSelector('.room-card');
  ok(await page.locator('.room-card').count() === 1, 'หน้าแรกของแผนผังแสดงห้อง 1 ห้อง',
     String(await page.locator('.room-card').count()));
  await page.screenshot({ path: SHOTS + '/09-map-root.png' });

  await page.click('.room-card');
  await page.waitForSelector('.stage .zone');
  ok(await page.locator('.zone').count() === 3, 'หน้าห้องมีปุ่มตู้ 3 ปุ่มบนรูป',
     String(await page.locator('.zone').count()));
  ok(await page.locator('.stage-img').count() === 1, 'แสดงรูปห้องเป็นฉากหลัง');

  await page.click('.zone[title="ตู้เก็บสารไวไฟ"]');
  await page.waitForSelector('.u-item');
  ok((await page.locator('.u-item').count()) > 0, 'กดปุ่มตู้แล้วเห็นรายการของข้างใน',
     String(await page.locator('.u-item').count()));
  await page.screenshot({ path: SHOTS + '/10-map-room.png' });

  await page.click('.side-card [data-go]');
  await page.waitForSelector('.zone[title="ชั้น 1"]');
  ok(await page.locator('.zone').count() === 4, 'เข้าไปในตู้แล้วเห็นปุ่มชั้น 4 ชั้น',
     String(await page.locator('.zone').count()));
  await page.click('.zone[title="ชั้น 1"]');
  await page.waitForSelector('.u-item');
  const shelfLots = await page.locator('.u-item').count();
  ok(shelfLots === 5, 'ชั้น 1 มีของ 5 ล็อตตามที่ย้ายเข้าไป', String(shelfLots));
  await page.screenshot({ path: SHOTS + '/11-map-cabinet.png' });

  sec('ปุ่มลัดบนหน้าชั้น');
  ok(await page.locator('.u-item >> nth=0 >> .qa').count() === 3, 'แต่ละล็อตมีปุ่มลัด 3 ปุ่ม',
     String(await page.locator('.u-item >> nth=0 >> .qa').count()));
  const firstQty = await page.$eval('.u-item:first-child .u-qty', el => Number(el.textContent.replace(/[^\d.]/g, '')));
  await page.click('.u-item:first-child .qa[data-tx="ISSUE"]');
  await page.waitForSelector('#tx-form [name=qty]');
  await page.fill('#tx-form [name=qty]', '1');
  await page.click('#tx-ok');
  await page.waitForSelector('.toast.is-ok', { timeout: 20000 });
  await page.waitForFunction(b => {
    const el = document.querySelector('.u-item:first-child .u-qty');
    return el && Number(el.textContent.replace(/[^\d.]/g, '')) === b - 1;
  }, firstQty, { timeout: 20000 });
  ok(true, 'เบิกจากหน้าแผนผังแล้วยอดลดลงทันที');

  sec('ย้ายที่เก็บจากแผนผัง');
  await page.click('.u-item:first-child .qa[data-mv]');
  await page.waitForSelector('#mv-to');
  const opt4 = await page.locator('#mv-to option', { hasText: 'ชั้น 4' }).first().getAttribute('value');
  await page.selectOption('#mv-to', opt4);
  await page.click('#mv-ok');
  await page.waitForSelector('.toast.is-ok', { timeout: 20000 });
  await page.waitForFunction(n => document.querySelectorAll('.u-item').length === n - 1,
                             shelfLots, { timeout: 20000 });
  ok(true, 'ย้ายล็อตออกจากชั้น 1 แล้วรายการลดลง');
  await page.click('.zone[title="ชั้น 4"]');
  await page.waitForSelector('.u-item');
  ok((await page.locator('.u-item').count()) === 1, 'ล็อตไปโผล่ที่ชั้น 4 ตามที่ย้าย');

  sec('ประวัติบันทึกการย้ายที่ และยกเลิกไม่ได้');
  await page.click('.u-item:first-child .u-row');
  await page.waitForSelector('dialog .kv');
  ok(/ชั้น 4/.test(await page.textContent('dialog .kv')), 'รายละเอียดแสดงที่เก็บใหม่เป็นเส้นทางเต็ม');
  await page.click('dialog [data-tab="hist"]');
  await page.waitForSelector('dialog .hist li');
  const h = await page.textContent('dialog .hist');
  ok(/ย้ายที่เก็บ/.test(h), 'ประวัติมีรายการย้ายที่เก็บ');
  ok(/ชั้น 1/.test(h) && /ชั้น 4/.test(h), 'ประวัติบอกทั้งต้นทางและปลายทาง');
  ok(await page.locator('dialog .hist .h-MOVE [data-cancel]').count() === 0,
     'รายการย้ายที่ไม่มีปุ่มยกเลิก (ต้องย้ายกลับแทน)');
  await closeDialogs(page);

  sec('โหมดจัดวางปุ่ม — ลากสร้างปุ่มใหม่บนรูป');
  await page.click('[data-act="toggle-edit"]');
  await page.waitForSelector('.stage.editing');
  await page.waitForTimeout(400);
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const box = await page.locator('#stage').boundingBox();
  const x0 = box.x + box.width * 0.2, y0 = box.y + box.height * 0.955;
  await page.mouse.move(x0, y0); await page.mouse.down();
  await page.mouse.move(x0 + box.width * 0.25, y0 + box.height * 0.035, { steps: 6 });
  await page.mouse.up();
  await page.waitForSelector('#pl-form');
  await page.fill('#pl-name', 'ชั้นล่างสุด');
  await page.click('#pl-ok');
  await page.waitForSelector('.zone[title="ชั้นล่างสุด"]', { timeout: 20000 });
  ok(true, 'ลากบนรูปแล้วสร้างปุ่มชั้นใหม่ได้');
  await page.screenshot({ path: SHOTS + '/12-map-edit.png' });

  // ย้ายปุ่ม
  const zb = await page.locator('.zone[title="ชั้นล่างสุด"]').boundingBox();
  const leftBefore = await page.locator('.zone[title="ชั้นล่างสุด"]').evaluate(e => e.style.left);
  await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2); await page.mouse.down();
  await page.mouse.move(zb.x + zb.width / 2 + 60, zb.y + zb.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(b => {
    const z = document.querySelector('.zone[title="ชั้นล่างสุด"]');
    return z && z.style.left !== b;
  }, leftBefore, { timeout: 20000 });
  ok(true, 'ลากย้ายปุ่มได้');
  await page.waitForTimeout(1200);

  // ปรับขนาด
  const zb2 = await page.locator('.zone[title="ชั้นล่างสุด"]').boundingBox();
  await page.mouse.move(zb2.x + zb2.width - 1, zb2.y + zb2.height - 1); await page.mouse.down();
  await page.mouse.move(zb2.x + zb2.width + 40, zb2.y + zb2.height, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const w1 = (await page.locator('.zone[title="ชั้นล่างสุด"]').boundingBox()).width;
  ok(w1 > zb2.width + 20, 'ลากมุมปรับขนาดปุ่มได้', `${zb2.width} → ${w1}`);

  await page.click('[data-act="toggle-edit"]');
  await page.waitForTimeout(300);

  sec('ดูบนแผนผังจากหน้าคลัง');
  await page.click('#rail-nav [data-page="stock"]');
  await page.waitForSelector('#tbody tr');
  await page.fill('#q', '');
  await page.waitForTimeout(400);
  await page.click('#tbody tr:first-child .name-btn');
  await page.waitForSelector('dialog .kv');
  const mapBtn = page.locator('[data-act="showmap"]').first();
  if (await mapBtn.count()) {
    await mapBtn.click({ timeout: 15000, force: true });
    await page.waitForSelector('.stage, .room-card', { timeout: 20000 });
    ok(true, 'กด "ดูบนแผนผัง" แล้วไปที่แผนผังของที่เก็บนั้น');
  } else {
    // ล็อตแรกของตารางอาจยังไม่ได้ผูกที่เก็บ — กรณีนั้นไม่มีปุ่มนี้ ถือว่าถูกต้อง
    ok(!/ดูบนแผนผัง/.test(await page.textContent('dialog .kv')),
       'ล็อตที่ยังไม่ผูกที่เก็บ ไม่มีปุ่มดูบนแผนผัง (ถูกต้อง)');
  }
  await closeDialogs(page);

  sec('สลับหน้าไปมาแล้ว กดเปิดครั้งเดียวต้องได้หน้าต่างเดียว (กดกากบาทครั้งเดียวก็ปิด)');
  {
    // เดิมหน้าแผนผัง/ตัวเลือกผูกตัวรับคลิกไว้กับ #main ทุกครั้งที่เข้า → ซ้อนกันหลายชุด
    await closeDialogs(page);
    for (let i = 0; i < 3; i++) {
      await page.click('#rail-nav [data-page="map"]');
      await page.waitForSelector('.room-card, .stage, .crumbs', { timeout: 20000 });
      await page.click('#rail-nav [data-page="settings"]');
      await page.waitForSelector('#set-body .set-block', { timeout: 20000 });
      await page.click('#rail-nav [data-page="stock"]');
      await page.waitForSelector('#tbody tr', { timeout: 20000 });
    }
    await page.fill('#q', '');
    await page.waitForTimeout(400);
    await page.click('#tbody tr:first-child .name-btn');
    await page.waitForSelector('dialog .kv');
    await page.waitForTimeout(300);
    ok(await page.locator('dialog[open]').count() === 1, 'หน้าคลัง: กดชื่อรายการครั้งเดียวได้หน้าต่างเดียว',
       String(await page.locator('dialog[open]').count()));
    await page.locator('dialog[open] .modal-x').first().click();
    await page.waitForTimeout(200);
    ok(await page.locator('dialog[open]').count() === 0, 'กดกากบาทครั้งเดียวก็ปิดหมด',
       String(await page.locator('dialog[open]').count()));

    await page.click(`${chemRow} >> nth=0 >> [data-tx="ISSUE"]`);
    await page.waitForTimeout(300);
    ok(await page.locator('dialog[open]').count() === 1, 'หน้าคลัง: กดปุ่ม "เบิก" ครั้งเดียวได้หน้าต่างเดียว',
       String(await page.locator('dialog[open]').count()));
    await closeDialogs(page);

    // บนหน้าแผนผังเองก็ต้องไม่ซ้อน — เปิดห้องแรกแล้วกดรายการแรกที่เห็น
    await page.click('#rail-nav [data-page="map"]');
    await page.waitForSelector('.room-card, .stage, .crumbs', { timeout: 20000 });
    await page.click('#rail-nav [data-page="map"]');
    await page.waitForSelector('.room-card, .stage, .crumbs', { timeout: 20000 });
    const roomCard = page.locator('.room-card').first();
    if (await roomCard.count()) {
      await roomCard.click();
      await page.waitForSelector('.crumbs', { timeout: 20000 });
    }
    const row = page.locator('#side .u-row').first();
    if (await row.count()) {
      await row.click();
      await page.waitForSelector('dialog .kv');
      await page.waitForTimeout(300);
      ok(await page.locator('dialog[open]').count() === 1, 'หน้าแผนผัง: กดรายการครั้งเดียวได้หน้าต่างเดียว',
         String(await page.locator('dialog[open]').count()));
    }
    await closeDialogs(page);
    await page.click('#rail-nav [data-page="stock"]');
    await page.waitForSelector('#tbody tr', { timeout: 20000 });
  }

  sec('ติ๊กเลือกหลายรายการในหน้าคลัง แล้วย้ายที่เก็บพร้อมกัน');
  {
    await page.fill('#q', '');
    await page.waitForTimeout(400);
    const boxes = page.locator('#tbody input[type="checkbox"][data-lot]');
    const lotA = await boxes.nth(0).getAttribute('data-lot');
    const lotB = await boxes.nth(1).getAttribute('data-lot');
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    ok(await page.locator('#bulk-move').isVisible(), 'เลือกแล้วมีปุ่ม "ย้ายที่เก็บ" ในแถบด้านบน');
    await page.click('#bulk-move');
    await page.waitForSelector('dialog #mv-to');
    ok(/2 ล็อต/.test(await page.textContent('dialog[open] .modal-head')), 'หน้าต่างย้ายบอกว่าย้าย 2 ล็อต',
       await page.textContent('dialog[open] .modal-head'));
    const dest = await page.$eval('dialog #mv-to', s => [...s.options].map(o => o.value).filter(Boolean).pop());
    await page.selectOption('dialog #mv-to', dest);
    await page.click('dialog #mv-ok');
    await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);

    const snap = await apiCall('snapshot', {}, SESS.admin.session);
    const lf = snap.lots.fields;
    const placeOfLot = id => (snap.lots.rows.find(r => String(r[lf.indexOf('LotID')]) === id) || [])[lf.indexOf('PlaceID')];
    ok(placeOfLot(lotA) === dest && placeOfLot(lotB) === dest, 'ทั้ง 2 ล็อตย้ายไปที่เก็บใหม่จริงในหลังบ้าน',
       `${placeOfLot(lotA)} ${placeOfLot(lotB)} → ${dest}`);
    ok(await page.locator('#bulk').isHidden(), 'ย้ายเสร็จแล้วล้างรายการที่เลือกไว้');
    ok(await page.locator('#tbody input[type="checkbox"]:checked').count() === 0, 'ไม่มีช่องที่ยังติ๊กค้าง');

    // หน้าแผนผังต้องเห็นตรงกันทันที (ใช้ snapshot ชุดเดียวกับหน้าคลัง)
    const destPath = await page.evaluate(async id => {
      const s = await import('./js/search.js');
      return s.placeOf(id) ? s.placeOf(id).pathText : '';
    }, dest);
    const inDest = await page.evaluate(async id => {
      const s = await import('./js/search.js');
      return s.lotsIn(id, false).map(it => it.lotId);
    }, dest);
    ok(inDest.includes(lotA) && inDest.includes(lotB), 'ข้อมูลในเครื่องเห็น 2 ล็อตอยู่ในที่เก็บใหม่ (แผนผังตรงกัน)', destPath);
  }

  sec('สิทธิ์ viewer');
  const vp = await openAs(browser, 'viewer');
  ok(await vp.locator('#rail-nav button').count() === 2, 'viewer เห็นเมนู 2 ปุ่ม (แผนผัง + คลัง)',
     String(await vp.locator('#rail-nav button').count()));
  ok(await vp.locator('#tbody .qa').count() === 0, 'viewer ไม่เห็นปุ่มลัดทำรายการ');
  await vp.click('#tbody tr:first-child .name-btn');
  await vp.waitForSelector('dialog .kv');
  ok(await vp.locator('dialog .actions').count() === 0, 'viewer ไม่เห็นปุ่มคำสั่งในรายละเอียด');
  await vp.click('dialog [data-tab="hist"]');
  await vp.waitForSelector('dialog .hist li, dialog .empty');
  ok(await vp.locator('dialog .hist [data-cancel]').count() === 0, 'viewer ไม่เห็นปุ่มยกเลิกรายการ');
  ok((await vp.locator('dialog .hist li').count()) > 0, 'viewer ดูประวัติได้');

  // ═══════════════════════════════════════════════════════════════════════
  sec('ผู้ดูแลระบบและมือถือ');
  const ap = await openAs(browser, 'admin');
  ok(await ap.locator('#rail-nav button').count() === 5, 'admin เห็นเมนูครบ 5 ปุ่ม',
     String(await ap.locator('#rail-nav button').count()));

  await ap.click('#rail-nav [data-page="settings"]');
  await ap.waitForSelector('.set-block');
  const adminRoom = ap.locator('[data-type="Room"]');
  ok(await adminRoom.locator('[data-rm]').count() > 0, 'admin เห็นปุ่มลบค่า');
  await adminRoom.locator('.chip-del', { hasText: 'Room 999' }).locator('button').click();
  await ap.waitForSelector('#cf-ok');
  await ap.click('#cf-ok');
  await ap.waitForFunction(
    () => !/Room 999/.test(document.querySelector('[data-type="Room"]').textContent),
    null, { timeout: 15000 });
  ok(true, 'admin ลบค่าออกจากรายการได้ (มีกล่องยืนยันก่อน)');
  await ap.screenshot({ path: SHOTS + '/06-settings-admin.png' });

  // ═══════════════════════════════════════════════════════════════════════
  sec('นำเข้าไฟล์ "ดาวน์โหลด CSV" ของระบบเดิมผ่านหน้าจอ');
  {
    const FIX_V2 = path.join(__dirname, 'fixtures', 'hbt-v2-export.csv');
    const onConfirm = d => d.accept();
    ap.on('dialog', onConfirm);
    await ap.click('#rail-nav [data-page="import"]');
    await ap.waitForSelector('#file', { state: 'attached' });
    ok(/สารเคมี/.test(await ap.textContent('#imp-kind-note')), 'หน้านำเข้าบอกว่าของจากระบบเดิมจะเป็นชนิดสารเคมี');

    await ap.setInputFiles('#file', FIX_V2);
    await ap.click('#btn-check');
    await ap.waitForSelector('#report .stats', { timeout: 20000 });
    const ready = await ap.textContent('#report .stat:first-child .v');
    ok(ready.trim() === '5', 'ตรวจไฟล์แล้วพร้อมนำเข้า 5 ล็อต', ready);
    ok(!/ไม่รู้จัก/.test(await ap.textContent('#report')), 'ไม่มีคอลัมน์ที่ระบบไม่รู้จัก');

    await ap.click('#btn-commit');
    await ap.waitForSelector('#report .note-ok', { timeout: 20000 });
    ok(/เพิ่มล็อต 5 ล็อต/.test(await ap.textContent('#report .note-ok')), 'นำเข้าแล้วได้ 5 ล็อต');

    // ตรวจว่ายอดและชนิดที่หน้าคลังตรงกับไฟล์
    await ap.click('#rail-nav [data-page="stock"]');
    await ap.waitForSelector('#tbody tr');
    await ap.fill('#q', 'โซเดียมไฮดรอกไซด์');
    await ap.waitForTimeout(300);
    ok(await ap.locator('#tbody tr').count() === 1, 'ค้นเจอล็อตที่นำเข้า (ชื่อภาษาไทย)');
    const row = await ap.textContent('#tbody tr:first-child');
    ok(/125\.5/.test(row), 'ยอดคงเหลือเท่ากับ Balance ในไฟล์', row.replace(/\s+/g, ' ').slice(0, 120));
    ok(await ap.locator('#tbody tr:first-child .kind-chem').count() === 1, 'ล็อตที่นำเข้ามีป้ายสารเคมี');
    await ap.fill('#q', '');

    // นำเข้าไฟล์เดิมซ้ำ — ต้องไม่มีอะไรให้นำเข้า
    await ap.click('#rail-nav [data-page="import"]');
    await ap.waitForSelector('#file', { state: 'attached' });
    await ap.setInputFiles('#file', FIX_V2);
    await ap.click('#btn-check');
    await ap.waitForSelector('#report .stats', { timeout: 20000 });
    ok((await ap.textContent('#report .stat:first-child .v')).trim() === '0', 'นำเข้าไฟล์เดิมซ้ำ: พร้อมนำเข้า 0');
    ok(await ap.locator('#btn-commit.hidden').count() === 1, 'นำเข้าซ้ำแล้วไม่มีปุ่มบันทึกให้กด');
    ap.off('dialog', onConfirm);
    await ap.click('#rail-nav [data-page="stock"]');
    await ap.waitForSelector('#tbody tr');
  }

  const mob = await openAs(browser, 'staff',
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  ok(!(await mob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)),
     'มือถือ: หน้าไม่เลื่อนซ้ายขวา');
  await mob.click('#tbody tr:first-child .name-btn');
  await mob.waitForSelector('dialog .kv');
  await mob.screenshot({ path: SHOTS + '/05-mobile-detail.png' });
  ok(!(await mob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)),
     'มือถือ: หน้าต่างรายละเอียดไม่ทำให้จอล้น');

  // ═══════════════════════════════════════════════════════════════════════
  sec('รูปของล็อต: เลือก → ดูก่อน → อัปโหลด');
  let picLotId = '';
  {
    const pp = await openAs(browser, 'staff');
    await pp.fill('#q', 'niacinamide');
    await pp.waitForTimeout(300);
    await pp.click('#tbody tr:first-child .name-btn');
    await pp.waitForSelector('dialog .kv');
    picLotId = await pp.locator('dialog .kv .mono').first().textContent();
    picLotId = picLotId.trim();

    ok(await pp.locator('[data-act="photos"]').count() === 1, 'หน้ารายละเอียดล็อตมีปุ่มรูปภาพ');
    await pp.click('[data-act="photos"]');
    await pp.waitForSelector('[data-pick="file"]');
    ok(await pp.locator('[data-pick="cam"]').count() === 0, 'เดสก์ท็อปไม่โชว์ปุ่มถ่ายรูป (กดไปก็ได้แค่หน้าต่างเลือกไฟล์)');

    // เลือก 2 รูป → ต้องเข้าแถบรอ ไม่ใช่อัปขึ้นทันที
    await choose(pp, () => pp.click('[data-pick="file"]'), [FIX_ROOM, FIX_CAB]);
    await pp.waitForSelector('.pd-stage');
    ok(await pp.locator('.pd-sitem').count() === 2, 'รูปที่เลือกเข้าแถบรอ 2 รูป');
    ok(await pp.locator('.pd-grid .pd-item').count() === 0, 'ยังไม่ส่งขึ้นเซิร์ฟเวอร์จนกว่าจะกดอัปโหลด');
    ok(/เพิ่มได้อีก 6 รูป/.test(await pp.locator('#pd-note').textContent()), 'บอกโควตาที่เหลือหลังหักรูปที่เลือกไว้');

    // เอาออก 1 รูป แล้วเลือกเข้ามาใหม่
    await pp.locator('[data-unstage]').first().click();
    ok(await pp.locator('.pd-sitem').count() === 1, 'กด ✕ เอารูปออกจากแถบรอได้');
    await choose(pp, () => pp.click('.pd-stage [data-pick="file"]'), [FIX_ROOM]);
    await pp.waitForFunction(() => document.querySelectorAll('.pd-sitem').length === 2, null, { timeout: 10000 });
    ok(true, 'กด "+ เลือกเพิ่ม" จากในแถบรอได้');

    // หมุนรูปแนวนอน 90° แล้วอัปโหลด — ไฟล์ที่เก็บจริงต้องกลายเป็นแนวตั้ง
    await pp.locator('.pd-sitem').last().locator('[data-rot]').click();
    await pp.waitForTimeout(200);
    await pp.click('[data-up="go"]');
    await pp.waitForFunction(() => document.querySelectorAll('.pd-grid .pd-item').length === 2,
                             null, { timeout: 30000 });
    ok(await pp.locator('.pd-sitem').count() === 0, 'อัปเสร็จแล้วแถบรอว่าง');

    const pics = await photosOfApi('LOT', picLotId);
    ok(pics.length === 2, 'หลังบ้านเก็บรูปของล็อตนี้ 2 รูป', String(pics.length));
    const turned = pics[1];
    ok(turned.h > turned.w, 'รูปแนวนอนที่สั่งหมุนถูกบันทึกเป็นแนวตั้งจริง (หมุนที่ไฟล์ ไม่ใช่แค่ CSS)',
       turned.w + 'x' + turned.h);
    ok(Math.max(turned.w, turned.h) <= 1100, 'ย่อรูปก่อนส่งตามขนาดที่ตั้งไว้', turned.w + 'x' + turned.h);

    // ปิดหน้าต่างรูป แล้วรูปต้องโผล่บนแถบรูปย่อของหน้ารายละเอียด
    await closeDialogs(pp);
    await pp.click('#tbody tr:first-child .name-btn');
    await pp.waitForSelector('dialog .kv');
    ok(await pp.locator('.ph-strip .ph-thumb').count() === 2, 'หน้ารายละเอียดโชว์รูปย่อของล็อต');
    await pp.screenshot({ path: SHOTS + '/09-lot-photos.png' });
    await closeDialogs(pp);

    // รูปย่อขึ้นในตารางคลังด้วย
    await pp.waitForFunction(() => document.querySelectorAll('#tbody .cell-pic:not(.is-none)').length > 0,
                             null, { timeout: 20000 });
    ok(true, 'ตารางคลังโชว์รูปย่อของล็อตที่มีรูป');
  }

  // ═══════════════════════════════════════════════════════════════════════
  sec('รูปของสาร และการยืมรูปมาแสดง');
  {
    const mp = await openAs(browser, 'staff');
    await mp.fill('#q', 'niacinamide');
    await mp.waitForTimeout(300);
    await mp.click('#tbody tr:first-child .name-btn');
    await mp.waitForSelector('dialog .kv');
    await mp.click('[data-tab="info"]');
    await mp.waitForSelector('[data-act="matphotos"]');

    await mp.click('[data-act="matphotos"]');
    await mp.waitForSelector('[data-pick="file"]');
    await choose(mp, () => mp.click('[data-pick="file"]'), [FIX_CAB]);
    await mp.waitForSelector('.pd-stage');
    await mp.click('[data-up="go"]');
    await mp.waitForFunction(() => document.querySelectorAll('.pd-grid .pd-item').length === 1,
                             null, { timeout: 30000 });

    ok(true, 'เพิ่มรูประดับสารได้');
    await closeDialogs(mp);

    // ล็อตอื่นของสารเดียวกันที่ยังไม่มีรูปของตัวเอง ต้องยืมรูปสารมาแสดง
    await mp.reload();
    await mp.waitForSelector('#tbody tr');
    await mp.fill('#q', 'niacinamide');
    await mp.waitForTimeout(400);
    const rows = await mp.locator('#tbody tr').count();
    ok(rows >= 1, 'มีล็อตของสารนี้ให้ตรวจ', String(rows));
    const withPic = await mp.locator('#tbody .cell-pic:not(.is-none)').count();
    ok(withPic === rows, 'ทุกล็อตของสารนี้มีรูปแสดง (ล็อตที่ไม่มีรูปของตัวเองยืมรูปของสารมา)',
       withPic + '/' + rows);

    const borrowRow = mp.locator('#tbody tr').last();
    await borrowRow.locator('.name-btn').click();
    await mp.waitForSelector('dialog .kv');
    const hint = await mp.locator('.ph-hint').first().textContent().catch(() => '');
    ok(/ยืม|รูปของสาร/.test(hint) || await mp.locator('.ph-thumb').count() > 0,
       'หน้ารายละเอียดบอกว่ากำลังแสดงรูปของสาร');
    await closeDialogs(mp);
  }

  // ═══════════════════════════════════════════════════════════════════════
  sec('แนบรูปตั้งแต่ตอนรับเข้าล็อตใหม่');
  {
    const fp = await openAs(browser, 'staff');
    await fp.click('#btn-add');
    await fp.waitForSelector('#it-form');
    await fp.fill('[name=inci]', 'Photo Test Material');
    await fp.fill('[name=unit]', 'g');
    await fp.fill('[name=qty]', '250');

    ok(await fp.locator('[data-pic-add="file"]').count() === 1, 'ฟอร์มรับเข้ามีช่องแนบรูป');
    await choose(fp, () => fp.click('[data-pic-add="file"]'), [FIX_CAB, FIX_ROOM]);
    await fp.waitForSelector('#f-pics .pd-sitem');
    ok(await fp.locator('#f-pics .pd-sitem').count() === 2, 'แนบรูปไว้ 2 รูปก่อนบันทึก');
    ok(await fp.inputValue('[name=qty]') === '250', 'เลือกรูปแล้วค่าที่กรอกไว้ไม่หาย');

    await fp.locator('#f-pics [data-pic-del]').first().click();
    ok(await fp.locator('#f-pics .pd-sitem').count() === 1, 'เอารูปออกก่อนบันทึกได้');

    await fp.click('#it-ok');
    await fp.waitForSelector('#it-form', { state: 'detached', timeout: 40000 });
    ok(true, 'บันทึกล็อตใหม่พร้อมรูปสำเร็จ');

    const snap = await apiCall('snapshot', {}, SESS.admin.session);
    const lf = snap.lots.fields;
    const newLot = snap.lots.rows
      .map(r => ({ id: r[lf.indexOf('LotID')], mat: r[lf.indexOf('MaterialID')] }))
      .slice(-1)[0];
    const pics = await photosOfApi('LOT', newLot.id);
    ok(pics.length === 1, 'รูปถูกผูกกับล็อตที่เพิ่งสร้าง', String(pics.length));
  }

  // ═══════════════════════════════════════════════════════════════════════
  sec('มือถือ: ปุ่มถ่ายรูป และสิทธิ์ viewer');
  {
    const mob = await openAs(browser, 'staff',
      { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await mob.fill('#q', 'niacinamide');
    await mob.waitForTimeout(300);
    await mob.click('#tbody tr:first-child .name-btn');
    await mob.waitForSelector('dialog .kv');
    await mob.click('[data-act="photos"]');
    await mob.waitForSelector('[data-pick="file"]');
    ok(await mob.locator('[data-pick="cam"]').count() === 1, 'มือถือเห็นปุ่ม "ถ่ายรูป"');
    ok(!(await mob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)),
       'มือถือ: หน้าต่างรูปไม่ทำให้จอล้น');
    await mob.screenshot({ path: SHOTS + '/10-photos-mobile.png' });

    const vp = await openAs(browser, 'viewer');
    await vp.fill('#q', 'niacinamide');
    await vp.waitForTimeout(300);
    await vp.click('#tbody tr:first-child .name-btn');
    await vp.waitForSelector('dialog .kv');
    ok(await vp.locator('.ph-thumb').count() > 0, 'viewer เห็นรูป');
    await vp.click('[data-act="photos"]');
    await vp.waitForSelector('.pd-grid');
    ok(await vp.locator('[data-pick]').count() === 0, 'viewer เพิ่มรูปไม่ได้');
    ok(await vp.locator('[data-del]').count() === 0, 'viewer ลบรูปไม่ได้');
  }

  // ═══════════════════════════════════════════════════════════════════════
  sec('ล็อกอินด้วยรหัสผ่าน');
  {
    // เปิดหน้าเว็บแบบไม่มี session เลย — ต้องเห็นหน้าล็อกอิน
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'th-TH' });
    const lp = await ctx.newPage();
    lp.on('pageerror', e => errors.push('[pageerror] ' + e.message));
    await lp.goto(BASE);
    await lp.waitForSelector('#show-pass-login');
    ok(await lp.locator('#pass-login').isHidden(), 'เริ่มต้นซ่อนฟอร์มรหัสผ่านไว้ — Google เป็นหลัก');

    await lp.click('#show-pass-login');
    await lp.waitForSelector('#li-user', { state: 'visible' });
    ok(await lp.locator('#gsi-button').isHidden(), 'กดลิงก์แล้วสลับมาเป็นฟอร์มรหัสผ่าน');
    ok(await lp.locator('#google-copy').isHidden() && await lp.locator('#google-note').isHidden(),
       'โหมดรหัสผ่านซ่อนคำอธิบายที่พูดถึงบัญชี Google');
    ok(await lp.locator('#pass-copy').isVisible(), 'ขึ้นคำอธิบายของโหมดรหัสผ่านแทน');
    await lp.screenshot({ path: SHOTS + '/07-login-password.png' });

    // รหัสผิดต้องไม่พาเข้าระบบ และต้องขึ้นข้อความบอก
    await lp.fill('#li-user', 'student01');
    await lp.fill('#li-pass', 'ผิดแน่นอน9');
    await lp.click('#li-go');
    await lp.waitForSelector('#login-error:not(.hidden)', { timeout: 15000 });
    ok(await lp.locator('#app-view.hidden').count() === 1, 'รหัสผิดเข้าระบบไม่ได้');
    ok(/ไม่ถูกต้อง/.test(await lp.locator('#login-error').textContent()), 'ขึ้นข้อความว่าชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    ok(await lp.inputValue('#li-pass') === '', 'ล้างช่องรหัสผ่านให้พิมพ์ใหม่');

    // รหัสถูกต้อง → เข้าระบบได้ ใช้สิทธิ์ staff
    await lp.fill('#li-pass', 'LabTest2026x');
    await lp.click('#li-go');
    await lp.waitForSelector('#tbody tr', { timeout: 20000 });
    ok(true, 'ล็อกอินด้วยรหัสผ่านเข้าใช้งานได้');
    ok(/นักศึกษาช่วยงาน/.test(await lp.locator('#who').textContent()), 'แถบล่างแสดงชื่อผู้ใช้ที่ล็อกอิน');
    ok(/student01/.test(await lp.locator('#who').textContent()), 'แสดงชื่อผู้ใช้แทนอีเมล (บัญชีนี้ไม่มีอีเมล)');
    ok(await lp.locator('#btn-chpass').count() === 1, 'บัญชีรหัสผ่านมีปุ่มเปลี่ยนรหัสผ่าน');
    ok(await lp.locator('#rail-nav button').count() === 3, 'ได้เมนูเท่าสิทธิ์ staff',
       String(await lp.locator('#rail-nav button').count()));

    // เปลี่ยนรหัสผ่านเอง — พิมพ์ยืนยันไม่ตรงต้องไม่ผ่าน
    await lp.click('#btn-chpass');
    await lp.waitForSelector('#cp-old');
    await lp.fill('#cp-old', 'LabTest2026x');
    await lp.fill('#cp-new', 'LabTest2026z');
    await lp.fill('#cp-new2', 'LabTest2026q');
    await lp.click('#cp-ok');
    await lp.waitForSelector('.toast.is-risk', { timeout: 15000 });
    ok(await lp.locator('#cp-old').count() === 1, 'ยืนยันรหัสใหม่ไม่ตรงกัน หน้าต่างยังเปิดอยู่');

    await lp.fill('#cp-new2', 'LabTest2026z');
    await lp.click('#cp-ok');
    await lp.waitForSelector('dialog #cp-old', { state: 'detached', timeout: 20000 });
    ok(true, 'เปลี่ยนรหัสผ่านเองสำเร็จ');

    // session ใหม่ถูกเก็บแทนตัวเดิมแล้ว → ใช้งานต่อได้ไม่หลุด
    await lp.click('#rail-nav [data-page="stock"]');
    await lp.waitForSelector('#tbody tr', { timeout: 20000 });
    ok(await lp.locator('#app-view.hidden').count() === 0, 'เปลี่ยนรหัสแล้วยังใช้งานต่อได้ ไม่เด้งออก');
    await ctx.close();
  }

  // ═══════════════════════════════════════════════════════════════════════
  sec('หน้าผู้ใช้ระบบ: บัญชีสองชนิด');
  {
    const up = await openAs(browser, 'admin');
    await up.click('#rail-nav [data-page="users"]');
    await up.waitForSelector('#u-list table');

    ok(await up.locator('#kind-seg [data-kind="PASSWORD"]').count() === 1, 'มีปุ่มสลับไปสร้างบัญชีรหัสผ่าน');
    ok(await up.locator('#u-list .tag', { hasText: 'รหัสผ่าน' }).count() >= 1, 'รายชื่อบอกว่าบัญชีไหนเป็นบัญชีรหัสผ่าน');
    ok(await up.locator('#u-list [data-reset]').count() >= 1, 'บัญชีรหัสผ่านมีปุ่มตั้งรหัสใหม่');
    ok(await up.locator('#u-email').count() === 1, 'ฟอร์มเริ่มต้นเป็นบัญชี Google');

    await up.click('#kind-seg [data-kind="PASSWORD"]');
    await up.waitForSelector('#u-username');
    ok(await up.locator('#u-email').count() === 0, 'สลับเป็นบัญชีรหัสผ่านแล้วไม่มีช่องอีเมล');
    const roles = await up.$$eval('#u-role option', els => els.map(e => e.value));
    ok(roles.indexOf('admin') === -1, 'บัญชีรหัสผ่านเลือกสิทธิ์ admin ไม่ได้', roles.join(','));

    await up.fill('#u-username', 'helper02');
    await up.fill('#u-name', 'ผู้ช่วยคนที่สอง');
    await up.fill('#u-pass', 'LabTest2026x');
    await up.click('#add-form button[type="submit"]');
    await up.waitForFunction(
      () => /helper02/.test(document.querySelector('#u-list').textContent), null, { timeout: 20000 });
    ok(true, 'เพิ่มบัญชีรหัสผ่านจากหน้าเว็บได้');
    await up.screenshot({ path: SHOTS + '/08-users-both-kinds.png' });

    // ตั้งรหัสใหม่ให้บัญชีนั้น
    await up.locator('#u-list tr', { hasText: 'helper02' }).locator('[data-reset]').click();
    await up.waitForSelector('#pw-new');
    await up.fill('#pw-new', 'LabTest2026y');
    await up.click('#pw-ok');
    await up.waitForSelector('.toast.is-ok', { timeout: 20000 });
    ok(true, 'ตั้งรหัสใหม่ให้ผู้ใช้จากหน้าเว็บได้');
  }

  // ═══════════════════════════════════════════════════════════════════════
  sec('ถูกตัดสิทธิ์ระหว่างใช้งาน');
  {
    // ล็อกอินด้วยบัญชีรหัสผ่าน แล้วให้ admin ระงับบัญชีนั้นจากอีกแท็บ
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'th-TH' });
    const kp = await ctx.newPage();
    await kp.goto(BASE);
    await kp.click('#show-pass-login');
    await kp.fill('#li-user', 'helper02');
    await kp.fill('#li-pass', 'LabTest2026y');
    await kp.click('#li-go');
    await kp.waitForSelector('#tbody tr', { timeout: 20000 });

    const admin = await openAs(browser, 'admin');
    await admin.click('#rail-nav [data-page="users"]');
    await admin.waitForSelector('#u-list table');
    admin.on('dialog', d => d.accept());
    await admin.locator('#u-list tr', { hasText: 'helper02' }).locator('[data-toggle]').click();
    await admin.waitForSelector('.toast.is-ok', { timeout: 20000 });

    // คนที่ถูกระงับต้องถูกเด้งออกทันทีที่ทำอะไรต่อ ไม่ใช่รอ session หมดอายุ 8 ชั่วโมง
    await kp.click('#tbody tr:first-child .name-btn');
    await kp.waitForFunction(
      () => !document.querySelector('#login-view').classList.contains('hidden'),
      null, { timeout: 25000 });
    ok(true, 'ถูกระงับบัญชีแล้วเด้งกลับหน้าล็อกอินทันที');
    ok(/ระงับ|ล็อกอิน/.test(await kp.locator('#login-error').textContent()),
       'หน้าล็อกอินบอกเหตุผลที่ถูกเด้งออก');
    ok(await kp.evaluate(() => !localStorage.getItem('hbt.session')),
       'ลบ session ที่ใช้ไม่ได้ออกจากเครื่องแล้ว');
    ok(await kp.locator('dialog[open]').count() === 0, 'ไม่มีหน้าต่างย่อยค้างบังหน้าล็อกอิน');
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${pass} ผ่าน / ${fail} ไม่ผ่าน`);
  const real = errors.filter(e => !/net::ERR_FAILED|Failed to load resource/.test(e));
  if (real.length) {
    console.log('\nข้อความ error ในเบราว์เซอร์:');
    [...new Set(real)].slice(0, 15).forEach(e => console.log('  ' + e));
  }
  process.exit(fail || real.length ? 1 : 0);
})().catch(e => {
  console.error('E2E ล้มเหลว:', (e.stack || e.message).split('\n').slice(0, 3).join(' | '));
  process.exit(2);
});
