// AIDUX map: вся логика карты в одном файле.
// Данные: OpenFreeMap (тайлы), OSM через наш сервер /api (места, адреса), routing.openstreetmap.de (маршруты).
'use strict';
const $ = id => document.getElementById(id);
const KOST = { lat: 53.2144, lng: 63.6246 };
const results = $('results'), actions = $('routeActions');

let userPos = null, destination = null, profile = 'car', routeSeq = 0;
let userMarker = null, destMarker = null, placeMarkers = [], pickMode = false;
let lastList = [], lastLabel = '', onlyOpen = false, lastQ = '', buildingsOn = false, globeOn = false;

// ---------- Мелкие помощники ----------
const setStatus = t => { $('status').textContent = t; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const formatDistance = m => m < 1000 ? Math.round(m) + ' м' : (m / 1000).toFixed(1) + ' км';
const formatTime = sec => { const min = Math.max(1, Math.round(sec / 60)); return min < 60 ? `${min} мин` : `${Math.floor(min / 60)} ч ${min % 60} мин`; };
const dist = (a, b) => {
  const R = 6371000, r = Math.PI / 180, dp = (b.lat - a.lat) * r, dl = (b.lng - a.lng) * r;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
const q4 = c => ({ lat: c.lat.toFixed(4), lng: c.lng.toFixed(4) });
const validPos = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* хранилище недоступно */ } };
async function api(path, params) {
  const r = await fetch(path + '?' + new URLSearchParams(params));
  if (!r.ok) throw new Error('api ' + r.status);
  return r.json();
}

// ---------- Мобильная панель ----------
const mapUi = document.querySelector('.map-ui');
function setMobileSearch(open) {
  mapUi.classList.toggle('mobile-open', open);
  $('mobileSearchToggle').setAttribute('aria-expanded', String(open));
}
$('mobileSearchToggle').addEventListener('click', () => setMobileSearch(!mapUi.classList.contains('mobile-open')));
$('mobileSearchClose').addEventListener('click', () => setMobileSearch(false));

// ---------- Карта (стартуем в Костанае, плоская, без рельефа) ----------
const map = new maplibregl.Map({
  container: 'map', style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [KOST.lng, KOST.lat], zoom: 11, pitch: 0, maxPitch: 75, attributionControl: false
});
map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
map.on('error', e => console.warn('map:', e?.error?.message || e));
const onReady = fn => (map.isStyleLoaded() ? fn() : map.once('load', fn));

// Ссылка вида map.html#lat,lng,zoom
(() => {
  const a = location.hash.slice(1).split(',').map(Number);
  if (a.length === 3 && a.every(Number.isFinite) && validPos({ lat: a[0], lng: a[1] })) map.jumpTo({ center: [a[1], a[0]], zoom: a[2] });
})();

function toggleBuildings() {
  if (buildingsOn) {
    if (map.getLayer('aidux-3d-buildings')) map.removeLayer('aidux-3d-buildings');
    buildingsOn = false; $('buildingsBtn').textContent = '🏙️ 3D-здания'; return;
  }
  if (!map.getStyle().sources?.openmaptiles) return setStatus('3D-здания недоступны в этом стиле карты');
  try {
    map.addLayer({
      id: 'aidux-3d-buildings', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 0], 0, '#21402d', 30, '#36d36f', 120, '#9cffb2'],
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 3],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': .82
      }
    });
    buildingsOn = true; $('buildingsBtn').textContent = '🏙️ 3D-здания: ВКЛ';
    map.easeTo({ pitch: 55, duration: 700 });
  } catch (e) { console.warn(e); setStatus('3D-здания недоступны'); }
}
function toggleGlobe() {
  globeOn = !globeOn;
  try { map.setProjection({ type: globeOn ? 'globe' : 'mercator' }); } catch (e) { console.warn(e); globeOn = !globeOn; return; }
  $('modePill').textContent = globeOn ? 'GLOBE' : '2D';
  $('globeBtn').textContent = globeOn ? '🗺️ Плоская карта' : '🌍 Глобус';
}

