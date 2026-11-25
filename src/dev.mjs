import './load-env.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { listenError } from './listen-error.mjs';

function port(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} 必須是 1–65535 之間的整數`);
  return value;
}

async function checkPort(host, port) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', error => reject(Object.assign(new Error(listenError(error, host, port)), { code: error.code })));
    probe.listen(port, host, () => probe.close(resolve));
  });
}

async function main() {
  const apiPort = port('API_PORT', 4173), clientPort = port('CLIENT_PORT', 5173);
  if (apiPort === clientPort) throw new Error('API_PORT 和 CLIENT_PORT 不能使用同一個連接埠');
  // Check both before launching either child. No processes are stopped by a probe.
  await checkPort(process.env.HOST || '127.0.0.1', apiPort);
  await checkPort('127.0.0.1', clientPort);
  const env = { ...process.env, API_PORT: String(apiPort), PORT: String(apiPort) };
  const children = [
    spawn(process.execPath, ['src/server.mjs'], { env, stdio: 'inherit' }),
    spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(clientPort), '--strictPort'], { env, stdio: 'inherit' })
  ];
  let stopping = false;
  function stop(code) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
    const timer = setTimeout(() => {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 4000);
    timer.unref();
  }
  for (const child of children) {
    child.once('error', error => { console.error(`[啟動失敗] ${error.message}`); stop(1); });
    child.once('exit', (code, signal) => stop(code ?? (signal ? 1 : 0)));
  }
  process.once('SIGINT', () => stop(130));
  process.once('SIGTERM', () => stop(143));
}

main().catch(error => {
  console.error(error.message);
  if (error.code === 'EADDRINUSE') console.error(`專案頁面位址：http://127.0.0.1:${process.env.CLIENT_PORT || '5173'}/（確認已有專案實例後存取）`);
  process.exitCode = 1;
});
