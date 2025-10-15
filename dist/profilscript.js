
(async function(){ try{
  // ===== helpers, die dein Code unten erwartet =====
const APP_HOME = '/rezepte';
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));

/** Warten bis Objekte da sind (robust, ~12s Timeout) */
function waitFor(check, { tries = 240, delay = 50 } = {}) {
  return new Promise(res => {
    let n = 0;
    (function loop(){
      const v = check();
      if (v !== null && v !== undefined) return res(v);
      if (++n >= tries) return res(null);
      setTimeout(loop, delay);
    })();
  });
}

/** Memberstack v1/v2 sicher greifen (DOM/$memberstackDom) */
async function getMS(){
  return await waitFor(() => {
    const ms1 = window.$memberstackDom;
    const ms2 = window.Memberstack?.DOM || window.Memberstack;
    const ms  = ms1 || ms2 || null;
    if (!ms) return null;
    // nur „echte" Instanzen zurückgeben
    if (ms.getCurrentMember || ms?.memberstack?.getCurrentMember) return ms;
    return null;
  }, { tries: 240, delay: 50 });
}

/** Supabase-CLIENT sicherstellen (existierend nutzen oder neu bauen) */
async function getSB(){
  return await waitFor(() => {
    // a) bereits erzeugter Client?
    const ready = window.supabaseClient || window._supabase || window.SUPABASE || window.sb || null;
    if (ready?.from && ready?.storage) return ready;

    // b) manchmal liegt der Client direkt unter window.supabase
    if (window.supabase?.from && window.supabase?.storage) return window.supabase;

    // c) sonst aus Namespace bauen (URL/Key aus Meta, data-Attr oder globalen Variablen)
    const ns  = window.supabase;
    const metaUrl = document.querySelector('meta[name="supabase-url"]')?.content;
    const metaKey = document.querySelector('meta[name="supabase-key"]')?.content;
    const dsEl    = document.querySelector('[data-sb-url][data-sb-key]') || document.body;
    const url = window.SUPABASE_URL || dsEl?.dataset?.sbUrl || metaUrl || null;
    const key = window.SUPABASE_ANON_KEY || dsEl?.dataset?.sbKey || metaKey || null;

    if (ns?.createClient && url && key){
      try{
        const client = ns.createClient(url, key);
        window.supabaseClient = client; // einheitlich global ablegen
        return client;
      }catch(e){ console.warn('[SB] createClient failed', e); }
    }
    return null;
  }, { tries: 240, delay: 50 });
}

/** Normalisierte Member-Daten (funktioniert mit MS v1/v2) */
async function getMemberNormalized(ms){
  try{
    const getter = ms?.getCurrentMember || ms?.memberstack?.getCurrentMember;
    const res    = getter ? await getter() : null;
    const data   = res?.data || res || {};
    const member = data.member || data || {};
    return {
      id: member.id || data.id || null,
      cf: member.customFields || data.customFields || {}
    };
  }catch(err){
    console.warn('[MS] getMemberNormalized failed', err);
    return { id:null, cf:{} };
  }
}


  // NEU: Bild-Fallback (gegen weiße Kacheln)
  function wireImgFallback(img){
    if(!img) return; img.loading = 'lazy'; img.decoding='async';
    let retried=false;
    img.onerror=()=>{
      if(retried){ img.src='https://via.placeholder.com/900x900.png?text=Doggo'; return; }
      retried=true;
      try{ const u=new URL(img.src, location.origin); u.searchParams.set('v', Date.now()); img.src=u.toString(); }
      catch(_){ img.src = img.src + ((img.src||'').includes('?')?'&':'?') + 'v='+Date.now(); }
    };
  }

  // NEU: kleine Cache-Helfer (Profil-Posts)
  const CACHE_TTL_MS = 90*1000;
  function cacheKey(uid){ return `DM_POSTS_CACHE:${uid}`; }
  function getCachedPosts(uid){
    try{
      const raw=sessionStorage.getItem(cacheKey(uid)); if(!raw) return null;
      const {ts,items}=JSON.parse(raw); if(!Array.isArray(items)) return null;
      if(Date.now()-ts > CACHE_TTL_MS) return null;
      return items;
    }catch(_){ return null; }
  }
  function setCachedPosts(uid, items){
    try{ sessionStorage.setItem(cacheKey(uid), JSON.stringify({ts:Date.now(), items:items||[]})); }catch(_){}
  }
  function clearCachedPosts(uid){
    try{ sessionStorage.removeItem(cacheKey(uid)); }catch(_){}
  }
  // NEU: Cache-Helfer (Profil-Galerie)
const GALLERY_CACHE_TTL_MS = 90*1000;
function galleryKey(uid){ return `DM_GALLERY_CACHE:${uid}`; }
function getCachedGallery(uid){
  try{
    const raw = sessionStorage.getItem(galleryKey(uid));
    if(!raw) return null;
    const { ts, items } = JSON.parse(raw);
    if(!Array.isArray(items)) return null;
    if(Date.now() - ts > GALLERY_CACHE_TTL_MS) return null;
    return items;
  }catch(_){ return null; }
}
function setCachedGallery(uid, items){
  try{ sessionStorage.setItem(galleryKey(uid), JSON.stringify({ ts:Date.now(), items:items||[] })); }catch(_){}
}
function clearCachedGallery(uid){
  try{ sessionStorage.removeItem(galleryKey(uid)); }catch(_){}
}

  function showDoggoSnackbar(msg){
    alert(msg); // Fallback wenn kein Snackbar vorhanden
  }

  function ageFrom(s){ if(!s) return {label:'–'}; const d=new Date(s), n=new Date(); let m=(n.getFullYear()-d.getFullYear())*12+(n.getMonth()-d.getMonth()); if(n.getDate()<d.getDate()) m--; return m<24?{label:`${m} Mon.`}:{label:`${Math.floor(m/12)} J.`}; }
  function fmtDateDE(s){ if(!s) return '–'; const d=new Date(s); if(isNaN(d)) return '–'; const dd=String(d.getDate()).padStart(2,'0'); const mm=String(d.getMonth()+1).padStart(2,'0'); return `${dd}.${mm}.${d.getFullYear()}`; }
  function setPrivacy(isOwner){ $$('.dm2-private').forEach(el=>el.classList.toggle('hidden', !isOwner)); }
  // Gleicher Compressor wie im HDM
  window.compressImage = async function(file, {
    maxW = 1600, maxH = 1600,
    targetBytes = 600 * 1024,   // Ziel 400–600 KB
    qualityMin = 0.5, qualityMax = 0.9,
    minW = 900, minH = 900,
    mimePreferred = 'image/webp'
  } = {}) {
    let src;
    try { src = await createImageBitmap(file); }
    catch {
      src = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
        img.src = url;
      });
    }
    const ratio = Math.min(1, maxW/src.width, maxH/src.height);
    const baseW = Math.max(1, Math.round(src.width*ratio));
    const baseH = Math.max(1, Math.round(src.height*ratio));

    const canvas = document.createElement('canvas');
    function draw(w,h){
      canvas.width=w; canvas.height=h;
      const ctx = canvas.getContext('2d',{alpha:false});
      ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h);
      ctx.drawImage(src,0,0,w,h);
    }
    async function encode(type,q){
      const blob = await new Promise(res=>canvas.toBlob(res, type, q));
      if (!blob) return null; if (type && blob.type && blob.type!==type) return null; return blob;
    }
    const supportsWebP = (()=>{ try{ return canvas.toDataURL('image/webp').startsWith('data:image/webp'); }catch{ return false; } })();
    const encoders=[]; if (mimePreferred==='image/webp' && supportsWebP) encoders.push('image/webp'); encoders.push('image/jpeg');
    const nameWith = (name,type)=> name.replace(/\.(heic|heif|png|jpe?g|webp|avif)$/i,'') + (type==='image/webp'?'.webp':'.jpg');

    draw(baseW, baseH);
    for (const type of encoders){
      let lo=qualityMin, hi=qualityMax, best=null;
      for(let i=0;i<8;i++){
        const q=(lo+hi)/2, b=await encode(type,q);
        if(!b){ best=null; break; }
        if(b.size<=targetBytes){ best=b; lo=q; } else { hi=q; }
      }
      if(best) return new File([best], nameWith(file.name,type), { type });

      let w=baseW,h=baseH;
      for(let s=0;s<6 && (w>minW||h>minH); s++){
        w=Math.max(minW,Math.round(w*0.85)); h=Math.max(minH,Math.round(h*0.85));
        draw(w,h);
        let lo2=qualityMin, hi2=qualityMax, best2=null;
        for(let j=0;j<6;j++){
          const q=(lo2+hi2)/2, b=await encode(type,q);
          if(!b){ best2=null; break; }
          if(b.size<=targetBytes){ best2=b; lo2=q; } else { hi2=q; }
        }
        if(best2) return new File([best2], nameWith(file.name,type), { type });
      }
      const last = await encode(type, qualityMin);
      if (last && last.size < file.size * 0.95) return new File([last], nameWith(file.name,type), { type });
      draw(baseW, baseH);
    }
    return null;
  };


