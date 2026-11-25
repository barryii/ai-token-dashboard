# 本機採集器架構

## 目標

本專案只保留純 JavaScript 本機採集路徑。採集過程讀取使用者機器上的 AI 工具日誌、JSONL transcript、JSON session 或 SQLite 狀態庫，統一正規化後寫入本專案設定的 SQLite / PostgreSQL / MySQL。

專案不再 vendoring 外部採集 runner，也不再提供 Rust 建置腳本或外部二進位相容入口。

## 採集架構

```text
npm run collect
  -> src/collect.mjs
  -> src/collectors/*.mjs
  -> collection_checkpoints: 比較日期簽章，交易內核對變化日期
  -> daily_usage: 每日 source/model token 與 cost
  -> time_usage: 帶真實時間與專案路徑的事件明細
  -> session_usage: 保留舊 workspace/model 彙總相容資料
  -> collection_runs: 記錄採集狀態
```

## 支援範圍

- Claude Code：`~/.claude/projects/`
- Hermes Agent：`~/.hermes/state.db` 或 `$HERMES_HOME/state.db`
- Codex CLI：`~/.codex/sessions/`
- Gemini CLI：`~/.gemini/tmp/`
- OpenClaw：`~/.openclaw/agents/`、`~/.clawdbot/agents/`、`~/.moltbot/agents/`、`~/.moldbot/agents/`
- OpenCode：`~/.local/share/opencode/`
- Grok CLI：`~/.grok/sessions/`
- DeepSeek Harness：`~/.dsh/sessions/`
- Pi Agent：`~/.pi/agent/sessions/`；優先讀取 `PI_CODING_AGENT_SESSION_DIR`，其次為 `PI_CODING_AGENT_DIR/sessions`，再使用 `collectors.pi.roots`

## 資料對應

各 collector 輸出統一的中間結構：

- `contributions[]`：用於產生 `daily_usage`
- `entries[]`：用於產生舊相容 `session_usage`
- `events[]`：用於產生 `time_usage`；專案排行只從帶專案路徑的事件彙總，按日期、裝置、來源和模型篩選

寫入後由 `src/server.mjs` 提供 `/api/data`（日彙總 / 專案日彙總 / 採集記錄）和 `/api/time`（按時間範圍、游標分頁載入事件，每頁最多 2000 條），前端頁面使用這兩個 API。

解析快取未變化時不再重寫 JSON；更新快取採用暫存檔和原子替換。資料庫核對以完整正規化結果的日期簽章判斷變化，不使用事件時間水位線，因此遲到的歷史記錄仍會入庫。無變化時跳過用量表讀取，變化時保留跨日期的專案活動和歷史費用。更多說明見 [採集效能](collection-performance.md)。

## 安全邊界

- 預設只讀取本機檔案，不上傳資料。
- 多裝置上報只在明確傳入 `--push` 時發生。
- 預設只監聽 `127.0.0.1`。外部監聽必須設定 `DASHBOARD_TOKEN` 或 `INGEST_TOKEN`，頁面、讀寫 API 都需要驗證。
- `--full` 預設預覽，只有 `--full --apply` 才備份並替換指定範圍。費用與還原規則見 [usage-accuracy.md](usage-accuracy.md)。
- `data/usage.sqlite`、`.env` 和採集匯出檔案不應提交到 Git。
