# Dashboard 緊湊化與圖表修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec `docs/superpowers/specs/2026-07-18-dashboard-density-polish-design.md`：趨勢圖去圓角、圓環圖畫出全部來源、中間行三卡等高並給快取卡加「節省費用 + 命中率 sparkline」、熱力圖格子響應式拉伸並加小時分佈。

**Architecture:** 純前端 React (無 JSX 測試基礎建設，UI 改動靠 dev server 視覺驗證 + `npm test` 迴歸)；唯一的後端改動是 `/api/data` 的 daily 行新增 `cacheSavedUSD` 欄位，由 `pricing.mjs` 新匯出的 `calculateCacheSavings` 計算（此函式走 TDD）。

**Tech Stack:** React 18 + ECharts 6 + 手寫 CSS；Node 22 原生 `node --test`；SQLite 資料（只讀，不改 schema）。

## Global Constraints

- 不改 DB schema、不改採集器、不改表格區 / KPI 行 / 篩選器。
- 測試指令：`npm test`（node --test，跑 `test/*.test.mjs`）。
- dev 環境：`npm run dev`（vite 5173 + API 4173）。
- 工作樹裡有上一輪未提交的 UI 改動（KPI 6→4、donut 過滤等），先原樣提交為基準線（Task 1），不要混入本計畫的改動。
- 所有新 UI 文案為中文，與現有風格一致；數字用 `U.compactCN` / `U.fmtUS`。

---

### Task 1: 提交現有 WIP 基準線

**Files:**
- Modify: 無（僅提交現有工作樹改動）

現有未提交改動（KPI 行 6→4 卡、donut <0.5% 過滤、TopModels 8→5、Gauge cache-metrics、對應 CSS）是使用者當前看到的介面基準線，先單獨提交，避免與本計畫的 diff 混在一起。

- [ ] **Step 1: 確認改動範圍只有三個檔案**

Run: `git status --short`
Expected: `M src/client/dashboard/App.jsx`、`M src/client/dashboard/components-charts.jsx`、`M src/client/dashboard/styles.css`（`.superpowers/` 與 docs 之外無其它）。`?? .superpowers/` 不要提交。

- [ ] **Step 2: 提交**

```bash
git add src/client/dashboard/App.jsx src/client/dashboard/components-charts.jsx src/client/dashboard/styles.css
git commit -m "feat: slim KPI row, cap top models at 5, donut tiny-slice filter, cache card meters"
```

---

### Task 2: pricing.mjs 新增 calculateCacheSavings（TDD）

**Files:**
- Modify: `src/pricing.mjs`（在 `calculateCost` 定義之後，約 195 行處新增匯出函式）
- Test: `test/pricing.test.mjs`（檔案已存在，追加測試案例）

**Interfaces:**
- Consumes: 既有 `calculateCost(model, tokens, pricingData, provider, options)`。
- Produces: `calculateCacheSavings(model, tokens, pricingData, provider = null) => number`，tokens 形如 `{ input, output, cacheRead, cacheWrite, reasoning }`（與 calculateCost 相同），回傳 `max(0, 無快取假設成本 − 實際估算成本)`，查不到定價時為 0。Task 3 的 server.mjs 相依此簽名。

- [ ] **Step 1: 寫失敗測試**

在 `test/pricing.test.mjs` 末尾追加（該檔案已 `import { calculateCost } from '../src/pricing.mjs'`，把 import 改為同時引入 `calculateCacheSavings`）：

```js
import { calculateCost, calculateCacheSavings } from '../src/pricing.mjs';
```

