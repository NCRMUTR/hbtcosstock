/* ══════════════════════════════════════════════════════════════════════════
   zone-draft.js — "ร่าง" ของปุ่มบนรูปที่เก็บ ระหว่างอยู่ในโหมดจัดวางปุ่ม

   เดิมทุกการลาก/ย้าย/ปรับขนาดบันทึกขึ้นเซิร์ฟเวอร์ทันทีแล้วโหลดข้อมูลทั้งระบบใหม่
   ทำตู้ 5 ชั้นต้องรอ 5 รอบ และลากพลาดก็ย้อนไม่ได้ ไฟล์นี้จึงเก็บการแก้ไขไว้ในเครื่องก่อน
   (ย้อนกลับได้ ยกเลิกทั้งหมดได้) แล้วค่อยแปลงเป็นคำสั่ง placeSave ตอนกด "บันทึก" ครั้งเดียว

   ไม่แตะ DOM เลย — ทดสอบบน Node ได้ตรง ๆ (tests/zones.test.mjs)
   ══════════════════════════════════════════════════════════════════════════ */

export const RANK = ['ROOM', 'CABINET', 'SHELF', 'BOX'];

/** หลังบ้านปฏิเสธปุ่มที่เล็กกว่า 0.01 (MIN_ZONE_SIZE) — ฝั่งหน้าเว็บกันไว้กว้างกว่านิดหนึ่ง
 *  เพราะหลังบ้านปัดทศนิยม 5 ตำแหน่ง ค่าที่ชิดเส้นพอดีอาจตกเกณฑ์หลังปัด */
export const MIN_ZONE = 0.012;
/** ช่องว่างระหว่างปุ่มที่แบ่งอัตโนมัติ — ไม่ให้ปุ่มชนกันจนแตะผิดปุ่มบนมือถือ */
export const GRID_GAP = 0.006;
export const MAX_GRID_CELLS = 60;
const HISTORY_MAX = 60;
const EPS = 0.00002;

/** ชื่อขึ้นต้นตามชนิด — ใช้ตั้งชื่อถัดไปให้อัตโนมัติ */
export const KIND_PREFIX = { ROOM: 'ห้อง', CABINET: 'ตู้', SHELF: 'ชั้น', BOX: 'กล่อง' };

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** ให้ตรงกับ s_() ของหลังบ้าน: ช่องว่างหลายตัวเป็นตัวเดียว ตัดหัวท้าย */
export const cleanName = n => String(n == null ? '' : n).replace(/\s+/g, ' ').trim().slice(0, 80);
/** หลังบ้านห้ามชื่อซ้ำในระดับเดียวกันโดยไม่สนตัวพิมพ์ใหญ่เล็ก */
export const nameKey = n => cleanName(n).toLowerCase();

/** ชนิดตั้งต้นของที่เก็บข้างใน — ลึกกว่าแม่หนึ่งระดับ (เหมือนหลังบ้าน) */
export function childKind(parentKind) {
  const r = RANK.indexOf(String(parentKind || '').toUpperCase());
  return RANK[Math.min(r + 1, RANK.length - 1)] || 'CABINET';
}
/** ชนิดที่เลือกได้สำหรับที่เก็บข้างในแม่ชนิดนี้ */
export function childKinds(parentKind) {
  const r = RANK.indexOf(String(parentKind || '').toUpperCase());
  return RANK.slice(r + 1);
}

/** บีบตำแหน่งให้อยู่ในกรอบรูปและไม่เล็กเกินไป (ขยับเข้ามาแทนการตัดขนาดทิ้ง) */
export function fitZone(g) {
  let w = clamp(Number(g.w) || 0, MIN_ZONE, 1);
  let h = clamp(Number(g.h) || 0, MIN_ZONE, 1);
  const x = clamp(Number(g.x) || 0, 0, 1 - w);
  const y = clamp(Number(g.y) || 0, 0, 1 - h);
  return { x, y, w, h };
}

export function sameZone(a, b) {
  if (!a || !b) return !a && !b;
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS &&
         Math.abs(a.w - b.w) < EPS && Math.abs(a.h - b.h) < EPS;
}

