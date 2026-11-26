/**
 * zones.test.mjs — ทดสอบ "ร่าง" ของปุ่มบนรูป (docs/js/zone-draft.js) บน Node ตรง ๆ
 * ส่วนนี้ตัดสินว่าจะส่งคำสั่งอะไรขึ้นหลังบ้าน ผิดนิดเดียวปุ่มของผู้ใช้หายหรือซ้ำได้
 */
import * as Z from '../docs/js/zone-draft.js';

let pass = 0, fail = 0;
const failures = [];
const ok = (c, name, extra) => {
  if (c) pass++;
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (extra !== undefined ? ' → ' + extra : '')); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, JSON.stringify(a) + ' ≠ ' + JSON.stringify(b));
const sec = t => console.log('\n▸ ' + t);
const near = (a, b) => Math.abs(a - b) < 1e-9;

const kids = () => [
  { id: 'P1', name: 'ชั้น 1', kind: 'SHELF', color: '', zone: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 } },
  { id: 'P2', name: 'ชั้น 2', kind: 'SHELF', color: '#1e6b45', zone: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 } },
  { id: 'P3', name: 'ชั้นล่าง', kind: 'SHELF', color: '', zone: null }
];

sec('ตั้งชื่อถัดไป');
eq(Z.nextName('ชั้น 3', ['ชั้น 1', 'ชั้น 2', 'ชั้น 3']), 'ชั้น 4', 'ชั้น 3 → ชั้น 4');
eq(Z.nextName('ชั้น 3', ['ชั้น 3', 'ชั้น 4', 'ชั้น 5']), 'ชั้น 6', 'ข้ามชื่อที่มีแล้ว');
eq(Z.nextName('ตู้ A', ['ตู้ A']), 'ตู้ A 2', 'ชื่อไม่มีเลขท้าย → เติม 2');
eq(Z.nextName('ชั้น 3', ['ชั้น 4'.toUpperCase()]), 'ชั้น 5', 'เทียบชื่อแบบไม่สนตัวพิมพ์ (เหมือนหลังบ้าน)');
eq(Z.nextNumber('ชั้น', ['ชั้น 1', 'ชั้น 4', 'ชั้น 2 ช่อง 3', 'ตู้ 9']), 5, 'เลขถัดไปดูจากชื่อขึ้นต้นเดียวกันเท่านั้น');
eq(Z.nextNumber('ชั้น', []), 1, 'ยังไม่มีชื่อ → เริ่มที่ 1');
eq(Z.suggestName('SHELF', ['ชั้น 1', 'ชั้น 2']), 'ชั้น 3', 'ปุ่มใหม่ในตู้ได้ชื่อ "ชั้น 3"');
eq(Z.suggestName('CABINET', []), 'ตู้ 1', 'ปุ่มใหม่ในห้องได้ชื่อ "ตู้ 1"');
eq(Z.suggestName('SHELF', ['ชั้น 1', 'กล่อง 7'], 'กล่อง 7'), 'กล่อง 8', 'ตามแบบชื่อปุ่มล่าสุดที่สร้าง');
eq(Z.cleanName('  ชั้น   2 '), 'ชั้น 2', 'ตัดช่องว่างเหมือน s_() ของหลังบ้าน');
eq(Z.childKind('CABINET'), 'SHELF', 'ข้างในตู้ = ชั้น');
eq(Z.childKind('ROOM'), 'CABINET', 'ข้างในห้อง = ตู้');
eq(Z.childKinds('CABINET'), ['SHELF', 'BOX'], 'ข้างในตู้เลือกได้ ชั้น/กล่อง');