```js
const CACHE_PRICING_FIXTURE = {
  'test-cache-model': {
    mode: 'chat',
    litellm_provider: 'anthropic',
    input_cost_per_token: 1e-6,
    output_cost_per_token: 2e-6,
    cache_read_input_token_cost: 1e-7,
    cache_creation_input_token_cost: 1.25e-6
  }
};

test('calculateCacheSavings = uncached cost minus actual cost', () => {
  const tokens = { input: 1000, output: 500, cacheRead: 100_000, cacheWrite: 2000 };
  // uncached: (1000+100000+2000)*1e-6 + 500*2e-6      = 0.104
  // actual:   1000*1e-6 + 500*2e-6 + 100000*1e-7 + 2000*1.25e-6 = 0.0145
  const saved = calculateCacheSavings('test-cache-model', tokens, CACHE_PRICING_FIXTURE);
  assert.ok(Math.abs(saved - 0.0895) < 1e-9, `got ${saved}`);
});

test('calculateCacheSavings is 0 with no cache tokens or unknown model', () => {
  assert.equal(calculateCacheSavings('test-cache-model', { input: 1000, output: 500 }, CACHE_PRICING_FIXTURE), 0);
  assert.equal(calculateCacheSavings('no-such-model-zzz-123', { input: 1, cacheRead: 1000 }, {}), 0);
});
```

注意：若 fixture 的裸模型名查不到（`lookupPricing` 的候選生成不接受該形狀），把 fixture 鍵換成 `anthropic/test-cache-model` 再試；兩個測試案例的期望值不變。

- [ ] **Step 2: 執行確認失敗**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL，`calculateCacheSavings is not a function` / SyntaxError（未匯出）。

- [ ] **Step 3: 實作**

`src/pricing.mjs`，緊跟 `calculateCost` 函式之後：

```js
/**
 * Estimated dollars saved by prompt caching: what the same request volume
 * would have cost with every cached token billed at the full input rate,
 * minus the actual estimated cost. 0 when pricing is unknown.
 */
export function calculateCacheSavings(model, tokens, pricingData, provider = null) {
  const { input = 0, output = 0, cacheRead = 0, cacheWrite = 0, reasoning = 0 } = tokens;
  if (!cacheRead && !cacheWrite) return 0;
  const uncached = calculateCost(
    model,
    { input: input + cacheRead + cacheWrite, output, reasoning },
    pricingData,
    provider
  );
  const actual = calculateCost(model, tokens, pricingData, provider);
  return Math.max(0, uncached - actual);
}
```

- [ ] **Step 4: 執行確認透過**

Run: `npm test 2>&1 | tail -20`
Expected: 全部 PASS（含既有測試案例）。

- [ ] **Step 5: 提交**

```bash
git add src/pricing.mjs test/pricing.test.mjs
git commit -m "feat: add calculateCacheSavings to pricing module"
```

---

### Task 3: /api/data daily 行附加 cacheSavedUSD

**Files:**
- Modify: `src/server.mjs`（頭部 import、啟動時載入 pricing、`/api/data` 的 daily 映射約 111-116 行）

**Interfaces:**
- Consumes: Task 2 的 `calculateCacheSavings(model, tokens, pricingData)`；既有 `loadPricing(cachePath)`。
- Produces: `/api/data` 回應中每個 daily 行多一個數值欄位 `cacheSavedUSD`（≥0）。Task 4 的 aggregateTotals、Task 7 的 Gauge 相依它。

- [ ] **Step 1: 實作**

`src/server.mjs` 頭部（`import { queryQuota }` 之後）：

```js
import { calculateCacheSavings, loadPricing } from './pricing.mjs';
```

`const db = openDb(...)` 附近（模組頂層，檔案已是 ESM 可用頂層 await）：

```js
// Pricing data for serve-time cache-savings estimation. Same bundled cache
// file the collector uses; savings silently degrade to 0 if it is missing.
const pricingData = await loadPricing(resolve(process.cwd(), 'data', 'pricing-litellm.json'));
```

`/api/data` 中 daily 映射改為：

```js
      daily: rawDaily.map(d => ({
        ...d,
        projectPath: projMap.get(`${d.device}::${d.source}`)?.project || null,
        cacheSavedUSD: calculateCacheSavings(d.model, {
          input: d.inputTokens,
          output: d.outputTokens,
          cacheRead: d.cacheReadTokens,
          cacheWrite: d.cacheCreationTokens,
          reasoning: d.reasoningOutputTokens
        }, pricingData)
      })),
```

- [ ] **Step 2: 啟動服務驗證欄位**

