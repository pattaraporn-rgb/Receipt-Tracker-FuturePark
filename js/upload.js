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
      const origKeys = Object.keys(rows[0]);
      const keys = origKeys.map(k=>k.trim().toLowerCase());
      logLine('info', `📋 พบ columns: ${keys.join(', ')}`);

      // คอลัมน์ที่ไม่ใช่ drive (ที่เหลือถือเป็น drive ในไฟล์แนวนอน)
      const IGNORE = ['store_id','store id','store_name','ชื่อร้านค้า','รวม','total','updated_at'];
      const driveCols = origKeys.filter(k => !IGNORE.includes(k.trim().toLowerCase()));
      const hasName   = keys.includes('store_name') || keys.includes('store_id') || keys.includes('ชื่อร้านค้า');

      if(keys.includes('roboflow_count') || keys.includes('rf_full') || keys.includes('rf_header')){
        uploadRF(rows, log);
      } else if(keys.includes('drive_name')){
        uploadReceipts(rows, log);                 // Template 2 (แนวยาว)
      } else if(hasName && driveCols.length){
        uploadWide(rows, driveCols, log);          // แนวนอน: drive เป็นคอลัมน์
      } else if(hasName){
        uploadStores(rows, log);                   // Template 1 (ชื่อร้านอย่างเดียว)
      } else {
        logLine('err','❌ ไม่รู้จัก template — ตรวจสอบ column headers');
      }
    }catch(err){
      logLine('err','❌ อ่านไฟล์ไม่ได้: '+err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

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
    const nm    = (row['store_name']||row['ชื่อร้านค้า']||'').toString().trim();
    // store_id ว่างได้ ถ้ามีชื่อร้าน (backend จับคู่จากชื่อ/สร้าง pending ให้)
    if((!id&&!nm)||!drive||isNaN(cnt)){logLine('warn',`  ⚠ แถว ${i+2}: ข้ามเพราะข้อมูลไม่ครบ`);return}
    logLine('info',`  ${mode==='add'?'＋':'↺'} ${id||'('+nm+')'} / ${drive}: ${cnt} (${mode})`);
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

// อัพไฟล์ "แนวนอน": store_id?/store_name + คอลัมน์ drive หลายอัน → แตกเป็น 1 แถว/drive
// store_id ว่างได้ (backend จับคู่จากชื่อ/สร้าง pending) · ทุก drive เป็น mode=replace
async function uploadWide(rows, driveCols, log){
  logLine('info','📊 ตรวจพบไฟล์แนวนอน — แตก drive แต่ละคอลัมน์เป็นรายการต่อร้าน');
  logLine('info', `  คอลัมน์ drive: ${driveCols.join(', ')}`);
  const data = [];
  let storeCount = 0;
  rows.forEach((row,i)=>{
    const id = (row['store_id']||row['Store ID']||'').toString().trim();
    const nm = (row['store_name']||row['ชื่อร้านค้า']||'').toString().trim();
    if(!id && !nm) return;                       // แถวว่าง
    let any = false;
    driveCols.forEach(dc=>{
      const raw = row[dc];
      if(raw===''||raw===undefined||raw===null) return;
      const v = parseInt(String(raw).replace(/[, ]/g,''));
      if(isNaN(v)) return;                        // เช่น '-' ข้ามไป
      data.push({store_id:id, store_name:nm, drive_name:String(dc).trim(), receipts:v, mode:'replace'});
      any = true;
    });
    if(any) storeCount++;
    else logLine('warn',`  ⚠ แถว ${i+2}: ${nm||id} ไม่มียอด drive — ข้าม`);
  });

  if(!data.length){ logLine('err','❌ ไม่พบยอด drive ในไฟล์'); return; }
  logLine('info', `  ส่ง ${data.length} แถว (drive) จาก ${storeCount} ร้าน → Sheets...`);
  const res = await postToSheet('upsert_receipts', data);
  if(!res){ logLine('err','❌ บันทึกล้มเหลว'); return; }
  logLine('ok',`✓ ${res.ok} แถวสำเร็จ${res.warn?' ('+res.warn+' คำเตือน)':''}`);
  toast('✓ อัพชีตแนวนอน → Sheets สำเร็จ');
  await fetchFromSheet();
  refresh();
}

async function uploadRF(rows, log){
  logLine('info','🤖 ตรวจพบ Template 3 — อัพ Roboflow (เต็ม/หัว) → Google Sheets (replace ทั้งหมด)');
  const data = [];
  rows.forEach((row,i)=>{
    const id   = (row['store_id']||row['Store ID']||'').toString().trim();
    // รองรับคอลัมน์ใหม่ rf_full / rf_header และของเดิม roboflow_count (→ ใบเสร็จเต็ม)
    const full = parseInt(row['rf_full']||row['roboflow_count']||row['RF']||0);
    const head = parseInt(row['rf_header']||0);
    if(!id){logLine('warn',`  ⚠ แถว ${i+2}: ไม่มี store_id`);return}
    if(isNaN(full)&&isNaN(head)){logLine('warn',`  ⚠ แถว ${i+2}: ตัวเลข RF ไม่ถูกต้อง`);return}
    data.push({store_id:id, rf_full:isNaN(full)?0:full, rf_header:isNaN(head)?0:head});
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
  } else if(type==='wide'){
    data = [
      ['store_id','store_name','drive1','drive2','drive3'],
      ['161959','Katsu Midori',88,'',25],
      ['','ร้านใหม่ไม่มี ID',10,5,''],
      ['','--- store_id ว่างได้ ระบบจับจากชื่อ/สร้าง pending ให้ · ตั้งชื่อคอลัมน์ drive เองได้ ---','','',''],
    ];
    sheetName = 'wide_drives';
  } else {
    data = [
      ['store_id','rf_full','rf_header'],
      ['100033',95,80],
      ['100156',12,10],
      ['100218',27,20],
      ['','',''],
      ['','--- rf_full = ใบเสร็จเต็ม · rf_header = หัวใบเสร็จ · replace ทั้งหมดเสมอ ---',''],
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
// NOTE: the Apps Script backend only supports clearing RF (action 'clear_rf').
// There is no server-side clear for stores/receipts, so those must be cleared in
// the Google Sheet directly — tell the user instead of faking a success toast.
async function clearData(what){
  if(what==='rf' || what==='all'){
    if(!confirm(what==='all'
        ? 'ล้าง RF ทั้งหมดใน Sheet? (ส่วนร้านค้า/ใบเสร็จต้องลบใน Google Sheet เอง)'
        : 'ล้าง RF ทั้งหมดใน Sheet?')) return;
    const res = await postToSheet('clear_rf', []);
    if(res){
      toast('✓ ล้าง RF ใน Sheet แล้ว');
      await fetchFromSheet();
      refresh();
    }
  }
  if(what==='receipts' || what==='all'){
    toast('⚠ ล้างร้านค้า/ใบเสร็จ ต้องลบใน Google Sheet โดยตรง แล้วกด Sync');
  }
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
