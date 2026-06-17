// ══════════════════════════════════════════════════════
//  api.js — Google Sheets data layer + in-memory cache
//  (extracted from receipt-tracker-v2.html · behavior unchanged)
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  STORAGE — แยก 2 key ชัดเจน
//  stores_data  = { store_id: { name, drives:{drive_name: count} } }
//  rf_data      = { store_id: count }   ← ไม่โดน overwrite เมื่อ sync ร้านค้า
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  CONFIG — ใส่ URL จาก Apps Script Deploy ตรงนี้
// ══════════════════════════════════════════════════════
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx8GxE4CMaXHT6hVapp1oYaP_yX9-eO4IeocKcjh6a9klyHeY27QWNWEsvzeFWTIqsw/exec';

// ══ IN-MEMORY CACHE (ลด API call) ══
let _cache = { stores: {}, rf: {}, ts: null };
let _dirty = false;  // มีการเปลี่ยนแปลงที่ยังไม่ได้ push

function isConfigured(){ return APPS_SCRIPT_URL !== 'YOUR_APPS_SCRIPT_URL_HERE'; }

// ── Fetch all data from Sheets ──
async function fetchFromSheet(){
  if(!isConfigured()) return false;
  try {
    showLoading(true);
    const r = await fetch(APPS_SCRIPT_URL + '?action=get_all', {method:'GET'});
    const d = await r.json();
    if(!d.ok) throw new Error(d.error);
    // Build _cache from response
    _cache.stores = {};
    _cache.rf = {};
    d.stores.forEach(s => {
      _cache.stores[s.id] = { name: s.name, drives: s.drives };
      // RF per class (column N = ใบเสร็จเต็ม, O = หัวใบเสร็จ);
      // fall back to the legacy single `rf` field so the app keeps working
      // until the Apps Script backend starts returning rf_full / rf_header.
      if(s.rf_full !== undefined || s.rf_header !== undefined){
        _cache.rf[s.id] = { full: s.rf_full||0, header: s.rf_header||0 };
      } else if(s.rf !== undefined){
        _cache.rf[s.id] = { full: s.rf, header: 0 };
      }
    });
    _cache.ts = d.ts;
    _dirty = false;
    updateSyncTime(d.ts);
    showLoading(false);
    return true;
  } catch(err) {
    showLoading(false);
    toast('❌ โหลดจาก Sheet ไม่ได้: ' + err.message);
    return false;
  }
}

// ── POST to Sheet ──
async function postToSheet(action, data){
  if(!isConfigured()){ toast('⚠ ยังไม่ได้ใส่ Apps Script URL'); return false; }
  try {
    const r = await fetch(APPS_SCRIPT_URL, {
      method:'POST',
      body: JSON.stringify({ action, data }),
    });
    const d = await r.json();
    if(d.error) throw new Error(d.error);
    return d;
  } catch(err) {
    toast('❌ บันทึกไม่สำเร็จ: ' + err.message);
    return false;
  }
}

// ── Load/Save compat functions (ใช้ _cache) ──
function loadStores(){ return _cache.stores; }
function loadRF()    { return _cache.rf; }
function saveStores(d){ _cache.stores = d; _dirty = true; }
function saveRF(d)   { _cache.rf = d; _dirty = true; }

function showLoading(v){
  const lbl = document.getElementById('storageLabel');
  lbl.textContent = v ? 'กำลังโหลด...' : (isConfigured() ? 'Google Sheets ●' : 'ยังไม่เชื่อม Sheets');
}

function updateSyncTime(ts){
  try{
    const d = new Date(ts);
    const btn = document.querySelector('.sync-btn');
    if(btn) btn.title = 'อัพเดตล่าสุด: ' + d.toLocaleTimeString('th-TH');
  }catch(e){}
}