```bash
PORT=4599 node src/server.mjs & sleep 2
curl -s localhost:4599/api/data | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const rows=JSON.parse(s).daily;const w=rows.filter(r=>r.cacheSavedUSD>0);console.log('rows',rows.length,'with savings',w.length,'sample',w[0]?.model,w[0]?.cacheSavedUSD);})"
kill %1
```

Expected: `with savings` 數量 > 0，sample 的 cacheSavedUSD 為正數（claude 系模型應有值）。

- [ ] **Step 3: 迴歸 + 提交**

Run: `npm test 2>&1 | tail -5` → PASS。

```bash
git add src/server.mjs
git commit -m "feat: serve per-row cacheSavedUSD in /api/data"
```

---

### Task 4: aggregateTotals 匯總 cacheSavedUSD（TDD）

**Files:**
- Modify: `src/client/shared/utils.js`（`aggregateTotals`，約 192-214 行）
- Test: Create `test/client-utils.test.mjs`

**Interfaces:**
- Consumes: daily 行的 `cacheSavedUSD`（Task 3；行上可能缺省 → 按 0）。
- Produces: `U.aggregateTotals(rows)` 回傳物件新增 `cacheSavedUSD` 數值欄位。Task 7 透過 `totals.cacheSavedUSD` 消費。

- [ ] **Step 1: 寫失敗測試**

Create `test/client-utils.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { U } from '../src/client/shared/utils.js';

test('aggregateTotals sums cacheSavedUSD, defaulting missing values to 0', () => {
  const rows = [
    { totalTokens: 100, inputTokens: 10, outputTokens: 20, cacheReadTokens: 60,
      cacheCreationTokens: 10, reasoningOutputTokens: 0, costUSD: 1, cacheSavedUSD: 2.5 },
    { totalTokens: 50, inputTokens: 50, outputTokens: 0, cacheReadTokens: 0,
      cacheCreationTokens: 0, reasoningOutputTokens: 0, costUSD: 0.5 } // no cacheSavedUSD
  ];
  const t = U.aggregateTotals(rows);
  assert.equal(t.cacheSavedUSD, 2.5);
  assert.equal(t.totalTokens, 150);
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `node --test test/client-utils.test.mjs 2>&1 | tail -10`
Expected: FAIL，`t.cacheSavedUSD` 為 undefined。（若 import 階段因瀏覽器專用 API 錯誤，說明 utils.js 頂層引用了 document/window——按實際錯誤處理，函式本體內引用不影響 import。）

- [ ] **Step 3: 實作**

`aggregateTotals` 中：

```js
function aggregateTotals(rows) {
  let total = 0, inp = 0, out = 0, cacheRd = 0, cacheCr = 0, reason = 0, cost = 0, saved = 0;
  for (const r of rows) {
    total += r.totalTokens;
    inp   += r.inputTokens;
    out   += r.outputTokens;
    cacheRd += r.cacheReadTokens;
    cacheCr += r.cacheCreationTokens;
    reason += r.reasoningOutputTokens;
    cost  += r.costUSD;
    saved += r.cacheSavedUSD || 0;
  }
  return {
    totalTokens: total,
    inputTokens: inp,
    outputTokens: out,
    cacheReadTokens: cacheRd,
    cacheCreationTokens: cacheCr,
    cacheTokens: cacheRd + cacheCr,
    reasoningTokens: reason,
    costUSD: cost,
    cacheSavedUSD: saved,
    cacheHitRate: total ? (cacheRd / total) * 100 : 0
  };
}
```

- [ ] **Step 4: 執行確認透過**

Run: `npm test 2>&1 | tail -5`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/client/shared/utils.js test/client-utils.test.mjs
git commit -m "feat: aggregate cacheSavedUSD in totals"
```

---

### Task 5: 趨勢圖柱子去圓角

**Files:**
- Modify: `src/client/dashboard/components-charts.jsx`（TrendChart：刪除 `topSourceByDate` useMemo 約 43-55 行；柱狀 series 建置約 87-107 行）

**Interfaces:**
- Consumes/Produces: 無跨任務介面，純內部改動。

- [ ] **Step 1: 實作**

