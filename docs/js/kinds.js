/* ══════════════════════════════════════════════════════════════════════════
   kinds.js — ชนิดของในคลัง: สารเคมี / วัสดุสิ้นเปลือง / ครุภัณฑ์

   กติกาฝั่งหลังบ้าน (Config.gs · Data.gs) เป็นตัวตัดสินจริง ไฟล์นี้มีไว้ให้
   หน้าเว็บ "ไม่เสนอ" สิ่งที่หลังบ้านจะปฏิเสธอยู่แล้ว เช่น ปุ่มเบิกครุภัณฑ์
   ถ้าแก้กติกาที่นี่ ต้องแก้ ITEM_KINDS / EQUIPMENT_BLOCKED_TXN ใน Config.gs ให้ตรงกันด้วย
   ══════════════════════════════════════════════════════════════════════════ */
import { esc } from './ui.js';

export const KIND_ORDER = ['CHEMICAL', 'CONSUMABLE', 'EQUIPMENT'];

export const KINDS = {
  CHEMICAL:   { th: 'สารเคมี',        cls: 'kind-chem'  },
  CONSUMABLE: { th: 'วัสดุสิ้นเปลือง', cls: 'kind-cons'  },
  EQUIPMENT:  { th: 'ครุภัณฑ์',        cls: 'kind-equip' }
};

export const EQUIPMENT_UNIT = 'pcs';

/** ข้อความเดียวกับที่หลังบ้านตอบ — ผู้ใช้เห็นคำเดียวกันไม่ว่าจะเจอที่ไหน */
export const EQUIPMENT_NO_ISSUE =
  'ครุภัณฑ์ยังเบิก/คืนไม่ได้ — ถ้านำไปใช้ที่ห้องอื่น ให้ใช้ "ย้ายที่เก็บ" แทน (ระบบยืม-คืนครุภัณฑ์จะเปิดให้ใช้ภายหลัง)';

/**
 * ค่าว่าง/ไม่รู้จัก = สารเคมี — snapshot ที่เก็บไว้ในเครื่องก่อนอัปเกรดยังไม่มีคอลัมน์นี้
 * (หลังบ้านตีความให้แล้ว แต่ข้อมูลเก่าใน IndexedDB ยังอาจถูกใช้ก่อนซิงก์ใหม่)
 */
export function kindOf(v) {
  const k = String(v || '').trim().toUpperCase();
  return KINDS[k] ? k : 'CHEMICAL';
}

export function kindLabel(kind) { return KINDS[kindOf(kind)].th; }

export function kindTag(kind) {
  const k = kindOf(kind);
  return `<span class="tag ${KINDS[k].cls}" data-kind="${k}">${esc(KINDS[k].th)}</span>`;
}

export const isEquipment = it => !!it && kindOf(it.kind) === 'EQUIPMENT';

/** เบิก/คืนได้หรือไม่ — ครุภัณฑ์ต้องรอระบบยืม-คืน (กันประวัติปนกันตอนแยกระบบทีหลัง) */
export function canTxn(it, type) {
  return !(isEquipment(it) && (type === 'ISSUE' || type === 'RETURN'));
}

/** ช่องตัวเลขจำนวน — ครุภัณฑ์รับเฉพาะจำนวนเต็ม */
export function qtyAttrs(it) {
  return isEquipment(it) ? 'step="1" inputmode="numeric"' : 'step="any" inputmode="decimal"';
}

/** ชื่อที่ใช้แสดง — วัสดุ/ครุภัณฑ์อาจไม่มีชื่อสาร มีแต่ชื่อการค้าหรือรุ่น */
export function displayName(it) {
  return (it && (it.inci || it.trade)) || '(ไม่มีชื่อ)';
}
