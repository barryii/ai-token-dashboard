# 版本準備、升級與復原

目前變更記錄在 [Unreleased](../CHANGELOG.md)。發布準備、PR 合併、GitHub Release 和正在執行的服務是四個獨立狀態；`package.json` 中的 `0.1.0` 不表示已經發布。本文不執行打標籤、發布或服務重新啟動。

## 發布前驗收

在目標提交的全新目錄中執行 `npm ci`，隨後執行：

```sh
npm test
npm run test:release
npx playwright install chromium
npm run test:browser
```

`test:release` 先建置並執行首次安裝冒煙：診斷缺失資料庫、初始化、重複採集合成 Pi 日誌、建置頁面/資源與用量介面。隨後使用提交 `193277e1d5a8f71c90c192e926e12db42032c729` 的凍結 SQLite schema（PR #30 之前），驗證一致性備份、兩次初始化升級、歷史所有用量欄位保留、新採集、首次 HTTP 同步、行程重新啟動後無變化同步、還原舊備份及再次升級。記錄零費用、歷史估算和未知費用來源都必須保留。測試只存取暫存目錄和合成資料。

這證明對應舊 schema 的升級與資料備份還原，不代表執行了舊版本應用的端到端復原，也不涵蓋任意更早或被手工修改的資料庫。歷史欄升級另有單元測試。跨庫的交易、同步和 CSV 一致性由 PostgreSQL/MySQL 整合測試涵蓋；本輪不聲稱驗證了遠端正式環境備份或還原。

發布時記錄目標 commit、CI 連結、版本號/Tag、已知限制及製品來源。六項 CI 檢查（3 個平台、瀏覽器、相依套件稽核、資料庫整合）均通過後，才將候選描述為通過驗證；實際發布後再記錄 Release 連結。部署後另查 HTTP、採集與同步，不用 CI 替代執行驗收。

## 升級已有實例

1. 記錄目前 commit、Node 版本、實際資料庫類型/路徑和部署設定。先在資料庫副本上演練；保留 `.env`、採集路徑設定及舊建置產物在私有位置。
2. 暫停該資料庫的所有採集行程、排程任務、同步接收端和其他寫入者。所有共用資料庫的寫入程式必須一起升級；舊程式寫入不會產生新同步變更記錄，可能導致漏同步。
3. 備份完整資料庫。SQLite 不要只複製正在使用的 `.sqlite` 主檔案，WAL 中可能仍有已提交資料。下面的 Node 指令以唯讀來源連線執行一致性 `VACUUM INTO`；來源路徑必須是實際 SQLite 資料庫，目標必須是私有目錄下尚不存在的檔案，磁碟空間至少容納一份資料庫：

   ```sh
   node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.argv[1],{readOnly:true}); try {db.prepare('VACUUM INTO ?').run(process.argv[2]);} finally {db.close();}" "/absolute/path/usage.sqlite" "/private/backup/usage-before-upgrade.sqlite"
   ```

   校驗備份能開啟且 `PRAGMA integrity_check` 回傳 `ok`，並核對三張用量表的列數、Token 和金額；測試腳本執行了同一備份指令及逐欄位核對。PostgreSQL/MySQL 使用對應資料庫的完整一致性備份或代管快照，並在獨立庫驗證還原；不能用 CSV 匯出替代資料庫備份。
4. 在新程式碼目錄安裝鎖定相依套件並建置：`npm ci`、`npm run build`。帶入原設定，確認沒有指向錯誤資料庫，然後執行 `npm run doctor`、`npm run db:init`、`npm run db:check`。`db:init` 會修改 schema；`doctor` 只做診斷。初始化不重估歷史金額，可能補鎖價中繼資料及整理執行記錄。
5. 啟動新版本，檢查頁面、日期範圍、歷史 Token/金額和 CSV；確認沒有連接埠衝突後再還原排程採集和同步。已有日彙總不會因 `DISPLAY_TZ` 改變而重建，採集端和中心應使用一致時區。
6. 第一次同步會傳送歷史基線；後續按修訂傳送變化。保留原裝置名稱和來源，觀察失敗後的重試及中心結果。單獨 `--resync` 不刪除中心資料；`--full --apply` 是備份後替換範圍的獨立操作，不是升級必需步驟。

Codex 的 `CODEX_LOG_APPEND_ONLY` 和 Claude 的 `CLAUDE_LOG_APPEND_ONLY` 分別控制可選位元組續讀，預設均關閉；僅當對應日誌舊內容保證不改寫時才明確設為 `1`。模式切換會重建解析快取。這些選項不能偵測「中部改寫後檔案又增長」的情況，詳見[採集邊界](collection-performance.md)。

## 復原

先停止全部相關寫入者，另存升級後的完整資料庫及日誌，以便保留升級後新增用量。把升級前備份還原到**新的空路徑或獨立資料庫**，不要覆寫帶有舊 WAL/SHM 的使用中 SQLite 路徑。還原舊 commit、相依套件和建置產物，設定為已還原的資料庫；核對完整性、列數、Token、金額後再啟動舊程式。

還原備份只還原到備份時刻，之後新增資料需要另行核對合併。共用資料庫及同步兩端需協調復原，在核對完成前保持上傳暫停，避免用較舊快照覆寫較新歷史。沒有經過驗證的備份時，不能把直接啟動舊程式碼視為可靠復原，也不要暫時刪除同步表規避問題。`db:restore` 還原的是 JSON 用量範圍，不是資料庫 schema 或同步進度的版本復原。

## 支援與已知限制

| 維度 | 已有驗證與邊界 |
| --- | --- |
| 系統與執行階段 | Node ≥22.15；macOS、Linux、Windows CI 執行建置、合成採集和升級驗收。真實 Chromium 互動在 Linux CI 驗證。不能據此宣稱每個平台上的全部廠商用戶端日誌均經過真實環境驗收。 |
| 資料庫 | SQLite 為預設；CI 驗證 PostgreSQL 16、MySQL 8.4。MySQL 顯示時區統計需要正確載入時區表。其他版本和代管網路設定需單獨檢查。 |
| 採集器 | 九類來源見[採集器說明](local-collectors.md)。日誌格式相容性取決於實際用戶端版本，未設定來源不產生日誌。Gemini 目前只回傳日/工作階段彙總，不提供精確事件檢視；專案統計需要事件中有真實路徑。 |
| 壓縮日誌 | DSH 的 zstd 需要 Node 提供相關 API；不支援時跳過壓縮檔案並提示。 |
| 費用 | 已記錄金額優先，缺失時估算；未知模型為零不表示免費，估算不能作為廠商帳單。 |
| 匯出 | 固定快照先落暫存磁碟再下載，需要相應磁碟空間；強制終止可能留下私有暫存檔案。 |
| 大範圍查詢 | 「全部」回傳全部日/專案彙總，事件詳情仍分頁；回應大小隨彙總維度增長。合成測量見[查詢效能](query-performance.md)。 |
| 聯網與權限 | 一般採集預設只讀本機日誌並寫本機設定資料庫；明確同步/價格重新整理聯網。訂閱額度預設啟用，會查詢上游且可能重新整理本機 OAuth 憑證；可設 `SUBSCRIPTION_QUOTA_ENABLED=false`。非本機監聽必須設定權杖。 |

貢獻和問題回報見 [CONTRIBUTING](../CONTRIBUTING.md)。
