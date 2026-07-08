#!/usr/bin/env node
/* Claude Code 本機用量採集器(零相依)
 *
 * 讀 ~/.claude/projects 下所有 JSONL 的 assistant.message.usage,
 * 統計「過去 5 小時」與「過去 7 天」的 token 消耗,輸出 data.json。
 *
 * 用途:讓 PWA 顯示 Claude Code 這台機器的 token 趨勢(自動、免登入)。
 * 注意:官方沒有公佈 Max 方案的 token 上限,所以這裡給的是「絕對用量」,
 *       不是「剩餘 %」。剩餘 % 仍以 claude.ai/settings/usage 手動對數為準。
 *
 * 用法:
 *   node collector.mjs                 # 印出摘要 + 寫 ./data.json
 *   node collector.mjs --out /path.json
 *   node collector.mjs --cap5h 200000 --capWeek 5000000   # 若你想估 %(自訂上限)
 *   node collector.mjs --push https://<你的-KV/Gist-endpoint>  # 選填:POST 上去給手機讀
 */
import { readdirSync, statSync, readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

const args = Object.fromEntries(process.argv.slice(2).reduce((a,v,i,arr)=>{
  if(v.startsWith('--')) a.push([v.slice(2), arr[i+1]?.startsWith('--')?true:arr[i+1]]); return a;
},[]));

const ROOT = join(homedir(), '.claude', 'projects');
const now = Date.now();
const W5H = 5*3600e3, WEEK = 7*24*3600e3;

function walk(dir){
  let out=[];
  for(const name of readdirSync(dir)){
    const p=join(dir,name); const s=statSync(p);
    if(s.isDirectory()) out=out.concat(walk(p));
    else if(name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

async function readLines(fp, onLine){
  const rl=createInterface({ input:createReadStream(fp), crlfDelay:Infinity });
  for await(const line of rl){ if(line.trim()) onLine(line); }
}

const acc = {
  h5:{ in:0,out:0,cacheR:0,cacheW:0,calls:0 },
  week:{ in:0,out:0,cacheR:0,cacheW:0,calls:0 },
  byDay:{}, models:{},
};

function add(bucket,u){
  bucket.in += u.input_tokens||0;
  bucket.out += u.output_tokens||0;
  bucket.cacheR += u.cache_read_input_tokens||0;
  bucket.cacheW += u.cache_creation_input_tokens||0;
  bucket.calls++;
}

let files=[];
try{ files=walk(ROOT); }catch(e){ console.error('讀不到', ROOT, e.message); process.exit(1); }

for(const fp of files){
  await readLines(fp, (line)=>{
    let d; try{ d=JSON.parse(line); }catch{ return; }
    if(d.type!=='assistant') return;
    const u=d.message?.usage; const ts=Date.parse(d.timestamp||'');
    if(!u || !ts) return;
    const age=now-ts;
    if(age<0 || age>WEEK) return;                 // 只看近 7 天
    add(acc.week,u);
    if(age<=W5H) add(acc.h5,u);
    const day=new Date(ts).toISOString().slice(0,10);
    // 與下方總計同口徑(含 cache),長條圖才對得起來
    acc.byDay[day]=(acc.byDay[day]||0)+(u.input_tokens||0)+(u.output_tokens||0)
      +(u.cache_read_input_tokens||0)+(u.cache_creation_input_tokens||0);
    const m=d.message?.model||'?'; acc.models[m]=(acc.models[m]||0)+1;
  });
}

const totalOf=b=>b.in+b.out+b.cacheR+b.cacheW;
const pct=(used,cap)=>cap?Math.min(100,Math.round(used/cap*100)):null;

const cap5h=args.cap5h?+args.cap5h:null, capWeek=args.capWeek?+args.capWeek:null;

const data = {
  plan: args.plan || undefined,
  updatedAt: new Date(now).toISOString(),
  source: 'claude-code-local',
  windows: [
    { id:'5h',   used: pct(totalOf(acc.h5),cap5h),   resetsAt: undefined,
      codeTokens: totalOf(acc.h5),   codeCalls: acc.h5.calls },
    { id:'week', used: pct(totalOf(acc.week),capWeek), resetsAt: undefined,
      codeTokens: totalOf(acc.week), codeCalls: acc.week.calls },
  ],
  detail: { h5:acc.h5, week:acc.week, byDay:acc.byDay, models:acc.models },
};

const outPath = args.out || join(process.cwd(),'data.json');
writeFileSync(outPath, JSON.stringify(data,null,2));

// 終端摘要
const fmt=n=>n.toLocaleString('en-US');
console.log('\n📊 Claude Code 本機用量(這台機器)');
console.log('  掃描檔案:', files.length, 'jsonl');
console.log('  ── 過去 5 小時 ──');
console.log(`    呼叫 ${acc.h5.calls} 次 · 總 token ${fmt(totalOf(acc.h5))} (out ${fmt(acc.h5.out)} / in ${fmt(acc.h5.in)} / cache-r ${fmt(acc.h5.cacheR)})`);
if(cap5h) console.log(`    估用量 ${pct(totalOf(acc.h5),cap5h)}% (cap ${fmt(cap5h)})`);
console.log('  ── 過去 7 天 ──');
console.log(`    呼叫 ${acc.week.calls} 次 · 總 token ${fmt(totalOf(acc.week))} (out ${fmt(acc.week.out)} / in ${fmt(acc.week.in)} / cache-r ${fmt(acc.week.cacheR)})`);
if(capWeek) console.log(`    估用量 ${pct(totalOf(acc.week),capWeek)}% (cap ${fmt(capWeek)})`);
console.log('  已寫入:', outPath, '\n');

// 選填:推送給雲端(手機讀)
if(args.push){
  try{
    const r=await fetch(args.push,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    console.log('  ☁ 推送', args.push, '→', r.status);
  }catch(e){ console.error('  ☁ 推送失敗:', e.message); }
}
