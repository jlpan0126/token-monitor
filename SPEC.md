# Claude 額度監控 — SPEC

跨筆電 / 桌機 / 手機,**全自動**檢視 Claude 訂閱的 5 小時 / 每週 / Fable 額度剩餘量、reset 倒數,加上 Claude Code 本機用量與長期趨勢,接近上限時推播。

- **線上**:https://jlpan0126.github.io/token-monitor/
- **Repo**:https://github.com/jlpan0126/token-monitor(public,GitHub Pages)
- **目前版本**:v10(`app.js?v=10` / SW `claude-quota-v10`)
- **擁有者**:jlpan0126(Max 方案)

---

## 1. 核心設計原則

1. **零手動**:官方額度%、reset 時間、Code 用量全部自動抓取,使用者只看不填。
2. **官方數字來源 = `GET https://api.anthropic.com/api/oauth/usage`**(帶 Claude Code OAuth token)。這是 Claude Code `/usage` 背後的端點,GET **不消耗額度**。回傳 `five_hour` / `seven_day` 的 `utilization` + `resets_at`,以及 `limits[]` 中 `weekly_scoped`(model=Fable)。
3. **不碰 OAuth refresh flow**:token 過期時只用 `claude -p "ok"` 讓 Claude Code 自己刷新並寫回 Keychain。**絕不自行拿 refresh token 換 access token**(refresh token 會輪替,自行操作可能把使用者踢登)。
4. **憑證只在本機用**:OAuth token 從 macOS Keychain 讀取,只用於呼叫官方 API,**絕不寫檔 / 外傳 / 記錄 / 印出**。
5. **純前端 PWA**:無後端、無 build;GitHub Pages 靜態託管;桌機採集器透過 gist 當中繼把資料送到手機。

---

## 2. 系統架構 / 資料流

```
┌─────────────────────── 桌機 Mac(需開機登入)───────────────────────┐
│                                                                      │
│  launchd (每 1200s)                                                  │
│    → run-collector.sh → node sync.mjs                                │
│        │                                                             │
│        ├─(a) 讀 Keychain "Claude Code-credentials".accessToken       │
│        │      └ 過期則 `claude -p ok` 讓 Claude Code 自行刷新         │
│        ├─(b) GET api.anthropic.com/api/oauth/usage  → 官方 5h/週/Fable%│
│        ├─(c) 掃 ~/.claude/projects/*.jsonl          → Code token/byDay│
│        ├─(d) 累積 history.json(每日 token + 官方%快照)              │
│        ├─(e) 跨 80%/95% 門檻 → POST ntfy.sh/<topic>  → 手機推播        │
│        └─(f) gh api PATCH /gists/<GID>  ← 合併後的 data.json          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                  │ (data.json,僅%與token計數,無密鑰)
                                  ▼
              gist raw (CORS: *)  gist.githubusercontent.com/.../data.json
                                  │
                                  ▼
┌──────────── PWA(GitHub Pages,筆電/桌機/手機瀏覽器或加到主畫面)────────────┐
│  app.js 啟動 → fetch(syncUrl=gist raw) → mergeSync() → render()             │
│    • 官方三圈自動填 used% + resetsAt(倒數本地計算)                          │
│    • Claude Code 用量卡(近7天每日 token 長條)                              │
│    • 長期趨勢卡(每週%/5小時% 折線 + 每日 token 長條)                       │
│    • 狀態存 localStorage;Service Worker 離線快取                             │
└────────────────────────────────────────────────────────────────────────────┘
```

**帳號級資料**:官方額度是整個帳號共用,**只需一台 Mac 跑採集器**,所有裝置讀同一份 gist。

---

## 3. 檔案清單

