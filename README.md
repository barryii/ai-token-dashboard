# AI Token Dashboard

[English](README.en.md) | **繁體中文**

[目前狀態與後續工作](docs/project-status.md) · 查看已完成範圍、原始待辦和驗收條件。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.15-green)](https://nodejs.org)

一個輕量、隱私優先的本機 AI Token 用量看板，支援同時追蹤多種 Agent 和 CLI 工具的使用情況。

直接讀取本機的工作階段日誌，彙整寫入本機 SQLite，透過 React 應用程式展示——**預設零雲端、零遙測、不上傳任何資料。**

---

## 截圖

![Token Studio 用量看板 · 淺色](.github/assets/dashboard.png)

![Token Studio 用量看板 · 深色](.github/assets/dashboard-dark.png)

> _示意圖，使用示範資料。執行 `npm run seed:demo` 可在本機產生同一份資料。_

---

## 功能特性

- **多來源採集** — 支援 Claude Code、Codex CLI、OpenCode、Gemini CLI、Hermes Agent、OpenClaw、Grok CLI、DeepSeek Harness、Pi Agent
- **雙檢視** — 互動式用量看板（`/`）和適合閱讀與列印的複盤頁（`/review`）
- **淺色 / 深色主題** — 預設跟隨系統，右上角一鍵切換，選擇記在本機，兩個頁面共用
- **成本追蹤** — 依隨儲存庫提供的 LiteLLM + OpenRouter 定價快取，按模型估算 token 費用
- **頁面內採集** — 在看板右上角點選「採集」即可觸發一次本機採集（僅允許本機存取）
- **多裝置匯集** — 可選推送模式，將多台機器的用量合併到單一中心節點
- **Docker 支援** — 一條指令部署中心 ingest 服務
- **純 JavaScript** — 無需 Rust 工具鏈、無本機二進位檔、無額外 CLI 相依套件

---

## 支援的資料來源

| 工具 | 資料位置 |
|------|---------|
| [Claude Code](https://claude.ai/code) | `~/.claude/projects/` |
| [Codex CLI](https://github.com/openai/codex) | `~/.codex/sessions/` |
| [OpenCode](https://github.com/sst/opencode) | `~/.local/share/opencode/` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `~/.gemini/tmp/` |
| Hermes Agent | `~/.hermes/state.db`（或 `$HERMES_HOME/state.db`） |
| OpenClaw | `~/.openclaw/agents/` |
| Grok CLI | `~/.grok/sessions/`（可用 `GROK_HOME` 指定 home） |
| DeepSeek Harness (DSH) | `~/.dsh/sessions/`（可用 `DSH_HOME` 指定 home，或 `DSH_SESSIONS` 指定工作階段目錄） |
| Pi Agent | `~/.pi/agent/sessions/`（可用 `PI_CODING_AGENT_DIR` 指定 agent 目錄，或 `PI_CODING_AGENT_SESSION_DIR` 指定工作階段目錄） |

只有實際安裝了對應工具才會產生資料，未安裝的會被靜默跳過。

Grok 按已完成回合的模型用量統計：快取和 reasoning 從其所屬的 input/output 中拆出，避免重複累計；優先使用日誌中的 `costUsdTicks` 費用，沒有記錄時按定價表估算。

DSH 支援明文 `session.jsonl` 和多幀 `session.jsonl.zstd`。優先採用最終訊息用量，同時計入上下文壓縮呼叫，排除 fork 繼承的歷史；舊版僅含串流 usage 的日誌也能採集。DSH 費用按模型定價估算。壓縮日誌需要 Node 22.15+ 或 23.8+ 的 zstd API，不支援時提示並跳過壓縮檔案，明文日誌仍可採集。

Pi 讀取 JSONL 中的 assistant 用量、顯式 tool 用量及帶 usage 的上下文壓縮/分支摘要。reasoning 從 output 中拆出，避免重複累計；費用優先使用日誌記錄值，缺失時按模型價格估算。保留已發生呼叫的所有分支，只在父工作階段也位於掃描範圍內且記錄 ID、時間和用量相符時排除 fork 複製的歷史。

使用 `npm run pricing:update` 更新隨專案儲存的價格快照。估算採用快照標準價格（包括 DeepSeek 的尖峰標準價），不會自動按呼叫時段折扣，也不會重算資料庫中已經儲存的歷史費用。

---

## 環境需求

- **Node.js ≥ 22.15.0**（SQLite 使用內建的 `node:sqlite` 模組）

---

## 快速開始

```bash
# 1. 在專案根目錄安裝鎖定版本的相依套件
npm ci

# 2. 檢查環境（首次使用時，資料庫和建置產物缺失提示是正常的）
npm run doctor

# 3. 初始化資料庫並採集本機工具的用量資料
npm run db:init
npm run collect

# 4. 建置前端
npm run build

# 5. 啟動服務
npm run serve
```

在瀏覽器中開啟：

```
http://localhost:4173        # 用量看板
http://localhost:4173/review # 複盤檢視
```

用量資料寫入 `data/usage.sqlite`，`data/` 目錄已加入 `.gitignore`，不會提交到 Git。

開發模式使用 `npm run dev`，開啟 `http://127.0.0.1:5173/`。連接埠已佔用時，先確認是否已有專案執行個體；不要重複啟動。

啟動失敗、採集為空或採集失敗時，執行 `npm run doctor` 取得檢查結果和下一步操作。它只檢查環境、檔案中繼資料和已有資料庫，不採集、不初始化表、不修改歷史費用。未使用工具的日誌路徑不存在是正常提示；發現候選檔案也不代表其中包含有效用量。

分享診斷報告可用 `npm run --silent doctor -- --json`（不包含連線字串、權杖、個人路徑和原始採集錯誤）。自訂裝置名用 `--device <名稱>` 檢查。詳細狀態和邊界見 [診斷說明](docs/doctor.md)。

貢獻者可執行 `npm run test:onboarding`，用暫存資料庫及合成日誌驗證建置、首次/重複採集和頁面/API；不會採集個人日誌。CI 在 macOS、Linux、Windows 上執行此流程。

升級前請閱讀[版本說明](CHANGELOG.md)和[升級、備份與復原](docs/release.md)。`npm run test:release` 在首次安裝流程之外驗證舊 SQLite 升級、歷史金額保留、同步和備份還原；CI 在三個平台執行。支援範圍與限制也記錄在升級文件中。

瀏覽器迴歸：首次執行 `npx playwright install chromium`，再執行 `npm run test:browser`。它使用合成用量驗證跨時區篩選、分頁、匯出、重試和行動版面；CI 在 Linux 執行。

### 多裝置統一資料庫

專案支援 SQLite、PostgreSQL（包括 Supabase）和 MySQL。複製 `.env.example` 為不納入 Git 的 `.env`，設定一個共用連線：

```bash
# Supabase / PostgreSQL（建議使用 Supabase Session pooler URL）
DATABASE_URL=postgresql://user:password@host:5432/postgres?sslmode=require

# 或 MySQL 8+
# DATABASE_URL=mysql://user:password@host:3306/ai_token_dashboard
```

初始化新資料庫，並把目前機器的 SQLite 歷史資料遷移進去：

```bash
npm run db:init
npm run db:migrate -- --from data/usage.sqlite
npm run db:check
```

遷移會批次 Upsert 三張用量表並驗證記錄數，可安全重跑；`collection_runs` 僅在目標為空時遷移，避免重複日誌。其他裝置只需設定相同的 `DATABASE_URL`，執行 `npm run db:init` 後正常採集。儲存庫還提供專案級 skill：`$migrate-usage-database`。

### 前端開發模式

```bash
npm run dev   # 同時啟動 API 服務和 Vite 開發伺服器
```

開發啟動會先檢查兩個連接埠。重複啟動會提示佔用位址，不會關閉已有行程，也不會自動換連接埠。需要重新啟動時在原終端機按 Ctrl+C。可用 `API_PORT=4273 CLIENT_PORT=5273 npm run dev` 指定其他連接埠。

開發模式會佔用兩個連接埠：

```
http://localhost:4173 # API 服務
http://localhost:5173 # Vite 前端開發頁面（HMR）
```

如需分別啟動：

```bash
npm run dev:server # 只啟動 API 服務，預設連接埠 4173
npm run dev:client # 只啟動 Vite 前端，連接埠 5173
```

想在沒有真實資料時預覽介面（或重拍 README 截圖），可以產生一份示範資料：

```bash
npm run seed:demo                      # 寫入 data/demo.sqlite，不碰 data/usage.sqlite
DB_PATH=data/demo.sqlite npm run serve
```

產生結果是確定性的（固定隨機種子），同樣的指令永遠得到同樣的看板。

看板右上角的「採集」按鈕會呼叫本機介面 `POST /api/collect`，並透過 `GET /api/collect/status?wait=1` 等待完成通知，無需等待固定輪詢間隔。採集觸發介面只允許 loopback 本機存取。

正常採集按日期簽章核對變化：無變化時跳過用量表讀取與寫入；補入舊記錄時仍會核對對應的歷史日期。簽章與用量在同一交易提交，歷史費用保留規則不變。實作邊界與基準方法見 [採集效能](docs/collection-performance.md)。

---

## 多裝置匯集

從多台機器採集資料並合併到一個看板。

**第一步：在中心裝置啟動 hub 服務：**

```bash
HOST=0.0.0.0 INGEST_TOKEN="your-secret-token" npm run serve
```

**第二步：在每台使用 AI 工具的裝置上，帶 push 參數執行採集：**

```bash
npm run collect -- \
  --device "my-laptop" \
  --push http://your-hub-host:4173/api/ingest \
  --token "your-secret-token"
```

hub 會合併每日記錄和事件明細。瀏覽器登入時使用者名稱任意，密碼為 `DASHBOARD_TOKEN`（未設定時使用 `INGEST_TOKEN`）；程式使用 Bearer token。跨公網部署請在反向代理上啟用 HTTPS。首次推送包括本機資料庫已有歷史，之後按目標位址獨立記錄成功確認的內容，中斷後可重試。

---

## Docker

適合作為中心看板和 ingest 服務部署：

```bash
INGEST_TOKEN="your-secret-token" docker compose up -d
```

資料寫入掛載的 `./data` 目錄。**本機日誌採集建議在主機執行**，因為各 Agent/CLI 的工作階段檔案儲存在主機使用者目錄中。

### 定時採集

服務內建定時採集能力，預設關閉。開啟後，服務會按設定間隔自動執行一次本機採集；Docker 和一般 `npm run serve` 啟動走的是同一套邏輯。

如果用 Docker 採集，需要把主機的 AI 工具日誌目錄掛載進容器。`docker-compose.yml` 已內建相關環境變數和掛載，預設採集間隔為 5 分鐘（預設未啟用定時採集），並寫入同一個 `./data/usage.sqlite`。

Linux/macOS 範例：

```bash
export INGEST_TOKEN="your-secret-token"
export AI_TOKEN_DASHBOARD_COLLECTOR_HOME="$HOME"
export SCHEDULED_COLLECT_ENABLED=true
export SCHEDULED_COLLECT_RUN_ON_START=true
export COLLECT_DEVICE="my-laptop"
export SCHEDULED_COLLECT_INTERVAL_SECONDS=300
docker compose up -d
```

PowerShell 範例：

```powershell
$env:INGEST_TOKEN = "your-secret-token"
$env:AI_TOKEN_DASHBOARD_COLLECTOR_HOME = $env:USERPROFILE
$env:SCHEDULED_COLLECT_ENABLED = "true"
$env:SCHEDULED_COLLECT_RUN_ON_START = "true"
$env:COLLECT_DEVICE = "my-laptop"
$env:SCHEDULED_COLLECT_INTERVAL_SECONDS = "300"
docker compose up -d
```

注意：

- 不開啟 `SCHEDULED_COLLECT_ENABLED` 時，只會啟動看板和 ingest 服務，不會自動採集。
- `AI_TOKEN_DASHBOARD_COLLECTOR_HOME` 必須指向儲存 `.codex`、`.claude`、`.hermes`、`.local/share/opencode` 等日誌的主機使用者目錄。
- 非 Docker 場景也可以在 `config/collectors.json` 的 `scheduledCollect` 中設定 `enabled`、`intervalSeconds`、`runOnStart` 和 `device`。
- 如果 AI 工具資料分散在多個目錄，可以透過 `AI_TOKEN_DASHBOARD_CONFIG` 提供自訂 collector 設定。

---

## 設定項

| 環境變數 | 預設值 | 說明 |
|---------|--------|------|
| `HOST` | `127.0.0.1` | 監聽位址；外部存取需設定 token，Docker 為 `0.0.0.0` |
| `PORT` | `4173` | HTTP 服務連接埠 |
| `API_PORT` | `4173` | `npm run dev` 中 API 服務連接埠 |
| `CLIENT_PORT` | `5173` | `npm run dev` 中 Vite 頁面連接埠 |
| `DATABASE_URL` | _未設定_ | PostgreSQL/Supabase 或 MySQL 連線 URL；設定後優先於 SQLite |
| `DB_DRIVER` | `sqlite` | 未設定 `DATABASE_URL` 時的資料庫驅動程式 |
| `DB_PATH` | `data/usage.sqlite` | SQLite 資料庫路徑 |
| `DB_POOL_SIZE` | `10` | PostgreSQL/MySQL 連線池大小 |
| `DB_CONNECT_TIMEOUT_MS` | `10000` | 遠端資料庫連線逾時毫秒數 |
| `DISPLAY_TZ` | 主機時區 | 採集日期與頁面篩選、時間顯示及小時統計所用的 IANA 時區，如 `Asia/Shanghai`。瀏覽器沿用伺服器端設定；各採集端與中心應設定一致。已有日彙總不會隨設定變化自動重建 |
| `DASHBOARD_TOKEN` | _未設定_ | 看板及讀取 API 的密碼，未設定時復用 `INGEST_TOKEN` |
| `INGEST_TOKEN` | _未設定_ | 推送驗證；未設定時復用 `DASHBOARD_TOKEN`。兩個都未設定時僅允許本機監聽 |
| `SCHEDULED_COLLECT_ENABLED` | `false` | 是否啟用服務內建定時採集 |
| `SCHEDULED_COLLECT_INTERVAL_SECONDS` | `300` | 定時採集間隔秒數，最低 10 秒 |
| `SCHEDULED_COLLECT_RUN_ON_START` | `false` | 服務啟動後是否立即採集一次 |
| `COLLECT_DEVICE` | 主機名稱 | 定時採集寫入記錄的裝置標籤 |
| `COLLECTION_RUNS_KEEP` | `500` | 只保留最近 N 筆採集執行記錄，超出的會在每次開啟資料庫時清理 |
| `PARSE_CACHE` | `1` | 增量解析快取。開啟時按檔案指紋（mtime+大小）跳過未變化的工作階段檔案；設為 `0` 關閉 |
| `CODEX_LOG_APPEND_ONLY` | `0` | 可選 Codex 位元組續讀。僅在保證舊日誌內容不被改寫時設為 `1`；預設仍完整驗證舊前綴。需開啟解析快取，切換模式會重建檢查點。詳見[可靠性邊界](docs/collection-performance.md#codex-可選位元組續讀) |
| `CLAUDE_LOG_APPEND_ONLY` | `0` | 可選 Claude JSONL 位元組續讀，沿用相同的只追加限制。預設完整讀取並解析變化檔案；開啟後仍合併串流用量修正、advisor 和跨檔案副本。需開啟解析快取，切換模式重建基線；見[Claude 續讀](docs/collection-performance.md#claude-可選位元組續讀) |
| `SUBSCRIPTION_QUOTA_ENABLED` | `true` | 頂列的訂閱視窗進度條（Claude/Codex 的 5 小時 / 7 天使用率）。使用本機 OAuth 憑證連網查詢廠商介面，必要時重新整理並回寫憑證。設為 `false` 關閉此功能 |

### 定價快取

儲存庫內建兩份定價快取：

- `data/pricing-litellm.json`
- `data/pricing-openrouter.json`

正常採集會優先使用這些本機快取，因此不會為了估算價格而存取網路。需要重新整理上游價格時可手動執行：

```bash
npm run pricing:update
```

`npm run collect` 的 CLI 參數：

| 參數 | 範例 | 說明 |
|------|------|------|
| `--device` | `my-laptop` | 寫入記錄的裝置標籤（預設為主機名稱） |
| `--db` | `/path/to/db` | 覆寫 SQLite 路徑 |
| `--push` | `http://hub:4173/api/ingest` | 將採集資料推送到遠端 hub |
| `--token` | `your-secret-token` | 遠端 hub 的 Bearer token |
| `--source` | `"Codex CLI"` | 僅處理指定來源（使用看板中的完整名稱） |
| `--full` | — | 預覽指定裝置/來源的完整取代，不寫庫 |
| `--apply` | — | 配合 `--full`，備份後執行取代 |
| `--dry-run` | — | 只預覽本次採集變化 |
| `--allow-empty` | — | 配合 `--full --source`，明確允許以空日誌清空該範圍 |

預設掃描可用歷史並僅寫入變化的記錄，不再用最近事件時間截斷遲到資料。已存費用保持原值，只補能夠與新增事件核對的費用；舊口徑無法還原時顯示「未知口徑」。價格快照更新不會重算歷史費用。

重建先預覽，再顯式執行（請先確認原始日誌齊全）：

```bash
npm run collect -- --source "Codex CLI" --full
npm run collect -- --source "Codex CLI" --full --apply
```

執行時先在 `data/backups/` 儲存該裝置/來源的完整用量備份，再以交易方式取代日彙總、事件和舊工作區統計，清除過時記錄。備份可用 `npm run db:restore -- --file <備份路徑>` 預覽還原，加 `--apply` 執行。詳細費用口徑、同步復原和 API 契約見 [Usage accounting and upgrades](docs/usage-accuracy.md)。

---

## 隱私與安全

- 採集器讀取**本機檔案**；使用本機 SQLite 且不傳 `--push` 時，採集不連網。設定遠端 `DATABASE_URL` 後，採集會連線並寫入該資料庫。
- `npm run pricing:update` 會主動存取上游定價來源，用於重新整理本機價格快取。
- 除非顯式傳入 `--push`，否則不會上傳任何資料。
- `--push` 只向你提供的 URL 傳送資料。
- 預設只監聽本機；外部監聽必須設定 token，看板、讀取 API 和寫入 API 均驗證。
- `POST /api/collect` 僅允許從本機觸發，避免遠端頁面隨意掃描你的本機日誌。
- 不要將 `data/usage.sqlite`、`.env` 或任何採集匯出檔案提交到 Git。

### 訂閱額度與帳號資訊

頂列的訂閱視窗進度條（`SUBSCRIPTION_QUOTA_ENABLED`，預設開啟）會主動連網。它讀取官方 CLI 儲存在本機的登入狀態，查詢廠商用量介面，並在卡片上顯示遮罩後的帳號；憑證即將過期或被介面拒絕時，會嘗試 OAuth 重新整理並回寫原憑證儲存位置。邏輯在 `src/quota.mjs`，資料來源如下：

| 資訊 | 讀取位置 |
|------|----------|
| Claude 登入 token | macOS 鑰匙圈 `Claude Code-credentials`；讀不到時回退 `~/.claude/.credentials.json`（`CLAUDE_CONFIG_DIR` 可覆寫目錄） |
| Claude 方案 / 登入過期時間 | 同上憑證中的 `subscriptionType` / `expiresAt` |
| Claude 電子郵件 / 名稱 | `~/.claude.json` 的 `oauthAccount` 欄位 |
| Codex 登入 token | `~/.codex/auth.json`（`CODEX_HOME` 可覆寫目錄） |
| Codex 電子郵件 / 名稱 / 方案 | 上述檔案中 `id_token`（JWT）解析得到 |

資料流限制：

- **額度模組請求位址**：`api.anthropic.com/api/oauth/usage` 和 `chatgpt.com/backend-api/wham/usage`；OAuth 重新整理使用 `console.anthropic.com/v1/oauth/token` 和 `auth.openai.com/oauth/token`。每個 token 僅用於其所屬廠商。
- **電子郵件在伺服器端遮罩**後才下發前端（如 `some***@example.com`），原始位址不出伺服器端。
- **token、account_id 等敏感欄位絕不下發前端**，僅在伺服器端用於發起上述請求。
- 額度查詢結果不寫入用量資料庫或快取檔案；重新整理的登入憑證會寫回原鑰匙圈或憑證檔案。
- 程式碼中**不含任何帳號字面量**（電子郵件 / token / ID 均為執行時從本機檔案讀取，記憶體內使用後即棄）。
- 設 `SUBSCRIPTION_QUOTA_ENABLED=false` 可關閉額度查詢及其 OAuth 重新整理，卡片也不顯示；遠端資料庫、顯式同步和價格重新整理由各自設定控制。

---

## 專案結構

```
src/
├── collect.mjs          # 資料採集 CLI 入口
├── dev.mjs              # 開發模式：同時啟動 API 與 Vite
├── server.mjs           # HTTP 伺服器 + API
├── db.mjs               # SQLite/PostgreSQL/MySQL 適配與 upsert
├── db-init.mjs          # 初始化資料庫 schema
├── db-migrate.mjs       # SQLite 歷史資料遷移
├── db-check.mjs         # 連線與記錄數檢查
├── pricing.mjs          # LiteLLM + OpenRouter 定價匹配與成本估算
├── update-pricing.mjs   # 重新整理本機定價快取
├── collector-config.mjs # 讀取 config/collectors.json 與路徑展開
├── collectors/          # 各工具採集器
│   ├── claude-code.mjs
│   ├── codex.mjs
│   ├── opencode.mjs
│   ├── gemini.mjs
│   ├── hermes.mjs
│   ├── openclaw.mjs
│   └── utils.mjs
└── client/
    ├── dashboard/       # 主用量看板（React）
    ├── review/          # 複盤檢視（React）
    └── shared/          # 共用工具函式
data/
├── pricing-litellm.json     # 隨儲存庫提供的 LiteLLM 定價快取
└── pricing-openrouter.json  # 隨儲存庫提供的 OpenRouter 定價快取
db/
├── schema.sqlite.sql        # SQLite 初始化 schema
├── schema.postgres.sql      # PostgreSQL/Supabase 初始化 schema
└── schema.mysql.sql         # MySQL 初始化 schema
```

---

## 參與貢獻

歡迎貢獻。如需新增工具支援，請在 `src/collectors/` 中實作一個 collector，匯出回傳 `{ graphJson, modelsJson, eventsJson }` 的 `collect()` 函式——可參考現有 collector 了解預期資料結構。

提交較大改動前，請先開 issue 討論。

開發驗收和回饋所需資訊見[貢獻指南](CONTRIBUTING.md)；問題可提交到 [GitHub Issues](https://github.com/fengguanghuai/ai-token-dashboard/issues/new)。

---

## 授權條款

MIT — 詳見 [LICENSE](LICENSE)。
