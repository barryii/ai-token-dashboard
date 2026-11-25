# Contributing / 參與貢獻

Use a feature branch and a pull request against `main`. Describe the user-visible change, validation, and remaining limits. CI must pass before merge. For larger changes, first discuss the scope in an [issue](https://github.com/fengguanghuai/ai-token-dashboard/issues/new).

在功能分支開發並向 `main` 提交 PR，說明行為變化、驗證和限制，CI 通過後再合併。較大改動先透過 [Issue](https://github.com/fengguanghuai/ai-token-dashboard/issues/new) 討論範圍。

## Local validation

Requires Node ≥22.15. Use locked dependencies:

```sh
npm ci
npm test
npm run test:release
npx playwright install chromium
npm run test:browser
```

`test:release` uses only synthetic logs and temporary SQLite databases. It verifies installation, upgrade from the frozen schema preceding PR #30, historical values, HTTP synchronization, restart and backup restoration. `npm test` skips remote integration tests unless dedicated `TEST_POSTGRES_URL` / `TEST_MYSQL_URL` test databases are provided; those tests write data, so never point them at a personal or production database. CI runs both remote services. See [release evidence and limits](docs/release.md).

For query measurements, use `npm run benchmark:query -- 100000` (or `1000000`). Each sample opens a synthetic database in a fresh process; it never reads the application's `.env` or personal usage database.

## Collector changes

Implement `collect()` in `src/collectors/` using the existing `{ graphJson, modelsJson, eventsJson }` contract (`eventsJson` is optional). Add sanitized fixtures covering real format differences, repeated/forked events and missing usage fields. Do not infer tokens or prices that the source cannot establish. Preserve recorded zero cost, historical estimates and source event identities. Document whether the source provides event timestamps and project paths; aggregate-only data must not appear as precise events.

Keep current work and acceptance boundaries in [project status](docs/project-status.md). Update the corresponding behavior document when contracts change. Never run a full replacement or pricing rewrite against a contributor's real history for a test.

## Bug reports / 問題回饋

Open an [issue](https://github.com/fengguanghuai/ai-token-dashboard/issues/new) with the commit/version, OS, Node version, database driver, affected collector, reproduction steps, expected/actual result and sanitized error. A minimal synthetic log is preferable to a whole session archive. `npm run doctor -- --json` provides a diagnostic report; review it before sharing.

不要上傳 `.env`、存取權杖、資料庫連線字串、OAuth 檔案、個人用量資料庫或完整工作階段日誌。可提供去識別化後的最小重現、錯誤訊息和診斷報告；若無法去識別化，先描述問題，不附原始檔案。