### Repo(GitHub Pages 託管,公開)
| 檔案 | 作用 |
|---|---|
| `index.html` | PWA 外殼;`<script src="app.js?v=N">` 版本查詢字串破壞快取 |
| `app.js` | 全部前端邏輯:sync、渲染圈/卡/趨勢、倒數、自訂視窗、匯入匯出 |
| `sw.js` | Service Worker;`CACHE='claude-quota-vN'`;app shell cache-first、同步資料 network-first |
| `manifest.webmanifest` | PWA 安裝設定 |
| `icons/` | 192/512/maskable/apple-touch 圖示(PIL 產生的環形錶) |
| `README.md` | 使用者導向說明 |
| `SPEC.md` | 本文件(技術規格) |
| `collector.mjs` | **舊版**純 Code 統計腳本,已被 `sync.mjs` 取代,保留參考 |
| `.nojekyll` / `.gitignore` | Pages 原樣輸出;忽略 `data.json` |

### 本機營運檔(`~/.claude-quota/`,**不在 repo**)
| 檔案 | 作用 |
|---|---|
| `sync.mjs` | **主採集腳本**(§2 的 a–f);此為權威版本,repo 的 collector.mjs 已過時 |
| `run-collector.sh` | launchd 呼叫的 wrapper(設 PATH → `node sync.mjs`) |
| `data.json` | 每次產出的合併資料(推到 gist) |
| `history.json` | 長期歷史:`{dailyTokens(45天), snapshots(官方%,約每小時,留500)}` |
| `notify-state.json` | 推播去重:各視窗上次的門檻等級 `{id: 0|1|2}` |
| `.ntfy-topic` | 私密推播主題字串(**不進 repo,只在本機+手機訂閱**) |
| `collector.log` / `launchd.{out,err}.log` | 執行日誌 |

### 系統設定
| 路徑 | 作用 |
|---|---|
| `~/Library/LaunchAgents/com.jlpan.claudequota.collector.plist` | launchd,`StartInterval=1200`、`RunAtLoad=true` |
| macOS Keychain `Claude Code-credentials` | `claudeAiOauth.accessToken`(~8h 過期)、`refreshToken`、`expiresAt` |

### 外部服務
| 項目 | 值 |
|---|---|
| gist(secret) | `f5b6c0440ec49dc254dee8083e1cb141`(擁有者 jlpan0126) |
| gist raw(= PWA syncUrl 預設,寫死在 app.js) | `https://gist.githubusercontent.com/jlpan0126/<GID>/raw/data.json` |
| ntfy 主題 | `claude-quota-48978b8f6ae49715`(手機裝 ntfy app 訂閱) |
| 官方用量端點 | `GET https://api.anthropic.com/api/oauth/usage` |

---

## 4. 官方用量端點回傳格式(關鍵)

請求 headers:
```
authorization: Bearer <accessToken>
anthropic-beta: oauth-2025-04-20
anthropic-version: 2023-06-01
user-agent: claude-cli/2.1.201 (external, cli)
```
回傳(節錄):
```json
{
  "five_hour": { "utilization": 13.0, "resets_at": "2026-07-09T18:50:00Z" },
  "seven_day": { "utilization": 34.0, "resets_at": "2026-07-10T17:00:00Z" },
  "limits": [
    { "kind": "session",       "percent": 13, "resets_at": "...", "is_active": false },
    { "kind": "weekly_all",    "percent": 34, "resets_at": "...", "is_active": true },
    { "kind": "weekly_scoped", "percent": 7,  "resets_at": "...",
      "scope": { "model": { "display_name": "Fable" } }, "is_active": false }
  ]
}
```
`sync.mjs` 映射:`5h`←`five_hour`、`week`←`seven_day`、`fable5-week`←`limits[]` 中 `scope.model.display_name` 含 "Fable" 的項;**Fable 缺項或 `resets_at` 為 null 時退用每週 reset、used=0**(代表本週未用 Fable)。

---

## 5. PWA 資料模型(localStorage key `claude-quota-v1`)

