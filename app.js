'use strict';
/* Claude 額度監控 — 純前端 PWA
   資料模型存於 localStorage;reset 時間本地自動倒數;剩餘% 手動/同步更新。 */

const KEY = 'claude-quota-v1';
// 桌機採集器(launchd 每 20 分)推送的 gist,含本機 Claude Code 用量
const CODE_SYNC_URL = 'https://gist.githubusercontent.com/jlpan0126/f5b6c0440ec49dc254dee8083e1cb141/raw/data.json';
const DEFAULTS = {
  plan: 'Max',
  updatedAt: null,
  syncUrl: CODE_SYNC_URL,
  windows: [
    { id:'5h',   label:'5 小時視窗', sub:'全模型合計 · 每 5 小時重置', used:0, resetsAt:null, periodMs:5*3600e3 },
    { id:'week', label:'每週視窗',   sub:'全模型合計 · 每 7 天重置',   used:0, resetsAt:null, periodMs:7*24*3600e3 },
    { id:'fable5-week', label:'Fable 5 週額度', sub:'僅 Fable 5(若官方頁面有拆) · 每 7 天重置', used:0, resetsAt:null, periodMs:7*24*3600e3 },
  ],
};

let state = load();

function load(){
  try{
    const s = JSON.parse(localStorage.getItem(KEY));
    if(!s || !s.windows) return structuredClone(DEFAULTS);
    if(!s.syncUrl) s.syncUrl = CODE_SYNC_URL;   // 補上採集器同步網址
    // merge to pick up any new default windows / fields
    for(const d of DEFAULTS.windows){
      if(!s.windows.find(w=>w.id===d.id)) s.windows.push(structuredClone(d));
    }
    for(const w of s.windows){ const d=DEFAULTS.windows.find(x=>x.id===w.id); if(d) w.periodMs=d.periodMs, w.sub=d.sub, w.label=w.label||d.label; }
    return s;
  }catch{ return structuredClone(DEFAULTS); }
}
function save(){ localStorage.setItem(KEY, JSON.stringify(state)); }  // updatedAt 只在手動更新%時設,不自動蓋
function nowISO(){ return new Date().toISOString(); }

/* ---- reset 自動滾動:若 resetsAt 已過且有週期,往前推到未來,並把 used 歸零 ---- */
function rollWindows(){
  const now = Date.now();
  let changed = false;
  for(const w of state.windows){
    if(!w.resetsAt) continue;
    let t = new Date(w.resetsAt).getTime();
    if(now >= t){
      if(w.periodMs){
        while(now >= t) t += w.periodMs;   // 推進到下一個未來時點
        w.resetsAt = new Date(t).toISOString();
        w.used = 0;
        w.autoReset = true;                 // 標記:此為推算,提醒使用者確認
        changed = true;
      }
    }
  }
  if(changed) localStorage.setItem(KEY, JSON.stringify(state));
}

/* ---------- 渲染 ---------- */
const el = (id)=>document.getElementById(id);
const cardsBox = el('cards');

function colorFor(usedPct){
  const remain = 100 - usedPct;
  if(remain <= 10) return 'var(--bad)';
  if(remain <= 30) return 'var(--warn)';
  return 'var(--ok)';
}

/* 每次「已使用%」更新就記一筆歷史(事件式取樣) */
function pushHistory(w, used){
  if(!Array.isArray(w.history)) w.history=[];
  w.history.push({ t:Date.now(), u:used });
  if(w.history.length>120) w.history = w.history.slice(-120);
}

