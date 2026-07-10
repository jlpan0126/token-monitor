# TokenMonitor — Claude 維護指引

Claude 額度監控 PWA(全自動抓官方 5h/週/Fable 額度%、Code 用量、長期趨勢、接近上限推播)。

**動手前先讀 [`SPEC.md`](./SPEC.md)** —— 完整架構、資料流、檔案清單、官方端點、維護手冊、風險都在裡面。

## 最容易踩的三件事
1. **改前端必同步 bump 三處版本號**:`index.html` 的 `app.js?v=N`、`sw.js` 的 `CACHE` 與 `SHELL` 內 `app.js?v=N`。不 bump → 使用者被快取卡在舊版。
2. **權威採集腳本是 `~/.claude-quota/sync.mjs`(不在 repo)**,不是 repo 裡那支過時的 `collector.mjs`。
3. **不自行跑 OAuth refresh flow**;token 過期只用 `claude -p ok` 讓 Claude Code 自己刷新。OAuth token 只在本機用,絕不寫檔/外傳/印出。

- 線上:https://jlpan0126.github.io/token-monitor/ ｜ Repo:jlpan0126/token-monitor(public + GitHub Pages)
- 部署:改檔 → `git push origin main` → 等 Pages 重建
