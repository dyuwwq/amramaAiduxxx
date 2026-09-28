
const statusEl=document.getElementById('status'), destEl=document.getElementById('destName'), metaEl=document.getElementById('routeMeta');
const input=document.getElementById('target-input'), results=document.getElementById('results'), actions=document.getElementById('routeActions');
let userPos=null,destination=null,routeProfile='driving',routeMarker=null,placeMarkers=[],terrainOn=true,globeOn=true,buildingOn=false,routeSeq=0;
const WORLD=[0,20], KOSTANAY=[63.6246,53.2144];

const map=new maplibregl.Map({
 container:'map',
 style:'https://tiles.openfreemap.org/styles/liberty',
 center:WORLD, zoom:1.35, pitch:18, bearing:0, maxPitch:85,
 attributionControl:false, canvasContextAttributes:{antialias:true}
});
map.addControl(new maplibregl.NavigationControl({showCompass:true,visualizePitch:true}),'bottom-right');

function setStatus(t){statusEl.textContent=t}
function formatDistance(m){return m<1000?Math.round(m)+' м':(m/1000).toFixed(1)+' км'}
function formatTime(sec){const min=Math.round(sec/60);return min<60?`${min} мин`:`${Math.floor(min/60)} ч ${min%60} мин`}
function dist(a,b){const R=6371000,p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dp=(b.lat-a.lat)*Math.PI/180,dl=(b.lng-a.lng)*Math.PI/180,x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
function addTerrain(){
 if(map.getSource('aidux-terrain')) return;
 map.addSource('aidux-terrain',{type:'raster-dem',url:'https://tiles.mapterhorn.com/tilejson.json',tileSize:256,maxzoom:14});
 map.setTerrain({source:'aidux-terrain',exaggeration:1.12});
}
function removeTerrain(){try{map.setTerrain(null)}catch(e){}}
function addBuildings(){
 const style=map.getStyle();
 if(!style.sources?.openmaptiles || map.getLayer('aidux-3d-buildings')) return;
 try{
  map.addLayer({id:'aidux-3d-buildings',type:'fill-extrusion',source:'openmaptiles','source-layer':'building',minzoom:14,
   filter:['!=',['get','hide_3d'],'true'],
   paint:{'fill-extrusion-color':['interpolate',['linear'],['coalesce',['get','render_height'],0],0,'#21402d',30,'#36d36f',120,'#9cffb2'],'fill-extrusion-height':['coalesce',['get','render_height'],3],'fill-extrusion-base':['coalesce',['get','render_min_height'],0],'fill-extrusion-opacity':.82}});
  buildingOn=true;document.getElementById('buildingsBtn').textContent='🏙️ 3D-здания: ВКЛ';
 }catch(e){console.warn('3D buildings unavailable',e);setStatus('3D-здания недоступны в этом стиле')}
}
function removeBuildings(){if(map.getLayer('aidux-3d-buildings'))map.removeLayer('aidux-3d-buildings');buildingOn=false;document.getElementById('buildingsBtn').textContent='🏙️ 3D-здания'}
function setProjection(globe){
 globeOn=globe;
 try{map.setProjection({type:globe?'globe':'mercator'});}catch(e){console.warn(e)}
 document.getElementById('modePill').textContent=globe?'GLOBE':'3D MERCATOR';
 document.getElementById('globeBtn').textContent=globe?'🌍 Глобус':'🗺️ Плоская карта';
}
function clearRoute(){if(map.getLayer('route-line'))map.removeLayer('route-line');if(map.getSource('route'))map.removeSource('route')}
async function getUserLocation(){return new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(new Error('GPS недоступен'));navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}),reject,{enableHighAccuracy:true,timeout:12000,maximumAge:10000})})}
async function geocode(q){
 results.style.display='block';results.innerHTML='<div class="result">🔎 Ищем…</div>';
 const url='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&q='+encodeURIComponent(q);
 const r=await fetch(url,{headers:{Accept:'application/json'}});if(!r.ok)throw new Error('search');return r.json();
}
function showResults(items){
 results.innerHTML='';if(!items.length){results.innerHTML='<div class="result"><b>Ничего не найдено</b><span>Добавь город, улицу или страну.</span></div>';return}
 items.forEach(item=>{const d=document.createElement('div');d.className='result';d.innerHTML=`<b>${item.name||item.display_name.split(',')[0]}</b><span>${item.display_name}</span>`;d.onclick=()=>selectDestination(item);results.appendChild(d)})
}
function selectDestination(item){
 destination={lat:+item.lat,lng:+item.lon,name:item.name||item.display_name.split(',')[0],full:item.display_name};
 destEl.textContent=destination.name;metaEl.textContent='Маршрут можно построить от GPS';results.style.display='none';
 map.flyTo({center:[destination.lng,destination.lat],zoom:16,pitch:58,duration:1000}); addDestinationMarker(destination); actions.style.display='grid';
}
function addDestinationMarker(p){
 if(routeMarker)routeMarker.remove();
 const el=document.createElement('div');el.className='marker-pin';routeMarker=new maplibregl.Marker({element:el}).setLngLat([p.lng,p.lat]).addTo(map);
}
function showPlaceMarkers(items){
 placeMarkers.forEach(m=>m.remove());placeMarkers=[];
 items.forEach(item=>{const p={lat:+item.lat,lng:+item.lon,name:item.name||item.display_name.split(',')[0],full:item.display_name};const el=document.createElement('div');el.className='marker-pin';const m=new maplibregl.Marker({element:el}).setLngLat([p.lng,p.lat]).setPopup(new maplibregl.Popup({offset:12}).setHTML(`<strong>${escapeHtml(p.name)}</strong><br><span style="font-size:12px;color:#68756d">${escapeHtml(p.full)}</span><br><button onclick='window.aiduxSelect(${p.lat},${p.lng},${JSON.stringify(p.name)})' style="margin-top:8px;padding:6px 9px;border-radius:8px;border:0;background:#36d36f">Маршрут</button>`)).addTo(map);placeMarkers.push(m)})
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
window.aiduxSelect=(lat,lng,name)=>selectDestination({lat,lng,name,display_name:name});

const PLACE_INTENTS={
 food:{label:'Где поесть',emoji:'🍴',queries:['restaurant','cafe','fast food']},
 billiards:{label:'Бильярд',emoji:'🎱',queries:['бильярд','billiards','pool hall']},
 birthday:{label:'День рождения',emoji:'🎂',queries:['банкетный зал','event venue','restaurant']},
 coffee:{label:'Кофе',emoji:'☕',queries:['cafe','coffee shop']},
 sport:{label:'Спорт',emoji:'🏀',queries:['sports centre','fitness centre','gym']},
 entertainment:{label:'Развлечения',emoji:'🎮',queries:['entertainment','bowling','cinema','amusement']}
};
let placeIntent=null;

async function ensurePlaceLocation(){
 if(userPos) return userPos;
 try{
  userPos=await getUserLocation();
  document.getElementById('placeScope').textContent='по GPS';
  return userPos;
 }catch(_){
  const c=map.getCenter();
  const fallback={lat:c.lat,lng:c.lng,accuracy:null};
  document.getElementById('placeScope').textContent='по центру карты';
  return fallback;
 }
}
async function nominatimPlaces(query, center, radiusKm=7){
 const d=radiusKm/111;
 const left=center.lng-d/Math.max(.35,Math.cos(center.lat*Math.PI/180)), right=center.lng+d/Math.max(.35,Math.cos(center.lat*Math.PI/180));
 const top=Math.min(85,center.lat+d), bottom=Math.max(-85,center.lat-d);
 const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=12&addressdetails=1&bounded=1&viewbox=${left},${top},${right},${bottom}&q=${encodeURIComponent(query)}`;
 const r=await fetch(url,{headers:{Accept:'application/json'}});
 if(!r.ok) throw new Error('search');
 return r.json();
}
function placeName(item){return item.name||item.display_name?.split(',')[0]||'Место'}
function mergePlaceItems(groups, center){
 const mapById=new Map();
 groups.flat().forEach(x=>{
  const key=x.place_id||`${x.lat}:${x.lon}`;
  if(!mapById.has(key)) mapById.set(key,x);
 });
 return [...mapById.values()].map(x=>({
  ...x,
  _distance:dist(center,{lat:+x.lat,lng:+x.lon})
 })).sort((a,b)=>a._distance-b._distance).slice(0,15);
}
function showPlaceResults(items,intent){
 results.style.display='block';
 if(!items.length){
  results.innerHTML=`<div class="result"><b>${intent?.emoji||'🔎'} Ничего подходящего не нашли</b><span>Попробуй другой район или категорию.</span></div>`;
  return;
 }
 results.innerHTML=items.map((item,i)=>`
  <div class="result place-result" data-place-result="${i}">
   <span class="place-distance">${formatDistance(item._distance)}</span>
   <b>${intent?.emoji||'📍'} ${escapeHtml(placeName(item))}</b>
   <span>${escapeHtml(item.display_name||'Адрес не указан')}</span>
  </div>`).join('');
 results.querySelectorAll('[data-place-result]').forEach(el=>el.onclick=()=>{
  const p=items[+el.dataset.placeResult];
  selectDestination({lat:+p.lat,lng:+p.lon,name:placeName(p),full:p.display_name});
  results.style.display='none';
 });
}
async function searchPlaces(intentKey, customQuery=''){
 const intent=PLACE_INTENTS[intentKey];
 if(!intent && !customQuery.trim()) return;
 document.querySelectorAll('[data-place]').forEach(b=>b.classList.toggle('active',b.dataset.place===intentKey));
 const center=await ensurePlaceLocation();
 const label=intent?.label||customQuery;
 input.value='';
 document.getElementById('placeInput').value=customQuery||intent.label;
 results.style.display='block';
 results.innerHTML=`<div class="result">🔎 Ищем ${escapeHtml(label.toLowerCase())} рядом…</div>`;
 setStatus(`Ищем: ${label}`);
 try{
  const queries=intent?.queries||[customQuery];
  const groups=await Promise.all(queries.map(q=>nominatimPlaces(q,center,7).catch(()=>[])));
  const items=mergePlaceItems(groups,center);
  showPlaceResults(items,intent);
  showPlaceMarkers(items);
  if(items.length){
   const first=items[0];
   map.flyTo({center:[+first.lon,+first.lat],zoom:14,pitch:52,duration:900});
   setStatus(`${label}: найдено ${items.length}`);
  }else setStatus('Подходящих мест не найдено');
 }catch(e){
  results.innerHTML='<div class="result"><b>Поиск мест недоступен</b><span>Проверь интернет и попробуй ещё раз.</span></div>';
  setStatus('Ошибка поиска мест');
 }
}
function parsePlaceQuery(q){
 const t=q.toLowerCase();
 if(/бильярд|pool hall|billiard/.test(t)) return 'billiards';
 if(/день рождения|др|банкет|праздник|юбилей/.test(t)) return 'birthday';
 if(/поесть|еда|ресторан|кафе|обед|ужин|завтрак|пицц/.test(t)) return 'food';
 if(/кофе|coffee/.test(t)) return 'coffee';
 if(/спорт|зал|фитнес|баскетбол|футбол|волейбол/.test(t)) return 'sport';
 if(/развлеч|кино|боулинг|игров/.test(t)) return 'entertainment';
 return null;
}
document.querySelectorAll('[data-place]').forEach(btn=>btn.addEventListener('click',()=>searchPlaces(btn.dataset.place)));
document.getElementById('placeGo').onclick=()=>{
 const q=document.getElementById('placeInput').value.trim();
 if(!q) return;
 const intent=parsePlaceQuery(q);
 searchPlaces(intent,q);
};
document.getElementById('placeInput').addEventListener('keydown',e=>{
 if(e.key==='Enter'){e.preventDefault();document.getElementById('placeGo').click();}
});

async function searchCategory(cat){
 const c=map.getCenter(), d=map.getZoom()<5?12:2.5, left=c.lng-d,right=c.lng+d,top=Math.min(85,c.lat+d),bottom=Math.max(-85,c.lat-d);
 results.style.display='block';results.innerHTML=`<div class="result">🔎 Ищем ${cat} рядом с видом карты…</div>`;
 try{
  const q=`${cat}`;const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=20&bounded=1&viewbox=${left},${top},${right},${bottom}&q=${encodeURIComponent(q)}`;
  const r=await fetch(url,{headers:{Accept:'application/json'}});const items=await r.json();
  showResults(items);showPlaceMarkers(items);setStatus(items.length?`Найдено: ${items.length}`:'Мест не найдено');
 }catch(e){results.innerHTML='<div class="result"><b>Поиск недоступен</b><span>Проверь интернет.</span></div>'}
}
async function buildRoute(){
 const seq=++routeSeq;if(!destination)return;
 try{
  if(!userPos)userPos=await getUserLocation();
  setStatus('Строим маршрут…');
  const coords=`${userPos.lng},${userPos.lat};${destination.lng},${destination.lat}`;
  const url=`https://router.project-osrm.org/route/v1/${routeProfile}/${coords}?overview=full&geometries=geojson&steps=true&alternatives=true`;
  const r=await fetch(url);const data=await r.json();if(seq!==routeSeq) return;if(data.code!=='Ok'||!data.routes?.length)throw new Error('Маршрут не найден');
  const route=data.routes[0];clearRoute();
  map.addSource('route',{type:'geojson',data:{type:'Feature',geometry:route.geometry}});
  map.addLayer({id:'route-line',type:'line',source:'route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#36d36f','line-width':['interpolate',['linear'],['zoom'],3,2,10,4,16,8,19,11],'line-opacity':.95}});
  const b=new maplibregl.LngLatBounds();route.geometry.coordinates.forEach(c=>b.extend(c));
  map.fitBounds(b,{padding:window.innerWidth<=620?{top:250,bottom:210,left:30,right:30}:{top:170,bottom:180,left:440,right:80},duration:1000,maxZoom:17});
  metaEl.textContent=`${formatDistance(route.distance)} · ${formatTime(route.duration)}`;setStatus('Маршрут построен');
 }catch(e){metaEl.textContent=e.message.includes('GPS')?'Разреши доступ к геолокации':'Не удалось построить маршрут';setStatus('Ошибка маршрута')}
}
async function locate(){
 try{setStatus('Определяем GPS…');userPos=await getUserLocation();map.flyTo({center:[userPos.lng,userPos.lat],zoom:16,pitch:58,duration:1000});if(window.userMarker)window.userMarker.remove();window.userMarker=new maplibregl.Marker({color:'#36d36f'}).setLngLat([userPos.lng,userPos.lat]).addTo(map);setStatus(`GPS найден ±${Math.round(userPos.accuracy)} м`);if(destination)buildRoute()}catch(e){setStatus('Разреши GPS в браузере')}
}
function saveFavorite(){if(!destination)return;const f=JSON.parse(localStorage.getItem('aidux-favorites')||'[]');if(!f.some(x=>x.lat===destination.lat&&x.lng===destination.lng)){f.unshift(destination);localStorage.setItem('aidux-favorites',JSON.stringify(f.slice(0,30)));setStatus('Место добавлено в избранное ★')}else setStatus('Место уже в избранном')}
function showFavorites(){const f=JSON.parse(localStorage.getItem('aidux-favorites')||'[]');results.style.display='block';results.innerHTML=f.length?f.map((x,i)=>`<div class="result" data-fav="${i}"><b>★ ${escapeHtml(x.name)}</b><span>${escapeHtml(x.full||x.name)}</span></div>`).join(''):'<div class="result"><b>Избранное пусто</b><span>Выбери место и добавь его в избранное.</span></div>';results.querySelectorAll('[data-fav]').forEach(el=>el.onclick=()=>{const x=f[+el.dataset.fav];selectDestination(x)})}
function shareMap(){const c=map.getCenter();const url=`${location.origin}${location.pathname}#${c.lat.toFixed(5)},${c.lng.toFixed(5)},${map.getZoom().toFixed(2)}`;navigator.clipboard?.writeText(url).then(()=>setStatus('Ссылка на карту скопирована')).catch(()=>prompt('Скопируй ссылку:',url))}
function readHash(){const a=location.hash.slice(1).split(',').map(Number);if(a.length===3&&a.every(Number.isFinite))map.jumpTo({center:[a[1],a[0]],zoom:a[2]})}

