// ══════════════════════════════════════════════════════
//  main.js — boot, demo seed, sync — runs initAuth() last
//  (extracted from receipt-tracker-v2.html · behavior unchanged)
// ══════════════════════════════════════════════════════

// ══ SEED DEMO DATA (ถ้ายังไม่มีข้อมูล) ══
function seedIfEmpty(){
  // Always seed demo data into memory (ล้างด้วย reset button ได้)
  if(Object.keys(_cache.stores).length > 0) return;

  const DEMO_STORES = {
    '100218':{ name:'ฮะจิบัง ราเมน', drives:{'drive1_27mar2026':20,'drive3Rocket_03042026':25} },
    '101719':{ name:'S & P Restaurant', drives:{'drive1_27mar2026':33} },
    '104764':{ name:'OOTOYA GOHAN DOKORO', drives:{'drive1_27mar2026':30} },
    '104882':{ name:'MOS BURGER', drives:{'drive2_26mar2026':31} },
    '105259':{ name:'Daiso', drives:{'drive1_27mar2026':32} },
    '106027':{ name:'Sizzler', drives:{'drive2_26mar2026':20,'drive3Rocket_03042026':15} },
    '106557':{ name:'Coffee World', drives:{'drive1_27mar2026':40,'drive2_26mar2026':22} },
    '108309':{ name:'AFTER YOU', drives:{'drive1_27mar2026':60,'drive2_26mar2026':45} },
    '108836':{ name:'Santa Fe Steak', drives:{'drive3Rocket_03042026':38} },
    '109469':{ name:'DAIRY QUEEN', drives:{'drive2_26mar2026':56} },
    '110399':{ name:'STARBUCKS COFFEE', drives:{'drive1_27mar2026':55,'drive4Rocket_17042026':51} },
    '111072':{ name:'ชาตรามือ', drives:{'drive3Rocket_03042026':66} },
    '111380':{ name:'Tokyo sweet', drives:{'drive2_26mar2026':81} },
    '159498':{ name:'BIG C', drives:{'drive5Rocket_05052026':12} },
    '159581':{ name:'Watson', drives:{'drive1_27mar2026':50,'drive3Rocket_03042026':44} },
    '159592':{ name:'MK Buffet', drives:{'drive2_26mar2026':50,'drive3Rocket_03042026':36} },
    '160014':{ name:'Dr.PONG', drives:{'drive4Rocket_17042026':8} },  // RF > total case
    '161329':{ name:'Nitori', drives:{'drive5Rocket_05052026':55} },
    '161895':{ name:'KKV', drives:{'drive4Rocket_17042026':42} },
    '162014':{ name:'One to two coffee', drives:{'drive3Rocket_03042026':49} },
    '162095':{ name:'Moyu Meow', drives:{'drive4Rocket_17042026':73} },
    '162238':{ name:'กาแฟพันธุ์ไทย', drives:{'drive1_27mar2026':30,'drive5Rocket_05052026':17} },
    '162340':{ name:'Yamazaki', drives:{'drive3Rocket_03042026':53} },
    '162294':{ name:'Yowo hotpot', drives:{'drive4Rocket_17042026':59} },
    'pending_001':{ name:'425DEGREE PLZ.2.KIO040B', drives:{'drive4Rocket_17042026':10} },
    'pending_002':{ name:'ขนมไทยเก้าพี่น้อง PLZ.B.KIO019', drives:{'drive4Rocket_17042026':8} },
    'pending_003':{ name:'ซูกิชิ บาร์บีคิว PLZ.B.SHP006', drives:{'drive5Rocket_05052026':17} },
    '162662_dup':{ name:'Coffee World', drives:{'drive5Rocket_05052026':9} }, // intentional dup
  };

  const DEMO_RF = {
    '100218':27,'101719':29,'104764':1,'104882':3,'105259':5,
    '106027':30,'106557':51,'108309':83,'108836':33,'109469':39,
    '110399':49,'111072':56,'111380':77,'159498':0,'159581':54,
    '159592':41,'160014':51, // RF=51 > Total=8 → system fixes
    '161329':6,'161895':29,'162014':24,'162095':3,'162238':28,
    '162340':33,'162294':21,
  };

  saveStores(DEMO_STORES);
  // demo RF in the new 2-class shape (header ≈ 70% of full, just for illustration)
  const demoRf = {};
  Object.entries(DEMO_RF).forEach(([id,n])=>{ demoRf[id] = { full:n, header:Math.round(n*0.7) }; });
  saveRF(demoRf);
}

// ══ BOOT ══
async function boot(){
  const pill = document.getElementById('storagePill');
  const lbl  = document.getElementById('storageLabel');

  if(!isConfigured()){
    lbl.textContent = 'ยังไม่เชื่อม Sheets';
    pill.style.background = 'rgba(248,113,113,.08)';
    pill.style.borderColor = 'rgba(248,113,113,.25)';
    lbl.style.color = 'var(--red)';
    document.querySelector('.live-dot').style.background = 'var(--red)';
    const banner = document.getElementById('sandboxBanner');
    banner.style.display = 'flex';
    banner.innerHTML = '<span>⚠</span><span>ยังไม่ได้เชื่อม Google Sheets — ไปที่แท็บ <strong>อัพโหลด</strong> แล้วใส่ Apps Script URL | ตอนนี้แสดง Demo data</span>';
    seedIfEmpty();
    refresh();
    return;
  }

  lbl.textContent = 'Google Sheets ●';
  pill.style.background = 'rgba(52,211,153,.08)';
  pill.style.borderColor = 'rgba(52,211,153,.2)';

  const ok = await fetchFromSheet();
  if(!ok) seedIfEmpty();
  refresh();
}

(function initAuth(){
  const stored = sessionStorage.getItem('auth');
  if(stored){
    try{
      const user = JSON.parse(stored);
      if(isAllowed(user.email)){ applyAuth(user); boot(); return; }
    }catch(e){}
  }
})();
