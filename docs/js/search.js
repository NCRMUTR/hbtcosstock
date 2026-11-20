/* ══════════════════════════════════════════════════════════════════════════
   search.js — ค้นหาในเครื่อง

   สร้าง "สายอักขระค้นหา" (haystack) ต่อ 1 ล็อตไว้ล่วงหน้าตอนโหลดข้อมูล
   เวลาค้นจึงเป็นการวน indexOf ธรรมดา — เร็วระดับไม่กี่มิลลิวินาที
   และค้นคำที่อยู่กลางชื่อได้ ("cerin" เจอ "Glycerin") ซึ่งฐานข้อมูลบนคลาวด์
   ส่วนใหญ่ทำไม่ได้โดยตรง
   ══════════════════════════════════════════════════════════════════════════ */

import { kindOf, kindLabel, displayName } from './kinds.js';

const CFG = window.APP_CONFIG;
const DAY = 86400000;

let items    = [];
let settings = {};
let places   = new Map();     // PlaceID → { id, parentId, kind, name, zone, color, sort, children, pathText, depth, deep }
let roots    = [];            // PlaceID ของที่เก็บระดับบนสุด เรียงแล้ว
let photos   = new Map();     // "OWNERTYPE:ID" → [รูป เรียงตาม Sort]

export function getSettings() { return settings; }
export function getItems()    { return items; }
export function getPlaces()   { return places; }
export function getRoots()    { return roots; }

export function placeOf(id)  { return places.get(String(id)) || null; }

/** เส้นทางจากบนลงล่าง [ห้อง, ตู้, ชั้น] */
export function pathOf(id) {
  const out = [];
  let p = placeOf(id), guard = 0;
  while (p && guard++ < 10) { out.unshift(p); p = placeOf(p.parentId); }
  return out;
}

export function descendantIds(id) {
  const out = [];
  (function walk(pid) {
    const p = placeOf(pid);
    if (!p) return;
    for (const c of p.children) { out.push(c); walk(c); }
  })(String(id));
  return out;
}

/** ล็อตที่อยู่ในที่เก็บนี้ (deep = รวมที่เก็บข้างในทุกชั้น) */
export function lotsIn(placeId, deep) {
  const set = new Set([String(placeId), ...(deep ? descendantIds(placeId) : [])]);
  return items.filter(it => it.placeId && set.has(it.placeId));
}

export function photosOf(ownerType, ownerId) { return photos.get(ownerType + ':' + String(ownerId)) || []; }
export function coverOf(ownerType, ownerId)  { return photosOf(ownerType, ownerId)[0] || null; }

/* ── เตรียมข้อมูล (ทำครั้งเดียวต่อการโหลด snapshot) ────────────────────── */

export function buildIndex(snap) {
  const mf  = snap.materials.fields;
  const lf  = snap.lots.fields;
  const mi  = name => mf.indexOf(name);
  const li  = name => lf.indexOf(name);

  // สาร → ค้นด้วย MaterialID
  const mats = new Map();
  for (const r of snap.materials.rows) {
    mats.set(String(r[mi('MaterialID')]), {
      inci:  r[mi('INCIName')]  || '',
      trade: r[mi('TradeName')] || '',
      cas:   r[mi('CASNo')]     || '',
      func:  r[mi('Function')]  || '',
      state: r[mi('State')]     || '',
      unit:  r[mi('Unit')]      || 'g',
      sds:   r[mi('SDSLink')]   || '',
      hazard:r[mi('Hazard')]    || '',
      // snapshot เก่าที่ไม่มีคอลัมน์นี้ได้ index -1 → undefined → ถือเป็นสารเคมี
      kind:  kindOf(r[mi('ItemKind')])
    });
  }

  const now = Date.now();
  const out = [];

  for (const r of snap.lots.rows) {
    const lotId = String(r[li('LotID')]);
    const m     = mats.get(String(r[li('MaterialID')])) || {};
    const bal   = Number(snap.balances[lotId] || 0);

    const exp     = toDate(r[li('ExpireDate')]);
    const daysLeft = exp ? Math.floor((exp.getTime() - now) / DAY) : null;
    const shelfState = r[li('ShelfState')] || 'On Shelf';

    const it = {
      lotId,
      materialId:    String(r[li('MaterialID')]),
      inci:          m.inci  || '',
      trade:         m.trade || '',
      cas:           m.cas   || '',
      func:          m.func  || '',
      state:         m.state || '',
      unit:          m.unit  || 'g',
      sds:           m.sds   || '',
      hazard:        m.hazard || '',
      kind:          m.kind || 'CHEMICAL',
      supplier:      r[li('Supplier')]      || '',
      supplierLotNo: r[li('SupplierLotNo')] || '',
      fiscalYear:    String(r[li('FiscalYear')] || ''),
      room:          r[li('Room')]  || '',
      shelf:         r[li('Shelf')] || '',
      placeId:       String(r[li('PlaceID')] || ''),
      qtyReceived:   Number(r[li('QtyReceived')] || 0),
      unitPrice:     r[li('UnitPrice')] === '' ? null : Number(r[li('UnitPrice')]),
      receiveDate:   toDate(r[li('ReceiveDate')]),
      expireDate:    exp,
      legacyCode:    r[li('LegacyCode')] || '',
      shelfState,
      status:        r[li('Status')] || 'ACTIVE',
      balance:       bal,
      daysLeft
    };

    it.name   = displayName(it);
    it.stock  = bal <= 0 ? 'out' : (bal <= CFG.LOW_STOCK ? 'low' : 'ok');
    it.expiry = daysLeft === null ? 'none'
              : daysLeft < 0 ? 'expired'
              : daysLeft <= CFG.EXPIRE_WARN_DAYS ? 'soon' : 'ok';

    // คำค้นที่รวมทุกอย่างที่คนจะพิมพ์หา — ชื่อสาร ชื่อการค้า CAS รหัส ที่เก็บ
    it._hay = [
      it.inci, it.trade, it.cas, it.func, it.state,
      it.supplier, it.supplierLotNo, it.room, it.shelf,
      it.legacyCode, it.lotId, it.fiscalYear, kindLabel(it.kind)
    ].join(' \u0001 ').toLowerCase();

    out.push(it);
  }

  items    = out;
  settings = snap.settings || {};
  buildPlaces(snap);
  return items;
}