刪除整個 `topSourceByDate` useMemo（`const topSourceByDate = useMemo(...)` 到 `}, [byKey, dates, sources]);`）。

柱狀/堆疊分支改為（不再有逐點 itemStyle / borderRadius）：

```js
  if (mode === 'stacked' || mode === 'bar') {
    sources.forEach((src, i) => {
      series.push({
        name: src,
        type: 'bar',
        stack: mode === 'stacked' ? 'total' : undefined,
        barMaxWidth: 24,
        itemStyle: { color: palette[i] },
        ...stableBarState,
        data: dates.map(d => byKey.get(`${d}::${src}`) || 0)
      });
    });
  } else if (mode === 'line') {
```

- [ ] **Step 2: 視覺驗證**

Run: `npm run dev`（若未在跑），瀏覽器開啟 http://localhost:5173。
Expected: 堆疊/柱狀模式下柱子四角均為直角；切換三種模式無錯誤。

- [ ] **Step 3: 提交**

```bash
git add src/client/dashboard/components-charts.jsx
git commit -m "fix: square bar corners in trend chart"
```

---

### Task 6: 圓環圖方角 + 全部來源入環

**Files:**
- Modify: `src/client/dashboard/components-charts.jsx`（SourceDonut 約 277-357 行）

**Interfaces:**
- Consumes/Produces: 無跨任務介面。

- [ ] **Step 1: 實作**

三處改動：

1. 刪除 pieData 過滤及其註解（`// Tiny slices (<0.5%)...` 三行註解 + `const pieData = data.filter(...)`），series 的 `data:` 直接用 `data.map(...)`。
2. series 的 `itemStyle` 去掉 `borderRadius: 8`：

```js
      itemStyle: {
        borderColor: '#fff',
        borderWidth: 2,
        shadowBlur: 12,
        shadowOffsetY: 3,
        shadowColor: 'rgba(15, 23, 42, 0.16)'
      },
```

3. `minAngle: 2` 保留不動。

- [ ] **Step 2: 視覺驗證**

瀏覽器重新整理，來源佔比圓環圖。
Expected: 4 個來源全部有扇區（Hermes Agent / OpenCode 為細小扇區但可見、可 hover 出 tooltip）；扇區為方角；12 點鐘接縫處無疊色小圓點。

- [ ] **Step 3: 提交**

```bash
git add src/client/dashboard/components-charts.jsx
git commit -m "fix: draw all sources in donut with square slice corners"
```

---

### Task 7: 中間行等高 + 快取卡節省費用 & 命中率 sparkline + 環比卡拉伸

**Files:**
- Modify: `src/client/dashboard/components-top.jsx`（607 行匯出處）
- Modify: `src/client/dashboard/components-charts.jsx`（import 行 9；Gauge 約 695-768 行；GrowthPanel 約 801-825 行）
- Modify: `src/client/dashboard/App.jsx`（Dashboard 內新增 hitRateSeries useMemo；Gauge 呼叫處約 465-472 行）
- Modify: `src/client/dashboard/styles.css`（Grid 段約 920-931 行後新增等高規則；Cache card 段 1188-1257 行重寫）

**Interfaces:**
- Consumes: `totals.cacheSavedUSD`（Task 4）；`Spark({ values, color, height, fill })`（components-top 既有元件）。
- Produces: `Gauge` 新 props：`savedUSD`（number）、`hitRateSeries`（number[]，與 dates 對齊的百分比 0-100）。`Spark` 從 components-top.jsx 具名匯出。

- [ ] **Step 1: 匯出 Spark**

`components-top.jsx` 最後一行改為：

```js
export { Topbar, FilterBar, KPI, Delta, Spark };
```

`components-charts.jsx` 第 9 行改為：

```js
import { Delta, Spark } from './components-top.jsx';
```

- [ ] **Step 2: 重寫 Gauge 元件**

替換整個 `Gauge` 函式：

