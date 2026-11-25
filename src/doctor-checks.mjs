import { access, stat, opendir, readFile } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { serverAccess } from './http-security.mjs';

export function supportedNode(version) {
  const [major, minor] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 15);
}

// Codes are allowlisted. Raw errors, paths, DSNs, messages and env values must
// never become part of the shareable report (including its JSON form).
export function errorCode(error) {
  return new Set(['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'EADDRINUSE', 'EADDRNOTAVAIL',
    'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ERR_SQLITE_ERROR',
    '28P01', '3D000', '42P01', '42703', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR',
    'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR']).has(error?.code) ? error.code : 'CHECK_FAILED';
}

export async function inspectRoot(root, { limit = 2000, budgetMs = 250 } = {}) {
  if (root.invalid) return { state: 'invalid', candidates: 0 };
  const result = { state: 'readable', candidates: 0, entries: 0, incomplete: false };
  const deadline = performance.now() + budgetMs;
  try {
    const info = await stat(root.path);
    if (root.kind === 'file') {
      if (!info.isFile()) return { state: 'invalid', candidates: 0 };
      await access(root.path, constants.R_OK);
      return { state: info.size ? 'readable' : 'empty', candidates: info.size ? 1 : 0 };
    }
    if (!info.isDirectory()) return { state: 'invalid', candidates: 0 };
    const pending = [{ path: root.path, depth: 0 }];
    while (pending.length) {
      const dir = pending.pop();
      await access(dir.path, constants.R_OK | constants.X_OK);
      const handle = await opendir(dir.path);
      for await (const entry of handle) {
        if (result.entries >= limit || performance.now() >= deadline) {
          result.incomplete = true;
          return result;
        }
        result.entries++;
        const path = join(dir.path, entry.name);
        if (entry.isDirectory() && dir.depth < (root.maxDepth ?? 32)) pending.push({ path, depth: dir.depth + 1 });
        else if (entry.isDirectory() && root.maxDepth === undefined) result.incomplete = true;
        else if (entry.isFile() && root.match(entry.name)) {
          await access(path, constants.R_OK);
          result.candidates++;
        } else if (entry.isSymbolicLink()) result.incomplete = true;
      }
    }
    if (!result.entries) result.state = 'empty';
    return result;
  } catch (error) {
    return { ...result, state: error.code === 'ENOENT' ? 'missing' : 'unreadable', code: errorCode(error) };
  }
}

export async function checkConfig(add) {
  let config;
  try {
    config = JSON.parse(await readFile(process.env.AI_TOKEN_DASHBOARD_CONFIG || resolve('config/collectors.json'), 'utf8'));
  } catch (error) {
    const optional = error.code === 'ENOENT' && !process.env.AI_TOKEN_DASHBOARD_CONFIG;
    add('config', optional ? 'warn' : 'error', optional ? '採集設定缺失，部分來源不會啟用。' : '採集設定無法讀取或不是有效 JSON。',
      '檢查 config/collectors.json 或 AI_TOKEN_DASHBOARD_CONFIG。');
    return false;
  }
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const arrayKeys = new Set(['roots', 'homes', 'headlessRoots', 'agentRoots', 'extraDbPaths', 'sessionSubdirs']);
  const pathKeys = new Set(['dbPath', 'dataDir', 'tmpDir', 'desktopLocalAgentBase']);
  let valid = object(config) && object(config.collectors);
  for (const value of Object.values(valid ? config.collectors : {})) {
    if (!object(value)) { valid = false; break; }
    for (const [key, item] of Object.entries(value)) {
      if (arrayKeys.has(key) && (!Array.isArray(item) || !item.every(path => typeof path === 'string' && path.trim()))) valid = false;
      if (pathKeys.has(key) && (typeof item !== 'string' || !item.trim())) valid = false;
      if (key === 'includeDesktopLocalAgent' && typeof item !== 'boolean') valid = false;
    }
  }
  add('config', valid ? 'ok' : 'error', valid ? '採集設定格式有效。' : '採集設定欄位類型不正確。',
    valid ? undefined : '路徑列表必須是字串陣列，單一路徑必須是非空字串。');
  return valid;
}

