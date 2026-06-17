// ══════════════════════════════════════════════════════
//  state.js — compute merged stores, duplicate detection, query defs
//  (extracted from receipt-tracker-v2.html · behavior unchanged)
// ══════════════════════════════════════════════════════

// ══ COMPUTE merged store list ══
function computeStores(){
  const stores = loadStores();
  const rf     = loadRF();
  return Object.entries(stores).map(([id, s])=>{
    const drives = s.drives || {};
    const total  = Object.values(drives).reduce((a,v)=>a+(v||0),0);
    // RF per class — accept new {full,header} shape, fall back to legacy single number
    const raw = rf[id];
    let rfFull = 0, rfHeader = 0;
    if(raw && typeof raw === 'object'){ rfFull = raw.full||0; rfHeader = raw.header||0; }
    else if(typeof raw === 'number'){ rfFull = raw; rfHeader = 0; }
    // each class is compared against the total receipts (M); a class can't exceed it
    const adjTotal = Math.max(total, rfFull, rfHeader);
    const pctFull       = adjTotal>0 ? Math.round(Math.min(rfFull,adjTotal)/adjTotal*100) : 0;
    const pctHeader     = adjTotal>0 ? Math.round(Math.min(rfHeader,adjTotal)/adjTotal*100) : 0;
    const pendingFull   = Math.max(0, adjTotal - rfFull);
    const pendingHeader = Math.max(0, adjTotal - rfHeader);
    // combined roll-ups (keep rf/pct/pending names so existing sort/filter/export keep working)
    const rfTotal  = rfFull + rfHeader;
    const pending  = pendingFull + pendingHeader;
    const pct      = adjTotal>0 ? Math.round((Math.min(rfFull,adjTotal)+Math.min(rfHeader,adjTotal))/(2*adjTotal)*100) : 0;
    const priority = adjTotal===0 ? 0 : Math.round(((pending/(2*adjTotal))*.6 + (Math.min(pending,400)/400)*.4)*100);
    const isPending = id.startsWith('pending_');
    return { id, name: s.name||'(ไม่มีชื่อ)', drives, total:adjTotal,
             rfFull, rfHeader, pctFull, pctHeader, pendingFull, pendingHeader,
             rf:rfTotal, pct, pending, priority, isPending };
  });
}

// ══ DUPLICATE DETECTION ══
// normalize a store name for matching: drop case, spaces and - _ . , / punctuation
// so variants like "mr diy" / "MR-DIY" / "Mr.DIY" collapse to the same key
function normName(s){ return (s||'').toString().toLowerCase().replace(/[\s\-_.,/]+/g,''); }

function findDuplicates(){
  const stores = loadStores();
  const map = {};
  Object.entries(stores).forEach(([id,s])=>{
    const key = normName(s.name);
    if(!key) return;                       // skip blank names
    (map[key] = map[key] || { name: s.name, ids: [] }).ids.push(id);
  });
  return Object.values(map).filter(g=>g.ids.length>1);
}

// ══ STATE ══
let filtered = [];
let activeQ = 'all';
let expandedId = null;

const QUERIES = {
  all:        { fn:()=>true,                                    title:'ร้านค้าทั้งหมด',            desc:'แสดงทุกร้านค้าในระบบ' },
  gap:        { fn:s=>s.total>29&&(s.rfFull<30||s.rfHeader<30), title:'Total > 30 แต่ RF ยังไม่ครบ',desc:'ใบเสร็จเยอะ แต่ class เต็มหรือหัวยังตามไม่ทัน' },
  rf30:       { fn:s=>s.rfFull>29||s.rfHeader>29,               title:'Roboflow > 30 ใบ',          desc:'ร้านที่อัพ RF (เต็มหรือหัว) เกิน 30 ใบ' },
  zero:       { fn:s=>s.rfFull===0&&s.rfHeader===0&&s.total>0,  title:'ยังไม่อัพ RF เลย',          desc:'ยังไม่ได้อัพทั้งเต็มและหัว' },
  done:       { fn:s=>s.pendingFull===0&&s.pendingHeader===0&&s.total>0, title:'อัพ RF ครบ 100%',    desc:'ครบทั้งใบเสร็จเต็มและหัวใบเสร็จ' },
  high:       { fn:s=>s.priority>70&&s.pending>0,               title:'Priority สูง — ต้องรีบอัพ',  desc:'มีใบเสร็จเยอะ แต่ RF ยังเหลือเยอะ' },
  'pending-id':{ fn:s=>s.isPending,                            title:'ยังไม่มี Store ID',          desc:'ร้านที่ได้ pending_ ID ชั่วคราว' },
};
