const map = L.map('map', {zoomControl:true, zoomAnimation:false, fadeAnimation:false, markerZoomAnimation:false}).setView([49.1,31.2],6);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19,minZoom:4,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);

const centers = [
  ['Київ',50.4501,30.5234],['Вінниця',49.2331,28.4682],['Луцьк',50.7472,25.3254],['Дніпро',48.4647,35.0462],
  ['Донецьк',48.0159,37.8029],['Житомир',50.2547,28.6587],['Ужгород',48.6208,22.2879],['Запоріжжя',47.8388,35.1396],
  ['Івано-Франківськ',48.9226,24.7111],['Кропивницький',48.5079,32.2623],['Луганськ',48.5740,39.3078],['Львів',49.8397,24.0297],
  ['Миколаїв',46.9750,31.9946],['Одеса',46.4825,30.7233],['Полтава',49.5883,34.5514],['Рівне',50.6199,26.2516],
  ['Суми',50.9077,34.7981],['Тернопіль',49.5535,25.5948],['Харків',49.9935,36.2304],['Херсон',46.6354,32.6169],
  ['Хмельницький',49.4229,26.9871],['Черкаси',49.4444,32.0598],['Чернівці',48.2915,25.9403],['Чернігів',51.4982,31.2893]
];

let selected = null;
let searchResults = [];
let activeSuggestion = -1;
let activeAlerts = JSON.parse(localStorage.getItem('uaAlertSimV2') || '{}');
let markers = {};
let zones = {};
let movers = {};
let moveTimers = {};
let ukraineGeo = null;
let bannerTimer = null;

const quick = document.getElementById('quickSelect');
centers.forEach(([name,lat,lng])=>{const o=document.createElement('option');o.value=JSON.stringify({name,lat,lng,bbox:null,display:name+', Україна'});o.textContent=name;quick.appendChild(o);});
quick.addEventListener('change',()=>{if(!quick.value)return;selectPlace(JSON.parse(quick.value));});

function safeIcon(){return L.divIcon({className:'',html:'<div class="safe-dot"></div>',iconSize:[18,18],iconAnchor:[9,9]});}
function alertIcon(kind){const c=kind==='drone'?'yellow':'red';return L.divIcon({className:'',html:`<div class="alert-dot ${c}"><div class="pulse"></div><div class="core"></div></div>`,iconSize:[32,32],iconAnchor:[16,16]});}
function moverIcon(kind){let s='⚠️',cls='';if(kind==='drone'){s='🛩️';cls='drone'}if(kind==='missile'||kind==='strike'){s='🚀';cls='missile'}return L.divIcon({className:'',html:`<div class="threat-symbol ${cls}">${s}</div>`,iconSize:[36,36],iconAnchor:[18,18]});}
function kindLabel(k){return {air:'Повітряна тривога',drone:'Загроза БпЛА / Shahed',missile:'Ракетна загроза',strike:'Загроза ракетного удару'}[k]||k;}
function kindColor(k){return k==='drone'?'#ffd21f':'#ef3340';}

function normalizeResult(r){
  const a=r.address||{};
  const name=(r.namedetails&&r.namedetails['name:uk']) || r.name || a.city || a.town || a.village || a.municipality || r.display_name.split(',')[0];
  const bbox=Array.isArray(r.boundingbox)?r.boundingbox.map(Number):null;
  return {name,lat:Number(r.lat),lng:Number(r.lon),bbox,display:r.display_name,type:r.type,address:a};
}

function selectPlace(p){
  selected=p;
  document.getElementById('placeSearch').value=p.name;
  document.getElementById('selectedPlace').classList.remove('empty');
  document.getElementById('selectedPlace').innerHTML=`<b>${escapeHtml(p.name)}</b><br><span>${escapeHtml(p.display||'Україна')}</span>`;
  hideSuggestions();
  const key=placeKey(p);
  if(!markers[key]) markers[key]=L.marker([p.lat,p.lng],{icon:safeIcon()}).addTo(map);
  refreshMarker(key,p);
  if(p.bbox){const b=[[p.bbox[0],p.bbox[2]],[p.bbox[1],p.bbox[3]]];map.fitBounds(b,{padding:[30,30],animate:false,maxZoom:11});}
  else map.setView([p.lat,p.lng],10,{animate:false});
  markers[key].openPopup();
}