```jsx
function Gauge({ rate, cacheRead, cacheCreation, total, prevRate, savedUSD, hitRateSeries }) {
  const r = Math.max(0, Math.min(100, rate));
  const C = Math.PI * 70;
  const dash = (r / 100) * C;

  return (
    <div className="panel cache-card">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">快取命中率</h2>
          <p className="panel-sub">cache_read / total</p>
        </div>
        <Delta value={U.deltaPct(rate, prevRate)} />
      </div>
      <div className="gauge">
        <div className="gauge-wrap">
          <svg viewBox="0 0 180 100" width="180" height="100">
            <path d="M 10 90 A 80 80 0 0 1 170 90" stroke="oklch(0.95 0.004 80)" strokeWidth="14" fill="none" strokeLinecap="round"/>
            <path
              d="M 10 90 A 80 80 0 0 1 170 90"
              stroke="url(#hitGrad)"
              strokeWidth="14" fill="none" strokeLinecap="round"
              strokeDasharray={`${dash} ${C}`}
              style={{transition: 'stroke-dasharray 600ms cubic-bezier(0.22,1,0.36,1)'}}
            />
            <defs>
              <linearGradient id="hitGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="oklch(0.65 0.13 200)"/>
                <stop offset="100%" stopColor="oklch(0.55 0.16 265)"/>
              </linearGradient>
            </defs>
          </svg>
          <div className="gauge-text">
            <div>
              <span className="gauge-num">{r.toFixed(1)}</span>
              <span className="gauge-suffix">%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="cache-line">
        <span><i className="cache-key cache-key-read"/>讀取 <b>{U.compactCN(cacheRead)}</b></span>
        <span><i className="cache-key cache-key-create"/>建立 <b>{U.compactCN(cacheCreation)}</b></span>
      </div>

      <div className="cache-saved">
        <div className="cache-saved-label">快取節省費用</div>
        <div className="cache-saved-num">≈ {U.fmtUS.format(savedUSD || 0)}</div>
        <div className="cache-saved-sub">若無快取需多付的估算金額</div>
      </div>

      <div className="cache-trend">
        <div className="cache-trend-head">
          <span>每日命中率</span>
        </div>
        <Spark values={hitRateSeries} color="oklch(0.65 0.11 200)" height={36}/>
      </div>
    </div>
  );
}
```

（`total` prop 保留傳入但不再展示"快取佔總 Token"進度條。）

- [ ] **Step 3: GrowthPanel 拉伸填滿**

`GrowthPanel` 的 stat 容器 div 改為：

```jsx
      <div style={{display: 'flex', flexDirection: 'column', gap: 8, flex: 1, justifyContent: 'space-evenly'}}>
```

峰值提示塊的樣式不動（保持 `marginTop: 14`）；只改上面這個 stat 容器，靠 `flex: 1` + `space-evenly` 把四個 stat 均勻拉開填滿卡片高度。

- [ ] **Step 4: App.jsx 傳參**

Dashboard 元件內（`sparkBy` useMemo 之後）新增：

```js
  // Daily cache hit-rate series for the gauge card sparkline
  const hitRateSeries = useMemo(() => {
    const read = new Map(), tot = new Map();
    for (const r of filtered) {
      read.set(r.usageDate, (read.get(r.usageDate) || 0) + (r.cacheReadTokens || 0));
      tot.set(r.usageDate, (tot.get(r.usageDate) || 0) + r.totalTokens);
    }
    return dates.map(d => {
      const t = tot.get(d) || 0;
      return t ? ((read.get(d) || 0) / t) * 100 : 0;
    });
  }, [filtered, dates]);
```

Gauge 呼叫處改為：

```jsx
          <Gauge
            rate={totals.cacheHitRate}
            cacheRead={totals.cacheReadTokens}
            cacheCreation={totals.cacheCreationTokens}
            total={totals.totalTokens}
            prevRate={compareData.totals?.cacheHitRate}
            savedUSD={totals.cacheSavedUSD}
            hitRateSeries={hitRateSeries} />
```

- [ ] **Step 5: CSS — 等高 + 新卡片樣式**

`styles.css` Grid 段（`.col-12 { ... }` 之後）新增：