// ---------- Моё местоположение ----------
const getGps = opts => new Promise((resolve, reject) => {
  if (!navigator.geolocation) return reject(Object.assign(new Error('nogps'), { code: 0 }));
  navigator.geolocation.getCurrentPosition(
    p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }), reject, opts);
});
function circle(c, rM) {
  const pts = [], kx = 111320 * Math.cos(c.lat * Math.PI / 180), ky = 110540;
  for (let i = 0; i <= 64; i++) { const a = i / 64 * 2 * Math.PI; pts.push([c.lng + rM * Math.cos(a) / kx, c.lat + rM * Math.sin(a) / ky]); }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } };
}
function drawAccuracy(p) {
  const data = circle(p, Math.max(p.accuracy || 0, 0));
  if (map.getSource('acc')) return map.getSource('acc').setData(data);
  map.addSource('acc', { type: 'geojson', data });
  map.addLayer({ id: 'acc-fill', type: 'fill', source: 'acc', paint: { 'fill-color': '#36d36f', 'fill-opacity': .15 } });
  map.addLayer({ id: 'acc-line', type: 'line', source: 'acc', paint: { 'line-color': '#36d36f', 'line-width': 1.5 } });
}
function setUser(p, { manual = false, fly = true } = {}) {
  userPos = { lat: p.lat, lng: p.lng, accuracy: p.accuracy || 0, manual };
  userMarker?.remove();
  userMarker = new maplibregl.Marker({ color: '#36d36f', draggable: manual }).setLngLat([p.lng, p.lat]).addTo(map);
  if (manual) {
    lsSet('aidux-home', { lat: p.lat, lng: p.lng });
    userMarker.on('dragend', () => { const l = userMarker.getLngLat(); setUser({ lat: l.lat, lng: l.lng }, { manual: true, fly: false }); if (destination) buildRoute(); });
  }
  onReady(() => drawAccuracy(userPos));
  if (fly) map.flyTo({ center: [p.lng, p.lat], zoom: userPos.accuracy > 2000 ? 13 : userPos.accuracy > 300 ? 15 : 16, pitch: 0, duration: 900 });
  $('placeScope').textContent = manual ? 'от вашей точки' : 'по GPS';
  setStatus(manual ? `📌 Вы здесь (отмечено): ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`
    : `📍 GPS: ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)} ±${Math.round(userPos.accuracy)} м`);
}
async function locate() {
  if (!navigator.geolocation) return setStatus('Браузер не поддерживает геолокацию. Нажми «📌 Я здесь (на карте)»');
  if (!window.isSecureContext) return setStatus('Геолокация работает только на HTTPS или localhost. Открой http://localhost:5500/map.html');
  setStatus('Определяем местоположение…');
  let p;
  try { p = await getGps({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }); }
  catch (e) {
    if (e.code === 1) return setStatus('Доступ к геолокации запрещён. Разреши его для сайта или нажми «📌 Я здесь (на карте)»');
    try { p = await getGps({ enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }); }
    catch (_) { return setStatus('Не удалось определить место. Нажми «📌 Я здесь (на карте)» и отметь точку'); }
  }
  if (!validPos(p)) return setStatus('Браузер вернул неверные координаты. Нажми «📌 Я здесь (на карте)»');
  setUser(p);
  if (p.accuracy > 3000) setStatus(`Точность низкая (±${Math.round(p.accuracy / 1000)} км), это похоже на определение по IP. Точнее: «📌 Я здесь (на карте)»`);
  else if (dist(p, KOST) > 1500000) setStatus(`Определено далеко от Костаная: ${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}. Если это неверно, нажми «📌 Я здесь (на карте)»`);
}
function togglePick() {
  pickMode = !pickMode;
  map.getCanvas().style.cursor = pickMode ? 'crosshair' : '';
  $('pickBtn').classList.toggle('active', pickMode);
  setStatus(pickMode ? 'Нажми на карте там, где ты находишься' : 'Режим отметки выключен');
  if (pickMode) setMobileSearch(false);
}
map.on('click', e => {
  if (!pickMode) return;
  togglePick();
  setUser({ lat: e.lngLat.lat, lng: e.lngLat.lng }, { manual: true });
  if (destination) buildRoute();
});