// Warten bis alle nötigen Knoten vorhanden sind
const _need=['dm2Profile','dm2HdmGrid','dm2GalleryGrid','dm2Modal'];
const _ok = await waitFor(()=> _need.every(id=>document.getElementById(id)));
if(!_ok){
  const miss=_need.filter(id=>!document.getElementById(id));
  console.warn('[DM] fehlende IDs → Abbruch:', miss);
  return;
}


const ui={
    cover:$('#dm2Cover'), coverFile:$('#dm2FileCover'),
    avatarImg:$('#dm2Avatar'), file:$('#dm2File'),
    name:$('#dm2Name'), handle:$('#dm2Handle'), bio:$('#dm2Bio'),
    age:$('#dm2Age'), breed:$('#dm2Breed'),
    statsPosts:$('#dm2PostsCount'), followers:$('#dm2Followers'), following:$('#dm2Following'),
    gear:$('#dm2Gear'), share:$('#dm2Share'), menu:$('#dm2Menu'), followBtn:$('#dm2FollowBtn'),
    membership:$('#dm2Membership'), logout:$('#dm2Logout'), editBtn:$('#dm2EditBtn'), editAvatarBtn:$('#dm2EditAvatar'),
    tabs:$$('.dm2-tab'),
    hdmSection:$('#dm2HdmSection'), hdmGrid:$('#dm2HdmGrid'),
    galleryGrid:$('#dm2GalleryGrid'), galleryAdd:$('#dm2GalleryAdd'), galleryFile:$('#dm2GalleryFile'),
    ab:{name:$('#ab2Name'),sex:$('#ab2Sex'),birth:$('#ab2Birth'),age:$('#ab2Age'),breed:$('#ab2Breed'),weight:$('#ab2Weight'),goal:$('#ab2Goal'),allergies:$('#ab2Allergies')},
    modal:$('#dm2Modal'), sheet:$('#dm2Sheet'),
    in:{bio:$('#in2Bio'),weight:$('#in2Weight'),neutered:$('#in2Neutered'),birth:$('#in2Birth'),goal:$('#in2Goal')},
    bioCount:$('#bioCount'),
    tagWrap:$('#in2Tags'), tagInput:$('#in2TagInput'), suggest:$('#in2Suggest'),
    photo:$('#dm2Photo'), photoImg:$('#dm2PhotoImg'),
    fModal:$('#dm2FollowModal'), fTitle:$('#fTitle'),
    listFollowers:$('#listFollowers'), listFollowing:$('#listFollowing'),
    openFollowers:$('#openFollowers'), openFollowing:$('#openFollowing'), closeFollowModal:$('#closeFollowModal')
  };
  ui.tabs.forEach(t=>t.addEventListener('click',()=>{ ui.tabs.forEach(x=>x.classList.remove('active')); t.classList.add('active'); $$('.dm2-panel').forEach(p=>p.classList.remove('active')); $('#dm2Tab-'+t.dataset.tab).classList.add('active'); }));

  /* --- Menüs / Logout --- */