```jsonc
{
  "plan": "Max",
  "updatedAt": "ISO",                 // 官方資料最後同步時間
  "syncUrl": "<gist raw>",            // 預設寫死;空則載入時補上
  "windows": [                        // 官方三視窗 + 使用者自訂視窗
    { "id":"5h", "label":"5 小時視窗", "sub":"...", "used":14,
      "resetsAt":"ISO", "periodMs":18000000, "history":[{"t":<ms>,"u":14}] },
    { "id":"week", ... }, { "id":"fable5-week", ... },
    { "id":"w<ts>", "label":"自訂", "custom":true, ... }   // 使用者新增
  ],
  "code":    { "byDay":{"YYYY-MM-DD":<tokens>}, "h5Tokens":n, "weekTokens":n },
  "history": { "dailyTokens":{...}, "snapshots":[{"t","u5","u7","uf"}] }
}
```
- `custom:true` 的視窗才有手動「編輯/刪除」;官方三視窗顯示「官方自動更新,無需手動」。
- `unset`(顯示灰色「設定」)判定 = `!resetsAt && !history.length`。同步後 0% 是**真實值**,顯示 100% 剩餘。
- reset 倒數本地每秒計算;`periodMs` 讓過期的視窗自動往後滾(fallback,官方 `resetsAt` 會覆蓋)。

---

## 6. 維護手冊(Runbook)

### 改版部署(**每次改前端必做**)
1. 改 `index.html` / `app.js` / `sw.js`。
2. **同步 bump 三處版本號**:`index.html` 的 `app.js?v=N`、`sw.js` 的 `CACHE` 與 `SHELL` 內 `app.js?v=N`。(不 bump → 使用者被瀏覽器/SW 快取卡在舊版)
3. `git add -A && git commit && git push origin main`。
4. 等 GitHub Pages 重建(~1–2 分),curl 確認 `index.html` 引用新 `?v=` 且 `sw.js` 新 `CACHE`。
5. 手機:完全關閉 PWA 再開,即更新。

### 採集器(桌機自動化)
```bash
# 立即手動跑一次
node ~/.claude-quota/sync.mjs
# 透過 launchd 觸發
launchctl kickstart -k "gui/$(id -u)/com.jlpan.claudequota.collector"
# 看日誌
tail ~/.claude-quota/collector.log
# 停用 / 啟用
launchctl unload ~/Library/LaunchAgents/com.jlpan.claudequota.collector.plist
launchctl load -w ~/Library/LaunchAgents/com.jlpan.claudequota.collector.plist
```

### 調整推播門檻
改 `sync.mjs` 的 `WARN=80`、`CRIT=95`。門檻只在**往上跨越**時推一次(靠 `notify-state.json` 去重)。

### 換裝置採集
把 `~/.claude-quota/`(含 `sync.mjs`、`.ntfy-topic`)複製到新 Mac,裝 `gh` 並登入、放同名 plist、`launchctl load`。官方資料帳號共用,通常一台就夠。

---

## 7. 已知風險 / 脆弱點

- **`/api/oauth/usage` 為非官方公開端點**:Anthropic 若改版即失效(可能回 401/404 或改結構)。失效時 `sync.mjs` 印錯誤、`windows=[]`,PWA 保留上次值。
- **Keychain 讀取**:launchd 背景已驗證可讀;新機首次可能跳「允許存取鑰匙圈」,需按「一律允許」。
- **`--bare` 模式**:`claude --bare` 不讀 keychain,勿用於刷新。
- **token 刷新成本**:過期時 `sync.mjs` 會跑一次 `claude -p ok`(極小額度,且會被計入 Code 用量);token 有效時不刷新。
- **gist 隱私**:gist raw URL 寫死在公開 repo,任何人可讀你的**用量%與 token 計數**(無密鑰)。介意可改私有來源。
- **本機 `python -m http.server` 預覽**會週期性自己掛掉(環境殺閒置行程),與正式站無關。

---

## 8. 相關自動化(非 repo)

- launchd 採集器(§3、§6)。
- ~~每日提醒 scheduled task~~:全自動後已刪除。

---

## 9. 版本沿革

| 版本 | 重點 |
|---|---|
| v1–v4 | 手動輸入%基礎版、PWA 安裝、Code 採集器、gist 同步、歷史 sparkline |
| v5–v7 | 未設定狀態 UX、快取破壞(`?v=`)、Code 卡置頂 |
| **v8** | **突破:`/api/oauth/usage` 官方%全自動填入,免手動** |
| v9 | 長期趨勢圖、ntfy 接近上限推播、history 累積、0% 判定修正 |
| v10 | 官方視窗移除手動編輯鈕(改「官方自動更新」),介面隨全自動收斂 |