// ---------- Центры поиска ----------
// Адреса и названия ищем там, куда смотрит карта (при далёком зуме берём Костанай). «Рядом» считаем от человека.
const viewCenter = () => (map.getZoom() < 8 ? KOST : { lat: map.getCenter().lat, lng: map.getCenter().lng });
const nearCenter = () => (userPos ? { lat: userPos.lat, lng: userPos.lng } : viewCenter());

// ---------- Часы работы (формат opening_hours из OSM) ----------
// <hours>
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'], RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const hm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const fmt = m => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
function parseHours(str) {
  if (!str) return null;
  if (/^\s*24\/7\s*$/.test(str)) return { days: Array(7).fill([[0, 1440]]) };
  const d = '(?:Mo|Tu|We|Th|Fr|Sa|Su)', t = '\\d{1,2}:\\d{2}-\\d{1,2}:\\d{2}';
  const rule = new RegExp(`^\\s*(${d}(?:-${d})?(?:\\s*,\\s*${d}(?:-${d})?)*)?\\s*(off|closed|${t}(?:\\s*,\\s*${t})*)\\s*$`, 'i');
  const days = Array(7).fill(null);
  for (const part of str.split(';')) {
    if (!part.trim() || /^\s*PH\b/i.test(part)) continue;
    const m = part.match(rule);
    if (!m) return null;
    const sel = new Set();
    if (m[1]) {
      m[1].split(',').forEach(tok => {
        const [a, b] = tok.trim().split('-').map(x => DAYS.findIndex(y => y.toLowerCase() === x.toLowerCase()));
        if (b === undefined) sel.add(a);
        else for (let i = a; ; i = (i + 1) % 7) { sel.add(i); if (i === b) break; }
      });
    } else DAYS.forEach((_, i) => sel.add(i));
    const iv = /^(off|closed)$/i.test(m[2]) ? [] : m[2].split(',').map(x => { const [s, e] = x.trim().split('-'); return [hm(s), hm(e)]; });
    sel.forEach(i => { days[i] = iv; });
  }
  return { days };
}
function hoursStatus(str, now = new Date()) {
  const p = parseHours(str);
  if (!p) return { state: 'unknown', label: str ? 'Часы: ' + str : 'Часы работы не указаны' };
  const dow = (now.getDay() + 6) % 7, t = now.getHours() * 60 + now.getMinutes();
  const today = p.days[dow] || [], yest = p.days[(dow + 6) % 7] || [];
  for (const [s, e] of today) {
    if (e - s >= 1440) return { state: 'open', label: 'Круглосуточно' };
    const end = e <= s ? e + 1440 : e;
    if (t >= s && t < end) return { state: 'open', label: 'Открыто до ' + fmt(end) };
  }
  for (const [s, e] of yest) if (e <= s && t < e) return { state: 'open', label: 'Открыто до ' + fmt(e) };
  for (let k = 0; k < 8; k++) {
    const starts = (p.days[(dow + k) % 7] || []).map(x => x[0]).filter(s => k > 0 || s > t).sort((a, b) => a - b);
    if (starts.length) return { state: 'closed', label: 'Закрыто · откроется ' + (k === 0 ? '' : k === 1 ? 'завтра ' : RU[(dow + k) % 7] + ' ') + 'в ' + fmt(starts[0]) };
  }
  return { state: 'closed', label: 'Закрыто' };
}
// </hours>