$('#dm2Gear')?.addEventListener('click',(e)=>{e.stopPropagation();ui.menu.classList.toggle('open');});
$('#dm2Membership')?.addEventListener('click',()=>window.$memberstackDom?.openModal?.('update-subscription'));
$('#dm2Logout')?.addEventListener('click',async()=>{try{await window.$memberstackDom?.logout?.();}catch(_){}location.reload();});
$('#dm2EditAvatar')?.addEventListener('click', ()=> ui.file?.click());

  /* --- Allergie-Auswahl --- */
  const optionsList=["Rind","Huhn","Lamm","Pferd","Kaninchen","Ente","Truthahn","Wild","Fisch","Lachs","Forelle","Thunfisch","Ei","Milchprodukte","Laktose","Gluten","Weizen","Reis","Mais","Hafer","Gerste","Kartoffel","Süßkartoffel","Kürbis","Zucchini","Karotte","Erbsen","Linsen","Bohnen","Rote Bete","Brokkoli","Fenchel","Pastinake","Topinambur","Birne","Apfel","Banane","Heidelbeeren","Cranberries","Kokos","Leinöl","Lachsöl","Hanfsamen","Flohsamen","Chiasamen","Hirse","Quinoa","Amaranth","Ziegenmilch","Petersilie","Brennnessel","Löwenzahn","Bierhefe","Algen","Eierschale","Joghurt"];
  let selectedTags=[];
  function renderTags(){ ui.tagWrap.innerHTML=''; selectedTags.forEach(txt=>{const s=document.createElement('span'); s.className='dm2-tag'; s.textContent=txt; const x=document.createElement('span'); x.className='x'; x.textContent='×'; x.onclick=()=>{selectedTags=selectedTags.filter(t=>t!==txt);renderTags();}; s.appendChild(x); ui.tagWrap.appendChild(s); });}
  ui.tagInput.addEventListener('input',()=>{const v=ui.tagInput.value.toLowerCase().trim(); const c=optionsList.filter(o=>o.toLowerCase().includes(v)&&!selectedTags.includes(o)); ui.suggest.innerHTML=''; if(!v||!c.length){ui.suggest.style.display='none';return;} c.slice(0,8).forEach(o=>{const li=document.createElement('li');li.textContent=o;li.onclick=()=>{selectedTags.push(o);renderTags();ui.tagInput.value='';ui.suggest.style.display='none';}; ui.suggest.appendChild(li);}); ui.suggest.style.display='block';});
  ui.tagInput.addEventListener('focus', ()=>{ const sheet = ui.sheet; if(!sheet) return; sheet.scrollTo({ top: sheet.scrollHeight, behavior:'smooth' }); });
  document.addEventListener('click',(e)=>{ if(ui.tagInput && ui.suggest && !ui.tagInput.contains(e.target) && !ui.suggest.contains(e.target)) ui.suggest.style.display='none'; });

  /* --- UI füllen --- */
  function hydrate(cf={}, isOwner=false){
    const name=cf.hundename||cf.name||'Dein Hund';
    ui.name.textContent=name; ui.handle.textContent='@'+(name?name.toLowerCase().replace(/\s+/g,'_'):'doggo');
    if(cf.profilbild) ui.avatarImg.src=cf.profilbild;
    if(cf.profilcover) ui.cover.style.backgroundImage=`url("${cf.profilcover}")`;
    ui.age.textContent=ageFrom(cf.geburtstag).label; ui.breed.textContent=cf.rasse||'Lieblingsfell';
    const bio=cf.bio?String(cf.bio):''; ui.bio.textContent=bio; ui.bio.style.display=bio?'block':'none';
    ui.ab.name.textContent=name; ui.ab.sex.textContent=cf.geschlecht||'–'; ui.ab.birth.textContent=fmtDateDE(cf.geburtstag);
    ui.ab.age.textContent=ageFrom(cf.geburtstag).label; ui.ab.breed.textContent=cf.rasse||'–';
    ui.ab.weight.textContent=cf.gewicht?`${cf.gewicht} kg`:'–'; ui.ab.goal.textContent=cf.endgewicht?`${cf.endgewicht} kg`:'–';
    const arr=Array.isArray(cf.allergien)?cf.allergien:(cf.allergien?String(cf.allergien).split(',').map(s=>s.trim()).filter(Boolean):[]);
    ui.ab.allergies.textContent=arr.length?arr.join(', '):'–';
    ui.in.bio.value=bio; ui.in.weight.value=cf.gewicht||''; ui.in.neutered.value=cf.kastriert||''; ui.in.birth.value=cf.geburtstag||''; ui.in.goal.value=cf.endgewicht||'';
    selectedTags=arr.slice(); renderTags(); setPrivacy(isOwner);
  }

  $('.dm2-avatar')?.addEventListener('click', ()=>{ $('#dm2PhotoImg').src=ui.avatarImg.src; $('#dm2Photo').classList.add('open'); document.body.classList.add('dm2-lock'); });
  $('#dm2Photo')?.addEventListener('click',(e)=>{ if(e.target.id==='dm2Photo') { e.currentTarget.classList.remove('open'); document.body.classList.remove('dm2-lock'); } });

  /* Likes sammeln (Count + ob Viewer geliked hat) ohne RPC */
  async function enrichLikesWithoutRpc(sb, pics, viewerId){
    try{
      const ids = (pics||[]).map(p=>p.id).filter(Boolean);
      if (!sb || !ids.length) return pics;
      const { data: rows } = await sb.from('hund_des_monats_likes').select('bild_id, memberstack_id').in('bild_id', ids);
      const countMap = new Map();
      const likedSet = new Set();
      (rows||[]).forEach(r=>{
        countMap.set(r.bild_id, (countMap.get(r.bild_id)||0)+1);
        if (viewerId && String(r.memberstack_id)===String(viewerId)) likedSet.add(r.bild_id);
      });
      return (pics||[]).map(p => Object.assign({}, p, { likes: countMap.get(p.id)||0, liked: likedSet.has(p.id) }));
    }catch(_){ return pics; }
  }

  /* === HDM-Posts mit richtigem Detail-Overlay laden === */
  async function loadPostsFor(profileUid){
    const sb = await getSB();
    const hdmGrid = ui.hdmGrid;
    const hdmSection = ui.hdmSection;
    if(!hdmGrid || !hdmSection){ console.warn('[Profile] HDM-Container fehlt – lade nur Galerie.'); await loadGalleryFor(profileUid); return; }
    hdmGrid.innerHTML = '';
    const cached = getCachedPosts(profileUid);
    if (cached && cached.length) renderHdmGrid(cached);
    if (!sb || !profileUid){ if (!cached?.length){ hdmSection.style.display = 'none'; } await loadGalleryFor(profileUid); return; }
    let pics = [];
    try{
      const r1 = await sb.from('hund_des_monats').select('id,bild_url,hundename,memberstack_id,member_id,owner_id,uid,created_at,caption').or(`memberstack_id.eq.${profileUid},member_id.eq.${profileUid},owner_id.eq.${profileUid},uid.eq.${profileUid}`).order('created_at',{ascending:false});
      pics = r1.data || [];
      try{ const ms = await getMS(); const me = ms ? await getMemberNormalized(ms) : { id:null }; const viewerId = me?.id || null; pics = await enrichLikesWithoutRpc(sb, pics, viewerId); }catch(_){}
      if(!pics.length){ const likePattern = `%${profileUid}_%`; const r2 = await sb.from('hund_des_monats').select('id,bild_url,hundename,created_at,caption').like('bild_url', likePattern).order('created_at',{ascending:false}); pics = r2.data || []; }
    }catch(e){ console.warn('[HDM posts ERROR]', e); }
    setCachedPosts(profileUid, pics);
    renderHdmGrid(pics);
    const galleryCount = await loadGalleryFor(profileUid);
    try{ ui.statsPosts.textContent = String((pics?.length||0) + (galleryCount||0)); }catch{}

    function renderHdmGrid(items){
      hdmGrid.innerHTML = '';
      if(!items.length){ hdmSection.style.display = 'none'; return; }
      hdmSection.style.display = '';
      items.forEach(p=>{
        const card = document.createElement('div');
        card.className = 'dm2-card';
        const id = p.id;
        const url = p.bild_url;
        const name = p.hundename || 'Doggo';
        const likes = Math.max(0, Number(p?.likes || 0));
        const liked = !!p?.liked;
        card.innerHTML = `<img src="${url}" alt="${name}"><div class="hdm-name-like-row"><div class="hdm-dogname">${name}</div><div id="like-${id}" class="hdm-likebox-placeholder"></div></div>`;
        const img = card.querySelector('img');
        wireImgFallback?.(img);
        card.style.cursor = 'pointer';
        card.addEventListener('click', (e)=>{ const el = (e.target instanceof Element) ? e.target : null; if (el?.closest('.hdm-likebox-placeholder')) return; openHdmDetailInProfile(p); });
        const likeBox = card.querySelector(`#like-${id}`);
        if (window.DGMlikes && likeBox) { window.DGMlikes.renderButton(likeBox, { type: 'hdm', id: id, initial: { likes: likes, liked: liked } }); }
        hdmGrid.appendChild(card);
      });
    }
  }

  /* === HDM-Detail-Overlay im Profil öffnen (1:1 wie Hund des Monats) === */
  function openHdmDetailInProfile(pic){
    if (!pic || !pic.id) { showDoggoSnackbar?.('Fehler: Bilddaten fehlen!'); return; }
    const overlay = document.getElementById('hdm-detail-overlay-profile');
    if (!overlay) { console.error('[HDM Detail] Overlay nicht gefunden!'); return; }
    overlay.classList.add('open');
    overlay.style.display = 'flex';
    document.body.classList.add('dm2-lock');
    document.body.style.top = `-${window.scrollY || 0}px`;
    const profilbild = pic.profilbild || pic.owner_avatar || 'https://i.imgur.com/ZcLLrkY.png';
    const hundename = pic.hundename || 'Doggo';
    const bildUrl = pic.bild_url || '';
    const caption = pic.caption || '';
    const uid = pic.memberstack_id || pic.member_id || pic.owner_id || pic.uid || '';
    const pimg = document.getElementById('hdm-profile-img-profile');
    pimg.src = profilbild;
    wireImgFallback?.(pimg);
    document.getElementById('hdm-profile-username-profile').textContent = hundename;
    const detailImg = document.getElementById('hdm-detail-img-profile');
    const skeleton = document.getElementById('hdm-detail-skeleton-profile');
    skeleton.style.display = 'flex';
    detailImg.src = bildUrl;
    wireImgFallback?.(detailImg);
    detailImg.onload = () => { skeleton.style.display = 'none'; };
    detailImg.onerror = () => { skeleton.style.display = 'none'; };
    requestAnimationFrame(() => { const scroller = overlay.querySelector('.hdm-detail-scroll'); if (scroller) scroller.scrollTop = 0; });
    const profileLink = document.getElementById('hdm-profile-link-profile');
    profileLink.onclick = () => { if (!uid) return; closeHdmDetailInProfile(); if (String(uid) === String(window._DM_MY_ID || '')) return; setTimeout(() => { location.href = `/user?uid=${encodeURIComponent(uid)}`; }, 10); };
    const closeBtn = document.getElementById('hdm-detail-close-profile');
    closeBtn.onclick = (e) => { e.stopPropagation(); const menu = document.getElementById('hdm-detail-menu-list-profile'); if (menu) menu.style.display = 'none'; closeHdmDetailInProfile(); };
    const likeBox = document.getElementById('hdm-detail-likebox-profile');
    likeBox.innerHTML = '';
    if (window.DGMlikes) { window.DGMlikes.renderButton(likeBox, { type: 'hdm', id: pic.id, initial: { likes: Math.max(0, Number(pic?.likes || 0)), liked: !!pic?.liked } }); }
    let lastTap = 0;
    function triggerLikeBurst(){ const box = document.querySelector('#hdm-detail-overlay-profile .hdm-detail-imgbox'); if (!box) return; const burst = document.createElement('div'); burst.className = 'hdm-like-burst'; burst.innerHTML = `<svg viewBox="0 0 24 24" width="120" height="120"><path d="M12 21c-.6 0-1.2-.21-1.65-.62C6.05 17.17 2 13.39 2 9.5 2 6.42 4.42 4 7.5 4c1.74 0 3.41.81 4.5 2.09C13.09 4.81 14.76 4 16.5 4 19.58 4 22 6.42 22 9.5c0 3.89-4.05 7.67-8.35 10.88-.45.41-1.05.62-1.65.62z" fill="#cc7255" stroke="#cc7255" stroke-width="1.4"/></svg>`; box.appendChild(burst); burst.addEventListener('animationend', () => burst.remove()); }
    detailImg.ontouchend = function(e){ const now = Date.now(); if (now - lastTap < 350){ e.preventDefault(); const likeBtn = likeBox.querySelector('button'); if (likeBtn && !likeBtn.classList.contains('liked')) { likeBtn.click(); triggerLikeBurst(); } } lastTap = now; };
    detailImg.ondblclick = function(e){ e.preventDefault(); const likeBtn = likeBox.querySelector('button'); if (likeBtn && !likeBtn.classList.contains('liked')) { likeBtn.click(); triggerLikeBurst(); } };
    const menuBtn = document.getElementById('hdm-detail-menu-btn-profile');
    const menuList = document.getElementById('hdm-detail-menu-list-profile');
    menuList.innerHTML = '';
    const myId = window._DM_MY_ID || null;
    const isOwner = String(uid || '') === String(myId || '');
    if (isOwner) {
      const editBtn = document.createElement('button');
      editBtn.textContent = caption?.trim() ? 'Beschreibung bearbeiten' : 'Beschreibung hinzufügen';
      editBtn.onclick = () => { /* TODO: Caption editieren */ };
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Beitrag löschen';
      delBtn.onclick = async () => { if (!confirm('Beitrag wirklich löschen?')) return; const sb = await getSB(); const { error } = await sb.rpc('delete_hund_des_monats', { p_bild_id: pic.id, p_memberstack_id: myId }); if (error) { alert('Löschen fehlgeschlagen'); return; } menuList.style.display = 'none'; closeHdmDetailInProfile(); clearCachedPosts?.(uid); await loadPostsFor(uid); showDoggoSnackbar?.('Beitrag gelöscht ✅'); };
      menuList.append(editBtn, delBtn);
    } else {
      const reportBtn = document.createElement('button');
      reportBtn.textContent = 'Beitrag melden';
      reportBtn.onclick = () => { menuList.style.display = 'none'; if (typeof guardedReport === 'function') { guardedReport('hund_des_monats', pic.id, reportBtn); } };
      menuList.appendChild(reportBtn);
    }
    menuBtn.onclick = (e) => { e.stopPropagation(); menuList.style.display = (menuList.style.display === 'flex') ? 'none' : 'flex'; };
    if (window._hdmProfileMenuHandler) document.removeEventListener('click', window._hdmProfileMenuHandler);
    window._hdmProfileMenuHandler = (e) => { if (!menuList.contains(e.target) && e.target !== menuBtn) { menuList.style.display = 'none'; } };
    document.addEventListener('click', window._hdmProfileMenuHandler);
    const captionRow = document.getElementById('hdm-detail-caption-row-profile');
    captionRow.innerHTML = '';
    if (caption?.trim()) {
      const username = document.createElement('span');
      username.className = 'hdm-caption-username';
      username.textContent = hundename;
      const wrap = document.createElement('span');
      wrap.className = 'hdm-caption-wrap';
      const text = document.createElement('span');
      text.className = 'hdm-caption-text caption-truncate';
      text.textContent = caption;
      wrap.appendChild(text);
      captionRow.append(username, wrap);
      requestAnimationFrame(() => {
        const clamped = text.scrollHeight > text.clientHeight + 1;
        if (!clamped) { text.classList.remove('caption-truncate'); return; }
        const moreBtn = document.createElement('button');
        moreBtn.className = 'caption-more-btn';
        moreBtn.textContent = 'mehr';
        let expanded = false;
        moreBtn.onclick = (e) => { e.stopPropagation(); expanded = !expanded; text.classList.toggle('caption-truncate', !expanded); moreBtn.textContent = expanded ? 'weniger' : 'mehr'; };
        wrap.appendChild(moreBtn);
      });
    }
    const commentsBox = document.getElementById('hdm-detail-comments-profile');
    commentsBox.innerHTML = '';
    const commentDiv = document.createElement('div');
    commentDiv.className = 'dgm-comments-box';
    commentDiv.dataset.commentsType = 'hund_des_monats';
    commentDiv.dataset.commentsRefId = pic.id;
    commentsBox.appendChild(commentDiv);
    if (window.DGMcomments) { window.DGMcomments.init(commentDiv, { type: 'hund_des_monats', refId: pic.id }); }
    attachEdgeSwipeProfile(overlay);
  }

  function closeHdmDetailInProfile(){
    const overlay = document.getElementById('hdm-detail-overlay-profile');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.style.display = 'none';
    document.body.classList.remove('dm2-lock');
    document.body.style.top = '';
    window.scrollTo(0, window._profileScrollY || 0);
    const img = document.getElementById('hdm-detail-img-profile');
    if (img) img.src = '';
    const skeleton = document.getElementById('hdm-detail-skeleton-profile');
    if (skeleton) skeleton.style.display = 'none';
  }

  function attachEdgeSwipeProfile(overlayEl){
    if (!overlayEl) return;
    const panel = overlayEl.querySelector('.hdm-detail-scroll') || overlayEl;
    panel.style.willChange = 'transform';
    let tracking = false, startX = 0, startY = 0, moved = false;
    overlayEl.addEventListener('pointerdown', (e) => { if (e.clientX > 24) return; tracking = true; moved = false; startX = e.clientX; startY = e.clientY; panel.style.transition = 'none'; overlayEl.setPointerCapture?.(e.pointerId); });
    overlayEl.addEventListener('pointermove', (e) => { if (!tracking) return; const dx = e.clientX - startX; const dy = Math.abs(e.clientY - startY); if (dy > 12 && Math.abs(dx) < 8) return; if (dx < 0) { panel.style.transform = `translateX(${dx * 0.2}px)`; moved = true; return; } e.preventDefault(); moved = true; panel.style.transform = `translateX(${dx}px)`; }, { passive: false });
    function endPointer(e) { if (!tracking) return; tracking = false; overlayEl.releasePointerCapture?.(e.pointerId); panel.style.transition = 'transform .22s ease'; const dx = e.clientX - startX; if (moved && dx > 70) { panel.style.transform = 'translateX(100%)'; setTimeout(() => { panel.style.transform = ''; closeHdmDetailInProfile(); }, 180); } else { panel.style.transform = ''; } }
    overlayEl.addEventListener('pointerup', endPointer);
    overlayEl.addEventListener('pointercancel', endPointer);
  }

  window.addEventListener('pagehide', closeHdmDetailInProfile);
  window.addEventListener('beforeunload', closeHdmDetailInProfile);

  /* Profil-Galerie laden */
  async function loadGalleryFor(profileUid){
    const sb = await getSB();
    const grid = ui.galleryGrid;
    if (!grid) return 0;
    grid.innerHTML = '';
    const cached = getCachedGallery(profileUid);
    if (Array.isArray(cached) && cached.length){ cached.forEach(item=>{ const cell = document.createElement('div'); cell.className='dm2-gallery-item'; cell.dataset.uid = item.uid; cell.dataset.name = item.name; const img = document.createElement('img'); img.src=item.url; img.alt='Foto'; wireImgFallback(img); cell.appendChild(img); cell.addEventListener('click', ()=> openProfilePhotoDetail(item)); grid.appendChild(cell); }); }
    if(!sb || !profileUid) return cached?.length || 0;
    let files = [];
    try{ const { data:list } = await sb.storage.from('profile-gallery').list(`${profileUid}`, { limit: 200, offset:0, sortBy:{ column:'name', order:'desc' } }); files = Array.isArray(list) ? list : []; }catch(e){ console.warn('[gallery list]', e); }
    const urls = files.map(f=>{ const { data } = sb.storage.from('profile-gallery').getPublicUrl(`${profileUid}/${f.name}`); return { uid: String(profileUid), name: String(f.name), url: data?.publicUrl || '', ts: f.name.match(/(\d{13})/)? Number(RegExp.$1) : 0 }; }).filter(x=>x.url);
    urls.sort((a,b)=> (b.ts - a.ts) || (a.name < b.name ? 1 : -1));
    grid.innerHTML = '';
    urls.forEach(item=>{ const cell = document.createElement('div'); cell.className='dm2-gallery-item'; cell.dataset.uid = item.uid; cell.dataset.name = item.name; const img = document.createElement('img'); img.src=item.url; img.alt='Foto'; wireImgFallback(img); cell.appendChild(img); cell.addEventListener('click', ()=> openProfilePhotoDetail(item)); grid.appendChild(cell); });
    setCachedGallery(profileUid, urls);
    return urls.length;
  }

  /* --- Modal-Logik --- */
  let scrollMem=0;
  let pgScrollMem = 0;
  function openSheet(){ scrollMem=window.scrollY||0; document.body.classList.add('dm2-lock'); document.body.style.top=`-${scrollMem}px`; $('#dm2Modal').classList.add('open'); }
  function closeSheet(){ $('#dm2Modal').classList.remove('open'); document.body.classList.remove('dm2-lock'); document.body.style.top=''; window.scrollTo(0,scrollMem); }
  $('#dm2EditBtn')?.addEventListener('click', openSheet);
  $('#dm2Modal')?.addEventListener('click',(e)=>{ if(e.target===e.currentTarget) closeSheet(); });
  document.addEventListener('keydown',(e)=>{ if(e.key==='Escape' && $('#dm2Modal')?.classList?.contains('open')) closeSheet(); });
  $('#dm2Cancel')?.addEventListener('click', closeSheet);

  /* --- Follower-Listen --- */
  $('#openFollowers')?.addEventListener('click',()=>{});
  $('#openFollowing')?.addEventListener('click',()=>{});

  (async ()=>{
    const [ms, sb] = await Promise.all([getMS(), getSB()]);
    console.log('[DM] MS/SB ready?', { ms: !!ms, sb: !!(sb && sb.from) });
    let myId=null,myCF={};
    if(ms){ const me=await getMemberNormalized(ms); myId=me.id; myCF=me.cf||{}; }
    window._DM_MY_ID = myId || null;
    const profileUid = myId;
    hydrate(myCF, true);
    await loadPostsFor(profileUid);
    
// DGMlikes Modul initialisieren (falls vorhanden)
    if (window.DGMlikes && typeof window.DGMlikes.init === 'function') {
      try {
        await window.DGMlikes.init();
      } catch(e) {
        console.warn('[DGMlikes init]', e);
      }
    }
    function extFromType(blob){ return blob?.type === 'image/webp' ? '.webp' : (blob?.type === 'image/png' ? '.png' : '.jpg'); }
    $('#dm2FabAdd')?.addEventListener('click', ()=> ui.galleryFile?.click());
    ui.galleryFile?.addEventListener('change', async (e)=>{ const f = e.target.files?.[0]; if(!f) return; const me = await getMemberNormalized(ms); const myId = me.id; if(!myId){ alert('Bitte einloggen.'); return; } const compressed = await window.compressImage(f, { maxW:1600, maxH:1600, targetBytes:600*1024, mimePreferred:'image/webp' }); const uploadFile = compressed || f; const safe = s=>s.replace(/[^a-zA-Z0-9._-]/g,'_'); const base = `g_${Date.now()}_${safe(f.name)}`.replace(/\.(heic|heif|png|jpe?g|webp|avif)$/i,''); const path = `${myId}/${base}${extFromType(uploadFile)}`; const up = await sb.storage.from('profile-gallery').upload(path, uploadFile, { upsert:true, cacheControl:'3600' }); if(up?.error){ alert('Upload fehlgeschlagen: '+up.error.message); return; } const pub = sb.storage.from('profile-gallery').getPublicUrl(path); const newUrl = pub?.data?.publicUrl || ''; clearCachedGallery(myId); await loadGalleryFor(myId); e.target.value=''; if(newUrl){ openProfilePhotoDetail({ uid: String(myId), name: path.split('/').pop(), url: newUrl }); } });

    async function dm_syncPublicProfile(sb, myId, cf){ try{ if(!sb||!myId) return; const row={memberstack_id:myId,hundename:cf?.hundename||cf?.name||null,geschlecht:cf?.geschlecht||null,geburtstag:cf?.geburtstag||null,rasse:cf?.rasse||null,bio:cf?.bio||null,updated_at:new Date().toISOString()}; await sb.from('doggo_public_profile').upsert(row,{onConflict:'memberstack_id'});}catch(e){console.warn('[syncPublicProfile]',e);} }
    async function upsertMedia(sb,myId,{avatar_url=null,cover_url=null}={}){ try{ if(!sb||!myId) return; const row={memberstack_id:myId}; if(avatar_url) row.avatar_url=avatar_url; if(cover_url) row.cover_url=cover_url; await sb.from('doggo_profile_media').upsert(row,{onConflict:'memberstack_id'});}catch(e){console.warn('[upsertMedia]',e);} }

    if(sb && myId){ await dm_syncPublicProfile(sb, myId, Object.assign({hundename:myCF.hundename||ui.name.textContent, rasse:myCF.rasse||$('#ab2Breed').textContent}, myCF)); const bg = getComputedStyle($('#dm2Cover')).backgroundImage || ''; const coverUrl = bg.startsWith('url(') ? bg.slice(4,-1).replace(/^"|"$|^'|'$/g,'') : ''; await upsertMedia(sb, myId, { avatar_url: myCF.profilbild || $('#dm2Avatar').src || null, cover_url: myCF.profilcover || coverUrl || null }); }

    $('#dm2Share')?.addEventListener('click', async ()=>{ const shareUrl=`${location.origin}/user?uid=${encodeURIComponent(profileUid)}`; if(navigator.share){ try{ await navigator.share({title:$('#dm2Name').textContent||'DoggoMeal', text:'Schau dir dieses Profil auf DoggoMeal an 🐾', url:shareUrl}); }catch(_){} }else{ try{ await navigator.clipboard.writeText(`Schau dir dieses Profil auf DoggoMeal an 🐾\n${shareUrl}`); alert('Link kopiert!'); }catch(_){ alert(shareUrl); } } });

    async function refreshFollow(){ const sb2=await getSB(); if(!sb2||!profileUid) return; const { data:a }=await sb2.from('doggo_follows').select('follower_id,followee_id'); const followers=(a||[]).filter(x=>String(x.followee_id)===String(profileUid)).map(x=>x.follower_id); const following=(a||[]).filter(x=>String(x.follower_id)===String(profileUid)).map(x=>x.followee_id); $('#dm2Followers').textContent=followers.length; $('#dm2Following').textContent=following.length; async function fill(ids, listEl){ listEl.innerHTML=''; if(!ids.length){ listEl.innerHTML='<div style="opacity:.6;padding:10px 12px">Noch leer</div>'; return; } const { data:profiles } = await sb2.from('doggo_public_profile').select('*').in('memberstack_id', ids); const { data:media } = await sb2.from('doggo_profile_media').select('*').in('memberstack_id', ids); const mapP=new Map((profiles||[]).map(r=>[String(r.memberstack_id),r])); const mapM=new Map((media||[]).map(r=>[String(r.memberstack_id),r])); ids.forEach(uid=>{ const p=mapP.get(String(uid))||{}; const m=mapM.get(String(uid))||{}; const displayName = p.hundename || 'Doggo'; const row=document.createElement('div'); row.className='dm2-user-row'; row.innerHTML = `<img src="${m.avatar_url||'https://via.placeholder.com/80?text=D'}" alt=""><div class="dm2-user-text"><div class="dm2-user-name">${displayName}</div><div class="dm2-user-handle">@${(displayName||'doggo').toLowerCase().replace(/\s+/g,'_')}</div></div>`; row.addEventListener('click', (e)=>{ const el = (e.target instanceof Element) ? e.target : null; if (el?.closest('.dm2-mini-follow')) return; if(String(uid)===String(myId)){ closeFollowModal(); return; } location.href=`/user?uid=${encodeURIComponent(uid)}`; }); listEl.appendChild(row); }); } $('#openFollowers').onclick = ()=>{ fill(followers, $('#listFollowers')); openFollowModal('followers'); }; $('#openFollowing').onclick = ()=>{ fill(following, $('#listFollowing')); openFollowModal('following'); }; }
    refreshFollow();

    $('#dm2File')?.addEventListener('change', async ()=>{ const f=$('#dm2File').files?.[0]; if(!f){return;} const sb=await getSB(); const ms=await getMS(); const me=await getMemberNormalized(ms); const myId=me.id; if(!sb||!myId) return; const safe = s=>s.replace(/[^a-zA-Z0-9._-]/g,'_'); const processed = await compressImage(f, { maxW:1440, maxH:1440, targetBytes:300*1024, mimePreferred:'image/webp' }); const fileToUp = processed || f; const path = `${myId}/avatar_${Date.now()}_${safe(fileToUp.name || 'avatar.jpg')}`; const up = await sb.storage.from('avatars').upload(path, fileToUp, { upsert:true, cacheControl:'3600' }); if(up?.error){ alert('Upload fehlgeschlagen: '+up.error.message); return; } const { data:pub }=sb.storage.from('avatars').getPublicUrl(path); const url=pub?.publicUrl; if(url){ $('#dm2Avatar').src=url; try{ await ms.updateMember({ customFields:{ profilbild:url } }); }catch(_){} try{ await sb.from('doggo_profile_media').upsert({ memberstack_id: myId, avatar_url: url }, { onConflict: 'memberstack_id' }); }catch(_){} try{ await sb.from('doggo_public_profile').upsert({ memberstack_id: myId, hundename: $('#dm2Name').textContent }, { onConflict: 'memberstack_id' }); }catch(_){} alert('Profilbild aktualisiert ✅'); } $('#dm2File').value=''; });

    $('#dm2Cover')?.addEventListener('click', ()=> $('#dm2FileCover')?.click());
    $('#dm2FileCover')?.addEventListener('change', async ()=>{ const f=$('#dm2FileCover').files?.[0]; if(!f){return;} const sb=await getSB(); const ms=await getMS(); const me=await getMemberNormalized(ms); const myId=me.id; if(!sb||!myId){return;} const safe=s=>s.replace(/[^a-zA-Z0-9._-]/g,'_'); const processed = await compressImage(f, { maxW:1600, maxH:1600, targetBytes:300*1024, mimePreferred:'image/webp' }); const fileToUp = processed || f; const path = `${myId}/cover_${Date.now()}_${safe(fileToUp.name || 'cover.jpg')}`; const up = await sb.storage.from('profile-banners').upload(path, fileToUp, { upsert:true, cacheControl:'3600' }); if(up?.error){ alert('Upload fehlgeschlagen: '+up.error.message); return; } const { data:pub }=sb.storage.from('profile-banners').getPublicUrl(path); const url=pub?.publicUrl; if(url){ $('#dm2Cover').style.backgroundImage=`url("${url}")`; try{ await ms.updateMember({ customFields:{ profilcover:url } }); }catch(_){} try{ await sb.from('doggo_profile_media').upsert({ memberstack_id: myId, cover_url: url }, { onConflict: 'memberstack_id' }); }catch(_){} alert('Banner aktualisiert ✅'); } $('#dm2FileCover').value=''; });

    const MAX_BIO=70;
    function updateBioCounter(){ const el = $('#in2Bio'); if(!el) return; let v = el.value || ''; if(v.length > MAX_BIO){ v = v.slice(0, MAX_BIO); el.value = v; } $('#bioCount') && (ui.bioCount.textContent = `${v.length}/${MAX_BIO}`); }
    $('#in2Bio')?.addEventListener('input', updateBioCounter);
    updateBioCounter();

    $('#dm2Save')?.addEventListener('click', async ()=>{ const ms=await getMS(); const sb=await getSB(); if(!ms) return alert('Memberstack noch nicht bereit.'); const updates={ bio: $('#in2Bio').value.slice(0,MAX_BIO), gewicht: $('#in2Weight').value, kastriert: $('#in2Neutered').value, geburtstag: $('#in2Birth').value, endgewicht: $('#in2Goal').value, allergien: selectedTags }; try{ await ms.updateMember({ customFields: updates }); const bg = getComputedStyle($('#dm2Cover')).backgroundImage || ''; const coverUrl = bg.startsWith('url(') ? bg.slice(4,-1).replace(/^"|"$|^'|'$/g,'') : ''; const merged=Object.assign({}, updates, { hundename:$('#dm2Name').textContent, rasse:$('#ab2Breed').textContent, profilbild:$('#dm2Avatar').src, profilcover: coverUrl }); hydrate(merged, true); const me=await getMemberNormalized(ms); try{ await sb.from('doggo_public_profile').upsert({ memberstack_id: me.id, hundename: $('#dm2Name').textContent, bio: merged.bio, rasse: merged.rasse, geburtstag: merged.geburtstag }, { onConflict: 'memberstack_id' }); }catch(_){} try{ await sb.from('doggo_profile_media').upsert({ memberstack_id: me.id, avatar_url: $('#dm2Avatar').src, cover_url: coverUrl }, { onConflict: 'memberstack_id' }); }catch(_){} clearCachedGallery(me.id); $('#dm2Cancel').click(); alert('Änderungen gespeichert ✅'); }catch(e){ console.error(e); alert('Speichern fehlgeschlagen.'); } });

    (function boostBottomNav(){ const nav=document.querySelector('.bottom-nav, .bottom_nav, [data-bottom-nav]'); if(!nav) return; nav.style.zIndex='2147483000'; nav.style.pointerEvents='auto'; nav.querySelectorAll('a[href]').forEach(a=>{ a.addEventListener('click',(e)=>{ e.preventDefault(); e.stopPropagation(); const href=a.getAttribute('href'); if(href) window.location.href = href; }); }); })();

    (function forceBottomNavClicks(){ function cleanup(){ try{ window.DGM_HDM?.closeAll?.(); try{ closeProfilePhotoDetail(); }catch(_){} if (typeof dmCleanupLocks === 'function') dmCleanupLocks(); document.body.classList.remove('dm2-lock'); document.body.style.top = ''; }catch(_){} } document.addEventListener('click', (e)=>{ const a = (e.target instanceof Element) ? e.target.closest('.bottom-nav a[href], .bottom_nav a[href], [data-bottom-nav] a[href]') : null; if(!a) return; e.preventDefault(); e.stopPropagation(); const href = a.getAttribute('href'); cleanup(); if(href) window.location.href = href; }, true); })();

    function openFollowModal(which){ $('#fTitle').textContent = which==='following' ? 'Folgt' : 'Follower'; $('#listFollowers').style.display = which==='followers' ? 'block' : 'none'; $('#listFollowing').style.display = which==='following' ? 'block' : 'none'; $('#dm2FollowModal').classList.add('open'); document.body.classList.add('dm2-lock'); }
    function closeFollowModal(){ $('#dm2FollowModal').classList.remove('open'); document.body.classList.remove('dm2-lock'); }
    $('#closeFollowModal')?.addEventListener('click', closeFollowModal);
    $('#dm2FollowModal')?.addEventListener('click',(e)=>{ if(e.target===e.currentTarget) closeFollowModal(); });

    function _navLower(z='1'){ const nav=document.querySelector('.bottom-nav, .bottom_nav, [data-bottom-nav]'); if(!nav) return; if(!nav.dataset.prevZ) nav.dataset.prevZ = nav.style.zIndex || ''; nav.style.zIndex = z; }
    function _navRestore(){ const nav=document.querySelector('.bottom-nav, .bottom_nav, [data-bottom-nav]'); if(!nav) return; const prev = nav.dataset.prevZ ?? ''; nav.style.zIndex = prev; delete nav.dataset.prevZ; }

    async function openProfilePhotoDetail(item){ const ov = document.getElementById('pg-detail'); if(!ov) return; const img = document.getElementById('pg-detail-img'); const sk = document.getElementById('pg-detail-skeleton'); const menu= document.getElementById('pg-detail-menu'); const displayName = document.getElementById('dm2Name')?.textContent || 'Doggo'; const avatarUrl = document.getElementById('dm2Avatar')?.src || 'https://i.imgur.com/ZcLLrkY.png'; document.getElementById('pg-profile-username').textContent = displayName; const pimg = document.getElementById('pg-profile-img'); pimg.src = avatarUrl; wireImgFallback(pimg); sk.style.display = 'flex'; img.src = item.url || ''; wireImgFallback(img); img.onload = ()=> sk.style.display = 'none'; img.onerror= ()=> sk.style.display = 'none'; pgScrollMem = window.scrollY || 0; ov.style.display='flex'; ov.classList.add('open'); document.body.classList.add('dm2-lock'); document.body.style.top = `-${pgScrollMem}px`; _navLower('1'); if(!ov.dataset.swipe){ attachEdgeSwipePG(ov, closeProfilePhotoDetail, '.hdm-detail-scroll'); ov.dataset.swipe = '1'; } menu.innerHTML = ''; const myId = window._DM_MY_ID || null; const isOwner = String(item.uid||'') === String(myId||''); const menuBtn = document.getElementById('pg-detail-menu-btn'); menuBtn.onclick = (e)=>{ e.stopPropagation(); menu.style.display = (menu.style.display==='block')?'none':'block'; }; if (window._pgMenuOutsideHandler) document.removeEventListener('click', window._pgMenuOutsideHandler); window._pgMenuOutsideHandler = (e)=>{ if(!menu.contains(e.target) && e.target!==menuBtn) menu.style.display='none'; }; document.addEventListener('click', window._pgMenuOutsideHandler); if (isOwner){ const editBtn = document.createElement('button'); editBtn.textContent = 'Beschreibung bearbeiten'; editBtn.onclick = ()=>{ menu.style.display='none'; pg_editCaption(item); }; const delBtn = document.createElement('button'); delBtn.textContent = 'Foto löschen'; delBtn.onclick = async ()=>{ menu.style.display='none'; if(delBtn.disabled) return; if(!confirm('Foto wirklich löschen?')) return; delBtn.disabled = true; try{ const sb = await getSB(); await sb.storage.from('profile-gallery').remove([ `${item.uid}/${item.name}` ]); try{ clearCachedGallery(item.uid); }catch(_){} closeProfilePhotoDetail(); await loadGalleryFor(item.uid); }catch(e){ alert('Löschen fehlgeschlagen.'); }finally{ delBtn.disabled = false; } }; menu.append(editBtn, delBtn); }else{ const reportBtn = document.createElement('button'); reportBtn.textContent = 'Beitrag melden'; reportBtn.onclick = ()=>{ menu.style.display='none'; guardedReport('profile_gallery', `${item.uid}/${item.name}`, reportBtn); }; menu.append(reportBtn); } await pg_renderCaption(item); document.getElementById('pg-profile-link').onclick = ()=>{ const myId = window._DM_MY_ID || null; closeProfilePhotoDetail(); if (String(item.uid||'') === String(myId||'')) return; setTimeout(()=>{ location.href = `/user?uid=${encodeURIComponent(item.uid)}`; }, 10); }; const likeBox = document.getElementById('pg-detail-likebox'); if (likeBox){ likeBox.innerHTML = ''; if (item.type === 'hdm'){ window.DGMlikes?.renderButton(likeBox, { type: 'hdm', id: item.id, initial: { likes: item.likes||0, liked: !!item.liked } }); }else{ const ref = `${item.uid}/${item.name}`; window.DGMlikes?.renderButton(likeBox, { type: 'profile_gallery', id: ref }); } } document.getElementById('pg-detail-close').onclick = ()=> closeProfilePhotoDetail(); const commentsBox = document.getElementById('pg-detail-comments'); commentsBox.innerHTML = ''; const mount = document.createElement('div'); mount.className = "dgm-comments-box"; const cType = (item.type === 'hdm') ? 'hdm' : 'profile_gallery'; const cRef = (item.type === 'hdm') ? String(item.id) : `${item.uid}/${item.name}`; mount.dataset.commentsType = cType; mount.dataset.commentsRefId = cRef; commentsBox.appendChild(mount); window.DGMcomments?.init(mount, { type: cType, refId: cRef }); }
    function closeProfilePhotoDetail(){ const ov = document.getElementById('pg-detail'); if(!ov) return; ov.classList.remove('open'); ov.style.display = 'none'; document.body.classList.remove('dm2-lock'); document.body.style.top = ''; window.scrollTo(0, pgScrollMem||0); const img = document.getElementById('pg-detail-img'); if (img) img.src = ''; const sk = document.getElementById('pg-detail-skeleton'); if (sk) sk.style.display = 'none'; _navRestore(); }

    async function pg_loadCaption(item){ try{ const sb = await getSB(); const { data } = await sb.from('profile_gallery_meta').select('caption').eq('memberstack_id', item.uid).eq('file_name', item.name).maybeSingle(); return data?.caption || ''; }catch{ return ''; } }
    async function pg_saveCaption(item, text){ try{ const sb = await getSB(); await sb.from('profile_gallery_meta').upsert({ memberstack_id:item.uid, file_name:item.name, caption:text }, { onConflict:'memberstack_id,file_name' }); }catch(_){} }
    async function pg_renderCaption(item){ const row = document.getElementById('pg-detail-caption-row'); row.innerHTML=''; const hundename = document.getElementById('pg-profile-username')?.textContent || 'Doggo'; const wrap = document.createElement('span'); wrap.className='hdm-caption-wrap'; const text = document.createElement('span'); text.className='hdm-caption-text'; text.textContent = await pg_loadCaption(item); const 
      username = document.createElement('span'); username.className='hdm-caption-username'; username.textContent = hundename; row.append(username, wrap); wrap.appendChild(text); if(text.textContent.trim()){ text.classList.add('caption-truncate'); requestAnimationFrame(()=>{ const clamped = text.scrollHeight > text.clientHeight + 1; if(!clamped) text.classList.remove('caption-truncate'); else{ const t=document.createElement('button'); t.className='caption-more-btn'; t.textContent='mehr'; let expanded=false; t.onclick=()=>{ expanded=!expanded; text.classList.toggle('caption-truncate', !expanded); t.textContent=expanded?'weniger':'mehr'; }; wrap.appendChild(t); } }); } }
    function pg_editCaption(item){ const row = document.getElementById('pg-detail-caption-row'); const old = row.textContent?.trim() ? row.querySelector('.hdm-caption-text')?.textContent || '' : ''; row.innerHTML = `<textarea id="pg-caption-input" rows="2" placeholder="Beschreibe das Bild...">${old||''}</textarea><button class="caption-save-btn" id="pg-caption-save">Speichern</button>`; document.getElementById('pg-caption-save').onclick = async ()=>{ const val = (document.getElementById('pg-caption-input').value||'').trim(); await pg_saveCaption(item, val); await pg_renderCaption(item); }; }

    function attachEdgeSwipePG(overlayEl, onDismiss, scrollSelector){ if (!overlayEl) return; const panel = overlayEl.querySelector(scrollSelector) || overlayEl; panel.style.willChange = 'transform'; let tracking=false, startX=0, startY=0, moved=false; overlayEl.addEventListener('pointerdown', (e)=>{ if (e.clientX > 24) return; tracking=true; moved=false; startX=e.clientX; startY=e.clientY; panel.style.transition='none'; overlayEl.setPointerCapture?.(e.pointerId); }); overlayEl.addEventListener('pointermove', (e)=>{ if(!tracking) return; const dx = e.clientX - startX, dy = Math.abs(e.clientY - startY); if (dy > 12 && Math.abs(dx) < 8) return; if (dx < 0){ panel.style.transform=`translateX(${dx*0.2}px)`; moved=true; return; } e.preventDefault(); moved=true; panel.style.transform = `translateX(${dx}px)`; }, {passive:false}); function end(e){ if(!tracking) return; tracking=false; overlayEl.releasePointerCapture?.(e.pointerId); panel.style.transition='transform .22s ease'; const dx = e.clientX - startX; if (moved && dx > 70){ panel.style.transform='translateX(100%)'; setTimeout(()=>{ panel.style.transform=''; onDismiss(); }, 180); } else { panel.style.transform=''; } } overlayEl.addEventListener('pointerup', end); overlayEl.addEventListener('pointercancel', end); }

    window.openProfilePhotoDetail = openProfilePhotoDetail;
    window.closeProfilePhotoDetail = closeProfilePhotoDetail;

    function dmCleanupLocks(){ document.body.classList.remove('dm2-lock'); document.body.style.top=''; $('#dm2Modal')?.classList.remove('open'); $('#dm2Photo')?.classList.remove('open'); $('#dm2FollowModal')?.classList.remove('open'); $('#pg-detail')?.classList.remove('open'); const hdmOverlay = document.getElementById('hdm-detail-overlay-profile'); if(hdmOverlay){ hdmOverlay.classList.remove('open'); hdmOverlay.style.display='none'; } }
    window.addEventListener('pagehide', dmCleanupLocks);
    window.addEventListener('beforeunload', dmCleanupLocks);
    window.addEventListener('popstate', dmCleanupLocks);
    window.addEventListener('hashchange', dmCleanupLocks);
    document.addEventListener('click', (e)=>{ const a = (e.target instanceof Element) ? e.target.closest('a[href]') : null; if(!a) return; const href = a.getAttribute('href') || ''; if (a.hasAttribute('download')) return; if (/^https?:\/\//i.test(href) && !href.startsWith(location.origin)) return; try { dmCleanupLocks(); }catch(_){} }, true);
    window.addEventListener('pageshow', ()=>{ dmCleanupLocks(); });
    document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) dmCleanupLocks(); });

    window._likePending = window._likePending || new Set();
    window.setLikePending = window.setLikePending || ((id,on)=>{ if(on) window._likePending.add(String(id)); else window._likePending.delete(String(id)); });
    window.isLikePending = window.isLikePending || (id => window._likePending.has(String(id)));
    window.getLikes = window.getLikes || (p => Math.max(0, Number(p?.likes || 0)));
    window.forceLikeNumber = window.forceLikeNumber || ((btn,p)=>{ const n = btn?.querySelector?.('.hdm-like-num'); if(n) n.textContent = String(window.getLikes(p)); });
    window.setHeartVisualBox = window.setHeartVisualBox || ((btn,on)=>{ btn?.classList?.toggle('liked', !!on); });
    window.applyLikeResultToCard = window.applyLikeResultToCard || ((btn,res)=>{ if(!btn||!res) return; const n = btn.querySelector('.hdm-like-num'); const liked = !!res.liked_now; const cnt = Math.max(0, Number(res.likes||0)); btn.classList.toggle('liked', liked); if(n) n.textContent = String(cnt); });

    if (!window.rpcToggleLike) {
      window.rpcToggleLike = async function(postId){
        try{
          const sb = await getSB();
          const ms = await getMS();
          const me = ms ? await getMemberNormalized(ms) : { id:null };
          const uid = me?.id;
          if (!sb || !uid || !postId) return { liked_now:false, likes:0 };
          const { data: ex } = await sb.from('hund_des_monats_likes').select('id').eq('bild_id', postId).eq('memberstack_id', uid).maybeSingle();
          if (ex) { await sb.from('hund_des_monats_likes').delete().eq('id', ex.id); } 
          else { await sb.from('hund_des_monats_likes').insert({ bild_id: postId, memberstack_id: uid }); }
          const { count } = await sb.from('hund_des_monats_likes').select('*', { count:'exact', head:true }).eq('bild_id', postId);
          return { liked_now: !ex, likes: count || 0 };
        }catch(_){ return { liked_now:false, likes:0 }; }
      };
    }
  })();

} catch(e) {
  console.error('[DM FATAL]', e);
}
})();