/* ── ที่เก็บแบบต้นไม้ และรูปภาพ ───────────────────────────────────────────── */

function buildPlaces(snap) {
  places = new Map(); roots = []; photos = new Map();
  if (!snap.places) return;                       // snapshot รุ่นเก่าที่ยังไม่มีที่เก็บ

  const f = snap.places.fields;
  const i = k => f.indexOf(k);
  for (const r of snap.places.rows) {
    const x = String(r[i('X')]), w = String(r[i('W')]);
    const hasZone = x !== '' && w !== '' && !isNaN(Number(x)) && !isNaN(Number(w));
    const id = String(r[i('PlaceID')]);
    places.set(id, {
      id, parentId: String(r[i('ParentID')] || ''), kind: String(r[i('Kind')] || ''),
      name: String(r[i('Name')] || ''),
      zone: hasZone ? { x: Number(r[i('X')]), y: Number(r[i('Y')]), w: Number(w), h: Number(r[i('H')]) } : null,
      color: String(r[i('Color')] || ''), sort: Number(r[i('Sort')]) || 0,
      notes: String(r[i('Notes')] || ''),
      children: [], direct: 0, deep: 0, pathText: '', depth: 0
    });
  }

  for (const p of places.values()) {
    const parent = p.parentId && places.get(p.parentId);
    if (parent) parent.children.push(p.id); else roots.push(p.id);
  }
  const bySort = (a, b) => {
    const pa = places.get(a), pb = places.get(b);
    return (pa.sort - pb.sort) || collator.compare(pa.name, pb.name);
  };
  roots.sort(bySort);
  for (const p of places.values()) p.children.sort(bySort);

  (function walk(ids, prefix, depth) {
    for (const id of ids) {
      const p = places.get(id);
      p.pathText = prefix ? prefix + ' › ' + p.name : p.name;
      p.depth = depth;
      walk(p.children, p.pathText, depth + 1);
    }
  })(roots, '', 0);

  // นับจำนวนล็อตในแต่ละที่เก็บ (deep = รวมที่อยู่ข้างใน)
  for (const it of items) {
    if (!it.placeId) continue;
    const direct = places.get(it.placeId);
    if (direct) direct.direct++;
    let p = direct;
    while (p) { p.deep++; p = places.get(p.parentId); }
  }

  if (snap.photos) {
    const pf = snap.photos.fields;
    const j = k => pf.indexOf(k);
    for (const r of snap.photos.rows) {
      const key = String(r[j('OwnerType')]) + ':' + String(r[j('OwnerID')]);
      if (!photos.has(key)) photos.set(key, []);
      photos.get(key).push({
        id: String(r[j('PhotoID')]), fileId: String(r[j('DriveFileID')]),
        width: Number(r[j('Width')]) || 0, height: Number(r[j('Height')]) || 0,
        caption: String(r[j('Caption')] || ''), sort: Number(r[j('Sort')]) || 0
      });
    }
    for (const list of photos.values()) list.sort((a, b) => a.sort - b.sort);
  }
}

