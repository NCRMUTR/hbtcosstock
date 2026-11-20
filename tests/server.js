/**
 * server.js — เสิร์ฟ docs/ และจำลอง GAS (/exec) ด้วยโค้ด .gs จริง + ข้อมูลตัวอย่าง
 * ใช้ตรวจหน้าจอจริงด้วยเบราว์เซอร์:  node tests/server.js [port]
 *
 * ข้ามขั้น Google Sign-In โดยเขียน session ที่ถูกต้องลง localStorage ให้เบราว์เซอร์
 * (ไฟล์ session.json) — ตัว authVerify_ ยังทำงานจริงทุกคำขอ
 */
'use strict';
const H = require('./harness');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const PORT = Number(process.argv[2] || 8799);
const CLIENT_ID = 'test.apps.googleusercontent.com';
const ADMIN = 'admin@rmutr.ac.th';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

H._props.set('SPREADSHEET_ID', 'fake');
H._props.set('OAUTH_CLIENT_ID', CLIENT_ID);
H._props.set('BOOTSTRAP_ADMIN', ADMIN);
setupSpreadsheet();

function call(action, payload, session) {
  const out = doPost({ postData: { contents: JSON.stringify({ action, payload: payload || {}, session: session || null }) } });
  const r = JSON.parse(out.getContent());
  if (!r.ok) throw new Error(action + ': ' + r.error.code + ' ' + r.error.message);
  return r.data;
}
function tokenFor(email) {
  H.TOKENS.set('tok-' + email, { aud: CLIENT_ID, email, email_verified: 'true', hd: 'rmutr.ac.th' });
  return 'tok-' + email;
}

const A = call('login', { idToken: tokenFor(ADMIN) });
call('users.add', { email: 'staff.a@rmutr.ac.th', name: 'สมชาย ใจดี', role: 'staff' }, A.session);
call('users.add', { email: 'view.b@rmutr.ac.th', name: 'มาลี ดูงาน', role: 'viewer' }, A.session);
call('users.add', { kind: 'PASSWORD', username: 'student01', password: 'LabTest2026x',
                    name: 'นักศึกษาช่วยงาน', role: 'staff' }, A.session);
const S = call('login', { idToken: tokenFor('staff.a@rmutr.ac.th') });
const V = call('login', { idToken: tokenFor('view.b@rmutr.ac.th') });

// ── ข้อมูลตัวอย่างให้เหมือนใช้งานจริง ──────────────────────────────────────
const INCI = [
  ['Glycerin', 'Glycerin 99%', '56-81-5', 'Humectant', 'Liquid', 'g'],
  ['Xanthan Gum', 'Keltrol CG', '11138-66-2', 'Thickener', 'Powder', 'g'],
  ['Phenoxyethanol', 'Euxyl PE 9010', '122-99-6', 'Preservative', 'Liquid', 'mL'],
  ['Niacinamide', 'Vitamin B3', '98-92-0', 'Active', 'Powder', 'g'],
  ['Cetearyl Alcohol', 'Lanette O', '67762-27-0', 'Emulsifier', 'Solid', 'g'],
  ['Allantoin', 'Allantoin USP', '97-59-6', 'Soothing', 'Powder', 'g']
];
const SUP = ['ABC Chemical', 'XYZ Trading', 'Siam Ingredients'];
const ROOMS = ['Room 101', 'Room 102', 'Cold Room'];
const SHELVES = ['Shelf A', 'Shelf B', 'Cabinet 1'];
const DAY = 86400000;
const iso = d => d.toISOString().slice(0, 10);

let seed = 0x9e3779b9;
function rnd(n) {                                    // mulberry32 — กระจายสม่ำเสมอจริง
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
}

const HEAD = 'Code,INCI Name,Trade Name,CAS No.,State,Function,Supplier,Shelf,Room,Total W.(g),Label W.(g),Receive Date,Expire Date,ปีงบประมาณ,ราคา,Unit';
const lines = [HEAD];
for (let i = 0; i < 48; i++) {
  const m = INCI[i % INCI.length];
  const rec = new Date(Date.now() - rnd(1200) * DAY);
  const exp = new Date(rec.getTime() + (365 + rnd(900)) * DAY);
  const tot = [100, 250, 500, 1000, 2500][rnd(5)];
  const bal = [0, 25, 90, tot * 0.3, tot * 0.7, tot][rnd(6)];
  lines.push([
    `#${String(rec.getFullYear()).slice(2)}${String(rec.getMonth() + 1).padStart(2, '0')}/${1000 + i}`,
    m[0], m[1], m[2], m[4], m[3], SUP[rnd(SUP.length)], SHELVES[rnd(SHELVES.length)], ROOMS[rnd(ROOMS.length)],
    tot, Math.round(bal * 100) / 100, iso(rec), iso(exp), '256' + (6 + rnd(4)), 400 + rnd(900), m[5]
  ].join(','));
}
const csv = lines.join('\n');
const pv = call('import.preview', { csv }, A.session);
call('import.commit', { csv, fingerprint: pv.fingerprint }, A.session);

// ประวัติให้ดูมีชีวิต: เบิก/คืนบางล็อต
const someLots = readTable_('LOTS').slice(0, 6);
someLots.forEach((l, i) => {
  const bal = computeBalances_()[l.LotID] || 0;
  if (bal > 20) {
    call('txn.post', { lotId: l.LotID, type: 'ISSUE', qty: Math.min(10 + i, bal), person: 'สมชาย ใจดี', purpose: 'เตรียมสูตรทดลอง' }, S.session);
    if (i % 2 === 0) call('txn.post', { lotId: l.LotID, type: 'RETURN', qty: 3, person: 'สมชาย ใจดี' }, S.session);
  }
});
call('lot.setShelfState', { lotIds: [someLots[5].LotID], state: 'Eliminate' }, S.session);

