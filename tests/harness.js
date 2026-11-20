/**
 * harness.js — จำลองสภาพแวดล้อม Google Apps Script บน Node (HBT Raw Material Stock v2)
 *
 * ตัวจำลองนี้ "เข้มเท่าของจริง" โดยตั้งใจ: ชีตมีขอบเขตแถว/คอลัมน์จำกัด
 * และปฏิเสธการเขียนค่าที่ไม่ใช่ค่าพื้นฐาน เพื่อให้ชุดทดสอบจับบั๊กชนิดที่เกิดบน
 * Apps Script จริงได้ตั้งแต่ก่อนนำขึ้นใช้งาน
 */
'use strict';
process.env.TZ = 'Asia/Bangkok';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─────────────────────────────────────────── Fake Sheet
class FakeRange {
  constructor(sheet, row, col, nRows, nCols) { this.s = sheet; this.r = row; this.c = col; this.nR = nRows; this.nC = nCols; }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nR; i++) {
      const row = [];
      for (let j = 0; j < this.nC; j++) row.push(this.s._get(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nR) throw new Error(`setValues row mismatch: got ${vals.length} want ${this.nR}`);
    for (let i = 0; i < this.nR; i++) {
      if (vals[i].length !== this.nC) throw new Error(`setValues col mismatch row ${i}: got ${vals[i].length} want ${this.nC}`);
      for (let j = 0; j < this.nC; j++) {
        const v = vals[i][j];
        // ของจริงรับได้เฉพาะค่าพื้นฐานกับ Date — ถ้าเผลอส่ง object/array ต้องพังตั้งแต่ตอนทดสอบ
        if (v !== null && v !== undefined && typeof v === 'object' && !(v instanceof Date)) {
          throw new Error('Cannot convert ' + Object.prototype.toString.call(v) + ' to a cell value.');
        }
        this.s._set(this.r + i, this.c + j, v);
      }
    }
    return this;
  }
  getValue() { return this.s._get(this.r, this.c); }
  setValue(v) { this.s._set(this.r, this.c, v); return this; }
  setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; }
  setNumberFormat() { return this; }
}
class FakeSheet {
  // ชีตใหม่ของ Google = 1000 แถว 26 คอลัมน์ และเขียนเกินขอบเขตไม่ได้ (ต้อง insertRows ก่อน)
  constructor(name) { this.name = name; this.cells = new Map(); this.maxR = 0; this.maxC = 0; this.maxRows = 1000; this.maxCols = 26; }
  _key(r, c) { return r + ':' + c; }
  _get(r, c) { const v = this.cells.get(this._key(r, c)); return v === undefined ? '' : v; }
  _set(r, c, v) {
    if (v === '' || v === null || v === undefined) this.cells.delete(this._key(r, c));
    else { this.cells.set(this._key(r, c), v); if (r > this.maxR) this.maxR = r; if (c > this.maxC) this.maxC = c; }
  }
  getName() { return this.name; }
  getLastRow() {
    // เหมือนของจริง: แถวสุดท้ายที่มีข้อมูล
    let m = 0; for (const k of this.cells.keys()) { const r = +k.split(':')[0]; if (r > m) m = r; } return m;
  }
  getLastColumn() { return this.maxC; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(after, howMany) { this.maxRows += Math.max(1, howMany | 0); return this; }
  insertColumnsAfter(after, howMany) { this.maxCols += Math.max(1, howMany | 0); return this; }
  getRange(r, c, nR, nC) {
    nR = nR === undefined ? 1 : nR;
    nC = nC === undefined ? 1 : nC;
    // ข้อความ error ตรงกับของจริง เพื่อให้ชุดทดสอบจับบั๊กชนิดเดียวกับที่เกิดบน Apps Script
    if (r < 1 || c < 1) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    if (nR < 1 || nC < 1) throw new Error('The number of rows or columns in the range must be at least 1.');
    if (r + nR - 1 > this.maxRows) throw new Error('Those rows are out of bounds.');
    if (c + nC - 1 > this.maxCols) throw new Error('Those columns are out of bounds.');
    return new FakeRange(this, r, c, nR, nC);
  }
  appendRow(vals) {
    const r = this.getLastRow() + 1;
    if (r > this.maxRows) throw new Error('Those rows are out of bounds.');
    vals.forEach((v, i) => this._set(r, i + 1, v));
    return this;
  }
  deleteRow(row) {
    const next = new Map();
    for (const [k, v] of this.cells) {
      const [r, c] = k.split(':').map(Number);
      if (r === row) continue;
      next.set((r > row ? r - 1 : r) + ':' + c, v);
    }
    this.cells = next;
    this.maxRows = Math.max(1, this.maxRows - 1);
  }
  setFrozenRows() { return this; }
}
class FakeSpreadsheet {
  constructor(name) { this.name = name; this.sheets = new Map(); }
  getId() { return 'fake-sheet-id'; }
  getName() { return this.name; }
  getSheetByName(n) { return this.sheets.get(n) || null; }
  getSheets() { return [...this.sheets.values()]; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.set(n, s); return s; }
  deleteSheet(s) { this.sheets.delete(s.name); }
}

let SS = new FakeSpreadsheet('Lab Stock Test');
global.SpreadsheetApp = { openById: () => SS, getActiveSpreadsheet: () => SS };

const _props = new Map();
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => (_props.has(k) ? _props.get(k) : null),
    setProperty: (k, v) => { _props.set(k, String(v)); },
    deleteProperty: k => { _props.delete(k); }
  })
};