function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/* ── ค้นหา ───────────────────────────────────────────────────────────────── */

/**
 * @param {string} query   คำค้น (เว้นวรรคได้หลายคำ = ต้องเจอทุกคำ)
 * @param {Object} f       { preset, kind, room, shelf, supplier, fiscalYear, func }
 * @param {Object} sort    { key, dir }  key: name | balance | expire | receive
 * @return {{rows:Array, ms:number, counts:Object}}
 */
export function search(query, f, sort) {
  const t0     = performance.now();
  const tokens = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const flt    = f || {};
  const rows   = [];

  const counts = { all: 0, soon: 0, expired: 0, out: 0, low: 0, eliminate: 0 };

  for (let i = 0; i < items.length; i++) {
    const it = items[i];

    // ── คำค้น ─────────────────────────────────────────────────────────────
    let hit = true;
    for (let t = 0; t < tokens.length; t++) {
      if (it._hay.indexOf(tokens[t]) === -1) { hit = false; break; }
    }
    if (!hit) continue;

    // ── ตัวกรองจากรายการเลือก ─────────────────────────────────────────────
    if (flt.kind       && it.kind       !== flt.kind)       continue;
    if (flt.room       && it.room       !== flt.room)       continue;
    if (flt.shelf      && it.shelf      !== flt.shelf)      continue;
    if (flt.supplier   && it.supplier   !== flt.supplier)   continue;
    if (flt.fiscalYear && it.fiscalYear !== flt.fiscalYear) continue;
    if (flt.func       && it.func       !== flt.func)       continue;

    // นับไว้ทำตัวเลขบนปุ่มตัวกรอง (นับหลังกรองรายการเลือก ก่อนกรอง preset)
    counts.all++;
    if (it.expiry === 'soon')    counts.soon++;
    if (it.expiry === 'expired') counts.expired++;
    if (it.stock  === 'out')     counts.out++;
    if (it.stock  === 'low')     counts.low++;
    if (it.shelfState === 'Eliminate') counts.eliminate++;

    // ── ตัวกรองหมวดด่วน (ชื่อตรงกับตัวเลขบนปุ่มใน counts เสมอ) ───────────
    switch (flt.preset) {
      case 'soon':
        if (it.expiry !== 'soon') continue;
        break;
      case 'expired':
        if (it.expiry !== 'expired') continue;
        break;
      case 'out':
        if (it.stock !== 'out') continue;
        break;
      case 'low':
        if (it.stock !== 'low') continue;
        break;
      case 'eliminate':
        if (it.shelfState !== 'Eliminate') continue;
        break;
      case 'onshelf':
        if (it.shelfState === 'Eliminate') continue;
        break;
    }

    rows.push(it);
  }

  sortRows(rows, sort);
  return { rows, ms: Math.round((performance.now() - t0) * 10) / 10, counts };
}

const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });

function sortRows(rows, sort) {
  const key = (sort && sort.key) || 'name';
  const dir = (sort && sort.dir === 'desc') ? -1 : 1;

  rows.sort((a, b) => {
    let r = 0;
    switch (key) {
      case 'balance': r = a.balance - b.balance; break;
      case 'expire':  r = tval(a.expireDate)  - tval(b.expireDate);  break;
      case 'receive': r = tval(a.receiveDate) - tval(b.receiveDate); break;
      case 'location':
        r = collator.compare(a.room + ' ' + a.shelf, b.room + ' ' + b.shelf);
        break;
      default:
        r = collator.compare(a.name, b.name);
    }
    // ชื่อสารเป็นตัวตัดสินรองเสมอ เพื่อให้ลำดับคงที่ไม่สลับไปมา
    if (r === 0) r = collator.compare(a.name, b.name);
    if (r === 0) r = a.lotId < b.lotId ? -1 : (a.lotId > b.lotId ? 1 : 0);
    return r * dir;
  });
}

/** วันที่ว่างให้ไปอยู่ท้ายสุดเสมอ ไม่ใช่ต้นสุด */
function tval(d) { return d ? d.getTime() : 8.64e15; }

/* ── ตัวเลือกสำหรับ dropdown — เอาจากข้อมูลจริงที่มีในคลัง ─────────────── */

export function facet(field) {
  const seen = new Set();
  for (const it of items) {
    const v = it[field];
    if (v) seen.add(v);
  }
  return [...seen].sort(collator.compare);
}