/* 用歷史畫剩餘% 趨勢小圖(inline SVG,越往下代表用越多) */
function sparkline(hist){
  if(!hist || hist.length<2)
    return '<div class="spark-empty">更新幾次後會出現趨勢線</div>';
  const W=280,H=38,pad=4;
  const xs=hist.map((_,i)=> hist.length===1?W/2 : i/(hist.length-1)*(W-2*pad)+pad);
  const ys=hist.map(p=>{ const r=100-(p.u||0); return H-pad-(r/100)*(H-2*pad); });
  const pts=xs.map((x,i)=>`${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const last=hist[hist.length-1], col=colorFor(last.u||0);
  const area=`${pad},${H-pad} ${pts} ${(W-pad).toFixed(1)},${H-pad}`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <polygon points="${area}" fill="${col}" opacity="0.13"/>
      <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${xs[xs.length-1].toFixed(1)}" cy="${ys[ys.length-1].toFixed(1)}" r="2.8" fill="${col}"/>
    </svg>`;
}

function fmtCountdown(ms){
  if(ms<=0) return '重置中…';
  const s=Math.floor(ms/1000);
  const d=Math.floor(s/86400), h=Math.floor(s%86400/3600), m=Math.floor(s%3600/60), sec=s%60;
  if(d>0) return `${d} 天 ${h} 小時 ${m} 分`;
  if(h>0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function fmtTime(iso){
  if(!iso) return '未設定';
  const d=new Date(iso);
  return d.toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
}

function render(){
  el('planName').textContent = state.plan || 'Max';
  const up = state.updatedAt ? new Date(state.updatedAt) : null;
  const staleMs = up ? Date.now()-up.getTime() : Infinity;
  const stale = staleMs > 6*3600e3;
  el('updated').innerHTML = up
    ? `方案額度%最後更新:${fmtTime(state.updatedAt)}${stale?' <span class="stale">· 可能過期,建議重對</span>':''}`
    : '⬆ 上方為「方案額度%」需你手動對數字(點儀表輸入) ｜ ⬇ 下方 Code 用量自動更新';

  cardsBox.innerHTML = '';
  state.windows.forEach((w,i)=>{
    // 從未設定過:沒有 reset 時間、沒填過 used、也沒歷史 → 顯示「未設定」而非假裝 100%
    const unset = !w.resetsAt && !(w.used>0) && !(w.history?.length);
    const remain = Math.max(0, 100 - (w.used||0));
    const col = unset ? 'var(--line)' : colorFor(w.used||0);
    const R=52, C=2*Math.PI*R, off = unset ? C : C*(1-remain/100);
    const centerPct = unset ? '設定' : remain+'%';
    const centerCap = unset ? '尚未輸入' : '剩餘';
    const centerColor = unset ? 'var(--dim)' : col;
    const card = document.createElement('div');
    card.className='card';
    card.innerHTML = `
      <h2>${w.label}${w.autoReset?'<span class="pill">已自動重置</span>':''}</h2>
      <div class="sub">${w.sub}</div>
      <div class="gauge">
        <div class="ring">
          <svg width="120" height="120" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--line)" stroke-width="11"/>
            <circle cx="60" cy="60" r="${R}" fill="none" stroke="${col}" stroke-width="11"
              stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
          </svg>
          <div class="val"><div class="pct" style="color:${centerColor};font-size:${unset?'18px':'26px'}">${centerPct}</div><div class="cap">${centerCap}</div></div>
        </div>
        <div class="meta">
          <div class="row"><span class="k">距離 reset</span><span class="v count" data-cd="${i}">—</span></div>
          <div class="row"><span class="k">reset 時間</span><span class="v">${fmtTime(w.resetsAt)}</span></div>
          <div class="row"><span class="k">已使用</span><span class="v">${w.used||0}%</span></div>
        </div>
      </div>
      <div class="sparkwrap">
        <div class="spark-head">剩餘% 趨勢<span>${(w.history?.length||0)} 筆</span></div>
        ${sparkline(w.history)}
      </div>
      <div class="edit">
        <button data-edit="${i}">✏ 更新此視窗</button>
        ${w.custom?`<button class="ghost" data-del="${i}">🗑 刪除</button>`:''}
      </div>`;
    cardsBox.appendChild(card);
  });
  cardsBox.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEdit(+b.dataset.edit));
  cardsBox.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>delWindow(+b.dataset.del));
  renderCode();
  tickCountdowns();
}

function fmtTok(n){
  if(n==null) return '—';
  if(n>=1e6) return (n/1e6).toFixed(1)+'M';
  if(n>=1e3) return Math.round(n/1e3)+'k';
  return ''+n;
}
/* 桌機採集器的 Claude Code 用量卡:近 N 天每日 token 長條 */
function renderCode(){
  const box=el('codeCard'); if(!box) return;
  const c=state.code;
  if(!c || !c.byDay || !Object.keys(c.byDay).length){ box.innerHTML=''; return; }
  const days=Object.keys(c.byDay).sort();
  const vals=days.map(d=>c.byDay[d]||0);
  const max=Math.max(...vals,1);
  const bars=days.map((d,i)=>{
    const h=Math.max(3, Math.round(vals[i]/max*46));
    const lab=d.slice(5).replace('-','/');
    return `<div class="bar"><div class="bar-fill" style="height:${h}px"></div><div class="bar-lab">${lab}</div></div>`;
  }).join('');
  const up=c.updatedAt?new Date(c.updatedAt):null;
  box.innerHTML = `<div class="card">
    <h2>Claude Code 本機用量<span class="pill">自動採集</span></h2>
    <div class="sub">這台機器 · 近 ${days.length} 天每日 token(含 cache)${up?' · 更新 '+fmtTime(c.updatedAt):''}</div>
    <div class="bars">${bars}</div>
    <div class="row"><span class="k">過去 5 小時</span><span class="v">${fmtTok(c.h5Tokens)} tok</span></div>
    <div class="row"><span class="k">過去 7 天</span><span class="v">${fmtTok(c.weekTokens)} tok</span></div>
  </div>`;
}

function tickCountdowns(){
  const now=Date.now();
  document.querySelectorAll('[data-cd]').forEach(node=>{
    const w=state.windows[+node.dataset.cd];
    if(!w.resetsAt){ node.textContent='未設定'; return; }
    node.textContent = fmtCountdown(new Date(w.resetsAt).getTime()-now);
  });
}

/* ---------- 編輯視窗 ---------- */
let editing = -1;
function openEdit(i){
  editing=i; const w=state.windows[i];
  el('editTitle').textContent=w.label;
  el('usedRange').value=w.used||0; el('usedNum').textContent=w.used||0;
  el('resetAt').value = w.resetsAt ? toLocalInput(w.resetsAt) : '';
  el('periodHint').innerHTML = w.id==='5h'
    ? '5 小時視窗是「首次訊息後 5 小時」滾動的,官方頁面會顯示確切 reset 時間 — 填一次即可,之後會自動往後滾。'
    : '每週視窗固定週期 — 填一次錨點,之後每 7 天自動往後滾,無需再管。';
  el('editDlg').showModal();
}
function toLocalInput(iso){
  const d=new Date(iso), p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
el('usedRange').oninput=e=>el('usedNum').textContent=e.target.value;
el('editCancel').onclick=()=>el('editDlg').close();
el('editSave').onclick=()=>{
  const w=state.windows[editing];
  const nv=+el('usedRange').value;
  if(w.used!==nv || !w.history?.length) pushHistory(w, nv);
  w.used=nv;
  w.resetsAt = el('resetAt').value ? new Date(el('resetAt').value).toISOString() : w.resetsAt;
  w.autoReset=false;
  state.updatedAt=nowISO();
  save(); el('editDlg').close(); render();
};

/* ---------- 新增 / 刪除視窗 ---------- */
function addWindow(){
  const name=prompt('視窗名稱(例如:Opus 週額度 / Fable 5 五小時)');
  if(!name) return;
  const pick=prompt('重置週期:輸入 5h、week,或天數(如 7)','week');
  if(pick===null) return;
  let periodMs=7*24*3600e3;
  const p=(pick||'').trim().toLowerCase();
  if(p==='5h') periodMs=5*3600e3;
  else if(p==='week'||p==='7') periodMs=7*24*3600e3;
  else if(!isNaN(+p) && +p>0) periodMs=+p*24*3600e3;
  const hours=periodMs/3600e3;
  const sub = hours%24===0 ? `每 ${hours/24} 天重置` : `每 ${hours} 小時重置`;
  state.windows.push({ id:'w'+Date.now(), label:name.trim(), sub, used:0, resetsAt:null, periodMs, custom:true });
  save(); render();
}
function delWindow(i){
  const w=state.windows[i];
  if(!w?.custom) return;
  if(!confirm(`刪除「${w.label}」?`)) return;
  state.windows.splice(i,1); save(); render();
}

/* ---------- 設定 / 匯入匯出 ---------- */
el('btnAdd').onclick=addWindow;
el('btnSettings').onclick=()=>{ el('setPlan').value=state.plan||''; el('setSync').value=state.syncUrl||''; el('setDlg').showModal(); };
el('setClose').onclick=()=>el('setDlg').close();
el('setSave').onclick=()=>{ state.plan=el('setPlan').value.trim()||'Max'; state.syncUrl=el('setSync').value.trim(); save(); el('setDlg').close(); render(); };
el('setExport').onclick=()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='claude-quota.json'; a.click();
};
el('setImport').onclick=()=>el('fileImport').click();
el('fileImport').onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader(); r.onload=()=>{ try{ state=Object.assign(structuredClone(DEFAULTS),JSON.parse(r.result)); save(); render(); el('setDlg').close(); }catch{ alert('JSON 格式錯誤'); } }; r.readAsText(f);
};