function escapeHtml(s){return String(s||'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));}
function placeKey(p){return `${p.name}|${p.lat.toFixed(5)}|${p.lng.toFixed(5)}`;}

const searchInput=document.getElementById('placeSearch');
const searchBtn=document.getElementById('searchBtn');

function submitSearch(){
  activeSuggestion=-1;
  const q=searchInput.value.trim();
  if(q.length<2){
    document.getElementById('searchStatus').textContent='Введи мінімум 2 літери';
    hideSuggestions();
    return;
  }
  document.getElementById('searchStatus').textContent='Пошук…';
  runSearch(q);
}

searchBtn.addEventListener('click',submitSearch);

searchInput.addEventListener('input',()=>{
  activeSuggestion=-1;
  document.getElementById('searchStatus').textContent='Натисни «Знайти» або Enter';
  hideSuggestions();
});

searchInput.addEventListener('keydown',e=>{
  const box=document.getElementById('suggestions');

  if(e.key==='Enter'){
    e.preventDefault();
    if(!box.classList.contains('hidden') && activeSuggestion>=0){
      selectPlace(searchResults[activeSuggestion]);
    } else {
      submitSearch();
    }
    return;
  }

  if(box.classList.contains('hidden'))return;
  if(e.key==='ArrowDown'){e.preventDefault();activeSuggestion=Math.min(activeSuggestion+1,searchResults.length-1);paintActive();}
  else if(e.key==='ArrowUp'){e.preventDefault();activeSuggestion=Math.max(activeSuggestion-1,0);paintActive();}
  else if(e.key==='Escape'){hideSuggestions();}
});

async function runSearch(q){
  try{
    const r=await fetch('/api/search?q='+encodeURIComponent(q));
    const data=await r.json();
    if(!Array.isArray(data))throw new Error('bad data');
    searchResults=data.map(normalizeResult);
    document.getElementById('searchStatus').textContent=searchResults.length?`Знайдено: ${searchResults.length}`:'Нічого не знайдено';
    renderSuggestions();
  }catch(e){document.getElementById('searchStatus').textContent='Не вдалося виконати пошук';hideSuggestions();}
}
function renderSuggestions(){
  const box=document.getElementById('suggestions');
  if(!searchResults.length){box.classList.add('hidden');box.innerHTML='';return;}
  box.innerHTML=searchResults.map((p,i)=>`<div class="suggestion" data-i="${i}"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.display)}</span></div>`).join('');
  box.classList.remove('hidden');
  box.querySelectorAll('.suggestion').forEach(el=>el.addEventListener('click',()=>selectPlace(searchResults[Number(el.dataset.i)])));
}
function paintActive(){document.querySelectorAll('.suggestion').forEach((el,i)=>el.classList.toggle('active',i===activeSuggestion));const a=document.querySelector('.suggestion.active');if(a)a.scrollIntoView({block:'nearest'});}
function hideSuggestions(){document.getElementById('suggestions').classList.add('hidden');activeSuggestion=-1;}

document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))hideSuggestions();});

function soundVolume(){return Number(document.getElementById('volumeRange').value)/100;}
function stopAudio(){['airSound','droneSound','allClearSound'].forEach(id=>{const a=document.getElementById(id);a.pause();a.currentTime=0;});}
function playThreatSound(kind){stopAudio();const a=document.getElementById(kind==='drone'?'droneSound':'airSound');a.volume=soundVolume();a.currentTime=0;a.play().catch(()=>{});}
function playAllClear(){stopAudio();const a=document.getElementById('allClearSound');a.volume=soundVolume();a.currentTime=0;a.play().catch(()=>{});}
document.getElementById('volumeRange').addEventListener('input',e=>document.getElementById('volumeValue').textContent=e.target.value+'%');

function refreshMarker(key,p){
  const m=markers[key];if(!m)return;const a=activeAlerts[key];
  if(a){m.setIcon(alertIcon(a.kind));m.bindPopup(`<b>${escapeHtml(a.place.name)}</b><br><b style="color:${kindColor(a.kind)}">${kindLabel(a.kind)}</b><br><small>${new Date(a.time).toLocaleString('uk-UA')}</small>`);}
  else{m.setIcon(safeIcon());m.bindPopup(`<b>${escapeHtml(p.name)}</b><br><span style="color:#2ecc71">Немає ручної загрози</span>`);}
}

