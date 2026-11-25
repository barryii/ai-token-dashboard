# Doctor / 環境診斷

```bash
npm run doctor
npm run --silent doctor -- --json
npm run doctor -- --device my-laptop
```

從專案根目錄執行。與啟動/採集指令一樣讀取 `.env`，已有行程環境變數優先；資料庫設定遵循 `DATABASE_URL` → `DB_DRIVER`/`DB_PATH` → 本機 SQLite。`--device` 僅選擇要檢查的歷史採集記錄，預設使用目前主機名稱，不修改裝置身份。

Run from the project root. The command loads `.env` with existing process environment variables taking precedence. Database selection follows the app: `DATABASE_URL`, then `DB_DRIVER`/`DB_PATH`, then local SQLite. `--device` selects historical run records; it defaults to the hostname and does not change device identity.

## 狀態 / Status

| Status | 含義 / Meaning | 下一步 / Next step |
| --- | --- | --- |
| `ok` | 該項檢查通過 / This check passed | 僅限該項範圍 / Limited to that check |
| `warn` | 缺少可選來源、尚未初始化、已有連接埠佔用或歷史記錄需關注 / Optional source absent, setup incomplete, occupied port, or historical run warning | 按提示判斷是否適用 / Follow the suggested action if applicable |
| `error` | 設定無效、權限或資料庫檢查失敗 / Invalid configuration, permissions or database failure | 修復後重跑 / Fix and rerun |

結束碼：`0` 沒有 error（可能有 warn）；`1` 有 error 或診斷未完成；`2` 參數錯誤。JSON 的 `version: 1`、檢查 `id` 和狀態可供腳本使用，不要解析顯示文字。純 JSON 使用 `npm run --silent doctor -- --json`；Node 的 SQLite 實驗性提示可能出現在 stderr，不影響 stdout JSON。

Exit codes: `0` means no errors (warnings may remain), `1` means an error or incomplete diagnosis, and `2` means invalid arguments. Scripts should use JSON `version: 1`, check IDs and statuses, not display messages. Use the silent npm form above for JSON-only stdout; Node may emit its SQLite experimental warning on stderr.

## 常見問題 / Common cases

- 首次安裝：資料庫缺失時執行 `npm run db:init`，然後 `npm run collect`、`npm run build`、`npm run serve`。
- 連接埠佔用：已有實例可直接存取；否則檢查佔用行程或設定不同的 `API_PORT` / `CLIENT_PORT`（開發）或 `PORT`（serve）。指令不會停止行程。
- 採集為空：檢查 `config/collectors.json` 和工具對應環境變數。`missing` 是路徑不存在，`empty` 是空目錄或空資料庫檔案，`unreadable` 是讀取失敗，`invalid` 是路徑類型或 OpenCode 資料庫檔名無效。
- 表結構失敗：先備份已有資料庫，再確認是否需要 `npm run db:init`；診斷指令不會自動修復或升級表。
- 上次採集 `error` / `empty`：這是指定裝置的歷史記錄，不表示目前失敗，也不表示歷史用量為零；檢查來源後重跑採集。

- Fresh install: run `npm run db:init`, `npm run collect`, `npm run build`, then `npm run serve`.
- Port occupied: reuse the existing instance when appropriate, otherwise inspect the owner or configure distinct development ports (`API_PORT` / `CLIENT_PORT`) or the serve port (`PORT`). No processes are stopped.
- Empty collection: check collector paths and environment overrides. Root states distinguish missing paths, empty directories/files, unreadable paths, and invalid path types/OpenCode database names.
- Schema failure: back up existing data before deciding to run `npm run db:init`. Doctor never repairs or upgrades tables.
- Last run `error` / `empty`: historical evidence for the selected device, not a current execution result or proof of zero historical usage.

## 檢查邊界 / Scope

來源檢查重複使用採集器的路徑解析函式，僅列舉目錄和檢查讀取權限，不讀取工作階段內容、不開啟來源資料庫、不建立解析快取、不請求價格或額度介面。每個目錄最多檢查 2,000 個項目、32 層，並在項目之間檢查 250 ms 預算；單次檔案系統呼叫不受此預算中斷。遇到限制或符號連結會標記掃描未完成。候選檔案按名稱粗篩，可能不屬於實際可採集日誌，也不會驗證日誌格式或費用準確性。

Source checks reuse collector path resolvers and inspect directory entries/read access only. They do not read conversations, open source databases, write parse caches, or call pricing/quota APIs. Each directory root is limited to 2,000 entries and 32 levels, with a 250 ms budget checked between entries; a filesystem call itself cannot be interrupted by that budget. Limits or symlinks mark the scan incomplete. Filename candidates may not be collectable logs and do not validate formats or costs.

用量資料庫以唯讀模式開啟，僅執行連線、關鍵欄位及目前裝置最近採集狀態的 SELECT，不執行 DDL/DML，不全表彙總。遠端連線使用現有轉接器和 `DB_CONNECT_TIMEOUT_MS`（預設 10 秒）。連線成功不驗證寫入權限、完整 schema、歷史帳單準確性或遠端資料庫服務的整體健康。頁面只檢查檔案是否存在，不證明建置最新或瀏覽器渲染正常。

The usage database is opened in read-only mode for SELECT checks of connectivity, key columns and latest per-source run statuses for the selected device. No DDL/DML or full usage aggregation runs. Remote connections use the existing adapters and `DB_CONNECT_TIMEOUT_MS` (10 seconds by default). Success does not validate write permissions, every schema detail, historical bill accuracy or overall remote database health. The frontend check verifies file presence, not build freshness or browser rendering.

報告不輸出個人路徑、主機名稱、資料庫 URL、權杖、日誌內容或原始例外文字；保留來源名稱、候選數量、連接埠、錯誤碼和採集時間，分享前仍可按需審閱。它不會向外部服務上傳報告。

Reports omit personal paths, hostnames, database URLs, tokens, log contents and raw exceptions. They retain source names, candidate counts, ports, error codes and run timestamps; review these before sharing if needed. Reports are never uploaded by the command.

## 自動驗收 / Onboarding smoke test

```bash
npm ci
npm run test:onboarding
npm test
```

冒煙流程建置真實前端，在隔離環境裡依次執行 doctor、db:init、兩次 Pi 合成日誌採集、db:check、doctor，再啟動暫時服務驗證看板/複盤 HTML、建置資源和用量 API。斷言 110 tokens、$0.25 和一條記錄在重複採集後不重複增長，結束時清理暫時資料庫和行程。瀏覽器互動仍需單獨驗收。

The smoke test builds the frontend, then runs doctor, database initialization, two collections of synthetic Pi logs, database verification and doctor again in isolation. A temporary server checks dashboard/review HTML, built assets and usage APIs. It asserts 110 tokens, $0.25 and one record after repeated collection, then removes its temporary database and process. Browser interaction requires separate validation.
