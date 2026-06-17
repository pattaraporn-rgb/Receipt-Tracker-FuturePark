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
    const rfCount= rf[id] !== undefined ? rf[id] : 0;
    // fix: if rf > total (Dr.PONG case), total = rf
    const adjTotal = Math.max(total, rfCount);
    const pending  = adjTotal - rfCount;
    const pct      = adjTotal > 0 ? Math.round(rfCount/adjTotal*100) : 0;
    const priority = adjTotal === 0 ? 0 : Math.round(((pending/adjTotal)*.6 + (Math.min(pending,200)/200)*.4)*100);
    const isPending = id.startsWith('pending_');
    return { id, name: s.name||'(ไม่มีชื่อ)', drives, total:adjTotal, rf:rfCount, pending, pct, priority, isPending };
  });
}

// ══ DUPLICATE DETECTION ══
function findDuplicates(){
  const stores = loadStores();
  const nameMap = {};
  Object.entries(stores).forEach(([id,s])=>{
    const n = (s.name||'').toLowerCase().trim();
    if(!nameMap[n]) nameMap[n]=[];
    nameMap[n].push(id);
  });
  return Object.entries(nameMap).filter(([,ids])=>ids.length>1).map(([name,ids])=>({name,ids}));
}

// ══ STATE ══
let filtered = [];
let activeQ = 'all';
let expandedId = null;

const QUERIES = {
  all:        { fn:()=>true,                       title:'ร้านค้าทั้งหมด',          desc:'แสดงทุกร้านค้าในระบบ' },
  gap:        { fn:s=>s.total>29&&s.rf<30,         title:'Total > 30 และ RF < 29',  desc:'ร้านที่มีใบเสร็จมาก แต่อัพ RF น้อย' },
  rf30:       { fn:s=>s.rf>29,                     title:'Roboflow > 30 ใบ',        desc:'ร้านที่อัพ Roboflow ไปแล้วมากกว่า 30 ใบ' },
  zero:       { fn:s=>s.rf===0&&s.total>0,         title:'ยังไม่อัพ RF เลย',        desc:'ร้านที่ยังไม่ได้เริ่มอัพขึ้น Roboflow' },
  done:       { fn:s=>s.pending===0&&s.total>0,    title:'อัพ RF ครบ 100%',         desc:'ร้านที่อัพ Roboflow ครบแล้ว' },
  high:       { fn:s=>s.priority>70&&s.pending>0,  title:'Priority สูง — ต้องรีบอัพ',desc:'มีใบเสร็จเยอะ แต่ยังไม่อัพ RF' },
  'pending-id':{ fn:s=>s.isPending,               title:'ยังไม่มี Store ID',        desc:'ร้านที่ได้ pending_ ID ชั่วคราว' },
};
