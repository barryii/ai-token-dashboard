# Dashboard 緊湊化與圖表修正 — 設計

日期：2026-07-18
背景：使用者回饋四個問題——趨勢圖圓角處理不好、來源佔比圓環圖只畫出 2 個扇區、
快取卡/環比卡下方大片留白、熱力圖格子偏小且左右懸浮空白多。

## 1. 趨勢圖去圓角

`components-charts.jsx` TrendChart：

- 柱狀 / 堆疊模式下所有柱子 `borderRadius` 歸零（直接不再設定 itemStyle.borderRadius）。
- 刪除只為"堆疊頂端段加圓角"服務的 `topSourceByDate` useMemo 及其引用。
- 折線模式不變。

## 2. 圓環圖還原顯示全部來源

`components-charts.jsx` SourceDonut：

- 去掉扇區 `itemStyle.borderRadius: 8`（方角扇區）。
- 刪除 `<0.5%` 的 pieData 過滤（該過滤是圓角扇區在接縫處擠成圓點的規避手段，
  圓角移除後不再需要）。全部來源入環，`minAngle: 2` 保底可見。
- 圖例邏輯不變。

## 3. 中間行（Top 模型 6 + 快取 3 + 環比 3）：充實資料 + 等高

### 等高（styles.css）

- 該行（及其它行）卡片高度拉滿：`.grid > [class^="col-"] > .panel { height: 100% }`
  （或等效選擇器），panel 內容 flex column 分佈，白卡填滿行高。

### 快取卡（Gauge）新增資料

- **快取節省費用**：突出顯示 `≈ $X`，副文案"若無快取需多付"。
  資料來源見下方伺服器端改動；按當前篩選聚合（`totals.cacheSavedUSD`）。
- **每日命中率 sparkline**：按當前篩選按日計算 `cacheRead/total`，
  重複使用 `components-top.jsx` 的 `Spark` 元件（匯出它），置於卡片底部。
- 現有"讀取 vs 建立"壓縮為一行緊湊數字（保留數值，去掉進度條）；
  "快取佔總 Token" 進度條移除，數值並入緊湊行或省略。

### 環比卡（GrowthPanel）

- 資料不變（DoD/WoW/MoM/日均/峰值），stat 列表 flex 均勻拉開填滿高度。

### 伺服器端：cacheSavedUSD

`server.mjs` `/api/data`：

- 啟動時 `loadPricing()`；daily 每行附加
  `cacheSavedUSD = max(0, calculateCost(model, {input: input+cacheRead+cacheWrite, output, reasoning})
  − calculateCost(model, {input, output, cacheRead, cacheWrite, reasoning}))`。
- 查不到定價時為 0。放在伺服器端按行算，保證與前端全部篩選維度聯動。
- `utils.js` `aggregateTotals` 增加 `cacheSavedUSD` 求和。
- `App.jsx` 將 `totals.cacheSavedUSD` 與每日命中率序列傳入 Gauge。

## 4. 熱力圖：響應式格子 + 小時分佈

`components-charts.jsx` Heatmap + styles.css：

- 格子列寬改為 `minmax(13px, 1fr)` 並設格子 `max-width`（約 22px），
  `width: 100%`、高度固定 13px；網格 `width: 100%`（撐滿左欄），不再 max-content 置中懸浮。
- 網格下方新增與 24 列對齊的**小時分佈**迷你柱狀圖：
  對當前顯示的 28 天按小時求和 tokens，24 根小柱（div 實作，同網格列軌道），
  hover 顯示 tooltip（小時 + tokens）。
- 右側活躍摘要新增一條"高峰時段 HH:00"（取小時分佈峰值），與現有"高峰 週六"呼應。

## 改動範圍

- `src/client/dashboard/components-charts.jsx`（四個元件）
- `src/client/dashboard/components-top.jsx`（匯出 Spark）
- `src/client/dashboard/styles.css`（等高、熱力圖響應式、新元素樣式）
- `src/client/shared/utils.js`（aggregateTotals）
- `src/server.mjs`（daily 行 cacheSavedUSD）
- `src/client/dashboard/App.jsx`（傳參）

## 不做的事

- 不改表格區、KPI 行、篩選器。
- 不改資料採集與儲存 schema。
- 環比卡不新增指標。

## 驗證

- `npm run dev` 起本地服務，實際瀏覽器查看四處改動。
- 圓環圖應畫出 4 個來源（Hermes Agent 0.11%、OpenCode 0.01% 可見小扇區）。
- 快取節省費用應為正數且隨篩選變化。
- 中間行三卡等高；熱力圖網格撐滿左欄。
