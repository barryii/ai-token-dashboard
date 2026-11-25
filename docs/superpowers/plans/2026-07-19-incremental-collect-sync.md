# 增量採集同步實施計畫

> 歷史實施計畫：水位線、歷史費用和全量重建部分已被後續實作替代。以下步驟保留供追溯，不是目前執行指令。目前待辦見[專案狀態](../../project-status.md)，現行語意見[費用與還原](../../usage-accuracy.md)及[採集效能](../../collection-performance.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把採集寫入資料庫從「全量刪表重插 + 逐行 upsert」改為「水位線增量 + 批量 upsert」,單次採集對遠端 Postgres 的往返從 1.2 萬次降到 30 次以內。

**Architecture:** 新增兩個模組——`src/incremental.mjs`(純函式:穩定 eventKey 去重、水位線過濾)和 `src/db-batch.mjs`(水位線查詢 + 三張表的多行批量 upsert,相容 sqlite/postgres/mysql 三驅動)。`src/collect.mjs` 與 `src/server.mjs` 的 `/api/ingest` 換用這兩個模組;`--full` 旗標保留刪表重建路徑。

**Tech Stack:** Node 22 原生 `node:test` / `node:sqlite`,pg,mysql2。無新增相依套件。

## Global Constraints

- 價格鎖定語意不變:`daily_usage` 中 `usage_date < 今天` 的行 `cost_usd` 永不被覆蓋(spec §相關既有約定)。
- `time_usage` 老事件在非 `--full` 路徑下永不重寫(增量即鎖價)。
- 三驅動(sqlite/postgres/mysql)同一套程式碼路徑,SQL 方言差異只允許出現在 `db.mjs`/`db-batch.mjs`。
- 批量每批 400 行(SQLite 變數上限保守值)。
- 水位線重疊視窗 48 小時。
- 現有匯出函式 `upsertDaily`/`upsertTimeUsage`/`upsertSession` 保留不刪(舊測試仍用)。

---

### Task 1: 純函式模組 `src/incremental.mjs`

**Files:**
- Create: `src/incremental.mjs`
- Test: `test/incremental.test.mjs`

**Interfaces:**
- Produces:
  - `dedupeEventKeys(rows) -> rows`(rows: `{eventKey, ...}[]`,重複 key 追加 `#1`/`#2`,首個不變;必須對**過濾前的全量行**呼叫)
  - `watermarkCutoff(watermark, overlapMs?) -> string|null`(ISO 水位線 − 48h;null/非法輸入回傳 null)
  - `filterTimeRows(rows, cutoff) -> rows`(保留 `eventTime > cutoff`;cutoff 為 null 回傳全部)
  - `filterDailyRows(rows, cutoff) -> rows`(保留 `usageDate >= cutoff.slice(0,10)`;cutoff 為 null 回傳全部)

- [ ] **Step 1: 寫失敗測試** `test/incremental.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeEventKeys, filterDailyRows, filterTimeRows, watermarkCutoff
} from '../src/incremental.mjs';

test('dedupeEventKeys keeps unique keys and suffixes duplicates deterministically', () => {
  const rows = [{ eventKey: 'a' }, { eventKey: 'b' }, { eventKey: 'a' }, { eventKey: 'a' }];
  const out = dedupeEventKeys(rows);
  assert.deepEqual(out.map(r => r.eventKey), ['a', 'b', 'a#1', 'a#2']);
  // 同輸入再跑一遍結果相同(冪等的前提)
  assert.deepEqual(dedupeEventKeys(rows).map(r => r.eventKey), ['a', 'b', 'a#1', 'a#2']);
  // 原陣列物件未被修改
  assert.equal(rows[2].eventKey, 'a');
});

test('watermarkCutoff subtracts the overlap window', () => {
  assert.equal(watermarkCutoff('2026-07-19T12:00:00.000Z'), '2026-07-17T12:00:00.000Z');
  assert.equal(watermarkCutoff(null), null);
  assert.equal(watermarkCutoff('not-a-date'), null);
});

test('filterTimeRows keeps rows strictly newer than cutoff', () => {
  const rows = [
    { eventTime: '2026-07-17T11:59:59.000Z' },
    { eventTime: '2026-07-17T12:00:00.000Z' },
    { eventTime: '2026-07-17T12:00:01.000Z' }
  ];
  const out = filterTimeRows(rows, '2026-07-17T12:00:00.000Z');
  assert.deepEqual(out.map(r => r.eventTime), ['2026-07-17T12:00:01.000Z']);
  assert.equal(filterTimeRows(rows, null).length, 3);
});

test('filterDailyRows keeps dates on or after the cutoff date', () => {
  const rows = [{ usageDate: '2026-07-16' }, { usageDate: '2026-07-17' }, { usageDate: '2026-07-18' }];
  const out = filterDailyRows(rows, '2026-07-17T12:00:00.000Z');
  assert.deepEqual(out.map(r => r.usageDate), ['2026-07-17', '2026-07-18']);
  assert.equal(filterDailyRows(rows, null).length, 3);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/incremental.test.mjs`
Expected: FAIL(模組不存在)

- [ ] **Step 3: 實作** `src/incremental.mjs`:

```js
const DEFAULT_OVERLAP_MS = 48 * 60 * 60 * 1000;

/**
 * Make event keys unique within one normalized batch by suffixing repeats
 * with #1, #2, … in source order. Must run on the FULL per-source batch
 * (before any watermark filtering) so numbering is stable across runs.
 */
export function dedupeEventKeys(rows) {
  const seen = new Map();
  return rows.map((row) => {
    const count = seen.get(row.eventKey) || 0;
    seen.set(row.eventKey, count + 1);
    return count === 0 ? row : { ...row, eventKey: `${row.eventKey}#${count}` };
  });
}