export async function checkDatabase(add, { device = hostname(), input } = {}) {
  const { resolveDbConfig, openDb } = await import('./db.mjs');
  let config, db;
  try { config = resolveDbConfig(input); }
  catch { add('database', 'error', '資料庫設定無效。', '檢查 DATABASE_URL 協定、跳脫和 DB_DRIVER；不要把連線字串貼到 Issue。'); return; }
  if (config.driver === 'sqlite') {
    try {
      const info = await stat(config.path);
      if (!info.isFile()) throw new Error('not a file');
      await access(config.path, constants.R_OK);
    } catch (error) {
      add('database', error.code === 'ENOENT' ? 'warn' : 'error',
        error.code === 'ENOENT' ? 'SQLite 資料庫尚未建立。' : 'SQLite 資料庫不可讀取。',
        error.code === 'ENOENT' ? '首次使用執行 npm run db:init。' : '檢查 DB_PATH 及檔案讀取權限。');
      return;
    }
  }
  try {
    db = await openDb(config, { readOnly: true });
    await db.get('SELECT 1 AS ok');
    add('database.connection', 'ok', `${config.driver} 唯讀連線成功。`);
    // Probe required columns without schema initialization or full-table scans.
    const columns = {
      daily_usage: 'device, source, usage_date, model, total_tokens, cost_usd, cost_basis, pricing_version',
      time_usage: 'device, source, event_key, event_time, project_path, session_id, cost_basis, pricing_version',
      session_usage: 'device, source, session_id, total_tokens, cost_usd',
      collection_runs: 'id, device, source, status, collected_at',
      collection_checkpoints: 'scope_key, state_json'
    };
    for (const [table, fields] of Object.entries(columns)) await db.all(`SELECT ${fields} FROM ${table} LIMIT 0`);
    add('database.schema', 'ok', '用量表及關鍵欄位存在。');
    const runs = await db.all(`SELECT r.source, r.status, r.collected_at FROM collection_runs r
      JOIN (SELECT source, MAX(id) AS id FROM collection_runs WHERE device = ? GROUP BY source) latest ON r.id = latest.id`, [device]);
    const { sourceKeys: known } = await import('./doctor-sources.mjs');
    let count = 0;
    for (const run of runs) {
      if (!known.has(run.source)) continue;
      count++;
      const status = ['ok', 'empty', 'error'].includes(run.status) ? run.status : 'unknown';
      const date = new Date(run.collected_at);
      const time = Number.isFinite(date.getTime()) ? date.toISOString() : 'unknown';
      add(`collection.${known.get(run.source)}`, status === 'ok' ? 'ok' : 'warn',
        `${run.source} 上次記錄：${status}（${time}）。`,
        status === 'error' ? '檢查對應來源路徑後，重新執行 npm run collect。' : undefined);
    }
    if (!count) add('collection', 'warn', '此裝置還沒有已知來源的採集記錄。', '執行 npm run collect；自訂裝置名可用 doctor --device <名稱> 檢查。');
  } catch (error) {
    const schema = ['42P01', '42703', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', 'ERR_SQLITE_ERROR'].includes(error.code);
    add('database', 'error', `資料庫檢查失敗（${errorCode(error)}）。`, schema
      ? '檢查資料庫檔案或資料表結構；已有資料先備份，再執行 npm run db:init。'
      : '檢查資料庫位址、網路、憑證和連線權限。');
  } finally { if (db) await db.close(); }
}

export async function checkPort(host, port) {
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', error => resolve(error.code === 'EADDRINUSE' ? 'busy' : errorCode(error)));
    server.listen(port, host, () => server.close(() => resolve('free')));
  });
}