/* ── ตั้งชื่อ ──────────────────────────────────────────────────────────── */

/** ชื่อถัดจากชื่อนี้ที่ยังว่าง: "ชั้น 3" → "ชั้น 4" · "ตู้ A" → "ตู้ A 2" */
export function nextName(name, taken) {
  const used = toKeySet(taken);
  const base = cleanName(name) || 'ใหม่';
  const m = base.match(/^(.*?)(\d+)$/);
  let head = m ? m[1] : base + ' ';
  let n = m ? parseInt(m[2], 10) + 1 : 2;
  for (let i = 0; i < 1000; i++, n++) {
    const cand = cleanName(head + n);
    if (!used.has(nameKey(cand))) return cand;
  }
  return cleanName(base + ' ' + Date.now());
}

/** เลขถัดไปของชื่อขึ้นต้นนี้ — ดูจากชื่อที่มีอยู่แล้ว เช่น มี ชั้น 1–4 → 5 */
export function nextNumber(prefix, taken) {
  const p = cleanName(prefix);
  const re = new RegExp('^' + escapeRe(p) + '\\s*(\\d+)(?:\\D.*)?$', 'i');
  let max = 0;
  for (const t of taken || []) {
    const m = cleanName(t).match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

/** ชื่อสำหรับปุ่มที่เพิ่งลากสร้าง: ตามแบบปุ่มล่าสุดถ้ามีเลขท้าย ไม่งั้นใช้ชื่อขึ้นต้นตามชนิด */
export function suggestName(kind, taken, lastName) {
  if (lastName && /\d+$/.test(cleanName(lastName))) return nextName(lastName, taken);
  const prefix = KIND_PREFIX[kind] || 'ที่เก็บ';
  return nextName(prefix + ' ' + (nextNumber(prefix, taken) - 1), taken);
}

/* ── แบ่งชั้นอัตโนมัติ ─────────────────────────────────────────────────── */

/**
 * แบ่งกรอบเป็นตาราง rows × cols — เรียงแถวจากบนลงล่าง ในแถวเรียงซ้ายไปขวา
 * @returns {Array<Array<{x,y,w,h}>>}  [แถว][ช่อง]
 */
export function splitGrid(area, rows, cols, gap) {
  const g = gap === undefined ? GRID_GAP : gap;
  const A = area;
  const cw = (A.w - g * (cols - 1)) / cols;
  const ch = (A.h - g * (rows - 1)) / rows;
  const out = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push({ x: A.x + c * (cw + g), y: A.y + r * (ch + g), w: cw, h: ch });
    }
    out.push(row);
  }
  return out;
}

/** ช่องเล็กสุดที่ได้จากการแบ่งนี้ ใหญ่พอให้หลังบ้านรับไหม */
export function gridFits(area, rows, cols) {
  const z = splitGrid(area, rows, cols)[0][0];
  return z.w >= MIN_ZONE && z.h >= MIN_ZONE;
}

/**
 * ชื่อของทุกช่อง ตามลำดับเดียวกับ splitGrid
 * ชั้นเดียวหลายช่อง: "ชั้น 2 ช่อง 1" (ช่องนับซ้ายไปขวา)
 * @param {Object} o { prefix, rows, cols, start, bottomUp }
 */
export function gridNames(o) {
  const prefix = cleanName(o.prefix);
  const start = Math.max(0, parseInt(o.start, 10) || 1);
  const out = [];
  for (let r = 0; r < o.rows; r++) {
    const num = start + (o.bottomUp ? o.rows - 1 - r : r);
    const row = [];
    for (let c = 0; c < o.cols; c++) {
      row.push(cleanName(prefix + ' ' + num + (o.cols > 1 ? ' ช่อง ' + (c + 1) : '')));
    }
    out.push(row);
  }
  return out;
}

/* ── ร่าง ──────────────────────────────────────────────────────────────── */

/**
 * @param {string} parentId
 * @param {Array} children  ที่เก็บข้างในที่มีอยู่จริง [{id, name, kind, color, zone}]
 */
