# Quickstart: Market data extensions

Owner steps after the feature is merged and deployed (`wrangler deploy` is the owner's action).

1. Backfill EGX 30 history once: `npm run backfill:indices`, then `npx wrangler d1 execute egx --remote --file "scripts/backfill/out/index-history-EGX30.sql"`. Expect about 1,240 rows written and the same number added to `usage_global.backfill_rows` for that day. Running the file a second time writes 0 rows and adds 0.
2. Ask a client: "How did EGX30 move week by week over the last year?" Expect `get_index_history` with weekly points on the last session of each week, source `mubasher` for older points and `tradingview` for points stored by the end-of-day job.
3. Ask: "Compare EGX30 and EGX70 over 6 months: return, volatility and drawdown?" While EGX 70 EWI has fewer than 20 stored closes, its SMA and volatility are `null` with reasons; EGX 30 has every metric and `highestReturn` names one index.
4. Ask: "What is the gold pound price in Egypt?" Expect `goldPound` from iSagha in EGP per piece with `dataTimeKind: "fetched"`. The first answer after the deploy may say `not_available` until the next metals refresh writes the pound.
5. Check any answer's `meta.provenance` for source, kind of time, stale flag and basis; an error answer carries `provenance: []`.
6. Probe EGX: deploy `scripts/probe` (`npx wrangler deploy -c scripts/probe/wrangler.jsonc`), call `/run`, and record the `getIndexChartData` status, content type and first 500 characters in research R1. If it returns data, save the body as a fixture and ask for the follow-up feature (EGX index provider).