// ── ที่เก็บแบบลำดับชั้น + รูปตู้ (กลุ่ม D) ──────────────────────────────────
const b64 = f => fs.readFileSync(path.join(__dirname, 'fixtures', f)).toString('base64');
const PL = {};
PL.room = call('place.save', { name: 'ห้องแลป 204', kind: 'ROOM' }, A.session).placeId;
PL.cab  = call('place.save', { name: 'ตู้เก็บสารไวไฟ', kind: 'CABINET', parentId: PL.room,
                               zone: { x: 0.06, y: 0.2, w: 0.25, h: 0.5 } }, A.session).placeId;
PL.cab2 = call('place.save', { name: 'ตู้เก็บของใช้', kind: 'CABINET', parentId: PL.room,
                               zone: { x: 0.34, y: 0.2, w: 0.25, h: 0.5 } }, A.session).placeId;
PL.desk = call('place.save', { name: 'โต๊ะชั่ง', kind: 'CABINET', parentId: PL.room,
                               zone: { x: 0.62, y: 0.2, w: 0.3, h: 0.5 } }, A.session).placeId;
call('photo.upload', { ownerType: 'PLACE', ownerId: PL.room, data: b64('room.jpg'), width: 1400, height: 950 }, A.session);
call('photo.upload', { ownerType: 'PLACE', ownerId: PL.cab,  data: b64('cabinet.jpg'), width: 1100, height: 1400 }, A.session);

PL.shelves = [];
const bandH = (1400 - 120 - 200) / 1400 / 4;
for (let i = 0; i < 4; i++) {
  PL.shelves.push(call('place.save', { name: 'ชั้น ' + (i + 1), kind: 'SHELF', parentId: PL.cab,
    zone: { x: 0.17, y: 120 / 1400 + i * bandH, w: 0.66, h: bandH - 0.004 } }, A.session).placeId);
}

// ย้ายล็อตบางส่วนเข้าชั้นจริง เพื่อให้กดปุ่มบนรูปแล้วเห็นของ
const all = readTable_('LOTS').map(l => String(l.LotID));
call('lot.move', { lotIds: all.slice(0, 5),   toPlaceId: PL.shelves[0] }, A.session);
call('lot.move', { lotIds: all.slice(5, 9),   toPlaceId: PL.shelves[1] }, A.session);
call('lot.move', { lotIds: all.slice(9, 11),  toPlaceId: PL.shelves[2] }, A.session);
call('lot.move', { lotIds: all.slice(11, 14), toPlaceId: PL.cab2 }, A.session);
call('lot.move', { lotIds: all.slice(14, 15), toPlaceId: PL.desk }, A.session);
console.log('[mock] ที่เก็บ ' + activePlaces_().length + ' แห่ง · รูป ' + readTable_('PHOTOS').length + ' รูป');

// ── ชนิดของอีก 2 แบบ (ต่อท้ายข้อมูลเดิม เพื่อไม่ให้ลำดับล็อตที่เทสอื่นอ้างถึงเลื่อน) ───
const equip = call('lot.save', { material: { kind: 'EQUIPMENT', inci: 'บีกเกอร์ 250 mL', trade: 'Pyrex' },
                                 qty: 12, room: 'Room 102', shelf: 'Cabinet 1' }, A.session);
const cons  = call('lot.save', { material: { kind: 'CONSUMABLE', trade: 'Whatman No.1', unit: 'แผ่น' },
                                 qty: 100, room: 'Room 101', shelf: 'Shelf B' }, A.session);

fs.writeFileSync(path.join(__dirname, 'session.json'), JSON.stringify({
  admin: { session: A.session, user: A.user },
  staff: { session: S.session, user: S.user },
  viewer: { session: V.session, user: V.user },
  sampleLot: someLots[0].LotID,
  equipLot: equip.lotId,
  consLot: cons.lotId,
  places: PL
}, null, 2));
console.log(`[mock] ข้อมูลตัวอย่าง ${readTable_('LOTS').length} ล็อต / ${readTable_('MATERIALS').length} สาร`);

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'POST' && url.pathname === '/exec') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let out;
      try { out = doPost({ postData: { contents: body } }).getContent(); }
      catch (e) { out = JSON.stringify({ ok: false, error: { message: e.message, code: 'CRASH' } }); }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(out);
    });
    return;
  }

  if (url.pathname.startsWith('/img/')) {
    const f = H.DRIVE.files.get(decodeURIComponent(url.pathname.slice(5)));
    if (!f || f.trashed) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': f.mime });
    return res.end(f.bytes);
  }

  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'] });
    return res.end(`window.APP_CONFIG={CLIENT_ID:"${CLIENT_ID}",GAS_URL:"http://localhost:${PORT}/exec",` +
      `APP_NAME:"ระบบคลังทดสอบ",APP_TAGLINE:"คลังสารเคมีและวัสดุ (จำลอง)",DOMAIN:"rmutr.ac.th",PAGE_SIZE:50,EXPIRE_WARN_DAYS:90,LOW_STOCK:100,` +
      `PHOTO_URL:"/img/{id}",PHOTO_FALLBACK_URL:"/img/{id}",PHOTO_MAX_SIDE_PLACE:1600,PHOTO_MAX_SIDE_ITEM:1100,` +
      `PHOTO_MAX_PER_OWNER:8};`);
  }

  const p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(DOCS, p);
  if (!file.startsWith(DOCS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(PORT, () => console.log(`[mock] http://localhost:${PORT}`));