/** Watermark minus the overlap window; null when there is no usable watermark. */
export function watermarkCutoff(watermark, overlapMs = DEFAULT_OVERLAP_MS) {
  if (!watermark) return null;
  const ms = Date.parse(watermark);
  if (Number.isNaN(ms)) return null;
  return new Date(ms - overlapMs).toISOString();
}

export function filterTimeRows(rows, cutoff) {
  if (!cutoff) return rows;
  return rows.filter(row => row.eventTime > cutoff);
}

export function filterDailyRows(rows, cutoff) {
  if (!cutoff) return rows;
  const cutoffDate = cutoff.slice(0, 10);
  return rows.filter(row => row.usageDate >= cutoffDate);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test test/incremental.test.mjs`
Expected: PASS(4 tests)

- [ ] **Step 5: 提交**

```bash
git add src/incremental.mjs test/incremental.test.mjs
git commit -m "feat: incremental sync helpers (stable keys, watermark filters)"
```

---

### Task 2: 水位線查詢 + `time_usage` 批量 upsert(`src/db-batch.mjs`)

**Files:**
- Modify: `src/db.mjs`(匯出三個私有輔助函式,函式本體不變)
- Create: `src/db-batch.mjs`
- Test: `test/db-batch.test.mjs`

**Interfaces:**
- Consumes: `db.mjs` 的 `nowExpression(driver)`、`todayExpression(driver)`、`mysqlRowKey(...parts)`(本任務將其從私有改為匯出,實作不動)。
- Produces:
  - `getTimeWatermark(db, device, source) -> Promise<string|null>`
  - `batchUpsertTimeUsage(db, rows) -> Promise<void>`(rows 結構同現有 `upsertTimeUsage` 的 row)

- [ ] **Step 1: 在 `src/db.mjs` 給三個輔助函式加 `export`**

`function nowExpression(` → `export function nowExpression(`;`function todayExpression(` → `export function todayExpression(`;`function mysqlRowKey(` → `export function mysqlRowKey(`。函式本體與呼叫處不變。

- [ ] **Step 2: 寫失敗測試** `test/db-batch.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.mjs';
import { batchUpsertTimeUsage, getTimeWatermark } from '../src/db-batch.mjs';

function tmpDbPath() {
  const dir = mkdtempSync(join(tmpdir(), 'tokbatch-'));
  return { path: join(dir, 'usage.sqlite'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function timeRow(i) {
  return {
    device: 'D', source: 'S', eventKey: `k${i}`,
    eventTime: `2026-07-10T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`,
    usageDate: '2026-07-10', model: 'm', projectPath: null, sessionId: null,
    inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0,
    reasoningOutputTokens: 0, totalTokens: 2, costUSD: 0.001
  };
}

test('batchUpsertTimeUsage crosses chunk boundaries and is idempotent', async () => {
  const { path, cleanup } = tmpDbPath();
  try {
    const db = await openDb(path);
    const rows = Array.from({ length: 401 }, (_, i) => timeRow(i));
    await batchUpsertTimeUsage(db, rows);
    let { c } = await db.get('SELECT COUNT(*) AS c FROM time_usage');
    assert.equal(c, 401);
    await batchUpsertTimeUsage(db, rows); // 重跑不產生重複
    ({ c } = await db.get('SELECT COUNT(*) AS c FROM time_usage'));
    assert.equal(c, 401);
    await batchUpsertTimeUsage(db, []); // 空批不報錯
    await db.close();
  } finally { cleanup(); }
});

test('getTimeWatermark returns MAX(event_time) per device+source, null when empty', async () => {
  const { path, cleanup } = tmpDbPath();
  try {
    const db = await openDb(path);
    assert.equal(await getTimeWatermark(db, 'D', 'S'), null);
    await batchUpsertTimeUsage(db, [timeRow(1), timeRow(2)]);
    const wm = await getTimeWatermark(db, 'D', 'S');
    assert.equal(wm, '2026-07-10T00:00:02.002Z');
    assert.equal(await getTimeWatermark(db, 'D', 'other'), null);
    await db.close();
  } finally { cleanup(); }
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `node --test test/db-batch.test.mjs`
Expected: FAIL(`src/db-batch.mjs` 不存在)

- [ ] **Step 4: 實作** `src/db-batch.mjs`:

```js
import { mysqlRowKey, nowExpression, todayExpression } from './db.mjs';

// SQLite 預設變數上限為 32766,但保守起見每批 400 行(400 × 16 參數 = 6400)。
const CHUNK_SIZE = 400;

function chunks(rows, size = CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function getTimeWatermark(db, device, source) {
  const row = await db.get(
    'SELECT MAX(event_time) AS watermark FROM time_usage WHERE device = ? AND source = ?',
    [device, source]
  );
  return row?.watermark || null;
}

const TIME_COLUMNS = `
  device, source, event_key, event_time, usage_date, model, project_path, session_id,
  input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
  reasoning_output_tokens, total_tokens, cost_usd, updated_at
`;

function timeValues(row) {
  return [
    row.device, row.source, row.eventKey, row.eventTime, row.usageDate, row.model || '',
    row.projectPath || null, row.sessionId || null, row.inputTokens || 0,
    row.outputTokens || 0, row.cacheCreationTokens || 0, row.cacheReadTokens || 0,
    row.reasoningOutputTokens || 0, row.totalTokens || 0, row.costUSD || 0
  ];
}

export async function batchUpsertTimeUsage(db, rows) {
  const now = nowExpression(db.driver);
  for (const part of chunks(rows)) {
    if (db.driver === 'mysql') {
      const group = `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${now})`;
      await db.run(`
        INSERT INTO time_usage (row_key, ${TIME_COLUMNS})
        VALUES ${part.map(() => group).join(', ')}
        ON DUPLICATE KEY UPDATE
          event_time = VALUES(event_time), usage_date = VALUES(usage_date), model = VALUES(model),
          project_path = VALUES(project_path), session_id = VALUES(session_id),
          input_tokens = VALUES(input_tokens), output_tokens = VALUES(output_tokens),
          cache_creation_tokens = VALUES(cache_creation_tokens), cache_read_tokens = VALUES(cache_read_tokens),
          reasoning_output_tokens = VALUES(reasoning_output_tokens), total_tokens = VALUES(total_tokens),
          cost_usd = VALUES(cost_usd), updated_at = ${now}
      `, part.flatMap(row => [mysqlRowKey(row.device, row.source, row.eventKey), ...timeValues(row)]));
      continue;
    }
    const group = `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${now})`;
    await db.run(`
      INSERT INTO time_usage (${TIME_COLUMNS})
      VALUES ${part.map(() => group).join(', ')}
      ON CONFLICT(device, source, event_key) DO UPDATE SET
        event_time = excluded.event_time, usage_date = excluded.usage_date, model = excluded.model,
        project_path = excluded.project_path, session_id = excluded.session_id,
        input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
        cache_creation_tokens = excluded.cache_creation_tokens, cache_read_tokens = excluded.cache_read_tokens,
        reasoning_output_tokens = excluded.reasoning_output_tokens, total_tokens = excluded.total_tokens,
        cost_usd = excluded.cost_usd, updated_at = ${now}
    `, part.flatMap(timeValues));
  }
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `node --test test/db-batch.test.mjs`
Expected: PASS(2 tests)。再跑 `node --test test/db.test.mjs` 確認 db.mjs 匯出改動無迴歸。

- [ ] **Step 6: 提交**

```bash
git add src/db.mjs src/db-batch.mjs test/db-batch.test.mjs
git commit -m "feat: time_usage batch upsert and watermark query"
```

---

### Task 3: `daily_usage` / `session_usage` 批量 upsert

**Files:**
- Modify: `src/db-batch.mjs`
- Test: `test/db-batch.test.mjs`(追加)

**Interfaces:**
- Consumes: Task 2 的 `chunks`、`nowExpression`、`todayExpression`、`mysqlRowKey`。
- Produces:
  - `batchUpsertDaily(db, rows) -> Promise<void>`(row 結構同現有 `upsertDaily`;保留價格鎖定 CASE)
  - `batchUpsertSession(db, rows) -> Promise<void>`(row 結構同現有 `upsertSession`)

- [ ] **Step 1: 追加失敗測試**到 `test/db-batch.test.mjs`:

```js
import { batchUpsertDaily, batchUpsertSession } from '../src/db-batch.mjs';

function dailyRow(overrides = {}) {
  return {
    device: 'D', source: 'S', usageDate: '2026-01-01', model: 'm',
    inputTokens: 5, outputTokens: 3, cacheCreationTokens: 1, cacheReadTokens: 2,
    reasoningOutputTokens: 1, totalTokens: 12, costUSD: 1, ...overrides
  };
}

test('batchUpsertDaily keeps historical cost locked but updates tokens', async () => {
  const { path, cleanup } = tmpDbPath();
  try {
    const db = await openDb(path);
    await batchUpsertDaily(db, [dailyRow()]); // 歷史日期,首次寫入
    await batchUpsertDaily(db, [dailyRow({ costUSD: 99, totalTokens: 20 })]);
    const row = await db.get('SELECT cost_usd, total_tokens, pricing_locked_at FROM daily_usage WHERE usage_date = ?', ['2026-01-01']);
    assert.equal(row.cost_usd, 1, 'historical cost must stay locked');
    assert.equal(row.total_tokens, 20, 'tokens still update');
    assert.ok(row.pricing_locked_at, 'lock timestamp set for historical dates');
    await db.close();
  } finally { cleanup(); }
});

test('batchUpsertDaily updates cost for today', async () => {
  const { path, cleanup } = tmpDbPath();
  try {
    const db = await openDb(path);
    const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD 本機時區
    await batchUpsertDaily(db, [dailyRow({ usageDate: today, costUSD: 1 })]);
    await batchUpsertDaily(db, [dailyRow({ usageDate: today, costUSD: 2 })]);
    const row = await db.get('SELECT cost_usd, pricing_locked_at FROM daily_usage WHERE usage_date = ?', [today]);
    assert.equal(row.cost_usd, 2);
    assert.equal(row.pricing_locked_at, null);
    await db.close();
  } finally { cleanup(); }
});

test('batchUpsertSession upserts by (device, source, session_id)', async () => {
  const { path, cleanup } = tmpDbPath();
  try {
    const db = await openDb(path);
    const row = {
      device: 'D', source: 'S', sessionId: 'sess1', lastActivity: '2026-07-19T00:00:00Z',
      projectPath: '/p', inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0,
      cacheReadTokens: 0, reasoningOutputTokens: 0, totalTokens: 2, costUSD: 0.1
    };
    await batchUpsertSession(db, [row]);
    await batchUpsertSession(db, [{ ...row, totalTokens: 5, costUSD: 0.2 }]);
    const { c } = await db.get('SELECT COUNT(*) AS c FROM session_usage');
    assert.equal(c, 1);
    const got = await db.get('SELECT total_tokens, cost_usd FROM session_usage WHERE session_id = ?', ['sess1']);
    assert.equal(got.total_tokens, 5);
    assert.equal(got.cost_usd, 0.2);
    await db.close();
  } finally { cleanup(); }
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/db-batch.test.mjs`
Expected: FAIL(`batchUpsertDaily` 未匯出)

- [ ] **Step 3: 實作**,追加到 `src/db-batch.mjs`:

```js
const DAILY_COLUMNS = `
  device, source, usage_date, model, input_tokens, output_tokens,
  cache_creation_tokens, cache_read_tokens, reasoning_output_tokens,
  total_tokens, cost_usd, pricing_locked_at, updated_at
`;

function dailyValues(row) {
  return [
    row.device, row.source, row.usageDate, row.model || '', row.inputTokens || 0,
    row.outputTokens || 0, row.cacheCreationTokens || 0, row.cacheReadTokens || 0,
    row.reasoningOutputTokens || 0, row.totalTokens || 0, row.costUSD || 0, row.usageDate
  ];
}

export async function batchUpsertDaily(db, rows) {
  const now = nowExpression(db.driver);
  const today = todayExpression(db.driver);
  for (const part of chunks(rows)) {
    if (db.driver === 'mysql') {
      const group = `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? < ${today}, ${now}, NULL), ${now})`;
      await db.run(`
        INSERT INTO daily_usage (row_key, ${DAILY_COLUMNS})
        VALUES ${part.map(() => group).join(', ')}
        ON DUPLICATE KEY UPDATE
          input_tokens = VALUES(input_tokens), output_tokens = VALUES(output_tokens),
          cache_creation_tokens = VALUES(cache_creation_tokens), cache_read_tokens = VALUES(cache_read_tokens),
          reasoning_output_tokens = VALUES(reasoning_output_tokens), total_tokens = VALUES(total_tokens),
          cost_usd = IF(daily_usage.usage_date < ${today}, daily_usage.cost_usd, VALUES(cost_usd)),
          pricing_locked_at = IF(
            daily_usage.usage_date < ${today}, COALESCE(daily_usage.pricing_locked_at, ${now}), NULL
          ),
          updated_at = ${now}
      `, part.flatMap(row => [mysqlRowKey(row.device, row.source, row.usageDate, row.model || ''), ...dailyValues(row)]));
      continue;
    }
    const group = `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? < ${today} THEN ${now} ELSE NULL END, ${now})`;
    await db.run(`
      INSERT INTO daily_usage (${DAILY_COLUMNS})
      VALUES ${part.map(() => group).join(', ')}
      ON CONFLICT(device, source, usage_date, model) DO UPDATE SET
        input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
        cache_creation_tokens = excluded.cache_creation_tokens, cache_read_tokens = excluded.cache_read_tokens,
        reasoning_output_tokens = excluded.reasoning_output_tokens, total_tokens = excluded.total_tokens,
        cost_usd = CASE WHEN daily_usage.usage_date < ${today} THEN daily_usage.cost_usd ELSE excluded.cost_usd END,
        pricing_locked_at = CASE
          WHEN daily_usage.usage_date < ${today} THEN COALESCE(daily_usage.pricing_locked_at, ${now})
          ELSE NULL
        END,
        updated_at = ${now}
    `, part.flatMap(dailyValues));
  }
}

const SESSION_COLUMNS = `
  device, source, session_id, last_activity, project_path, input_tokens,
  output_tokens, cache_creation_tokens, cache_read_tokens,
  reasoning_output_tokens, total_tokens, cost_usd, updated_at
`;

function sessionValues(row) {
  return [
    row.device, row.source, row.sessionId, row.lastActivity || null, row.projectPath || null,
    row.inputTokens || 0, row.outputTokens || 0, row.cacheCreationTokens || 0,
    row.cacheReadTokens || 0, row.reasoningOutputTokens || 0, row.totalTokens || 0,
    row.costUSD || 0
  ];
}

export async function batchUpsertSession(db, rows) {
  const now = nowExpression(db.driver);
  for (const part of chunks(rows)) {
    if (db.driver === 'mysql') {
      const group = `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${now})`;
      await db.run(`
        INSERT INTO session_usage (row_key, ${SESSION_COLUMNS})
        VALUES ${part.map(() => group).join(', ')}
        ON DUPLICATE KEY UPDATE
          last_activity = VALUES(last_activity), project_path = VALUES(project_path),
          input_tokens = VALUES(input_tokens), output_tokens = VALUES(output_tokens),
          cache_creation_tokens = VALUES(cache_creation_tokens), cache_read_tokens = VALUES(cache_read_tokens),
          reasoning_output_tokens = VALUES(reasoning_output_tokens), total_tokens = VALUES(total_tokens),
          cost_usd = VALUES(cost_usd), updated_at = ${now}
      `, part.flatMap(row => [mysqlRowKey(row.device, row.source, row.sessionId), ...sessionValues(row)]));
      continue;
    }
    const group = `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${now})`;
    await db.run(`
      INSERT INTO session_usage (${SESSION_COLUMNS})
      VALUES ${part.map(() => group).join(', ')}
      ON CONFLICT(device, source, session_id) DO UPDATE SET
        last_activity = excluded.last_activity, project_path = excluded.project_path,
        input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
        cache_creation_tokens = excluded.cache_creation_tokens, cache_read_tokens = excluded.cache_read_tokens,
        reasoning_output_tokens = excluded.reasoning_output_tokens, total_tokens = excluded.total_tokens,
        cost_usd = excluded.cost_usd, updated_at = ${now}
    `, part.flatMap(sessionValues));
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test test/db-batch.test.mjs`
Expected: PASS(5 tests)

- [ ] **Step 5: 提交**

```bash
git add src/db-batch.mjs test/db-batch.test.mjs
git commit -m "feat: daily/session batch upserts with pricing lock preserved"
```

---

### Task 4: 接入 `src/collect.mjs`(水位線 + `--full`)

**Files:**
- Modify: `src/collect.mjs`

**Interfaces:**
- Consumes: Task 1 全部四個函式;Task 2/3 的 `getTimeWatermark`、`batchUpsertTimeUsage`、`batchUpsertDaily`、`batchUpsertSession`;現有 `deleteTimeUsageForSource`。
- Produces: CLI 新增 `--full` 旗標;`exportPayload` 新增 `mode: 'full' | 'incremental'` 欄位(Task 5 的 ingest 依賴);payload 中 `daily`/`time` 只含本次實際寫入的行。

- [ ] **Step 1: 改 import 與 parseArgs**

`src/collect.mjs` 頂部 import 區改為:

```js
import { deleteTimeUsageForSource, openDb, recordRun } from './db.mjs';
import { batchUpsertDaily, batchUpsertSession, batchUpsertTimeUsage, getTimeWatermark } from './db-batch.mjs';
import { dedupeEventKeys, filterDailyRows, filterTimeRows, watermarkCutoff } from './incremental.mjs';
```

`parseArgs` 的 for 迴圈內追加分支:

```js
    } else if (arg === '--full') {
      parsed.full = true;
```

`exportPayload` 初始化物件加一行 `mode: args.full ? 'full' : 'incremental',`(放在 `device` 之後)。

- [ ] **Step 2: 替換 collectLocal 內的寫入資料庫段**

把現在的三段"normalize + runInTransaction 逐行 upsert"(約 68–85 行)整體替換為:

```js
    const dailyRows = normalizeDailyRows(graphJson, device);
    const sessionRows = normalizeSessionRows(modelsJson, device);
    // 先在全量批次上生成穩定 key,再做水位線過濾,保證 #n 序號跨次執行一致
    const timeRows = dedupeEventKeys(normalizeTimeRows(eventsJson, device));

    const watermark = args.full ? null : await getTimeWatermark(db, device, label);
    const cutoff = watermarkCutoff(watermark);
    const dailyToWrite = filterDailyRows(dailyRows, cutoff);
    const timeToWrite = filterTimeRows(timeRows, cutoff);
    const fullRebuild = args.full || !watermark;

    await runInTransaction(db, async (tx) => {
      await batchUpsertDaily(tx, dailyToWrite);
      await batchUpsertSession(tx, sessionRows);
      // 全量重建才允許刪表;增量路徑老事件永不觸碰(價格鎖定語意)
      if (fullRebuild) await deleteTimeUsageForSource(tx, device, label);
      await batchUpsertTimeUsage(tx, timeToWrite);
    });
    exportPayload.daily.push(...dailyToWrite);
    exportPayload.sessions.push(...sessionRows);
    exportPayload.time.push(...timeToWrite);
```

run 記錄的 message 改為(體現增量規模):

```js
      message: `daily=${dailyToWrite.length}/${dailyRows.length}, time=${timeToWrite.length}/${timeRows.length}, workspace_model=${sessionRows.length}${fullRebuild ? ', full' : ''}`,
```

console.log 同步改成列印該 message。`status` 判定改用 `dailyRows.length || sessionRows.length`(按源資料判空,與過濾無關,維持原語意)。

- [ ] **Step 3: 穩定化 normalizeTimeRows 的兜底 key**

`normalizeTimeRows` 的 map 回呼去掉 `index` 參數,`eventKey` 欄位改為:

```js
      eventKey: entry.eventKey || [
        entry.client || 'unknown',
        eventTime,
        entry.sessionId || entry.workspaceKey || '',
        model,
        totalTokens
      ].join(':'),
```

(與舊公式唯一區別是去掉了末尾的 `index`;重複元組由 `dedupeEventKeys` 追加 `#n`。)

- [ ] **Step 4: 全量迴歸 + 手動驗證**

Run: `node --test`
Expected: 全部 PASS。

手動驗證(暫存資料庫,先全量後增量):

```bash
cd <repo-root>
DB=/tmp/collect-verify.sqlite
rm -f $DB
node src/collect.mjs --db $DB          # 空資料庫 → 自動全量
node src/collect.mjs --db $DB          # 有水位線 → 增量
```

Expected:第一次輸出 `time=N/N ... full`;第二次輸出 `time=n/N`(n ≪ N,只有重疊視窗內的行),且兩次之後:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/tmp/collect-verify.sqlite');console.log(db.prepare('SELECT COUNT(*) c, ROUND(SUM(total_tokens)) t FROM time_usage').get());"
```

與第一次採集後的計數一致(增量未引入重複)。再跑 `node src/collect.mjs --db $DB --full` 確認全量重建路徑可用、行數不變。

- [ ] **Step 5: 提交**

```bash
git add src/collect.mjs
git commit -m "feat: watermark-incremental collect with --full rebuild flag"
```

---

### Task 5: `/api/ingest` 改為批量 + 按 mode 刪表

**Files:**
- Modify: `src/server.mjs`(`handleIngest`,約 363–403 行;import 區)

**Interfaces:**
- Consumes: Task 2/3 的 `batchUpsertDaily`、`batchUpsertSession`、`batchUpsertTimeUsage`;Task 4 的 payload `mode` 欄位。
- Produces: ingest 語意——`mode === 'full'`(或舊用戶端無 mode 欄位)才按 (device, source) 刪表重建;`mode === 'incremental'` 只 upsert。

**背景:** 現在 ingest 對 payload 裡出現的每個 (device, source) 先刪光再重插。Task 4 之後增量 payload 只含視窗內的行,如果保留無條件刪表,會把遠端歷史事件全部誤刪——本任務必須與 Task 4 同批部署。舊版用戶端(無 mode 欄位)payload 仍是全量,視為 `'full'` 保持相容。

- [ ] **Step 1: 改 import**

`src/server.mjs` 第 7–10 行的 db.mjs import 去掉 `upsertDaily, upsertSession, upsertTimeUsage`(保留 `deleteTimeUsageForSource, pruneCollectionRuns, recordRun` 等仍在用的),追加:

```js
import { batchUpsertDaily, batchUpsertSession, batchUpsertTimeUsage } from './db-batch.mjs';
```

- [ ] **Step 2: 替換 handleIngest 的交易段**

```js
    const fullRebuild = payload.mode !== 'incremental';

    // 全量 push 攜帶裝置完整時間窗,按 (device, source) 整體替換;
    // 增量 push 只含新事件,只做 upsert,絕不刪表。
    const timePairs = new Map();
    if (fullRebuild) {
      for (const row of timeRows) {
        if (row.device && row.source) timePairs.set(`${row.device}::${row.source}`, row);
      }
    }

    await db.transaction(async (tx) => {
      await batchUpsertDaily(tx, dailyRows);
      for (const row of timePairs.values()) await deleteTimeUsageForSource(tx, row.device, row.source);
      await batchUpsertTimeUsage(tx, timeRows);
      await batchUpsertSession(tx, sessionRows);
      for (const row of runRows) await recordRun(tx, row);
    });
```

回應 JSON 追加 `mode: fullRebuild ? 'full' : 'incremental'` 欄位。

- [ ] **Step 3: 迴歸 + 手動驗證**

Run: `node --test`
Expected: 全部 PASS。

手動驗證 ingest(暫存資料庫啟動服務):

```bash
DB=/tmp/ingest-verify.sqlite; rm -f $DB
PORT=4999 DB_PATH=$DB node src/server.mjs &   # 記下 pid
sleep 1
curl -s -X POST localhost:4999/api/ingest -H 'content-type: application/json' -d '{
  "mode":"full","daily":[],"sessions":[],"runs":[],
  "time":[{"device":"X","source":"S","eventKey":"a","eventTime":"2026-07-01T00:00:00Z","usageDate":"2026-07-01","model":"m","totalTokens":5,"inputTokens":5}]}'
curl -s -X POST localhost:4999/api/ingest -H 'content-type: application/json' -d '{
  "mode":"incremental","daily":[],"sessions":[],"runs":[],
  "time":[{"device":"X","source":"S","eventKey":"b","eventTime":"2026-07-02T00:00:00Z","usageDate":"2026-07-02","model":"m","totalTokens":7,"inputTokens":7}]}'
kill %1
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/tmp/ingest-verify.sqlite');console.log(db.prepare('SELECT COUNT(*) c FROM time_usage').get());"
```

Expected: `{ c: 2 }`——增量 push 沒有刪掉 full push 寫入的事件 a。

- [ ] **Step 4: 提交**

```bash
git add src/server.mjs
git commit -m "feat: mode-aware batched ingest endpoint"
```

---

### Task 6: 收尾驗證與文件

**Files:**
- Modify: `README.md`(採集章節追加 `--full` 說明)

**Interfaces:**
- Consumes: 全部前置任務。

- [ ] **Step 1: 全量測試**

Run: `node --test`
Expected: 全部 PASS,無跳過。

- [ ] **Step 2: 真實端到端驗證(本機 sqlite)**

```bash
cp data/usage.sqlite /tmp/usage-backup.sqlite
node src/collect.mjs        # 對本機預設資料庫跑一次增量
```

Expected:輸出各源 `time=n/N` 增量數字;跑完 `node src/server.mjs` 起的看板資料正常(總 token/成本與之前一致)。

- [ ] **Step 3: README 採集章節追加**(找到現有介紹 `npm run collect` 的段落,在其後追加):

```markdown
預設為增量採集:只上傳比遠端水位線(該裝置該來源最新事件時間)新的資料,歷史事件與已鎖定的歷史成本不會被改寫。如需全量重建(如採集器邏輯變更後),使用:

    node src/collect.mjs --full

注意:`--full` 會刪除該裝置的遠端事件並按目前價格重算歷史成本。
```

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: document incremental collect and --full rebuild"
```

## 已知邊界(實作時不處理,記錄在案)

- 90 天視窗滑動導致最老一天移出視窗時,如該天內有重複元組,`#n` 序號理論上可能重排;該天早已同步且被鎖定,增量路徑不會觸及,僅 `--full` 時統一重建,無實際影響。
- `--push` 模式下水位線取自採集端本機資料庫;若 hub 端落後於採集端本機資料庫,增量 push 可能留缺口。目前部署(直連 Supabase,單寫入方)不存在此問題;多裝置 push 場景還原手段為 `--full`。