// ---------- Метки и карточка места ----------
function clearPlaceMarkers() { placeMarkers.forEach(m => m.remove()); placeMarkers = []; }
function showPlaceMarkers(list) {
  clearPlaceMarkers();
  list.forEach(p => {
    const el = document.createElement('div'); el.className = 'marker-pin';
    const box = document.createElement('div');
    box.innerHTML = `<strong>${esc(p.name)}</strong><br><span style="font-size:12px;color:#68756d">${esc(p.address || p.kind || '')}</span><br>`;
    const b = document.createElement('button'); b.textContent = 'Подробнее';
    b.style.cssText = 'margin-top:8px;padding:6px 9px;border-radius:8px;border:0;background:#36d36f';
    b.onclick = () => pick(p); box.appendChild(b);
    placeMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat])
      .setPopup(new maplibregl.Popup({ offset: 12 }).setDOMContent(box)).addTo(map));
  });
}
function showCard(p) {
  let el = $('placeCard');
  if (!el) { el = document.createElement('div'); el.id = 'placeCard'; document.querySelector('.bottom-card').prepend(el); }
  const st = p.id ? hoursStatus(p.hours) : null;
  const phone = String(p.phone || '').split(';')[0].replace(/[^\d+]/g, '');
  const w = String(p.website || '').trim();
  const site = /^https?:\/\//i.test(w) ? w : (w && !/^[a-z][a-z0-9+.-]*:/i.test(w) ? 'https://' + w : '');
  const sub = [p.kind, p.cuisine, userPos ? formatDistance(dist(userPos, p)) : ''].filter(Boolean).join(' · ');
  el.innerHTML = `
   <button class="pc-close" aria-label="Закрыть">✕</button>
   <h3>${esc(p.name)}</h3>
   ${sub ? `<div class="pc-sub">${esc(sub)}</div>` : ''}
   ${st ? `<div class="pc-st ${st.state}">${esc(st.label)}</div>` : ''}
   ${p.hours && st?.state !== 'unknown' ? `<div class="pc-row">🕒 ${esc(p.hours)}</div>` : ''}
   ${p.address ? `<div class="pc-row">📍 ${esc(p.address)}</div>` : ''}
   ${phone ? `<div class="pc-row">📞 ${esc(phone)}</div>` : ''}
   <div class="pc-actions">
    <button class="primary" id="pcRoute">➜ Маршрут</button>
    ${phone ? `<a href="tel:${phone}">Позвонить</a>` : ''}
    ${site ? `<a href="${esc(site)}" target="_blank" rel="noopener noreferrer">Сайт</a>` : ''}
    <button id="pcFav">★</button><button id="pcShare">↗</button>
   </div>`;
  el.style.display = 'block';
  el.querySelector('.pc-close').onclick = () => { el.style.display = 'none'; };
  $('pcRoute').onclick = () => buildRoute();
  $('pcFav').onclick = saveFavorite;
  $('pcShare').onclick = () => {
    const url = `${location.origin}${location.pathname}#${p.lat.toFixed(5)},${p.lng.toFixed(5)},17`;
    navigator.clipboard?.writeText(url).then(() => setStatus('Ссылка на место скопирована')).catch(() => prompt('Скопируй ссылку:', url));
  };
}
function selectDestination(d) {
  destination = { lat: +d.lat, lng: +d.lng, name: d.name, full: d.full || d.name, place: d.place || null };
  $('destName').textContent = destination.name;
  $('routeMeta').textContent = userPos ? 'Нажми «Маршрут»' : 'Чтобы построить маршрут, отметь где ты (кнопка «Моё местоположение»)';
  results.style.display = 'none';
  setMobileSearch(false);
  clearRoute();
  destMarker?.remove();
  const el = document.createElement('div'); el.className = 'marker-pin';
  destMarker = new maplibregl.Marker({ element: el }).setLngLat([destination.lng, destination.lat]).addTo(map);
  map.flyTo({ center: [destination.lng, destination.lat], zoom: 16, pitch: buildingsOn ? 55 : 0, duration: 900 });
  actions.style.display = 'grid';
  showCard(destination.place || { name: destination.name, lat: destination.lat, lng: destination.lng, address: destination.full !== destination.name ? destination.full : '' });
}
function pick(p) { selectDestination({ lat: p.lat, lng: p.lng, name: p.name, full: p.address || p.name, place: p }); }