const _cache = new Map();
global.CacheService = {
  getScriptCache: () => ({
    get: k => (_cache.has(k) ? _cache.get(k) : null),
    put: (k, v) => { _cache.set(k, String(v)); },
    putAll: obj => { Object.keys(obj).forEach(k => _cache.set(k, obj[k])); },
    getAll: keys => { const o = {}; keys.forEach(k => { o[k] = _cache.has(k) ? _cache.get(k) : null; }); return o; },
    remove: k => { _cache.delete(k); },
    removeAll: keys => { keys.forEach(k => _cache.delete(k)); }
  })
};

let _lockHeld = false;
global.LockService = {
  getScriptLock: () => ({
    tryLock: () => { if (_lockHeld) return false; _lockHeld = true; return true; },
    releaseLock: () => { _lockHeld = false; }
  })
};

// ─────────────────────────────────────────── Utilities (ไบต์เป็น signed int เหมือน GAS)
const toBuf = x => {
  if (Buffer.isBuffer(x)) return x;
  if (Array.isArray(x)) return Buffer.from(x.map(b => b & 255));
  return Buffer.from(String(x), 'utf8');
};
const toSigned = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));

function parseCsv(text) {
  const rows = []; let row = [], field = '', inQ = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

global.Utilities = {
  parseCsv,
  DigestAlgorithm: { MD5: 'MD5', SHA_1: 'SHA_1', SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8', US_ASCII: 'US_ASCII' },
  computeDigest: (algo, value /*, charset */) => {
    const map = { MD5: 'md5', SHA_1: 'sha1', SHA_256: 'sha256' };
    const name = map[String(algo)];
    if (!name) throw new Error('Unsupported digest algorithm: ' + algo);
    return toSigned(crypto.createHash(name).update(toBuf(value)).digest());
  },
  sleep: () => {},
  getUuid: () => crypto.randomUUID(),
  base64Encode: b => toBuf(b).toString('base64'),
  base64EncodeWebSafe: b => toBuf(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  base64Decode: s => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(String(s))) throw new Error('Invalid base64');
    return toSigned(Buffer.from(String(s), 'base64'));
  },
  base64DecodeWebSafe: s => toSigned(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
  computeHmacSha256Signature: (v, k) => {
    // เหมือนของจริง: ชนิดของสองพารามิเตอร์ต้องตรงกัน (String,String) หรือ (byte[],byte[])
    if ((typeof v === 'string') !== (typeof k === 'string')) {
      throw new Error("The parameters (" + (typeof v === 'string' ? 'String' : 'number[]') + "," + (typeof k === 'string' ? 'String' : 'number[]') +
        ") don't match the method signature for Utilities.computeHmacSha256Signature.");
    }
    return toSigned(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest());
  },
  newBlob: (bytes, mime, name) => ({
    _b: toBuf(bytes), _m: mime || 'application/octet-stream', _n: name || '',
    getDataAsString() { return this._b.toString('utf8'); },
    getBytes() { return toSigned(this._b); },
    getContentType() { return this._m; }, getName() { return this._n; }
  })
};

global.ContentService = {
  MimeType: { JSON: 'application/json' },
  createTextOutput: t => ({ _t: t, setMimeType() { return this; }, getContent() { return this._t; } })
};

// ─────────────────────────────────────────── DriveApp จำลอง
const DRIVE = { files: new Map(), folders: new Map() };
let _fid = 0;
function mkFolder(name) {
  const id = 'FOLDER' + (++_fid);
  const f = {
    getId: () => id, getName: () => name,
    createFile(blob) {
      const fid = 'FILE' + (++_fid) + crypto.randomBytes(4).toString('hex');
      const file = {
        id: fid, name: blob.getName(), mime: blob.getContentType(), bytes: toBuf(blob.getBytes()), trashed: false, sharing: null,
        getId: () => fid, getName: () => blob.getName(),
        setSharing(a, p) { file.sharing = [a, p]; return file; },
        setTrashed(t) { file.trashed = !!t; return file; }
      };
      DRIVE.files.set(fid, file);
      return file;
    }
  };
  DRIVE.folders.set(id, f);
  return f;
}
global.DriveApp = {
  Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
  createFolder: n => mkFolder(n),
  getFolderById: id => { const f = DRIVE.folders.get(id); if (!f) throw new Error('Folder not found: ' + id); return f; },
  getFileById: id => { const f = DRIVE.files.get(id); if (!f) throw new Error('File not found: ' + id); return f; }
};

// ─────────────────────────────────────────── UrlFetchApp จำลอง (ตรวจ ID token กับ Google)
//  ชุดทดสอบตั้งค่าคำตอบล่วงหน้าผ่าน TOKENS: { '<idToken>': {aud, email, email_verified, hd} }
//  ค่า null = Google ตอบ 400 (token ปลอม/หมดอายุ)
const TOKENS = new Map();
global.UrlFetchApp = {
  fetch: (url) => {
    const m = String(url).match(/id_token=([^&]*)/);
    const tok = m ? decodeURIComponent(m[1]) : '';
    const info = TOKENS.get(tok);
    if (!info) return { getResponseCode: () => 400, getContentText: () => '{"error":"invalid_token"}' };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(info) };
  }
};

global.Session = { getActiveUser: () => ({ getEmail: () => '' }) };

global.Logger = { log: () => {} };
console.error = () => {};
console.warn = () => {};

// ─────────────────────────────────────────── โหลดไฟล์ .gs ทั้งหมด
const GAS_DIR = path.join(__dirname, '..', 'gas');
const ORDER = ['Config.gs', 'Data.gs', 'Auth.gs', 'Password.gs', 'Users.gs', 'Inventory.gs', 'Catalog.gs',
               'Places.gs', 'Photos.gs', 'Snapshot.gs', 'Import.gs', 'Setup.gs', 'Api.gs'];
let bundle = '';
ORDER.forEach(f => { bundle += fs.readFileSync(path.join(GAS_DIR, f), 'utf8') + '\n;\n'; });
(0, eval)(bundle);

/** ล้างทุกอย่างกลับไปเหมือนเพิ่งสร้างโปรเจกต์ใหม่ */
function reset() {
  SS.sheets.clear();
  _props.clear(); _cache.clear(); _lockHeld = false;
  DRIVE.files.clear(); DRIVE.folders.clear();
  TOKENS.clear();
}

module.exports = { get SS() { return SS; }, _props, _cache, DRIVE, TOKENS, reset };