function removeFx(key){if(zones[key]){map.removeLayer(zones[key]);delete zones[key];}if(movers[key]){map.removeLayer(movers[key]);delete movers[key];}if(moveTimers[key]){clearInterval(moveTimers[key]);delete moveTimers[key];}}
function makePlaceBounds(p,wide){
  if(p.bbox&&!wide){return [[p.bbox[0],p.bbox[2]],[p.bbox[1],p.bbox[3]]];}
  const d=wide?1.05:.22;return [[p.lat-d,p.lng-d],[p.lat+d,p.lng+d]];
}
async function ensureUkraineBoundary(){
  if(ukraineGeo)return ukraineGeo;
  try{const r=await fetch('/api/ukraine-boundary');ukraineGeo=await r.json();return ukraineGeo;}catch(e){return null;}
}
async function addZone(key,a){
  const color=kindColor(a.kind);const klass=a.kind==='drone'?'fx-zone-yellow':'fx-zone-red';
  if(a.scope==='country'){
    const geo=await ensureUkraineBoundary();
    if(geo){zones[key]=L.geoJSON(geo,{style:{color,weight:2,fillColor:color,fillOpacity:a.kind==='drone'?.24:.32,className:klass}}).addTo(map);}
    else{zones[key]=L.rectangle([[44.2,22.0],[52.5,40.3]],{color,weight:2,fillColor:color,fillOpacity:.28,className:klass}).addTo(map);}
  }else{
    const b=makePlaceBounds(a.place,a.scope==='wide');
    zones[key]=L.rectangle(b,{color,weight:3,fillColor:color,fillOpacity:a.kind==='drone'?.24:.33,className:klass}).addTo(map);
  }
}
function addMover(key,a){
  if(a.kind==='air')return;
  const p=a.place;const start=[p.lat+1.0,p.lng-1.6];const m=L.marker(start,{icon:moverIcon(a.kind),zIndexOffset:2000}).addTo(map);movers[key]=m;let t=0;
  moveTimers[key]=setInterval(()=>{t+=.025;if(t>=1){clearInterval(moveTimers[key]);delete moveTimers[key];t=1;}const curve=Math.sin(t*Math.PI)*.28;m.setLatLng([start[0]+(p.lat-start[0])*t+curve,start[1]+(p.lng-start[1])*t]);},90);
}
function showBanner(a){
  clearTimeout(bannerTimer);const b=document.getElementById('banner');b.className=`banner ${a.kind==='drone'?'yellow':'red'}`;b.textContent=`${kindLabel(a.kind)} — ${a.scope==='country'?'Україна':a.place.name}`;
  bannerTimer=setTimeout(()=>b.classList.add('hidden'),6500);
}
function save(){localStorage.setItem('uaAlertSimV2',JSON.stringify(activeAlerts));renderActive();}

async function startAlert(){
  if(!selected){alert('Спочатку знайди і вибери місто або район.');return;}
  const key=placeKey(selected);const kind=document.getElementById('threatSelect').value;const scope=document.getElementById('scopeSelect').value;
  removeFx(key);activeAlerts[key]={place:selected,kind,scope,time:new Date().toISOString()};save();
  if(!markers[key])markers[key]=L.marker([selected.lat,selected.lng],{icon:safeIcon()}).addTo(map);
  refreshMarker(key,selected);await addZone(key,activeAlerts[key]);addMover(key,activeAlerts[key]);playThreatSound(kind);showBanner(activeAlerts[key]);
  if(scope==='country')map.setView([49.1,31.2],6,{animate:false}); else map.setView([selected.lat,selected.lng],scope==='wide'?7:10,{animate:false});
  markers[key].openPopup();
}
function stopOne(key,withSound=true){
  const a=activeAlerts[key];if(!a)return;delete activeAlerts[key];removeFx(key);refreshMarker(key,a.place);save();if(withSound)playAllClear();
}
document.getElementById('startBtn').addEventListener('click',startAlert);
document.getElementById('stopBtn').addEventListener('click',()=>{if(!selected)return;stopOne(placeKey(selected),true);});
document.getElementById('stopAllBtn').addEventListener('click',()=>{const keys=Object.keys(activeAlerts);keys.forEach(k=>stopOne(k,false));if(keys.length)playAllClear();});

function renderActive(){
  const box=document.getElementById('activeList');const entries=Object.entries(activeAlerts);
  if(!entries.length){box.textContent='Немає активних загроз.';return;}
  box.innerHTML=entries.map(([key,a])=>`<div class="active-item ${a.kind==='drone'?'drone':''}"><b>${escapeHtml(a.place.name)}</b><span>${kindLabel(a.kind)}</span><small>${a.scope==='country'?'Вся Україна':a.scope==='wide'?'Велика зона':'Місто / район'}</small><div class="active-actions"><button class="mini focus" data-key="${escapeHtml(key)}">Показати</button><button class="mini end" data-key="${escapeHtml(key)}">Відбій</button></div></div>`).join('');
  box.querySelectorAll('.focus').forEach(btn=>btn.onclick=()=>{const a=activeAlerts[btn.dataset.key];if(a)map.setView([a.place.lat,a.place.lng],9,{animate:false});});
  box.querySelectorAll('.end').forEach(btn=>btn.onclick=()=>stopOne(btn.dataset.key,true));
}

async function restore(){
  for(const [key,a] of Object.entries(activeAlerts)){
    if(!a?.place)continue;markers[key]=L.marker([a.place.lat,a.place.lng],{icon:alertIcon(a.kind)}).addTo(map);refreshMarker(key,a.place);await addZone(key,a);
  }
  renderActive();
}
restore();
window.addEventListener('load',()=>setTimeout(()=>map.invalidateSize(false),120));
window.addEventListener('resize',()=>map.invalidateSize(false));
