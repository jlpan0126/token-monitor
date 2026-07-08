# Claude 額度監控 (TokenMonitor)

跨筆電 / 桌機 / 手機,快速檢視 Claude **5 小時滾動視窗**與**每週視窗**的剩餘額度與 reset 倒數。純前端 PWA,可加到手機主畫面像 App 一樣開。

---

## 為什麼是這個設計(重要前提)

Anthropic **沒有**提供查詢消費者 Pro/Max 訂閱「剩餘 token」的官方 API。實測本機 Claude Code 日誌:
- ✅ 有逐則 token 用量 → Code 用量可自動統計(`collector.mjs`)
- ❌ 5 小時 / 每週的 reset 視窗**沒被存下**(`rateLimits:null`)
- ❌ chat / cowork 用量本機完全沒有

所以本工具採「**reset 時間用算的(全自動)+ 剩餘% 手動對數(30 秒)**」:
- **reset 時間**是可推算的:每週視窗填一次錨點,之後每 7 天自動往後滾;5 小時視窗填一次官方顯示的 reset 時刻即可倒數。→ 這半邊 0 維護。
- **剩餘 %** 唯一真實來源是 `claude.ai/settings/usage`(涵蓋 chat/cowork/code)。開頁面→拉滑桿填數字,即完成。

---

## 檔案

| 檔案 | 作用 |
|---|---|
| `index.html` / `app.js` | PWA 本體(儀表、倒數、編輯、同步、匯入匯出) |
| `manifest.webmanifest` / `sw.js` / `icons/` | 讓它可安裝、可離線 |
| `collector.mjs` | 桌機採集器:統計本機 Claude Code token 用量 → `data.json` |

---

## 三台裝置怎麼用

PWA 要能「安裝到手機」且「桌機手機都開得到」,需要一個 https 網址。三選一:

### 方案 1:GitHub Pages(推薦,免費、最省事)
```bash
cd TokenMonitor
git init && git add . && git commit -m "token monitor"
# 推到你的 repo,Settings → Pages → 從 main 分支 /root 發佈
```
之後三台裝置都開 `https://<你的帳號>.github.io/<repo>/`。

### 方案 2:Cloudflare Pages / Vercel
把 `TokenMonitor/` 當靜態網站拖上去即可,同樣拿到一個網址。

### 方案 3:只在本機區網
```bash
python3 -m http.server 4178 --directory TokenMonitor
```
手機同一 Wi-Fi 開 `http://<電腦IP>:4178`。(註:非 https,iOS 安裝到主畫面功能受限,但檢視沒問題。)

### 安裝到手機
- **iPhone Safari**:分享 → 加入主畫面
- **Android Chrome**:⋮ → 安裝應用程式

---

## 日常操作(30 秒)

1. 點 **「↻ 從 claude.ai 對數字」** → 開 `claude.ai/settings/usage`
2. 看到兩個視窗的「已用 %」與「resets at」時間
3. 回 App,點各儀表 **「✏ 更新此視窗」**,拉滑桿填 %、填 reset 時間 → 儲存
4. 之後倒數自己跑;每週視窗設過一次就會自動往後滾,不用再碰

---

## 跨裝置自動同步(選填)

若不想每台各填一次,可讓**一台桌機**推數字、其他裝置只讀:

1. 找一個「不含密鑰、放得下一小段 JSON、有公開讀取網址」的地方,例如:
   - GitHub Gist(raw 網址)
   - Cloudflare KV / Workers 的簡單端點
   - 任何你能 PUT/GET 的 JSON 空間
2. 在 App **設定 → 雲端同步 JSON 網址** 填該網址;其他裝置也填同一個
3. App 啟動時會自動抓一次,或按「☁ 雲端同步」

`data.json` 格式:
```json
{
  "plan": "Max",
  "updatedAt": "2026-07-08T08:00:00Z",
  "windows": [
    { "id": "5h",   "used": 88, "resetsAt": "2026-07-08T11:19:00Z" },
    { "id": "week", "used": 55, "resetsAt": "2026-07-11T13:56:00Z" }
  ]
}
```

---

## 桌機採集器(自動統計 Code 用量)

```bash
node collector.mjs                       # 印摘要 + 寫 ./data.json
node collector.mjs --out ~/quota.json    # 指定輸出
node collector.mjs --cap5h 200000 --capWeek 5000000   # 給上限才會算 %
node collector.mjs --push https://<你的端點>            # 選填:PUT 上雲端
```
輸出「過去 5 小時 / 過去 7 天」的 Claude Code token 消耗(含 cache)。
> 注意:官方沒公佈 Max 的 token 上限,所以預設給**絕對用量**;要看 % 請自訂 `--cap`。這是 Code-only、單機資料,與 claude.ai 的方案 % 不同來源。

想定時自動跑,可用 macOS `launchd` 或 `cron`,例如每 10 分鐘:
```
*/10 * * * * cd /path/TokenMonitor && /usr/bin/env node collector.mjs --push https://<你的端點>
```

---

## 給學生看

把網址分享出去即可(唯讀顯示)。注意:你這邊**沒有**學生個人訂閱的資料來源,若要顯示他們的用量,得請他們各自回報、填進共享的 `data.json`。
