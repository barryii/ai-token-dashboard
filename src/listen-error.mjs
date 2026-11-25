export function listenError(error, host, port) {
  const address = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
  if (error.code === 'EADDRINUSE') return `[啟動失敗] ${address} 的連接埠已被佔用。\n如果專案已經執行，請開啟原來的頁面；需要重啟時，在原啟動終端機按 Ctrl+C 後重新執行 npm run dev。\n請先確認佔用者，不要直接結束不明行程。`;
  return `[啟動失敗] 無法監聽 ${address}：${error.code || error.message}`;
}