sec('แบ่งชั้นอัตโนมัติ');
{
  const A = { x: 0.1, y: 0.2, w: 0.8, h: 0.6 };
  const g = Z.splitGrid(A, 4, 1, 0);
  eq(g.length, 4, 'ได้ 4 แถว');
  ok(near(g[0][0].y, 0.2) && near(g[3][0].y + g[3][0].h, 0.8), 'แถวแรกชิดบน แถวสุดท้ายชิดล่างของกรอบ');
  ok(g.every(r => near(r[0].x, 0.1) && near(r[0].w, 0.8)), 'ทุกชั้นกว้างเต็มกรอบ');
  const g2 = Z.splitGrid(A, 2, 3);
  ok(g2.every(r => r.length === 3), '2 ชั้น × 3 ช่อง');
  ok(g2[0][1].x > g2[0][0].x + g2[0][0].w, 'มีช่องว่างระหว่างช่อง ไม่ให้ปุ่มชนกัน');
  ok(near(g2[1][2].x + g2[1][2].w, 0.9) && near(g2[1][2].y + g2[1][2].h, 0.8), 'ช่องมุมขวาล่างชิดขอบกรอบพอดี');
  ok(!Z.gridFits({ x: 0, y: 0, w: 0.1, h: 0.1 }, 30, 1), 'กรอบเล็กเกินไปสำหรับ 30 ชั้น → ไม่ยอม');
  ok(Z.gridFits({ x: 0, y: 0, w: 1, h: 1 }, 30, 2), 'ทั้งรูป 30 ชั้น × 2 ช่อง → ได้');

  eq(Z.gridNames({ prefix: 'ชั้น', rows: 3, cols: 1, start: 1 }), [['ชั้น 1'], ['ชั้น 2'], ['ชั้น 3']], 'ชื่อบนลงล่าง');
  eq(Z.gridNames({ prefix: 'ชั้น', rows: 3, cols: 1, start: 1, bottomUp: true }), [['ชั้น 3'], ['ชั้น 2'], ['ชั้น 1']],
     'นับจากชั้นล่างสุด → ชั้น 1 อยู่ล่าง');
  eq(Z.gridNames({ prefix: 'ชั้น', rows: 1, cols: 2, start: 5 }), [['ชั้น 5 ช่อง 1', 'ชั้น 5 ช่อง 2']], 'หลายช่อง + เลขเริ่ม');
}

sec('ร่าง: ยังไม่แก้อะไร = ไม่มีคำสั่ง');
{
  const d = Z.createDraft('C1', kids());
  eq(Z.pendingOps(d), [], 'ร่างใหม่ไม่มีคำสั่งค้าง');
  ok(!Z.isDirty(d), 'ไม่ถือว่ามีงานค้าง');
  const it = Z.itemOf(d, 'P1');
  Z.checkpoint(d);
  it.zone = { ...it.zone, x: 0.1 + 1e-7 };
  eq(Z.pendingOps(d), [], 'ขยับน้อยกว่าที่หลังบ้านเก็บได้ (ทศนิยม 5 ตำแหน่ง) ไม่นับว่าแก้');
}

sec('ร่าง: แก้ของเดิม');
{
  const d = Z.createDraft('C1', kids());
  const it = Z.itemOf(d, 'P1');
  Z.checkpoint(d); it.zone = { x: 0.2, y: 0.1, w: 0.7, h: 0.2 };
  Z.checkpoint(d); it.name = 'ชั้นบน';
  Z.checkpoint(d); Z.itemOf(d, 'P2').color = '';
  const ops = Z.pendingOps(d);
  eq(ops.length, 2, 'สองที่เก็บถูกแก้ → 2 คำสั่ง');
  eq(ops[0].payload, { placeId: 'P1', name: 'ชั้นบน', zone: { x: 0.2, y: 0.1, w: 0.7, h: 0.2 } },
     'คำสั่งแก้ส่งเฉพาะช่องที่เปลี่ยน (ไม่ส่งสีที่ไม่ได้แตะ)');
  eq(ops[1].payload, { placeId: 'P2', color: '' }, 'ล้างสีกลับเป็นอัตโนมัติก็ส่งได้');
  Z.removeItem(d, 'P2');
  eq(Z.pendingOps(d)[1].payload.zone, null, 'เอาปุ่มของเดิมออกจากรูป = zone:null (ไม่ลบที่เก็บ)');
  ok(Z.itemOf(d, 'P2') !== null, 'ที่เก็บเดิมยังอยู่ในร่าง (ย้ายไปอยู่ในรายการที่ยังไม่มีปุ่ม)');
}

