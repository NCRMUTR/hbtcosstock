/* ══════════════════════════════════════════════════════════════════════════
   store.js — เก็บ snapshot ไว้ในเครื่องด้วย IndexedDB

   เปิดระบบครั้งถัดไป: ถามเซิร์ฟเวอร์แค่ "เลขเวอร์ชันข้อมูลตอนนี้เท่าไร"
   ถ้าเลขเท่าเดิม → ใช้ข้อมูลในเครื่องได้เลย ไม่ต้องโหลดอะไรทั้งนั้น
   ══════════════════════════════════════════════════════════════════════════ */

const DB_NAME  = 'hbt-stock';
const DB_VER   = 1;
const STORE    = 'kv';
const SNAP_KEY = 'snapshot';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('ไม่รองรับ IndexedDB'));
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }).catch(e => { dbPromise = null; throw e; });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r && r.result !== undefined ? r.result : undefined);
    t.onerror    = () => reject(t.error);
    t.onabort    = () => reject(t.error);
  }));
}

/**
 * อ่าน snapshot ที่เก็บไว้ในเครื่อง
 * คืน null ถ้าไม่มี หรืออ่านไม่ได้ (เช่นโหมดส่วนตัว / ปิดการเก็บข้อมูลเว็บไซต์)
 */
export async function loadSnapshot() {
  try {
    const v = await tx('readonly', s => s.get(SNAP_KEY));
    return v || null;
  } catch {
    return null;
  }
}

export async function saveSnapshot(snap) {
  try {
    await tx('readwrite', s => s.put(snap, SNAP_KEY));
    return true;
  } catch {
    return false;   // เก็บไม่ได้ก็ยังใช้งานได้ เพียงต้องโหลดใหม่ทุกครั้งที่เปิด
  }
}

export async function clearSnapshot() {
  try { await tx('readwrite', s => s.delete(SNAP_KEY)); } catch { /* ไม่เป็นไร */ }
}