export async function runChecks(add, options) {
  const require = createRequire(import.meta.url);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const missing = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(name => {
    try { require.resolve(name); return false; } catch { return true; }
  });
  add('dependencies', missing.length ? 'error' : 'ok', missing.length ? `缺少相依套件：${missing.join(', ')}。` : '專案相依套件可解析。', missing.length ? '在專案目錄執行 npm ci。' : undefined);
  const validConfig = await checkConfig(add);
  try {
    const zone = process.env.DISPLAY_TZ?.trim();
    if (zone && !/^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/.test(zone)) throw new Error('invalid');
    new Intl.DateTimeFormat('en', zone ? { timeZone: zone } : {});
    add('timezone', 'ok', '顯示時區有效。');
  } catch { add('timezone', 'error', 'DISPLAY_TZ 無效，應用程式會退回 UTC。', '使用有效 IANA 時區，例如 Asia/Shanghai 或 UTC。'); }
  try { serverAccess(); add('access', 'ok', '監聽位址與認證設定有效。'); }
  catch { add('access', 'error', '遠端監聽缺少存取權杖。', '本機使用 HOST=127.0.0.1；遠端存取設定 DASHBOARD_TOKEN 或 INGEST_TOKEN。'); }
  const ports = [['API_PORT', 4173, process.env.HOST || '127.0.0.1'], ['CLIENT_PORT', 5173, '127.0.0.1']];
  if (process.env.PORT) ports.push(['PORT', 4173, process.env.HOST || '127.0.0.1']);
  if (Number(process.env.API_PORT || 4173) === Number(process.env.CLIENT_PORT || 5173)) add('ports', 'error', 'API_PORT 和 CLIENT_PORT 不能相同。', '為開發 API 和前端設定不同連接埠。');
  for (const [key, fallback, host] of ports) {
    const port = Number(process.env[key] || fallback);
    if (!Number.isInteger(port) || port < 1 || port > 65535) { add(`port.${key}`, 'error', `${key} 無效。`, '連接埠必須是 1–65535 的整數。'); continue; }
    const state = await checkPort(host, port);
    add(`port.${key}`, state === 'free' ? 'ok' : state === 'busy' ? 'warn' : 'error',
      `${key}=${port}：${state === 'free' ? '可監聽' : state === 'busy' ? '已被佔用' : state}。`,
      state === 'busy' ? '若已有專案實例可直接使用；否則檢查佔用行程或更換連接埠。doctor 不會停止任何行程。' : undefined);
  }
  if (validConfig) {
    const { sourceChecks } = await import('./doctor-sources.mjs');
    for (const source of sourceChecks()) {
      const roots = [];
      for (const root of source.roots) roots.push(await inspectRoot(root));
      const bad = roots.some(root => ['invalid', 'unreadable'].includes(root.state));
      const found = roots.reduce((sum, root) => sum + root.candidates, 0);
      const incomplete = roots.some(root => root.incomplete);
      const counts = Object.fromEntries(['missing', 'empty', 'unreadable', 'invalid'].map(state => [state, roots.filter(root => root.state === state).length]));
      add(`source.${source.key}`, bad ? 'error' : !found || incomplete ? 'warn' : 'ok',
        `${source.label}：${roots.length} 個路徑，${found} 個候選檔案；不存在 ${counts.missing}，空 ${counts.empty}，不可讀取 ${counts.unreadable}，無效 ${counts.invalid}${incomplete ? '（掃描未完成）' : ''}。`,
        bad || !found ? '檢查 config/collectors.json 中該來源路徑及環境變數覆寫；未使用的工具可忽略缺失提示。' : undefined,
        { roots });
    }
  }
  const zlib = await import('node:zlib');
  add('compression', typeof zlib.zstdDecompressSync === 'function' ? 'ok' : 'warn',
    typeof zlib.zstdDecompressSync === 'function' ? '支援 zstd 壓縮日誌。' : '執行階段不支援 zstd，壓縮日誌會被跳過。',
    typeof zlib.zstdDecompressSync === 'function' ? undefined : '升級到目前 Node 22 LTS 的修補版本或更新的 LTS。');
  await checkDatabase(add, options);
  const staticDir = existsSync(resolve('dist')) ? 'dist' : 'public';
  try { await access(resolve(staticDir, 'index.html'), constants.R_OK); add('frontend', 'ok', '前端頁面存在（未驗證是否最新）。'); }
  catch { add('frontend', 'warn', '前端尚未建置，npm run serve 無法顯示頁面。', '執行 npm run build；開發模式可使用 npm run dev。'); }
}