sec('ร่าง: สร้างใหม่ + ย้อนกลับ + ยกเลิกทั้งหมด');
{
  const d = Z.createDraft('C1', kids());
  Z.checkpoint(d);
  const n = Z.addItem(d, { name: 'ชั้น 3', kind: 'SHELF', zone: { x: 0.1, y: 0.7, w: 0.8, h: 0.2 } });
  ok(n.isNew && n.id.startsWith('new:'), 'ปุ่มใหม่มีรหัสชั่วคราว');
  const ops = Z.pendingOps(d);
  eq(ops.length, 1, 'ปุ่มใหม่ 1 ปุ่ม → 1 คำสั่ง');
  eq(ops[0].payload, { parentId: 'C1', name: 'ชั้น 3', kind: 'SHELF', color: '', zone: { x: 0.1, y: 0.7, w: 0.8, h: 0.2 } },
     'คำสั่งสร้างมีแม่ ชื่อ ระดับ และตำแหน่ง');
  ok(Z.undo(d), 'ย้อนกลับได้');
  eq(Z.pendingOps(d), [], 'ย้อนกลับแล้วปุ่มใหม่หายไป');
  ok(!Z.undo(d), 'ย้อนจนสุดแล้วไม่มีอะไรให้ย้อน');

  Z.checkpoint(d); Z.addItem(d, { name: 'x', kind: 'SHELF', zone: { x: 0, y: 0, w: 0.1, h: 0.1 } });
  Z.checkpoint(d); Z.itemOf(d, 'P1').name = 'เปลี่ยน';
  Z.revertAll(d);
  eq(Z.pendingOps(d), [], 'ยกเลิกทั้งหมด → กลับเหมือนก่อนเริ่มแก้');
  eq(d.items.length, 3, 'ปุ่มใหม่ถูกเอาออก ของเดิมครบ');
  ok(Z.undo(d) && Z.pendingOps(d).length === 2, 'ยกเลิกทั้งหมดแล้วยังกดย้อนกลับเอาคืนได้');
}

sec('ร่าง: ลำดับคำสั่ง');
{
  const d = Z.createDraft('C1', kids());
  Z.addItem(d, { name: 'ชั้น 1', kind: 'SHELF', zone: { x: 0, y: 0.8, w: 1, h: 0.1 } });
  d.items.unshift(d.items.pop());          // ปุ่มใหม่อยู่หน้าสุดของรายการ ก็ต้องส่งทีหลัง
  Z.itemOf(d, 'P1').name = 'ชั้นบนสุด';
  const ops = Z.pendingOps(d);
  eq(ops.map(o => o.type), ['update', 'create'],
     'แก้ของเดิมก่อนสร้างใหม่ — เปลี่ยนชื่อ "ชั้น 1" ออกก่อน ชื่อจึงว่างให้ปุ่มใหม่');
}

sec('ร่าง: ตรวจก่อนบันทึก');
{
  const d = Z.createDraft('C1', kids());
  Z.addItem(d, { name: 'ชั้น 2', kind: 'SHELF', zone: { x: 0, y: 0, w: 0.2, h: 0.2 } });
  ok(Z.validate(d).some(e => /ซ้ำ/.test(e)), 'ชื่อซ้ำในที่เก็บเดียวกัน → เตือนก่อนส่ง');
  const d2 = Z.createDraft('C1', kids());
  Z.addItem(d2, { name: '   ', kind: 'SHELF', zone: { x: 0, y: 0, w: 0.2, h: 0.2 } });
  ok(Z.validate(d2).some(e => /ไม่มีชื่อ/.test(e)), 'ชื่อว่าง → เตือนก่อนส่ง');
  eq(Z.validate(Z.createDraft('C1', kids())), [], 'ร่างปกติไม่มีคำเตือน');
}

