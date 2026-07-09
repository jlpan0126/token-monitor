/* 極簡離線快取:app shell 走 cache-first,資料(sync)一律走網路 */
const CACHE = 'claude-quota-v7';
const SHELL = ['./', './index.html', './app.js?v=7', './manifest.webmanifest',
  './icons/icon-192.png', './icons/apple-touch-icon.png'];
// 註:app.js 版本號隨 index.html 的 ?v= 更新

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  if(e.request.method!=='GET') return;
  // 同源 app shell:cache-first;其他(含 sync JSON):network-first
  if(url.origin===location.origin){
    e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
  }else{
    e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
  }
});
