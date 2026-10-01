// Network-first: сначала свежие файлы из сети, кэш — только если нет интернета.
// При каждом обновлении сайта меняй номер версии ниже (v5 -> v6 и т.д.).
const CACHE='aidux-v3-world-5';
const ASSETS=['./','./index.html','./map.html','./ar-nav.html','./ar.html','./camera.html','./vr.html','./ai-chat.html','./about.html','./contact.html','./style.css','./ai-chat.css','./ai-chat.js','./script.js','./voice.js','./manifest.webmanifest'];

self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE)
    .then(c=>c.addAll(ASSETS.map(u=>new Request(u,{cache:'reload'}))))
    .then(()=>self.skipWaiting())
));

self.addEventListener('activate',e=>e.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
));

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin) return;
  e.respondWith(
    fetch(e.request,{cache:'no-cache'})
      .then(r=>{
        if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}
        return r;
      })
      .catch(()=>caches.match(e.request))
  );
});