```css
/* Equal-height rows: stretch each panel to fill its grid cell */
.grid > [class*="col-"] { display: flex; flex-direction: column; }
.grid > [class*="col-"] > .panel { flex: 1; display: flex; flex-direction: column; min-width: 0; }
```

Cache card 段：保留 `.cache-card`、`.cache-card .gauge`、`.cache-key`、`.cache-key-read`、`.cache-key-create`，刪除 `.cache-metrics`、`.cache-metric-head`、`.cache-metric-label`、`.cache-metric-val`、`.cache-track`、`.cache-track-split`、`.cache-fill`、`.cache-fill-read`、`.cache-fill-total`、`.cache-metric-foot` 規則，新增：

```css
.cache-line {
  display: flex;
  justify-content: center;
  gap: 18px;
  font-size: 12px;
  color: var(--text-2);
  margin-top: 2px;
}
.cache-line b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }

.cache-saved {
  margin-top: 14px;
  padding: 12px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border-2);
  border-radius: 9px;
  text-align: center;
}
.cache-saved-label {
  font-size: 10.5px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.cache-saved-num {
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--good);
  margin-top: 2px;
}
.cache-saved-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }

.cache-trend { margin-top: auto; padding-top: 14px; }
.cache-trend-head {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 4px;
}
.cache-trend .kpi-spark { display: block; width: 100%; height: 36px; }
```

注意 `.cache-card` 原有的 `display`/`flex` 定義（1189-1193 行）查看後與全域等高規則合併，避免重複或衝突（全域已給 `.panel` flex column，`.cache-card` 裡只留它特有的規則）。

- [ ] **Step 6: 視覺驗證**

瀏覽器重新整理。
Expected:
- Top 模型 / 快取 / 環比三卡底邊齊平，白卡填滿整行高度，無底色露出。
- 快取卡自上而下：弧形錶 → 讀取/建立一行 → 「快取節省費用 ≈ $xxx」綠色大數字（正數）→ 底部每日命中率 sparkline。
- 切換篩選（來源/時間範圍）時節省費用與 sparkline 聯動變化。
- 趨勢圖+圓環圖那一行也等高無異常；熱力圖/表格行無佈局破壞。

- [ ] **Step 7: 迴歸 + 提交**

Run: `npm test 2>&1 | tail -5` → PASS。

```bash
git add src/client/dashboard/components-top.jsx src/client/dashboard/components-charts.jsx src/client/dashboard/App.jsx src/client/dashboard/styles.css
git commit -m "feat: equal-height chart rows, cache savings stat and hit-rate sparkline"
```

---

### Task 8: 熱力圖響應式格子 + 小時分佈 + 高峰時段

**Files:**
- Modify: `src/client/dashboard/components-charts.jsx`（Heatmap 約 460-690 行）
- Modify: `src/client/dashboard/styles.css`（heatmap 段 1261-1341 行）

**Interfaces:**
- Consumes/Produces: 無跨任務介面。

- [ ] **Step 1: Heatmap JSX — 小時匯總與網格改造**

`showMatrix`/`max` 計算之後新增：

```js
  // Hour-of-day marginal distribution across the shown window
  const hourTotals = Array.from({length: 24}, (_, h) =>
    showMatrix.reduce((s, row) => s + row[h].tokens, 0)
  );
  const hourMax = Math.max(...hourTotals, 1);
  const peakHourIndex = hourTotals.indexOf(Math.max(...hourTotals));
```

網格容器 inline style 改為（列軌道響應式、底部加 2 行放小時分佈）：

```jsx
              style={{
                gridTemplateColumns: '48px repeat(24, minmax(13px, 1fr))',
                gridTemplateRows: `16px repeat(${showDates.length}, 14px) 10px 30px`
              }}>
```

在日期行渲染結束、tooltip 渲染之前插入小時分佈行（gridRow = 日期行之後隔一行）：

```jsx
              <div className="heat-row-label" style={{gridRow: showDates.length + 3, gridColumn: 1}}>時段</div>
              {hourTotals.map((v, hi) => (
                <div
                  key={`hb-${hi}`}
                  className="heat-hour-bar"
                  style={{gridRow: showDates.length + 3, gridColumn: hi + 2}}
                  title={`${String(hi).padStart(2, '0')}:00 · ${U.compactCN(v)} tokens`}>
                  <div style={{height: v ? `${Math.max(8, (v / hourMax) * 100)}%` : 0}}/>
                </div>
              ))}
```

