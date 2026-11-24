/**
 * bundle.js — รวมไฟล์ .gs ทุกไฟล์ใน gas/ เป็นไฟล์เดียว dist/Code.gs
 * เพื่อให้ติดตั้งใน Apps Script ด้วยการคัดลอก-วางครั้งเดียว:  node tools/bundle.js
 *
 * ลำดับต้องตรงกับ ORDER ใน tests/harness.js เป๊ะ ๆ มิฉะนั้นจะเกิดกรณีที่
 * "ทดสอบผ่านแต่ของจริงพัง" เพราะลำดับการประกาศตัวแปรระดับบนสุดต่างกัน
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ORDER = ['Config.gs', 'Data.gs', 'Auth.gs', 'Password.gs', 'Users.gs', 'Inventory.gs',
               'Catalog.gs', 'Places.gs', 'Photos.gs', 'Snapshot.gs', 'Import.gs',
               'Setup.gs', 'Api.gs'];

const root = path.join(__dirname, '..');
const dir  = path.join(root, 'gas');

// กันลืม: เพิ่มไฟล์ .gs ใหม่แล้วไม่ได้ใส่ใน ORDER → ไฟล์นั้นจะหายไปจากของจริงเงียบ ๆ
const onDisk = fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort();
const missing = onDisk.filter(f => ORDER.indexOf(f) === -1);
const ghost   = ORDER.filter(f => onDisk.indexOf(f) === -1);
if (missing.length) {
  console.error('❌ มีไฟล์ .gs ที่ยังไม่ได้ใส่ใน ORDER: ' + missing.join(', '));
  console.error('   เพิ่มชื่อไฟล์ลงใน ORDER ของ tools/bundle.js และ tests/harness.js ให้ตรงกัน');
  process.exit(1);
}
if (ghost.length) {
  console.error('❌ ORDER อ้างถึงไฟล์ที่ไม่มีอยู่จริง: ' + ghost.join(', '));
  process.exit(1);
}

// ไม่ใส่เวลาที่สร้าง และบังคับขึ้นบรรทัดแบบ LF — ผลต้องเหมือนกันทุกไบต์ไม่ว่ารันเมื่อไรบนเครื่องไหน
// ไม่งั้นขั้น "ไฟล์รวมตรงกับต้นทาง" ใน GitHub Actions จะล้มทุกครั้ง (เคยล้มเพราะเวลาและ CRLF จาก Windows)
let out = '// Lab Chem Stock — รวมจากไฟล์ใน gas/ (สร้างโดย tools/bundle.js)\n' +
          '// อย่าแก้ไฟล์นี้โดยตรง — แก้ไฟล์ต้นทางใน gas/ แล้วรันรวมใหม่\n\n';

for (const f of ORDER) {
  out += '// ═════════════════════ ' + f + ' ═════════════════════\n' +
         fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trimEnd() + '\n\n';
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'Code.gs'), out);
fs.copyFileSync(path.join(dir, 'appsscript.json'), path.join(root, 'dist', 'appsscript.json'));
console.log('สร้าง dist/Code.gs แล้ว — ' + ORDER.length + ' ไฟล์ · ' + Math.round(out.length / 1024) + ' KB');
