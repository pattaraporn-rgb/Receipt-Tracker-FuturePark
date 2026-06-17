// ══════════════════════════════════════════════════════
//  render.js — dashboard + duplicate page rendering, toast, csv export
//  (extracted from receipt-tracker-v2.html · behavior unchanged)
// ══════════════════════════════════════════════════════

// ══ UTIL ══
// escape user-derived strings before injecting into innerHTML (prevents HTML injection)
function esc(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ══ UI ══
function showPage(p, btn){
  if(p === 'upload' && !_uploadUnlocked){
    _pendingUploadBtn = btn;
    showPinModal();
    return;
  }
  document.querySelectorAll('.page').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+p).classList.add('active');
  btn.classList.add('active');
  if(p==='dup') renderDupPage();
}

function applyQ(key, btn){
  activeQ = key;
  document.querySelectorAll('.q-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  const q = QUERIES[key];
  const sq = document.getElementById('searchInp').value.toLowerCase();
  const all = computeStores();
  filtered = all.filter(s=> q.fn(s) && (!sq || s.name.toLowerCase().includes(sq) || String(s.id).includes(sq)));
  document.getElementById('result-title').textContent = q.title;
  document.getElementById('result-desc').textContent  = q.desc;
  resort();
  renderMiniList();
}

function applyCustom(){
  const field = document.getElementById('cf-field').value;
  const op    = document.getElementById('cf-op').value;
  const val   = parseFloat(document.getElementById('cf-val').value);
  const ops   = {'>':'>','>=':'>=','<':'<','<=':'<=','=':'==='};
  const fns   = {'>':v=>v>val,'>=':v=>v>=val,'<':v=>v<val,'<=':v=>v<=val,'=':v=>v===val};
  document.querySelectorAll('.q-btn').forEach(b=>b.classList.remove('active'));
  activeQ = 'custom';
  const sq = document.getElementById('searchInp').value.toLowerCase();
  const labels = {total:'Total',rf:'RF อัพแล้ว',pending:'Pending',pct:'RF %'};
  const opLbl  = {'>':'>','>=':'≥','<':'<','<=':'≤','=':'='};
  filtered = computeStores().filter(s=>fns[op](s[field])&&(!sq||s.name.toLowerCase().includes(sq)||String(s.id).includes(sq)));
  document.getElementById('result-title').textContent = `${labels[field]} ${opLbl[op]} ${val}`;
  document.getElementById('result-desc').textContent  = 'กรองแบบกำหนดเอง';
  resort();
  renderMiniList();
}

// re-apply the active view (preset query OR custom filter) without crashing on 'custom'
function reapply(){
  if(activeQ==='custom') applyCustom();
  else applyQ(activeQ, document.getElementById('q-'+activeQ)||null);
}

function onSearch(){ reapply(); }

function resort(){
  const k = document.getElementById('sortSel').value;
  if(k==='name') filtered.sort((a,b)=>a.name.localeCompare(b.name,'th'));
  else filtered.sort((a,b)=>b[k]-a[k]);
  renderTable();
  updateStats();
}

// ══ GLOBAL STATS ══
function updateGlobal(){
  const all  = computeStores();
  const dups = findDuplicates();
  const tot  = all.reduce((a,s)=>a+s.total,0);
  const rf   = all.reduce((a,s)=>a+s.rf,0);
  const pend = all.reduce((a,s)=>a+s.pending,0);
  const pct  = tot>0 ? Math.round(rf/tot*100) : 0;
  const driveSet = new Set();
  const stores = loadStores();
  Object.values(stores).forEach(s=>Object.keys(s.drives||{}).forEach(d=>driveSet.add(d)));

  document.getElementById('g-stores').textContent = all.length.toLocaleString();
  document.getElementById('g-drives-sub').textContent = `${driveSet.size} drive${driveSet.size!==1?'s':''}`;
  document.getElementById('g-total').textContent   = tot.toLocaleString();
  document.getElementById('g-rf').textContent      = rf.toLocaleString();
  document.getElementById('g-rf-sub').textContent  = `${pct}% ของทั้งหมด`;
  document.getElementById('g-pending').textContent = pend.toLocaleString();
  document.getElementById('g-pending-sub').textContent = `เหลือ ${100-pct}%`;

  setTimeout(()=>{
    const el = document.getElementById('rf-fill');
    el.style.width = pct+'%';
    el.textContent = rf.toLocaleString()+' ใบ';
    document.getElementById('rf-pct').textContent = pct+'%';
  }, 200);

  // preset badges
  const allS = computeStores();
  Object.keys(QUERIES).forEach(k=>{
    const el = document.getElementById('qb-'+k);
    if(el) el.textContent = allS.filter(QUERIES[k].fn).length;
  });

  // dup badge
  const db = document.getElementById('dup-count-badge');
  if(dups.length>0){db.style.display='inline';db.textContent=dups.length}
  else db.style.display='none';
}

function updateStats(){
  document.getElementById('r-stores').textContent  = filtered.length.toLocaleString();
  document.getElementById('r-pending').textContent = filtered.reduce((a,s)=>a+s.pending,0).toLocaleString();
}

// ══ MINI LIST ══
function renderMiniList(){
  const wrap = document.getElementById('miniList');
  if(!filtered.length){wrap.innerHTML='<div style="text-align:center;padding:20px;color:var(--t3);font-size:11px;font-family:var(--mono)">ไม่พบ</div>';return}
  wrap.innerHTML = filtered.map(s=>{
    const dc = s.pending===0?'var(--green)':s.priority>70?'var(--red)':s.priority>35?'var(--yellow)':'var(--t3)';
    return `<div class="mini-item ${expandedId===s.id?'active':''}" onclick="scrollToStore('${s.id}')">
      <div class="mini-dot" style="background:${dc}"></div>
      <div class="mini-name">${esc(s.name)}</div>
      <div class="mini-num">${s.total}</div>
    </div>`;
  }).join('');
}

function scrollToStore(id){
  const row = document.getElementById('tr-'+id);
  if(row){row.scrollIntoView({behavior:'smooth',block:'center'});row.click()}
}

// ══ TABLE ══
function renderTable(){
  const tbody = document.getElementById('tbody');
  const dups  = findDuplicates();
  const dupKeys  = new Set(dups.map(d=>normName(d.name)));
  const stores   = loadStores();

  if(!filtered.length){
    tbody.innerHTML=`<tr><td colspan="8">
      <div class="empty">
        <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <h3>ไม่พบข้อมูล</h3><p>ลองเปลี่ยนเงื่อนไข</p>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((s,i)=>{
    const pct = s.pct;
    const bc  = pct===100?'var(--green)':pct>50?'var(--blue)':pct>0?'var(--yellow)':'var(--red)';
    const dc  = s.pending===0?'var(--green)':s.priority>70?'var(--red)':s.priority>35?'var(--yellow)':'var(--t3)';
    const pc  = s.pending===0?'done':s.priority>70?'high':s.priority>35?'mid':'low';
    const pl  = s.pending===0?'✓ Done':s.priority>70?'🔴 สูง':s.priority>35?'🟡 กลาง':'🟢 ต่ำ';
    const isDup= dupKeys.has(normName(s.name));
    const drvKeys = Object.keys(s.drives||{});

    // drive detail cards
    const driveCards = drvKeys.map(dn=>{
      const t  = s.drives[dn]||0;
      const rfD= s.rf; // simplified: RF per drive not tracked separately
      const dp = t>0?Math.round(Math.min(s.rf,t)/t*100):0;
      const dbc= dp===100?'var(--green)':dp>50?'var(--blue)':dp>0?'var(--yellow)':'var(--red)';
      const ds = dp===100?{t:'✓ ครบแล้ว',c:'var(--green)'}:dp>0?{t:`~${t-Math.round(t*dp/100)} คงเหลือ`,c:'var(--yellow)'}:{t:'ยังไม่อัพเลย',c:'var(--red)'};
      return `<div class="drive-card">
        <div class="dc-head"><div class="dc-icon">🗂</div><div class="dc-name">${esc(dn)}</div></div>
        <div class="dc-nums">
          <div class="dc-total">${t.toLocaleString()}<span style="font-size:11px;color:var(--t2);font-weight:400"> ใบ</span></div>
          <div class="dc-rf-wrap"><div class="dc-rf-num" style="color:${dbc}">${s.rf}</div><div class="dc-rf-lbl">RF รวม</div></div>
        </div>
        <div class="dc-bar"><div class="dc-fill" style="width:${dp}%;background:${dbc}"></div></div>
        <div class="dc-status" style="color:${ds.c}">${ds.t}</div>
      </div>`;
    }).join('');

    return `
    <tr id="tr-${s.id}" class="${expandedId===s.id?'expanded':''}" onclick="toggleRow('${s.id}')">
      <td style="color:var(--t3);font-family:var(--mono);font-size:10px">${i+1}</td>
      <td>
        <div class="sc-wrap">
          <div class="sc-dot" style="background:${dc}"></div>
          <div class="sc-info">
            <div class="sc-name">
              ${esc(s.name)} <span class="chevron">›</span>
              ${isDup?'<span class="dup-warn">⚠ ซ้ำ</span>':''}
              ${s.isPending?'<span class="pending-tag">pending ID</span>':''}
            </div>
            <div class="sc-id">${esc(s.id)} · ${drvKeys.length} drive${drvKeys.length!==1?'s':''}</div>
          </div>
        </div>
      </td>
      <td class="r">
        <div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:flex-end">
          ${drvKeys.map(d=>`<span style="font-size:9px;font-family:var(--mono);padding:2px 5px;border-radius:3px;background:var(--s3);border:1px solid var(--b1);color:var(--t2)">${esc(d)}</span>`).join('')}
        </div>
      </td>
      <td class="r"><span class="num total">${s.total.toLocaleString()}</span></td>
      <td class="r"><span class="num g">${s.rf.toLocaleString()}</span></td>
      <td class="r"><span class="num ${s.pending>0?'y':'d'}">${s.pending.toLocaleString()}</span></td>
      <td class="r">
        <div class="rf-bar-cell">
          <div class="rf-track-sm"><div class="rf-fill-sm" style="width:${pct}%;background:${bc}"></div></div>
          <span class="rf-pct-sm">${pct}%</span>
        </div>
      </td>
      <td class="r"><span class="pri ${pc}">${pl}</span></td>
    </tr>
    <tr id="exp-${s.id}" class="exp-row ${expandedId===s.id?'open':''}">
      <td colspan="8">
        <div class="exp-inner">
          <div class="drive-grid">${driveCards||'<div style="padding:12px;color:var(--t3);font-size:11px;font-family:var(--mono)">ไม่มีข้อมูล drive</div>'}</div>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function toggleRow(id){
  expandedId = expandedId===id ? null : id;
  renderTable();
  renderMiniList();
}

// ══ DUPLICATE PAGE ══
function renderDupPage(){
  const dups = findDuplicates();
  const stores = loadStores();
  const el = document.getElementById('dupList');
  if(!dups.length){
    el.innerHTML='<div class="no-dup">✓ ไม่พบชื่อร้านซ้ำ</div>';
    return;
  }
  el.innerHTML = dups.map(d=>`
    <div class="dup-item">
      <span class="dup-badge">DUPLICATE</span>
      <div>
        <div class="dup-name">${esc(d.name)}</div>
        <div class="dup-ids">IDs: ${d.ids.map(id=>`${esc(id)} (${esc(stores[id]?.name||'?')})`).join(' / ')}</div>
      </div>
      <div class="dup-actions">
        ${d.ids.slice(1).map(rid=>`
          <button class="dup-act-btn" onclick="requirePin(()=>mergeDup('${d.ids[0]}','${rid}'))">Merge ${esc(rid)} → ${esc(d.ids[0])}</button>
          <button class="dup-act-btn danger" onclick="requirePin(()=>deleteDup('${rid}'))">ลบ ${esc(rid)}</button>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function mergeDup(keepId, removeId){
  const stores = loadStores();
  const rf     = loadRF();
  const keep   = stores[keepId];
  const rem    = stores[removeId];
  if(!keep||!rem){toast('❌ ไม่พบ store');return}
  // merge drives
  Object.entries(rem.drives||{}).forEach(([d,c])=>{
    keep.drives[d] = (keep.drives[d]||0) + c;
  });
  // merge rf (take max)
  if(rf[removeId]!==undefined){
    rf[keepId] = Math.max(rf[keepId]||0, rf[removeId]);
    delete rf[removeId];
  }
  delete stores[removeId];
  saveStores(stores);
  saveRF(rf);
  toast(`✓ Merge แล้ว — ลบ ${removeId} รวมเข้า ${keepId}`);
  refresh();
}

function deleteDup(id){
  const stores = loadStores();
  const rf = loadRF();
  delete stores[id];
  delete rf[id];
  saveStores(stores); saveRF(rf);
  toast(`✓ ลบ ${id} แล้ว`);
  refresh();
}

// ══ EXPORT CSV ══
function exportCSV(){
  const rows=[['#','Store ID','ชื่อร้านค้า','Drives','Total','RF_อัพแล้ว','Pending','RF_%','Priority','is_pending_id']];
  filtered.forEach((s,i)=>{
    rows.push([i+1,s.id,s.name,Object.keys(s.drives).join('|'),s.total,s.rf,s.pending,s.pct+'%',s.priority,s.isPending?'YES':'']);
  });
  const csv = rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
  a.download= `receipt_export_${activeQ}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  toast('⬇ Export CSV สำเร็จ');
}

// ══ TOAST ══
function toast(msg){
  const el = document.createElement('div');
  el.className='toast';
  const isOk = msg.startsWith('✓');
  el.style.color = isOk?'var(--green)':msg.startsWith('❌')?'var(--red)':'var(--yellow)';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}

// ══ REFRESH ALL ══
function refresh(){
  updateGlobal();
  reapply();
}