- [ ] **Step 2: 活躍摘要新增「高峰時段」**

`heat-stat-grid` 內（峰值日期 stat 之後）追加：

```jsx
            <div className="heat-stat" style={{gridColumn: '1 / -1'}}>
              <span>高峰時段</span>
              <strong>{String(peakHourIndex).padStart(2, '0')}:00</strong>
              <small>{U.compactCN(hourTotals[peakHourIndex])} tokens</small>
            </div>
```

- [ ] **Step 3: CSS**

`styles.css` heatmap 段：

```css
.heatmap-main {
  min-width: 0;
  display: flex;
  align-items: center;
}
.heatmap-grid {
  position: relative;
  display: grid;
  width: 100%;
  gap: 3px;
  align-items: center;
}
```

（即 `.heatmap-main` 去掉 `justify-content: center`；`.heatmap-grid` 的 `width: max-content; margin: 0 auto;` 改為 `width: 100%`。）

`.heat-cell` 的尺寸規則拆開——基礎類保留視覺樣式，網格內改為自適應：

```css
.heat-cell {
  appearance: none;
  width: 13px;
  height: 13px;
  min-width: 13px;
  padding: 0;
  border: 1px solid color-mix(in oklab, var(--border), transparent 24%);
  border-radius: 2.5px;
  cursor: pointer;
  transition: transform 100ms ease, border-color 100ms ease, box-shadow 100ms ease;
}
.heatmap-grid .heat-cell {
  width: 100%;
  height: 100%;
}
```

新增小時分佈條樣式：

```css
.heat-hour-bar {
  align-self: end;
  height: 100%;
  display: flex;
  align-items: flex-end;
}
.heat-hour-bar > div {
  width: 100%;
  border-radius: 2px 2px 0 0;
  background: oklch(0.63 0.15 265 / 0.75);
  min-height: 0;
}
.heat-hour-bar:hover > div { background: oklch(0.48 0.18 265); }
```

- [ ] **Step 4: 視覺驗證**

瀏覽器重新整理，熱力圖區域。
Expected:
- 網格橫向撐滿左欄（格子為扁矩形，寬>高），左右不再懸浮空白；窄視窗時出現橫向滾動而不擠破。
- 網格下方 24 根小柱與小時列對齊，hover 有 title 提示；晚間時段應明顯更高。
- 右側摘要多一條「高峰時段 HH:00 · x tokens」，橫跨兩列。
- 格子 hover tooltip 位置仍正確（tooltip 基於 cell rect 計算，自適應後應無偏移）。

- [ ] **Step 5: 迴歸 + 提交**

Run: `npm test 2>&1 | tail -5` → PASS。

```bash
git add src/client/dashboard/components-charts.jsx src/client/dashboard/styles.css
git commit -m "feat: responsive heatmap cells with hour-of-day distribution"
```

---

### Task 9: 端到端驗證收尾

**Files:** 無新改動（發現問題則就地修復並單獨提交）。

- [ ] **Step 1: 全量測試**

Run: `npm test 2>&1 | tail -10`
Expected: 全部 PASS。

- [ ] **Step 2: 完整視覺走查（對照 spec 的驗證清單）**

`npm run dev` 下逐項確認：
1. 趨勢圖三種模式柱子直角、無 console 錯誤。
2. 圓環圖 4 來源全畫、方角、聚焦聯動正常（點選圖例聚焦/取消）。
3. 中間行三卡等高；快取節省費用為正且隨篩選聯動；sparkline 正常。
4. 熱力圖撐滿、小時分佈對齊、高峰時段正確。
5. 收窄瀏覽器視窗到 ~900px：各行退化為單列（既有響應式斷點 1761-1763 行），無溢出。

- [ ] **Step 3: 確認工作樹乾淨**

Run: `git status --short`
Expected: 除 `.superpowers/` 外無未提交改動。
