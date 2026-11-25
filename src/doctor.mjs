import { supportedNode, runChecks } from './doctor-checks.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const checks = [];
const add = (id, status, message, action, details) => checks.push({ id, status, message, ...(action ? { action } : {}), ...(details ? { details } : {}) });
let device;
let usageError = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') continue;
  if (args[i] === '--device' && args[i + 1] && !args[i + 1].startsWith('--')) { device = args[++i]; continue; }
  if (args[i] === '--help') {
    console.log('Usage: npm run doctor -- [--json] [--device <name>]\nRead-only diagnostics; does not collect, initialize schemas, or stop processes.');
    process.exit(0);
  }
  usageError = true;
}
if (usageError) add('arguments', 'error', '不支援的參數或缺少裝置名稱。', '使用 --help 檢視參數。');
else if (!supportedNode(process.versions.node)) add('runtime', 'error', `Node ${process.versions.node} 不受支援。`, '安裝 Node >=22.15.0，建議使用 Node 22 LTS 最新修補版本。');
else {
  add('runtime', 'ok', `Node ${process.versions.node} 滿足版本要求。`);
  try {
    await import('./load-env.mjs');
    await runChecks(add, { device });
  } catch {
    add('doctor', 'error', '診斷未完成。', '檢查 .env 讀取權限、Node 內建 SQLite 支援及專案檔案完整性；執行 npm ci 後重試。');
  }
}
const summary = Object.fromEntries(['ok', 'warn', 'error'].map(status => [status, checks.filter(check => check.status === status).length]));
const report = { version: 1, summary, checks };
if (json) console.log(JSON.stringify(report, null, 2));
else {
  console.log('AI Token Dashboard · Doctor\n只檢查環境、檔案中繼資料及已有資料庫；候選檔案不代表有效用量，上次採集記錄不代表本次採集成功。\n');
  for (const check of checks) console.log(`[${check.status.toUpperCase()}] ${check.id}: ${check.message}${check.action ? `\n  → ${check.action}` : ''}`);
  console.log(`\n${summary.ok} 通過 / ${summary.warn} 提示 / ${summary.error} 錯誤。`);
}
process.exitCode = usageError ? 2 : summary.error ? 1 : 0;