/* ---------- 動作按鈕 ---------- */
el('btnRefresh').onclick=()=>{
  window.open('https://claude.ai/settings/usage','_blank','noopener');
  // 開頁面後,使用者回來點各儀表輸入數字;給個提示
  setTimeout(()=>{ if(state.windows.every(w=>!w.resetsAt)) openEdit(0); },400);
};
el('btnSync').onclick=async()=>{
  if(!state.syncUrl){ el('btnSettings').click(); alert('請先在設定填入雲端同步 JSON 網址'); return; }
  try{
    const r=await fetch(state.syncUrl,{cache:'no-store'});
    const data=await r.json();
    mergeSync(data); save(); render();
    alert('已從雲端更新');
  }catch(err){ alert('同步失敗:'+err.message); }
};
function mergeSync(data){
  if(data.plan) state.plan=data.plan;
  // 採集器來源:只吃 Code 用量,不覆蓋你手填的方案%(dw.used 為 null 時不動)
  if(data.source==='claude-code-local' && data.detail){
    state.code = {
      byDay: data.detail.byDay || {},
      h5Tokens: data.windows?.find(w=>w.id==='5h')?.codeTokens,
      weekTokens: data.windows?.find(w=>w.id==='week')?.codeTokens,
      updatedAt: data.updatedAt,
    };
  } else if(data.updatedAt){
    state.updatedAt=data.updatedAt;
  }
  if(Array.isArray(data.windows)){
    for(const dw of data.windows){
      const w=state.windows.find(x=>x.id===dw.id);
      if(w){
        if(dw.used!=null){ if(w.used!==dw.used) pushHistory(w, dw.used); w.used=dw.used; }
        if(dw.resetsAt)w.resetsAt=dw.resetsAt;
        w.autoReset=false;
      }
    }
  }
}

/* ---------- 啟動 ---------- */
function loop(){ rollWindows(); tickCountdowns(); }
rollWindows(); render();
setInterval(loop,1000);

// 首次 / 未安裝時顯示安裝提示
if(!window.matchMedia('(display-mode: standalone)').matches && !navigator.standalone){
  el('installHint').style.display='block';
}

// 自動同步:若有 syncUrl,啟動時拉一次
if(state.syncUrl){ el('btnSync').onclick && fetch(state.syncUrl,{cache:'no-store'}).then(r=>r.json()).then(d=>{mergeSync(d);save();render();}).catch(()=>{}); }

// Service worker
if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
