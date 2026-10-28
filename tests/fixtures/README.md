# Provider fixtures

Read-only captures from public provider endpoints, recorded on 2026-10-25 with the header `User-Agent: egx-mcp/1.0 (+https://github.com/ahmed-essawy/egx-mcp)`. No file was trimmed (all are under 2 MB), except the COMI history which keeps only the last 300 lines.

All captures were taken at about 14:29 Cairo time on 2026-10-25, before the closing auction ends at 14:30, so the last row of mubasher-history-COMI.csv is an intraday bar and tests must not treat it as a final close.

| File | Source | Captured |
|---|---|---|
| tradingview-egypt-scan.json | POST https://scanner.tradingview.com/egypt/scan (T049 columns, range [0, 400]) | 2026-10-25 |
| tradingview-global-scan.json | POST https://scanner.tradingview.com/global/scan (EGX:EGX30, EGX:EGX30CAPPED, EGX:EGX70EWI, EGX:EGX100EWI; columns name, close, change, update_time) | 2026-10-25 |
| tradingview-fundamentals.json | POST https://scanner.tradingview.com/egypt/scan (T096 columns, range [0, 400]) | 2026-10-25 |
| tradingview-fx-metals.json | POST https://scanner.tradingview.com/global/scan (FX_IDC:USDEGP, TVC:GOLD, TVC:SILVER; columns name, close, update_time) | 2026-10-25 |
| mubasher-prices-all.json | GET https://www.mubasher.info/api/1/stocks/prices/all?country=eg | 2026-10-25 |
| mubasher-listed-p1.json | GET https://www.mubasher.info/api/1/listed-companies?country=eg&page=1 | 2026-10-25 |
| mubasher-funds-p1.json | GET https://www.mubasher.info/api/1/funds?country=eg&page=1 | 2026-10-25 |
| mubasher-actions-p1.json | GET https://www.mubasher.info/api/1/corporate-actions?country=eg&page=1 | 2026-10-25 |
| mubasher-actions-COMI.json | GET https://www.mubasher.info/api/1/corporate-actions?country=eg&symbol=COMI&page=1 | 2026-10-25 |
| mubasher-history-COMI.csv | Last 300 lines of https://static.mubasher.info/File.MubasherCharts/File.Historical_Stock_Charts_Dir/44507230b2b03e2da37352abf1a659545b44.csv (URL from the `historical-data-url` attribute of https://english.mubasher.info/markets/EGX/stocks/COMI) | 2026-10-25 |
| isagha-gold.html | GET https://market.isagha.com/prices | 2026-10-25 |
| isagha-silver.html | GET https://market.isagha.com/prices/silver | 2026-10-25 |
| mubasher-index-EGX30.csv | Last 300 lines of https://static.mubasher.info/File.MubasherCharts/File.Historical_Index_Charts_Dir/39d67d8ab4f4c10bf22aa353e27879133c.csv (URL from the `historical-data-url` attribute of https://english.mubasher.info/markets/EGX/indices/EGX30), from 2025-07-10 to 2026-10-27 | 2026-10-28 |
