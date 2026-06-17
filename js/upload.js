// ══════════════════════════════════════════════════════
//  upload.js — Excel import, template download, clear/url config
//  (extracted from receipt-tracker-v2.html · behavior unchanged)
// ══════════════════════════════════════════════════════

// ══ EXCEL UPLOAD ══
function handleDrop(e){
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if(f) handleFile(f);
}

function handleFile(file){
  if(!file){return}
  const log = document.getElementById('uploadLog');
  log.innerHTML = `<span class="log-info">📂 กำลังอ่าน ${file.name}...</span>\n`;
  const reader = new FileReader();
  reader.onload = e=>{
    try{
      const wb = XLSX.read(e.target.result, {type:'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {defval:''});
      if(!rows.length){logLine('warn','⚠ ไฟล์ว่างเปล่า');return}

      // Detect template by header
      const keys = Object.keys(rows[0]).map(k=>k.trim().toLowerCase());
      logLine('info', `📋 พบ columns: ${keys.join(', ')}`);

      if(keys.includes('roboflow_count')){
        uploadRF(rows, log);
      } else if(keys.includes('receipts') || keys.includes('drive_name')){
        uploadReceipts(rows, log);
      } else if(keys.includes('store_name') || keys.includes('store_id')){
        uploadStores(rows, log);
      } else {
        logLine('err','❌ ไม่รู้จัก template — ตรวจสอบ column headers');
      }
    }catch(err){
      logLine('err','❌ อ่านไฟล์ไม่ได้: '+err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

let pendingCounter = 1;

async function uploadStores(rows, log){
  logLine('info','🏪 ตรวจพบ Template 1 — อัพร้านค้า → Google Sheets');
  const data = rows.map(row => ({
    store_id:   (row['store_id']||row['Store ID']||'').toString().trim(),
    store_name: (row['store_name']||row['ชื่อร้านค้า']||'').toString().trim(),
  })).filter(r => r.store_name || r.store_id);

  logLine('info', `  ส่ง ${data.length} rows → Sheets...`);
  const res = await postToSheet('upsert_stores', data);
  if(!res){ logLine('err','❌ บันทึกล้มเหลว'); return; }
  logLine('ok', `✓ เพิ่ม ${res.added} ร้าน, อัพเดต ${res.updated} ร้าน`);
  if(res.pendingAssigned) logLine('warn', `  ⏳ assign pending_ ${res.pendingAssigned} ร้าน`);
  toast(`✓ อัพ Template 1 → Sheets สำเร็จ`);
  await fetchFromSheet();
  refresh();
}

async function uploadReceipts(rows, log){
  logLine('info','🗂 ตรวจพบ Template 2 — อัพใบเสร็จ + Drive → Google Sheets');
  const data = [];
  rows.forEach((row,i)=>{
    const id    = (row['store_id']||row['Store ID']||'').toString().trim();
    const drive = (row['drive_name']||row['Drive']||'').toString().trim();
    const cnt   = parseInt(row['receipts']||row['total_receipts']||0);
    const mode  = (row['mode']||'replace').toString().trim().toLowerCase();
    const nm    = (row['store_name']||'').toString().trim();
    if(!id||!drive||isNaN(cnt)){logLine('warn',`  ⚠ แถว ${i+2}: ข้ามเพราะข้อมูลไม่ครบ`);return}
    logLine('info',`  ${mode==='add'?'＋':'↺'} ${id} / ${drive}: ${cnt} (${mode})`);
    data.push({store_id:id, drive_name:drive, receipts:cnt, mode, store_name:nm});
  });

  logLine('info', `  ส่ง ${data.length} rows → Sheets...`);
  const res = await postToSheet('upsert_receipts', data);
  if(!res){ logLine('err','❌ บันทึกล้มเหลว'); return; }
  logLine('ok',`✓ ${res.ok} แถวสำเร็จ${res.warn?' ('+res.warn+' คำเตือน)':''}`);
  toast(`✓ อัพ Template 2 → Sheets สำเร็จ`);
  await fetchFromSheet();
  refresh();
}

async function uploadRF(rows, log){
  logLine('info','🤖 ตรวจพบ Template 3 — อัพ Roboflow → Google Sheets (replace ทั้งหมด)');
  const data = [];
  let warn = 0;
  rows.forEach((row,i)=>{
    const id  = (row['store_id']||row['Store ID']||'').toString().trim();
    const cnt = parseInt(row['roboflow_count']||row['RF']||0);
    if(!id){logLine('warn',`  ⚠ แถว ${i+2}: ไม่มี store_id`);warn++;return}
    if(isNaN(cnt)){logLine('warn',`  ⚠ แถว ${i+2}: ตัวเลข RF ไม่ถูกต้อง`);warn++;return}
    data.push({store_id:id, roboflow_count:cnt});
  });

  logLine('warn', `  ↻ จะล้าง RF เก่าทั้งหมด แล้วใส่ใหม่ ${data.length} ร้าน...`);
  const res = await postToSheet('replace_rf', data);
  if(!res){ logLine('err','❌ บันทึกล้มเหลว'); return; }
  logLine('ok',`✓ RF อัพเดตสำเร็จ — ${res.replaced} ร้าน`);
  toast(`✓ อัพ RF → Sheets สำเร็จ (replace)`);
  await fetchFromSheet();
  refresh();
}

function logLine(type, msg){
  const log = document.getElementById('uploadLog');
  const cls = {ok:'log-ok',warn:'log-warn',err:'log-err',info:'log-info'}[type]||'log-info';
  log.innerHTML += `<span class="${cls}">${msg}</span>\n`;
  log.scrollTop = log.scrollHeight;
}

// ══ TEMPLATE DOWNLOAD ══
function downloadTemplate(type){
  const wb = XLSX.utils.book_new();
  let data, sheetName;

  if(type==='stores'){
    data = [
      ['store_id','store_name'],
      ['100033','FITNESS FIRST / MIN.3.FIT004'],
      ['100156','เชสเตอร์กริลล์ / PLZ.B.SHP010A'],
      ['','ร้านที่ยังไม่มี ID ก็ใส่ได้เลย'],
    ];
    sheetName = 'stores';
  } else if(type==='receipts'){
    data = [
      ['store_id','drive_name','receipts','mode','store_name'],
      ['100218','drive1_27mar2026',45,'replace','ฮะจิบัง ราเมน'],
      ['101719','drive1_27mar2026',33,'replace','S & P Restaurant'],
      ['100218','drive3Rocket_03042026',12,'add','ฮะจิบัง ราเมน'],
      ['','','','',''],
      ['','--- mode: replace=แทนที่ / add=บวกเพิ่ม ---','','',''],
    ];
    sheetName = 'receipts_per_drive';
  } else {
    data = [
      ['store_id','roboflow_count'],
      ['100033',95],
      ['100156',12],
      ['100218',27],
      ['',''],
      ['','--- replace ทั้งหมดเสมอ ใส่ทุกร้านที่อยู่ใน RF ---'],
    ];
    sheetName = 'roboflow';
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:20},{wch:35},{wch:14},{wch:10},{wch:30}];
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `template_${type}.xlsx`);
  toast(`⬇ ดาวน์โหลด template_${type}.xlsx`);
}

// ══ CLEAR DATA ══
async function clearData(what){
  const msg = what==='all'?'ล้างทุกอย่าง? (ข้อมูลใน Sheet จะหายทั้งหมด)':what==='rf'?'ล้าง RF ทั้งหมดใน Sheet?':'ล้างข้อมูลร้านค้า? (ไม่กระทบ RF)';
  if(!confirm(msg)) return;
  if(what==='rf'||what==='all'){
    const res = await postToSheet('clear_rf', []);
    if(res) toast('✓ ล้าง RF ใน Sheet แล้ว');
  }
  if(what==='all'){
    // clear stores sheet — send empty replace
    _cache.stores = {}; _cache.rf = {};
    toast('✓ ล้างข้อมูลทั้งหมดแล้ว (reload เพื่อยืนยัน)');
  }
  await fetchFromSheet();
  refresh();
}

// ══ URL CONFIG ══
function saveURL(){
  const url = document.getElementById('urlInput').value.trim();
  if(!url){ toast('⚠ ใส่ URL ก่อน'); return; }
  // Reload page with new URL — user must edit source
  toast('⚠ ต้องแก้ค่า APPS_SCRIPT_URL ในโค้ดโดยตรง แล้ว save ไฟล์ใหม่');
}

async function pingURL(){
  const url = document.getElementById('urlInput').value.trim() || APPS_SCRIPT_URL;
  if(!url || url === 'YOUR_APPS_SCRIPT_URL_HERE'){ toast('⚠ ใส่ URL ก่อน'); return; }
  try {
    toast('⟳ กำลัง Ping...');
    const r = await fetch(url + '?action=ping');
    const d = await r.json();
    if(d.ok) toast('✅ Ping สำเร็จ! Sheet พร้อมใช้งาน — ' + d.ts);
    else toast('❌ Ping ไม่สำเร็จ: ' + JSON.stringify(d));
  } catch(e) {
    toast('❌ เชื่อมไม่ได้: ' + e.message);
  }
}