// ---------- Поиск по адресу и названию ----------
async function nominatimLocal(q, wide) { // запасной вариант, если наш сервер недоступен
  const c = viewCenter(), vb = wide ? '' : `&bounded=1&viewbox=${c.lng - .7},${c.lat + .4},${c.lng + .7},${c.lat - .4}`;
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8${vb}&q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error('nominatim');
  return r.json();
}
function showResults(items) {
  results.style.display = 'block';
  if (!items.length) {
    results.innerHTML = '<div class="result"><b>Рядом ничего не найдено</b><span>Искал в радиусе около 40 км. Попробуй написать иначе.</span></div><div class="result" id="wideBtn"><b>🌍 Искать по всему миру</b></div>';
    $('wideBtn').onclick = () => searchAddress(lastQ, true);
    return;
  }
  results.innerHTML = '';
  items.forEach(it => {
    const name = it.name || String(it.display_name || '').split(',')[0] || 'Место';
    const d = document.createElement('div'); d.className = 'result';
    d.innerHTML = `<b>${esc(name)}</b><span>${esc(it.display_name || '')}</span>`;
    d.onclick = () => selectDestination({ lat: +it.lat, lng: +it.lon, name, full: it.display_name });
    results.appendChild(d);
  });
}
async function searchAddress(q, wide = false) {
  lastQ = q;
  results.style.display = 'block';
  results.innerHTML = '<div class="result">🔎 Ищем рядом…</div>';
  setStatus('Ищем…');
  try {
    let items;
    try { items = await api('/api/search', { q, ...q4(viewCenter()), scope: wide ? 'wide' : 'local' }); }
    catch (_) { items = await nominatimLocal(q, wide); }
    showResults(items);
    setStatus(items.length ? `Найдено: ${items.length}` : 'Ничего не найдено');
  } catch (_) {
    results.innerHTML = '<div class="result"><b>Поиск недоступен</b><span>Проверь, что сервер запущен (npm start) и есть интернет.</span></div>';
    setStatus('Ошибка поиска');
  }
}
let typeTimer, typeCtl;
$('target-input').addEventListener('input', e => {
  clearTimeout(typeTimer);
  const q = e.target.value.trim();
  if (q.length < 2) return;
  typeTimer = setTimeout(async () => {
    typeCtl?.abort(); typeCtl = new AbortController();
    try {
      const r = await fetch('/api/suggest?' + new URLSearchParams({ q, ...q4(viewCenter()), scope: 'local' }), { signal: typeCtl.signal });
      if (!r.ok || $('target-input').value.trim() !== q) return;
      lastQ = q; showResults(await r.json());
    } catch (_) { /* нет сервера или запрос отменён */ }
  }, 250);
});
$('go-btn').onclick = () => { const q = $('target-input').value.trim(); if (q) searchAddress(q); };
$('target-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('go-btn').click(); });

// ---------- Поиск мест по категориям ----------
const INTENTS = { food: 'Где поесть', billiards: 'Бильярд', birthday: 'День рождения', coffee: 'Кофе', sport: 'Спорт', entertainment: 'Развлечения' };
const CAT_MAP = { 'кафе': 'coffee', 'ресторан': 'food', 'аптека': 'pharmacy', 'банкомат': 'atm', 'достопримечательность': 'attraction' };
function parseIntent(q) {
  const t = ' ' + q.toLowerCase() + ' ';
  if (/бильярд|billiard|pool hall/.test(t)) return 'billiards';
  if (/день рождения|банкет|праздник|юбилей| др /.test(t)) return 'birthday';
  if (/поесть|еда|ресторан|кафе|обед|ужин|завтрак|пицц/.test(t)) return 'food';
  if (/кофе|coffee/.test(t)) return 'coffee';
  if (/спорт|зал|фитнес|баскетбол|футбол|волейбол/.test(t)) return 'sport';
  if (/развлеч|кино|боулинг|игров/.test(t)) return 'entertainment';
  return null;
}
function renderList() {
  const list = lastList.filter(p => !onlyOpen || p._status.state === 'open');
  results.style.display = 'block';
  results.innerHTML = `<div class="pl-head"><span>${lastList.length} мест · ${esc(lastLabel)}</span><button id="onlyOpenBtn" class="${onlyOpen ? 'on' : ''}">Открыто сейчас</button></div>` +
    (list.length ? list.map((p, i) => `
    <div class="result place-result" data-i="${i}">
     <span class="place-distance">${formatDistance(p.distance)}</span>
     <b>${p.emoji} ${esc(p.name)}</b>
     <span><i class="st ${p._status.state}">${esc(p._status.label)}</i></span>
     <span>${esc(p.address || p.kind)}</span>
    </div>`).join('') : `<div class="result"><b>Ничего не найдено</b><span>${onlyOpen ? 'Сейчас ничего не открыто, выключи фильтр.' : 'Попробуй другой район или категорию.'}</span></div>`);
  $('onlyOpenBtn').onclick = () => { onlyOpen = !onlyOpen; renderList(); };
  results.querySelectorAll('[data-i]').forEach(el => { el.onclick = () => pick(list[+el.dataset.i]); });
  showPlaceMarkers(list);
}
async function runSearch(cat, q, label) {
  const c = nearCenter();
  results.style.display = 'block';
  results.innerHTML = `<div class="result">🔎 Ищем ${esc(label.toLowerCase())} рядом…</div>`;
  setStatus('Ищем: ' + label);
  $('placeScope').textContent = userPos ? (userPos.manual ? 'от вашей точки' : 'по GPS') : 'по центру карты';
  try {
    const data = await api('/api/places', { ...(cat ? { cat } : { q }), ...q4(c), r: 5000 });
    lastList = data.map(p => ({ ...p, _status: hoursStatus(p.hours) }));
    lastLabel = label; renderList();
    if (lastList.length) { map.flyTo({ center: [lastList[0].lng, lastList[0].lat], zoom: 14, duration: 900 }); setStatus(`${label}: найдено ${lastList.length}`); }
    else setStatus('Подходящих мест не найдено');
  } catch (_) {
    results.innerHTML = '<div class="result"><b>Поиск мест недоступен</b><span>Проверь, что сервер запущен (npm start) и есть интернет.</span></div>';
    setStatus('Ошибка поиска мест');
  }
}
function searchPlaces(key, custom = '') {
  const known = !!INTENTS[key];
  const label = known ? INTENTS[key] : custom;
  if (!label) return;
  document.querySelectorAll('[data-place]').forEach(b => b.classList.toggle('active', b.dataset.place === key));
  $('placeInput').value = custom || label;
  return runSearch(known ? key : null, known ? '' : custom, label);
}
document.querySelectorAll('[data-place]').forEach(b => b.addEventListener('click', () => searchPlaces(b.dataset.place)));
document.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => runSearch(CAT_MAP[b.dataset.cat], '', b.dataset.cat)));
$('placeGo').onclick = () => { const q = $('placeInput').value.trim(); if (q) searchPlaces(parseIntent(q), q); };
$('placeInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('placeGo').click(); } });

// ---------- Маршруты (отдельные серверы для авто, пешком и велосипеда) ----------
const ROUTERS = {
  car: 'https://routing.openstreetmap.de/routed-car/route/v1/driving/',
  foot: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/',
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving/'
};
function clearRoute() {
  ['route-line', 'route-casing'].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
  if (map.getSource('route')) map.removeSource('route');
}
async function buildRoute() {
  if (!destination) return;
  if (!userPos) { await locate(); if (!userPos) return; }
  const seq = ++routeSeq;
  setStatus('Строим маршрут…');
  try {
    const url = `${ROUTERS[profile]}${userPos.lng},${userPos.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await r.json();
    if (seq !== routeSeq) return;
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('no route');
    const route = data.routes[0];
    clearRoute();
    map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: route.geometry } });
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#04120a', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 4, 16, 12], 'line-opacity': .6 } });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#36d36f', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2, 16, 7], 'line-opacity': .95 } });
    const b = new maplibregl.LngLatBounds();
    route.geometry.coordinates.forEach(c => b.extend(c));
    map.fitBounds(b, { padding: window.innerWidth <= 620 ? { top: 250, bottom: 210, left: 30, right: 30 } : { top: 170, bottom: 180, left: 440, right: 80 }, duration: 900, maxZoom: 17 });
    $('routeMeta').textContent = `${formatDistance(route.distance)} · ${formatTime(route.duration)}`;
    setStatus('Маршрут построен');
  } catch (_) {
    if (seq !== routeSeq) return;
    $('routeMeta').textContent = 'Не удалось построить маршрут';
    setStatus('Ошибка маршрута: проверь интернет или выбери другую точку');
  }
}
function setProfile(p) {
  profile = p;
  [['car', 'driveBtn'], ['foot', 'walkBtn'], ['bike', 'bikeBtn']].forEach(([k, id]) => $(id).classList.toggle('active', k === p));
  buildRoute();
}
$('driveBtn').onclick = () => setProfile('car');
$('walkBtn').onclick = () => setProfile('foot');
$('bikeBtn').onclick = () => setProfile('bike');

// ---------- Избранное, ссылка, кнопки ----------
function saveFavorite() {
  if (!destination) return;
  const f = lsGet('aidux-favorites') || [];
  if (f.some(x => x.lat === destination.lat && x.lng === destination.lng)) return setStatus('Место уже в избранном');
  f.unshift({ lat: destination.lat, lng: destination.lng, name: destination.name, full: destination.full });
  lsSet('aidux-favorites', f.slice(0, 30));
  setStatus('Место добавлено в избранное ★');
}
function showFavorites() {
  const f = lsGet('aidux-favorites') || [];
  results.style.display = 'block';
  results.innerHTML = f.length ? f.map((x, i) => `<div class="result" data-fav="${i}"><b>★ ${esc(x.name)}</b><span>${esc(x.full || x.name)}</span></div>`).join('')
    : '<div class="result"><b>Избранное пусто</b><span>Выбери место и нажми ★ в карточке.</span></div>';
  results.querySelectorAll('[data-fav]').forEach(el => { el.onclick = () => selectDestination(f[+el.dataset.fav]); });
}
function shareMap() {
  const c = map.getCenter(), url = `${location.origin}${location.pathname}#${c.lat.toFixed(5)},${c.lng.toFixed(5)},${map.getZoom().toFixed(2)}`;
  navigator.clipboard?.writeText(url).then(() => setStatus('Ссылка на карту скопирована')).catch(() => prompt('Скопируй ссылку:', url));
}
$('locateBtn').onclick = async () => { await locate(); if (destination && userPos) buildRoute(); };
$('pickBtn').onclick = togglePick;
$('arBtn').onclick = () => { location.href = 'ar-nav.html'; };
$('shareBtn').onclick = shareMap;
$('favoritesBtn').onclick = showFavorites;
$('globeBtn').onclick = toggleGlobe;
$('buildingsBtn').onclick = toggleBuildings;
$('zoomIn').onclick = () => map.zoomIn();
$('zoomOut').onclick = () => map.zoomOut();
$('reset').onclick = () => { map.flyTo({ center: [KOST.lng, KOST.lat], zoom: 11, pitch: 0, bearing: 0, duration: 800 }); setStatus('Костанай'); };
$('pitch').onclick = () => map.easeTo({ pitch: map.getPitch() > 35 ? 0 : 60, duration: 700 });

// ---------- Запуск ----------
async function checkServer() {
  try { const r = await fetch('/health', { cache: 'no-store' }); if ((await r.json()).ok) return; } catch (_) { /* сервера нет */ }
  const b = document.createElement('div');
  b.className = 'err-banner';
  b.textContent = 'Поиск мест работает только через сервер AIDUX. Закрой Live Server, запусти start.bat (или npm start) и открой http://localhost:5500/map.html';
  document.body.appendChild(b);
}
map.on('load', () => {
  const home = lsGet('aidux-home');
  if (validPos(home)) setUser(home, { manual: true, fly: false });
  else setStatus('Карта Костаная готова');
});
checkServer();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