map.on('load',()=>{
 try{addTerrain()}catch(e){terrainOn=false;document.getElementById('terrainBtn').textContent='⛰️ 3D-рельеф: НЕТ'}
 setProjection(true); readHash();
 setStatus('3D-глобус готов • крути, приближай, наклоняй');
});
document.getElementById('go-btn').onclick=async()=>{const q=input.value.trim();if(!q)return;setStatus('Ищем…');try{showResults(await geocode(q));setStatus('Результаты поиска готовы')}catch(e){setStatus('Ошибка поиска');results.style.display='block';results.innerHTML='<div class="result"><b>Поиск временно недоступен</b></div>'}};
input.addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('go-btn').click()});
document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>searchCategory(b.dataset.cat));
document.getElementById('locateBtn').onclick=locate;document.getElementById('arBtn').onclick=()=>location.href='ar-nav.html';document.getElementById('shareBtn').onclick=shareMap;
document.getElementById('driveBtn').onclick=()=>{routeProfile='driving';driveBtn.classList.add('active');walkBtn.classList.remove('active');buildRoute()};
document.getElementById('walkBtn').onclick=()=>{routeProfile='walking';walkBtn.classList.add('active');driveBtn.classList.remove('active');buildRoute()};
document.getElementById('globeBtn').onclick=()=>setProjection(!globeOn);
document.getElementById('terrainBtn').onclick=()=>{terrainOn=!terrainOn;if(terrainOn)addTerrain();else removeTerrain();document.getElementById('terrainBtn').textContent=terrainOn?'⛰️ 3D-рельеф: ВКЛ':'⛰️ 3D-рельеф: ВЫКЛ'};
document.getElementById('buildingsBtn').onclick=()=>buildingOn?removeBuildings():addBuildings();
document.getElementById('favoritesBtn').onclick=showFavorites;
document.getElementById('zoomIn').onclick=()=>map.zoomIn();document.getElementById('zoomOut').onclick=()=>map.zoomOut();
document.getElementById('reset').onclick=()=>{map.flyTo({center:WORLD,zoom:1.35,pitch:18,bearing:0,duration:900});setProjection(true);setStatus('Вернулись к миру')};
document.getElementById('pitch').onclick=()=>map.easeTo({pitch:map.getPitch()>35?12:62,duration:700});
window.addEventListener('beforeunload',()=>{if(window.userMarker)window.userMarker.remove()});
