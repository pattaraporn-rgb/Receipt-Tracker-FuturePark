// ============================================================
//  Receipt Tracker — Google Apps Script
//  วาง code นี้ใน Extensions → Apps Script → Code.gs
//  แล้ว Deploy → New deployment → Web app
//  Execute as: Me | Who has access: Anyone
//
//  RF เก็บแบบ 2 class: rf_full (ใบเสร็จเต็ม) + rf_header (หัวใบเสร็จ)
//  ชีต roboflow: store_id | rf_full | rf_header | updated_at
// ============================================================

const SHEET_ID   = SpreadsheetApp.getActiveSpreadsheet().getId();
const SS         = SpreadsheetApp.getActiveSpreadsheet();

// ── Sheet names ──
const SH_STORES  = 'stores';
const SH_RF      = 'roboflow';
const SH_LOG     = 'upload_log';

// ── RF sheet schema (2 class) ──
const RF_HEADERS = ['store_id','rf_full','rf_header','updated_at'];

// ============================================================
//  GET — dashboard ดึงข้อมูล
//  ?action=get_all   → ดึงทั้งหมด (stores + rf)
//  ?action=ping      → health check
// ============================================================
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'get_all';
  let result;

  try {
    if (action === 'get_all')    result = getAllData();
    else if (action === 'ping')  result = { ok: true, ts: new Date().toISOString() };
    else result = { error: 'unknown action' };
  } catch(err) {
    result = { error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  POST — เว็บอัพโหลดข้อมูล
//  body: { action, data[] }
//  action: upsert_stores | upsert_receipts | replace_rf | clear_rf
// ============================================================
function doPost(e) {
  let result;
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action;
    const data   = body.data || [];

    if      (action === 'upsert_stores')   result = upsertStores(data);
    else if (action === 'upsert_receipts') result = upsertReceipts(data);
    else if (action === 'replace_rf')      result = replaceRF(data);
    else if (action === 'clear_rf')        result = clearRF();
    else result = { error: 'unknown action: ' + action };

    writeLog(action, data.length, 'ok');
  } catch(err) {
    result = { error: err.message };
    writeLog('error', 0, err.message);
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  getAllData — merge stores + RF แล้วส่งกลับ
// ============================================================
function getAllData() {
  const storesSheet = getOrCreate(SH_STORES, ['store_id','store_name','drive_name','receipts','updated_at']);
  const rfSheet     = getRfSheet();

  // Read stores (อาจมีหลาย row ต่อ store เพราะหลาย drive)
  const storeRows = readSheet(storesSheet);
  const rfRows    = readSheet(rfSheet);

  // Build stores map: store_id → { name, drives: {drive_name: count} }
  const storeMap = {};
  storeRows.forEach(r => {
    const id = String(r.store_id || '').trim();
    if (!id) return;
    if (!storeMap[id]) storeMap[id] = { name: r.store_name || '', drives: {} };
    if (r.drive_name && r.receipts !== '' && r.receipts !== undefined) {
      storeMap[id].drives[r.drive_name] = Number(r.receipts) || 0;
    }
    if (r.store_name) storeMap[id].name = r.store_name; // update name if provided
  });

  // Build RF map: store_id → { full, header }
  // รองรับ header เดิม (roboflow_count → full) เผื่อชีตยังไม่ migrate
  const rfMap = {};
  rfRows.forEach(r => {
    const id = String(r.store_id || '').trim();
    if (!id) return;
    const full   = Number(r.rf_full !== undefined && r.rf_full !== '' ? r.rf_full : (r.roboflow_count || 0)) || 0;
    const header = Number(r.rf_header || 0) || 0;
    rfMap[id] = { full, header };
  });

  // Compute per store
  const stores = Object.entries(storeMap).map(([id, s]) => {
    const total    = Object.values(s.drives).reduce((a, v) => a + v, 0);
    const rf        = rfMap[id] || { full: 0, header: 0 };
    const rfFull    = rf.full, rfHeader = rf.header;
    const adjTotal  = Math.max(total, rfFull, rfHeader);  // Dr.PONG fix (a class can't exceed total)
    const pending   = Math.max(0, adjTotal - rfFull) + Math.max(0, adjTotal - rfHeader);
    const pct       = adjTotal > 0
      ? Math.round((Math.min(rfFull, adjTotal) + Math.min(rfHeader, adjTotal)) / (2 * adjTotal) * 100) : 0;
    return {
      id, name: s.name, drives: s.drives, total: adjTotal,
      rf_full: rfFull, rf_header: rfHeader,
      rf: rfFull + rfHeader,        // legacy combined (kept for back-compat)
      pending, pct,
      isPending: id.startsWith('pending_')
    };
  });

  const totalReceipts = stores.reduce((a, s) => a + s.total, 0);
  const totalRFFull   = stores.reduce((a, s) => a + Math.min(s.rf_full, s.total), 0);
  const totalRFHeader = stores.reduce((a, s) => a + Math.min(s.rf_header, s.total), 0);
  const driveSet      = new Set();
  stores.forEach(s => Object.keys(s.drives).forEach(d => driveSet.add(d)));

  return {
    ok: true,
    ts: new Date().toISOString(),
    summary: {
      stores: stores.length,
      drives: driveSet.size,
      driveList: [...driveSet].sort(),
      totalReceipts,
      rfFull: totalRFFull,
      rfHeader: totalRFHeader,
      pct: totalReceipts > 0 ? Math.round((totalRFFull + totalRFHeader) / (2 * totalReceipts) * 100) : 0,
    },
    stores
  };
}

// ============================================================
//  upsertStores — Template 1: store_id, store_name
// ============================================================
function upsertStores(rows) {
  const sh = getOrCreate(SH_STORES, ['store_id','store_name','drive_name','receipts','updated_at']);
  const existing = readSheet(sh);
  let added = 0, updated = 0, pendingN = 1;

  // find max pending number
  existing.forEach(r => {
    const m = String(r.store_id).match(/^pending_(\d+)$/);
    if (m) pendingN = Math.max(pendingN, parseInt(m[1]) + 1);
  });

  rows.forEach(row => {
    let id   = String(row.store_id || '').trim();
    const nm = String(row.store_name || '').trim();
    if (!nm && !id) return;

    if (!id || id === 'null' || id === 'undefined') {
      id = 'pending_' + String(pendingN++).padStart(3, '0');
    }

    // check if store_id exists (only name update, no drive touch)
    const found = existing.find(r => String(r.store_id) === id);
    const ts = new Date().toISOString();
    if (found) {
      // update name in sheet — find row index
      const allVals = sh.getDataRange().getValues();
      for (let i = 1; i < allVals.length; i++) {
        if (String(allVals[i][0]) === id) {
          if (nm) sh.getRange(i + 1, 2).setValue(nm);
          sh.getRange(i + 1, 5).setValue(ts);
        }
      }
      updated++;
    } else {
      // new store — append row with empty drive/receipts
      sh.appendRow([id, nm, '', '', ts]);
      added++;
    }
  });

  return { ok: true, added, updated, pendingAssigned: pendingN - 1 };
}

// ============================================================
//  upsertReceipts — Template 2: store_id, drive_name, receipts, mode, store_name?
// ============================================================
function upsertReceipts(rows) {
  const sh = getOrCreate(SH_STORES, ['store_id','store_name','drive_name','receipts','updated_at']);
  let ok = 0, warn = 0;
  const ts = new Date().toISOString();

  rows.forEach(row => {
    const id    = String(row.store_id || '').trim();
    const drive = String(row.drive_name || '').trim();
    const cnt   = Number(row.receipts);
    const mode  = String(row.mode || 'replace').toLowerCase();
    const nm    = String(row.store_name || '').trim();

    if (!id || !drive || isNaN(cnt)) { warn++; return; }

    const allVals = sh.getDataRange().getValues();
    let found = false;

    for (let i = 1; i < allVals.length; i++) {
      if (String(allVals[i][0]) === id && String(allVals[i][2]) === drive) {
        // existing store+drive row
        const cur = Number(allVals[i][3]) || 0;
        sh.getRange(i + 1, 4).setValue(mode === 'add' ? cur + cnt : cnt);
        sh.getRange(i + 1, 5).setValue(ts);
        if (nm && !allVals[i][1]) sh.getRange(i + 1, 2).setValue(nm);
        found = true;
        break;
      }
    }

    if (!found) {
      // check if store exists with different drive
      const storeExists = allVals.slice(1).some(r => String(r[0]) === id);
      const storeName = nm || (storeExists ? allVals.find(r => String(r[0]) === id)?.[1] || id : id);
      sh.appendRow([id, storeName, drive, cnt, ts]);
    }
    ok++;
  });

  return { ok, warn };
}

// ============================================================
//  replaceRF — Template 3: store_id, rf_full, rf_header (replace all)
//  รองรับของเดิม roboflow_count (→ rf_full) เผื่อไฟล์เก่า
// ============================================================
function replaceRF(rows) {
  const sh = getRfSheet();
  // Clear all data except header
  const lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, RF_HEADERS.length).clearContent();

  const ts = new Date().toISOString();
  let replaced = 0;
  rows.forEach(row => {
    const id   = String(row.store_id || '').trim();
    if (!id) return;
    const full = Number(row.rf_full !== undefined ? row.rf_full : row.roboflow_count) || 0;
    const head = Number(row.rf_header || 0) || 0;
    sh.appendRow([id, full, head, ts]);
    replaced++;
  });

  return { ok: true, replaced };
}

// ============================================================
//  clearRF — ล้าง RF ทั้งหมด
// ============================================================
function clearRF() {
  const sh = getRfSheet();
  const lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, RF_HEADERS.length).clearContent();
  return { ok: true };
}

// ============================================================
//  HELPERS
// ============================================================

// roboflow sheet + auto-migrate legacy header (store_id, roboflow_count, updated_at)
//  → (store_id, rf_full, rf_header, updated_at); roboflow_count becomes rf_full, rf_header = 0
function getRfSheet() {
  const sh = getOrCreate(SH_RF, RF_HEADERS);
  const hdr = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(h => String(h).trim());
  if (hdr[1] === 'roboflow_count') {
    const last = sh.getLastRow();
    let dataRows = [];
    if (last > 1) {
      // old layout: col1=store_id, col2=roboflow_count, col3=updated_at
      dataRows = sh.getRange(2, 1, last - 1, 3).getValues()
        .map(r => [r[0], Number(r[1]) || 0, 0, r[2]]);   // full = old count, header = 0
    }
    sh.clear();
    sh.appendRow(RF_HEADERS);
    sh.getRange(1, 1, 1, RF_HEADERS.length).setFontWeight('bold')
      .setBackground('#1a73e8').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    if (dataRows.length) sh.getRange(2, 1, dataRows.length, RF_HEADERS.length).setValues(dataRows);
  }
  return sh;
}

function getOrCreate(name, headers) {
  let sh = SS.getSheetByName(name);
  if (!sh) {
    sh = SS.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold')
      .setBackground('#1a73e8').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readSheet(sh) {
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(h => String(h).trim());
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  }).filter(r => Object.values(r).some(v => v !== ''));
}

function writeLog(action, count, status) {
  try {
    const sh = getOrCreate(SH_LOG, ['timestamp','action','rows','status']);
    sh.appendRow([new Date().toISOString(), action, count, status]);
    // keep only last 200 rows
    if (sh.getLastRow() > 201) sh.deleteRow(2);
  } catch(e) {}
}