sec('ร่าง: วางตารางที่แบ่งแล้ว');
{
  const d = Z.createDraft('C1', kids());
  const names = Z.gridNames({ prefix: 'ชั้น', rows: 4, cols: 1, start: 1 });
  eq(Z.gridConflicts(d, names), ['ชั้น 1', 'ชั้น 2'], 'ชื่อที่ชนกับปุ่มบนรูปถูกรายงาน');
  const names2 = [['ชั้นล่าง'], ['ชั้น 3'], ['ชั้น 4']];
  const r = Z.applyGrid(d, Z.splitGrid({ x: 0, y: 0, w: 1, h: 1 }, 3, 1), names2, 'SHELF');
  eq(r.reused, ['ชั้นล่าง'], 'ชื่อตรงกับที่เก็บเดิมที่ยังไม่มีปุ่ม → ใช้ของเดิม ไม่สร้างซ้ำ');
  eq(r.created, ['ชั้น 3', 'ชั้น 4'], 'ที่เหลือสร้างใหม่');
  const ops = Z.pendingOps(d);
  eq(ops.filter(o => o.type === 'create').length, 2, 'คำสั่งสร้าง 2');
  ok(ops.some(o => o.type === 'update' && o.id === 'P3' && o.payload.zone), 'ที่เก็บเดิมได้ตำแหน่งใหม่');
  ok(Z.undo(d) && Z.pendingOps(d).length === 0, 'การแบ่งทั้งชุดย้อนกลับได้ในครั้งเดียว');
  const r2 = Z.applyGrid(d, Z.splitGrid({ x: 0, y: 0, w: 1, h: 1 }, 1, 1), [['ชั้น 1']], 'SHELF');
  eq(r2.skipped, ['ชั้น 1'], 'ชื่อที่มีปุ่มอยู่แล้ว → ข้าม');
  ok(!Z.undo(d), 'ไม่มีอะไรเปลี่ยน ก็ไม่จดจุดย้อนกลับเปล่า ๆ');
}

sec('ตำแหน่งปุ่มต้องผ่านเกณฑ์หลังบ้านเสมอ');
{
  const f = Z.fitZone({ x: 0.995, y: -0.2, w: 0.001, h: 2 });
  ok(f.w >= Z.MIN_ZONE && f.h <= 1 && f.x + f.w <= 1 && f.y >= 0, 'บีบให้อยู่ในรูปและไม่เล็กเกิน', JSON.stringify(f));
  const d = Z.createDraft('C1', []);
  Z.addItem(d, { name: 'ขอบ', kind: 'SHELF', zone: { x: 1 / 3, y: 2 / 3, w: 2 / 3, h: 1 / 3 } });
  const z = Z.pendingOps(d)[0].payload.zone;
  ok(z.x + z.w <= 1.0001 && z.y + z.h <= 1.0001 && z.w >= 0.01, 'ปัดทศนิยมแล้วไม่หลุดกรอบ', JSON.stringify(z));
}

sec('บันทึกไม่ผ่านบางคำสั่ง → ใส่กลับเข้าร่าง');
{
  const d = Z.createDraft('C1', kids());
  Z.addItem(d, { name: 'ชั้น 9', kind: 'SHELF', zone: { x: 0, y: 0, w: 0.2, h: 0.2 } });
  Z.itemOf(d, 'P1').zone = { x: 0.3, y: 0.1, w: 0.5, h: 0.2 };
  const failed = Z.pendingOps(d).map(o => ({ ...o, message: 'ชื่อซ้ำ' }));
  const fresh = Z.createDraft('C1', kids());
  Z.reapplyFailed(fresh, failed);
  eq(Z.pendingOps(fresh).length, 2, 'งานที่ยังไม่ผ่านกลับมาอยู่ในร่างครบ');
  ok(fresh.items.filter(it => it.failed).length === 2, 'ทำเครื่องหมายว่าบันทึกไม่ผ่าน');

  // มีคนอื่นสร้าง "ชั้น 9" ตัดหน้า (ยังไม่มีปุ่มบนรูป) — ปุ่มของเราต้องไม่หายไปเงียบ ๆ
  const other = Z.createDraft('C1', kids().concat([{ id: 'P9', name: 'ชั้น 9', kind: 'SHELF', zone: null }]));
  Z.reapplyFailed(other, failed.filter(f => f.type === 'create'));
  ok(other.items.some(it => it.isNew && it.name === 'ชั้น 9' && it.failed && it.zone),
     'ชื่อชนกับที่เก็บที่เพิ่งมีคนสร้าง ปุ่มที่ยังไม่ผ่านก็ยังกลับมาให้แก้ชื่อ');
  ok(Z.validate(other).some(e => /ซ้ำ/.test(e)), 'และเตือนชื่อซ้ำก่อนส่งรอบถัดไป');
}

console.log('\n' + '━'.repeat(60));
console.log(`ร่างปุ่มบนรูป: ผ่าน ${pass}  ไม่ผ่าน ${fail}`);
if (fail) { failures.forEach(f => console.log('  · ' + f)); process.exit(1); }
console.log('✅ ผ่านทั้งหมด');