export function createDraft(parentId, children) {
  const base = new Map();
  const items = children.map(c => {
    const it = { id: String(c.id), isNew: false, name: cleanName(c.name), kind: c.kind,
                 color: c.color || '', zone: c.zone ? { ...c.zone } : null };
    base.set(it.id, { name: it.name, color: it.color, zone: it.zone ? { ...it.zone } : null });
    return it;
  });
  return { parentId: String(parentId), base, items, hist: [], seq: 0, lastName: '' };
}

const snap = d => JSON.stringify({ items: d.items, seq: d.seq, lastName: d.lastName });

/** จดสถานะก่อนแก้ — เรียกก่อนเปลี่ยนอะไรก็ตาม เพื่อให้ "ย้อนกลับ" ได้ทีละขั้น */
export function checkpoint(d) {
  d.hist.push(snap(d));
  if (d.hist.length > HISTORY_MAX) d.hist.shift();
}
/** จดสถานะที่จับไว้ก่อนหน้า (เช่น ตอนเริ่มพิมพ์ชื่อ) */
export function pushSnapshot(d, s) {
  if (s && s !== snap(d)) {
    d.hist.push(s);
    if (d.hist.length > HISTORY_MAX) d.hist.shift();
  }
}
export const takeSnapshot = snap;

export function undo(d) {
  const s = d.hist.pop();
  if (!s) return false;
  const o = JSON.parse(s);
  d.items = o.items; d.seq = o.seq; d.lastName = o.lastName;
  return true;
}

export function revertAll(d) {
  if (!isDirty(d) && !d.hist.length) return;
  checkpoint(d);
  d.items = d.items.filter(it => !it.isNew).map(it => {
    const b = d.base.get(it.id);
    return { ...it, name: b.name, color: b.color, zone: b.zone ? { ...b.zone } : null };
  });
}

export const itemOf = (d, id) => d.items.find(it => it.id === String(id)) || null;
export const namesOf = (d, exceptId) => d.items.filter(it => it.id !== exceptId).map(it => it.name);

export function addItem(d, o) {
  d.seq += 1;
  const it = { id: 'new:' + d.seq, isNew: true, name: cleanName(o.name), kind: o.kind,
               color: o.color || '', zone: o.zone ? fitZone(o.zone) : null };
  d.items.push(it);
  d.lastName = it.name;
  return it;
}

export function removeItem(d, id) {
  const it = itemOf(d, id);
  if (!it) return;
  if (it.isNew) d.items = d.items.filter(x => x !== it);
  else it.zone = null;              // ของจริงแค่เอาปุ่มออกจากรูป ไม่ลบที่เก็บ
}

/**
 * วางตารางที่แบ่งแล้วลงร่าง
 * ชื่อตรงกับที่เก็บเดิมที่ยังไม่มีปุ่มบนรูป → ใช้ที่เก็บเดิม (ไม่สร้างซ้ำ)
 * ชื่อตรงกับปุ่มที่วางอยู่แล้ว → ข้าม แล้วรายงานกลับ
 * @returns {{ created: string[], reused: string[], skipped: string[] }}
 */
export function applyGrid(d, zones, names, kind) {
  const res = { created: [], reused: [], skipped: [] };
  checkpoint(d);
  for (let r = 0; r < zones.length; r++) {
    for (let c = 0; c < zones[r].length; c++) {
      const name = names[r][c], z = fitZone(zones[r][c]);
      const same = d.items.find(it => nameKey(it.name) === nameKey(name));
      if (same && !same.zone) { same.zone = z; res.reused.push(name); }
      else if (same) res.skipped.push(name);
      else { addItem(d, { name, kind, zone: z }); res.created.push(name); }
    }
  }
  if (!res.created.length && !res.reused.length) d.hist.pop();   // ไม่มีอะไรเปลี่ยน ไม่ต้องจด
  return res;
}

/** ชื่อในตารางที่จะชนกับปุ่มที่วางบนรูปอยู่แล้ว (ต้องเปลี่ยนชื่อขึ้นต้นหรือเลขเริ่ม) */
export function gridConflicts(d, names) {
  const placed = new Set(d.items.filter(it => it.zone).map(it => nameKey(it.name)));
  return names.flat().filter(n => placed.has(nameKey(n)));
}

