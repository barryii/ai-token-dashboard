# 專案狀態與後續工作

更新日期：2026-10-04。增量同步及頁面最佳化見 [PR #30](https://github.com/fengguanghuai/ai-token-dashboard/pull/30)；可選日誌位元組續讀與固定快照匯出見 [PR #31](https://github.com/fengguanghuai/ai-token-dashboard/pull/31)；發布準備與合成查詢基準見 [PR #32](https://github.com/fengguanghuai/ai-token-dashboard/pull/32)。程式碼、驗證與合併狀態以對應 PR 為準，不代表已部署。

本檔案是當前待辦與完成狀態的統一入口。效能文件記錄實作邊界和測量證據，歷史計畫保留方案演變，不作為當前執行清單。這裡的「完成」只針對該項驗收範圍，不代表整個專案不存在問題。

## 原始四項待辦

| 編號 | 原始目標 | 當前狀態 | 證據與未完成邊界 |
| --- | --- | --- | --- |
| START-01 | 啟動連線埠檢查與友善提示 | 已完成 | [PR #24](https://github.com/fengguanghuai/ai-token-dashboard/pull/24)、[啟動腳本](../src/dev.mjs)：啟動子行程前探測連線埠，衝突時給出提示。 |
| QUERY-01 | 精確時間查詢聚合、明細按需分頁 | 已完成 | [PR #24](https://github.com/fengguanghuai/ai-token-dashboard/pull/24)、[查詢說明](query-performance.md)：統計基於完整選定範圍，事件詳情按頁載入。 |
| SYNC-01 | 同步讀取變更記錄，避免完整快照比較 | 已完成 | [PR #30](https://github.com/fengguanghuai/ai-token-dashboard/pull/30)：[變更記錄](../src/sync-journal.mjs)與用量同交易；[同步](../src/sync.mjs)按目標、裝置、來源儲存確認進度。首次基線後唯讀取變化記錄，支援歷史修正、重試、明確範圍替換和慢目標保留；三庫契約測試通過。 |
| READ-01 | 日誌從上次位置續讀，避免重讀變化的大檔案 | 部分完成；Codex、Claude 有可選模式 | Codex 見 [PR #31](https://github.com/fengguanghuai/ai-token-dashboard/pull/31)，Claude 見 [PR #33](https://github.com/fengguanghuai/ai-token-dashboard/pull/33)，分別使用 `CODEX_LOG_APPEND_ONLY=1` / `CLAUDE_LOG_APPEND_ONLY=1`。預設完整讀取變化檔案；可選模式僅讀新增位元組及未完成行，不能偵測歷史中部改寫後增長，其餘來源尚未支援。 |

**計數：3 項完成、1 項部分完成。** 頁面「上一週期對比」和多裝置「同步比較」是不同功能，不能用 QUERY-01 或 PR #26 代替 SYNC-01 的完成證據。

## 其他已交付內容

| 內容 | 合併證據 | 範圍 |
| --- | --- | --- |
| 用量可靠性、費用保留與還原規則 | [PR #20](https://github.com/fengguanghuai/ai-token-dashboard/pull/20) | 具體語意見[費用與升級說明](usage-accuracy.md)；不將歷史估算宣稱為已還原帳單。 |
| 開發模式採集請求的來源校驗相容 | [PR #21](https://github.com/fengguanghuai/ai-token-dashboard/pull/21) | Vite 代理保留瀏覽器請求來源。 |
| 採集快取、變化日期核對和完成通知 | [PR #22](https://github.com/fengguanghuai/ai-token-dashboard/pull/22)、[PR #23](https://github.com/fengguanghuai/ai-token-dashboard/pull/23) | 見[採集效能](collection-performance.md)。這是本地採集最佳化，不是 SYNC-01 的同步變更序列。 |
| 診斷指令與首次使用冒煙測試 | [PR #25](https://github.com/fengguanghuai/ai-token-dashboard/pull/25) | `npm run doctor`、`npm run test:onboarding`；見[診斷說明](doctor.md)。 |
| 普通首頁和複盤按日期查詢 | [PR #26](https://github.com/fengguanghuai/ai-token-dashboard/pull/26) | 包含對比週期、全域篩選選項、有限快取和請求取消；「全部」仍查詢全部歷史彙總。 |
| 用量 CSV 串流匯出、移除首頁歷史口徑橫幅 | [PR #28](https://github.com/fengguanghuai/ai-token-dashboard/pull/28) | 伺服器端分批輸出，下載由瀏覽器管理；幫助說明和歷史費用保留。不是交易快照匯出。 |

截至基線，以上 PR 的合併提交均在 Git 歷史中。歷史測試與基準結果只適用於當時版本和樣本。

## 本輪高收益最佳化

[PR #30](https://github.com/fengguanghuai/ai-token-dashboard/pull/30) 按使用者確認順序實作；驗收邊界見[查詢效能](query-performance.md)和[同步效能](collection-performance.md)。

| 編號 | 範圍 | 程式碼與驗證 |
| --- | --- | --- |
| TZ-01 | 頁面與伺服器端時區一致 | `/api/config`、`display-time.js`；涵蓋跨月、DST、明細、對比與匯出範圍。已有日彙總不自動重建。 |
| ASSET-01 | 靜態資源與路由載入 | gzip、ETag、HEAD、私有快取；首頁與複盤獨立載入，認證先於快取判斷。 |
| QUOTA-01 | 合併額度並行請求 | `request-cache.mjs`；共享進行中的呼叫，保留成功/錯誤兩種 TTL，失敗可重試。 |
| HOURLY-01 | 重複小時統計的複用 | 10 秒有限快取，以資料庫來源修訂號失效；外部連線寫入由整合測試驗證。 |
| BROWSER-01 | 可重複的瀏覽器迴歸 | `npm run test:browser`，暫時 SQLite、合成資料、跨時區 Chromium；獨立 CI job。 |

## 原始驗收記錄與後續順序

### 1. SYNC-01：交易變更記錄與確認進度

當前實作使用持久化變更記錄和每個目標端獨立的確認進度，替代常規同步的完整快照雜湊比較。SQLite 本地契約測試及 CI 中 PostgreSQL/MySQL 的同一契約均通過。獨立資料庫副本測得無變化同步約 2 ms，舊方式約 409–417 ms；1 條歷史修正唯讀取並行送 1 條變化，歷史金額未重新計算。

完成條件：

- 用量寫入與變更記錄同交易提交；涵蓋採集、匯入、還原和明確全量替換等寫入入口。
- 首次同步建立基線後，無變化和少量變化的常規同步不讀取整個用量快照，不重新雜湊全部歷史，也不重寫整份歷史行確認清單。
- 確認進度按目標位址、裝置和必要的來源範圍隔離；只在遠端確認後推進。部分失敗、回應丟失、重啟重試不丟記錄，重放保持冪等。
- 補入舊記錄、歷史記錄更新和明確範圍替換都能傳遞；不能僅相依套件最大事件時間。清理變更記錄時保留慢目標的還原路徑。
- SQLite、PostgreSQL、MySQL 測試通過；與完整同步逐項核對事件、Token 和已有費用，並記錄無變化/少量變化情境的讀取行數與耗時。

### 2. READ-01：有明確可靠性邊界的位元組續讀

Codex 為首個支援來源，現已擴展到 Claude；其他採集器單獨記錄支援範圍。現有解析狀態、累計用量、fork 重放和跨檔案去重語意必須保留。

2026-10-04 使用者確認保留預設完整校驗、增加可選只追加模式。該模式已涵蓋重啟續讀、檔案身份變化、可觀察截斷、同大小改寫、半行、UTF-8 分割、快取損壞和模式切換。64 MiB 合成日誌追加 157 位元組，僅讀取 157 位元組；結果與完整校驗一致。原始目標繼續標為部分完成，因為通用日誌的「歷史改寫偵測」和「跳過舊位元組」不能同時保證。具體啟用方式與測試邊界見[採集效能](collection-performance.md#codex-可選位元組續讀)。

後續擴展到 Claude JSONL，預設仍完整解析變化檔案。檢查點儲存原始用量快照和絕對行號，續讀後重新合併回應，保留遲到的串流修正、advisor 和 sidechain 去重。沒有修改共享位元組讀取器或資料庫費用邏輯；重複快照較多時快取可能增大，詳見 [Claude 續讀邊界](collection-performance.md#claude-可選位元組續讀)。

本地 190 項測試和發布驗收通過；2 項遠端資料庫測試由 CI 驗證，跨平台、瀏覽器和遠端結果見 [PR #33 CI](https://github.com/fengguanghuai/ai-token-dashboard/pull/33/checks)。開關保持預設關閉，未修改現有服務設定。

完成條件：

- 明確哪些日誌可以認定為只追加，以及無法確認時的後備策略。僅靠檔案大小、時間戳記或頭尾抽樣，不能保證發現歷史中部改寫。
- 在確認支援的追加情境中，讀取量隨新增位元組增長，不再為每次追加讀取完整舊前綴；用實際讀取位元組數驗證，不只測 JSON 解析耗時。
- 涵蓋行程重啟、檔案替換/輪轉、截斷、半行 JSON、UTF-8 半字元、快取損壞和版本變化；結果與完整解析一致。
- 若無法在保證所需正確性的前提下跳過舊內容校驗，保持「部分完成」，記錄限制；不能用重新命名或縮小驗收口徑宣稱原始目標完成。
- 測試與基準明確區分讀取、解析、整次採集耗時和峰值記憶體。

### 3. EXPORT-02：固定快照匯出（已實作）

新增固定快照匯出：在資料庫唯讀一致性快照內按頁產生私有暫時 CSV，提交並釋放連線後再開始下載。SQLite 使用獨立唯讀連線，PostgreSQL/MySQL 使用可重複讀交易。並行替換來源時，匯出各頁仍對應同一版本；慢下載不持有資料庫交易。驗證涵蓋取消、查詢失敗、暫時檔案清理與三庫同一契約，遠端資料庫由 CI 驗證。見 [PR #31](https://github.com/fengguanghuai/ai-token-dashboard/pull/31) 和[匯出邊界](query-performance.md#csv-匯出邊界)。

驗收：並行寫入時，匯出仍對應同一版本；記憶體保持有界；取消、失敗和暫時資源清理可靠；慢速下載不長期佔用寫交易。實作方案需同時考慮三種資料庫。

### 4. RELEASE-01：公開版本準備（驗收流程與文件已補齊）

已有中英文 README、MIT 授權條款、診斷指令和跨平台 CI，應在這些基礎上補充，避免重複搭建。

本輪新增 [Unreleased 版本說明](../CHANGELOG.md)、[升級/退回和支援邊界](release.md)、[貢獻與回饋入口](../CONTRIBUTING.md)，以及 `npm run test:release`。它重複使用首次安裝冒煙，再用 PR #30 前的凍結 SQLite schema 驗證備份、升級、歷史欄位保留、同步、重啟和還原；三平台 CI 執行同一流程。它不驗證任意舊庫或遠端生產備份，具體限制見升級文件。目標提交的 CI 通過與實際發布分別以 PR / Release 證據為準，當前仍標記 Unreleased。

本地 macOS arm64 / Node 22.22.2 驗收：從提交 `9aa2221` 的乾淨封存安裝 `npm ci`，`npm run test:release` 通過；工作目錄 `npm test` 為 188 通過、2 個遠端資料庫測試跳過。跨平台、遠端資料庫和瀏覽器結果見 [PR #32 CI](https://github.com/fengguanghuai/ai-token-dashboard/pull/32/checks)。

驗收：形成版本說明、升級/退回與已知限制說明、貢獻及問題回饋入口；對擬發布版本完成全新安裝和升級驗收；確認文件描述的採集器與平台支援範圍。準備完成與實際發布分別記錄，不能把 `package.json` 的版本號當成已發布證據。

### 5. QUERY-02：大範圍預聚合（按測量決定）

「全部」仍會讀取全部日/專案彙總，尚無伺服器端實體化彙總快取。只有實際查詢與記憶體測量顯示需要時才安排，不能僅因缺少快取就認定為缺陷。

2026-10-04 已加入可重複的[合成查詢基準](../scripts/query-benchmark.mjs)，完成 10 萬 / 100 萬事件的全歷史與 30 天對比。100 萬全歷史約 1.09 秒、峰值 RSS 158 MiB、回應約 10 MiB；30 天約 190 ms、63 MiB。測量不含瀏覽器、並行及遠端資料庫。本輪完成測量，未實作預聚合；後續在實際大庫高頻全歷史情境同時評估查詢時間與回應大小，詳見[查詢證據](query-performance.md#大範圍查詢的可重複基準)。

## 更新規則

- 原始目標保留固定編號；新增任務單列，不能擠掉未完成項。
- 「部分完成」必須同時寫已實作範圍與剩餘驗收條件；程式碼、測試、合併、執行驗證分開記錄。
- 後續變更沿用功能分支、可審閱的提交、PR、CI 通過後合併的流程。狀態變化時更新本頁，並連結實作和驗證證據。
- 歷史金額按既定規則保留，只補可確認的漏算，不為效能最佳化重算全部歷史。
- 不用一個整體百分比代替不同目標的驗收，也不因本頁已整理就宣稱任何未完成目標已修復。
