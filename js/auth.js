// ══════════════════════════════════════════════════════
//  auth.js — Google login + PIN gate + help modal
//  (extracted from receipt-tracker-v2.html · behavior unchanged)
// ══════════════════════════════════════════════════════

// ══ AUTH ══
const ALLOWED_DOMAIN = 'rocket.in.th';
function isAllowed(email){ return typeof email === 'string' && email.endsWith('@' + ALLOWED_DOMAIN); }

function parseJwt(token){
  try{
    const b64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(atob(b64));
  }catch(e){return null}
}

function showLoginErr(msg){
  const el = document.getElementById('loginErr');
  el.textContent = msg;
  el.style.display = 'block';
}

function handleGoogleLogin(response){
  const payload = parseJwt(response.credential);
  if(!payload){ showLoginErr('ไม่สามารถอ่านข้อมูลผู้ใช้ได้'); return; }
  const email = payload.email || '';
  if(!isAllowed(email)){
    showLoginErr('❌ ' + email + ' ไม่มีสิทธิ์เข้าใช้งาน (ต้องใช้ @rocket.in.th)');
    return;
  }
  const user = {email, name: payload.name||'', picture: payload.picture||''};
  sessionStorage.setItem('auth', JSON.stringify(user));
  applyAuth(user);
  boot();
}

function applyAuth(user){
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('userEmail').textContent = user.email;
  if(user.picture){
    document.getElementById('userAvatar').src = user.picture;
    document.getElementById('userChip').style.display = 'flex';
  } else {
    document.getElementById('userChip').style.display = 'none';
  }
  document.getElementById('signoutBtn').style.display = 'block';
}

function signOut(){
  sessionStorage.removeItem('auth');
  location.reload();
}

// ══ PIN GATE ══
let _uploadUnlocked = false;
let _pendingUploadBtn = null;
let _pinCallback = null;

function showPinModal(){
  const m = document.getElementById('pinModal');
  document.querySelectorAll('.pin-box').forEach(b=>b.value='');
  document.getElementById('pinError').classList.remove('show');
  document.getElementById('pinInputs').classList.remove('shake');
  m.classList.add('show');
  setTimeout(()=>document.getElementById('pin0').focus(),50);
}

function hidePinModal(){
  document.getElementById('pinModal').classList.remove('show');
  _pinCallback = null;
}

function requirePin(fn){
  _pinCallback = fn;
  showPinModal();
}

function checkPin(){
  const pin = [0,1,2,3].map(i=>document.getElementById('pin'+i).value).join('');
  if(pin === '9944'){
    hidePinModal();
    if(_pinCallback){
      const cb = _pinCallback;
      _pinCallback = null;
      cb();
    } else {
      _uploadUnlocked = true;
      showPage('upload', _pendingUploadBtn);
    }
  } else {
    const inp = document.getElementById('pinInputs');
    inp.classList.remove('shake');
    void inp.offsetWidth;
    inp.classList.add('shake');
    document.getElementById('pinError').classList.add('show');
    document.querySelectorAll('.pin-box').forEach(b=>b.value='');
    setTimeout(()=>document.getElementById('pin0').focus(),50);
  }
}

function openHelp(){
  document.getElementById('helpOverlay').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeHelp(){
  document.getElementById('helpOverlay').classList.remove('open');
  document.body.style.overflow='';
}
function closeOnBg(e){
  if(e.target===document.getElementById('helpOverlay')) closeHelp();
}
function hmTab(id,btn){
  document.querySelectorAll('.hm-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.hm-tab').forEach(b=>b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
}
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeHelp(); });

function onPinInput(el, idx){
  el.value = el.value.replace(/[^0-9]/g,'').slice(-1);
  if(el.value && idx < 3){
    document.getElementById('pin'+(idx+1)).focus();
  }
  if(idx === 3 && el.value){
    setTimeout(checkPin, 60);
  }
}

function onPinKey(e, idx){
  if(e.key === 'Backspace' && !e.target.value && idx > 0){
    document.getElementById('pin'+(idx-1)).focus();
  }
  if(e.key === 'Enter') checkPin();
}