/* ── จากร่างเป็นคำสั่งบันทึก ──────────────────────────────────────────── */

/**
 * คำสั่งที่ต้องส่ง — แก้ของเดิมก่อนสร้างใหม่ เพราะการเปลี่ยนชื่อของเดิมอาจปล่อยชื่อ
 * ที่ปุ่มใหม่ต้องการใช้ (หลังบ้านตรวจชื่อซ้ำทีละคำสั่ง)
 */
export function pendingOps(d) {
  const ups = [], news = [];
  for (const it of d.items) {
    if (it.isNew) {
      news.push({ type: 'create', id: it.id, payload: {
        parentId: d.parentId, name: it.name, kind: it.kind, color: it.color || '',
        zone: it.zone ? round5(it.zone) : undefined } });
      continue;
    }
    const b = d.base.get(it.id);
    const p = {};
    if (it.name !== b.name) p.name = it.name;
    if ((it.color || '') !== (b.color || '')) p.color = it.color || '';
    if (!sameZone(it.zone, b.zone)) p.zone = it.zone ? round5(it.zone) : null;
    if (Object.keys(p).length) ups.push({ type: 'update', id: it.id, payload: { placeId: it.id, ...p } });
  }
  for (const n of news) if (n.payload.zone === undefined) delete n.payload.zone;
  return ups.concat(news);
}

export const isDirty = d => !!d && pendingOps(d).length > 0;
export const dirtyCount = d => (d ? pendingOps(d).length : 0);

/** ตรวจก่อนส่ง — บอกเป็นภาษาคนว่าต้องแก้อะไร */
export function validate(d) {
  const errs = [];
  const seen = new Map();
  for (const it of d.items) {
    if (!cleanName(it.name)) { errs.push('มีปุ่มที่ยังไม่มีชื่อ — แตะปุ่มนั้นแล้วตั้งชื่อก่อนบันทึก'); continue; }
    const k = nameKey(it.name);
    if (seen.has(k)) errs.push('ชื่อ "' + it.name + '" ซ้ำกัน — ในที่เก็บเดียวกันต้องใช้ชื่อไม่ซ้ำ');
    seen.set(k, true);
    if (it.zone && (it.zone.w < 0.01 || it.zone.h < 0.01)) errs.push('ปุ่ม "' + it.name + '" เล็กเกินไป');
  }
  return [...new Set(errs)];
}

/**
 * หลังบันทึก: สร้างร่างใหม่จากข้อมูลล่าสุด แล้วใส่คำสั่งที่ยังไม่สำเร็จกลับเข้าไป
 * ผู้ใช้จะไม่เสียงานที่ทำไว้ แม้บางคำสั่งถูกปฏิเสธ (เช่น ชื่อชนกับคนอื่นที่เพิ่งสร้าง)
 */
export function reapplyFailed(d, failed) {
  for (const f of failed) {
    if (f.type === 'create') {
      // ชื่อชนกับที่เก็บที่คนอื่นเพิ่งสร้างก็ยังต้องคืนปุ่มให้ — ผู้ใช้เปลี่ยนชื่อแล้วบันทึกใหม่ได้
      addItem(d, f.payload).failed = f.message || true;
    } else {
      const it = itemOf(d, f.id);
      if (!it) continue;
      if ('name' in f.payload)  it.name = f.payload.name;
      if ('color' in f.payload) it.color = f.payload.color;
      if ('zone' in f.payload)  it.zone = f.payload.zone ? { ...f.payload.zone } : null;
      it.failed = f.message || true;
    }
  }
}

/* ── ภายใน ─────────────────────────────────────────────────────────────── */
function round5(z) {
  const r = n => Math.round(n * 100000) / 100000;
  // ปัดแล้วต้องไม่หลุดกรอบ (เช่น x+w = 1.000004 จะโดนหลังบ้านปฏิเสธ)
  const w = r(z.w), h = r(z.h);
  return { x: Math.min(r(z.x), r(1 - w)), y: Math.min(r(z.y), r(1 - h)), w, h };
}
function toKeySet(arr) { return new Set((arr || []).map(nameKey)); }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
