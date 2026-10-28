import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { createSqliteD1 } from "../helpers/sqlite-d1";
import {
  dividendsLast365,
  setQuoteCurrencies,
  upsertActions,
  upsertFigures,
  type ActionRow,
  type FigureRow,
} from "../../src/store/d1/fundamentals";

type StoredRow = Record<string, unknown>;

const COMI_ISIN = "EGS60121C018";
const EPS_METRIC = "eps_basic";
const SOURCE = "tradingview";
const PERIOD_END = "2026-06-30";
const UNKNOWN_PERIOD_END = "";
const DATED_VALUE = 21.1557;
const CHANGED_VALUE = 25.5;
const FIRST_FETCH = 100;
const SECOND_FETCH = 200;
const THIRD_FETCH = 300;
const FOURTH_FETCH = 400;
const FIFTH_FETCH = 500;
const NOW = 1_792_000_000;

type StoredFigure = { period_end: string; value: number; fetched_at: number };

function figure(periodEnd: string | null, value: number, fetchedAt: number): FigureRow {
  return {
    isin: COMI_ISIN,
    metric: EPS_METRIC,
    periodType: "TTM",
    periodEnd,
    periodInferred: periodEnd === null,
    value,
    currency: "EGP",
    source: SOURCE,
    fetchedAt,
  };
}

function action(exDate: string, kind: ActionRow["kind"] = "cash_dividend", now = NOW): ActionRow {
  return {
    isin: COMI_ISIN,
    ticker: "COMI",
    kind,
    announcedOn: null,
    exDate,
    amount: 1.5,
    currency: "EGP",
    source: "mubasher",
    sourceText: null,
    now,
  };
}

describe("fundamentals store", () => {
  let db: D1Database;
  let sqlite: DatabaseSync;

  beforeEach(() => {
    ({ db, sqlite } = createSqliteD1());
  });

  function storedFigures(): StoredFigure[] {
    return sqlite
      .prepare("SELECT period_end, value, fetched_at FROM financial_figures ORDER BY period_end DESC")
      .all() as StoredFigure[];
  }

  describe("upsertActions", () => {
    it("inserts the given actions and returns them", async () => {
      const inserted = await upsertActions(db, [action("2026-10-12"), action("2026-11-01", "bonus")]);

      expect(inserted.map((row) => [row.kind, row.exDate, row.status])).toEqual([
        ["cash_dividend", "2026-10-12", "recorded"],
        ["bonus", "2026-11-01", "needs_ratio"],
      ]);
    });

    it("inserts nothing when the same actions are given again", async () => {
      await upsertActions(db, [action("2026-10-12")]);

      const inserted = await upsertActions(db, [action("2026-10-12")]);

      expect(inserted).toEqual([]);
      expect(sqlite.prepare("SELECT COUNT(*) AS total FROM corporate_actions").get()).toEqual({ total: 1 });
    });
  });

  describe("upsertActions events and notices", () => {
    it("writes the event of every new action and a needs_ratio notice for a bonus", async () => {
      const inserted = await upsertActions(db, [action("2026-10-12"), action("2026-11-01", "bonus")]);

      const events = sqlite.prepare("SELECT kind, occurred_at, isin, payload FROM market_events ORDER BY id").all() as StoredRow[];
      const notices = sqlite.prepare("SELECT kind, subject, details, created_at, status FROM notices").all() as StoredRow[];
      expect(events.map((event) => ({ ...event, payload: JSON.parse(String(event.payload)) }))).toEqual(
        inserted.map((row) => ({
          kind: "corporate_action",
          occurred_at: NOW,
          isin: COMI_ISIN,
          payload: { actionId: row.id, kind: row.kind, exDate: row.exDate },
        })),
      );
      expect(notices.map((notice) => ({ ...notice, details: JSON.parse(String(notice.details)) }))).toEqual([
        {
          kind: "needs_ratio",
          subject: "COMI bonus 2026-11-01",
          details: { actionId: inserted[1]?.id, ticker: "COMI", kind: "bonus", exDate: "2026-11-01", source: "mubasher" },
          created_at: NOW,
          status: "open",
        },
      ]);
    });

    it("writes no second event or notice when the same actions are given again", async () => {
      await upsertActions(db, [action("2026-11-01", "bonus")]);

      await upsertActions(db, [action("2026-11-01", "bonus", NOW + 1)]);

      expect(sqlite.prepare("SELECT COUNT(*) AS total FROM market_events").get()).toEqual({ total: 1 });
      expect(sqlite.prepare("SELECT COUNT(*) AS total FROM notices").get()).toEqual({ total: 1 });
    });

    it("keeps no action when its event cannot be written", async () => {
      sqlite.exec("DROP TABLE market_events");

      await expect(upsertActions(db, [action("2026-10-12")])).rejects.toThrow();

      expect(sqlite.prepare("SELECT COUNT(*) AS total FROM corporate_actions").get()).toEqual({ total: 0 });
    });
  });

  describe("dividendsLast365", () => {
    const TODAY = "2026-10-25";

    function seedDividend(exDate: string, amount: number | null, currency: string | null): void {
      sqlite
        .prepare(
          `INSERT INTO corporate_actions (isin, kind, ex_date, amount, currency, status, source, created_at, updated_at)
           VALUES (?1, 'cash_dividend', ?2, ?3, ?4, 'recorded', 'mubasher', ?5, ?5)`,
        )
        .run(COMI_ISIN, exDate, amount, currency, NOW);
    }

    it("sums the amounts in the given currency and counts the dividends with no amount", async () => {
      seedDividend("2026-03-15", 2, "EGP");
      seedDividend("2026-06-01", 3, "EGP");
      seedDividend("2026-07-01", 50, "USD");
      seedDividend("2026-09-01", null, null);

      const { value } = await dividendsLast365(db, COMI_ISIN, TODAY, "EGP");

      expect(value).toEqual({ total: 5, unpriced: 1 });
    });

    it("returns no total and no unpriced dividends when there are none", async () => {
      const { value } = await dividendsLast365(db, COMI_ISIN, TODAY, "EGP");

      expect(value).toEqual({ total: null, unpriced: 0 });
    });
  });

  describe("setQuoteCurrencies", () => {
    it("updates the quote currency of a symbol", async () => {
      sqlite
        .prepare(
          `INSERT INTO symbols (isin, ticker, status, created_at, updated_at) VALUES (?1, 'COMI', 'active', ?2, ?2)`,
        )
        .run(COMI_ISIN, NOW);

      await setQuoteCurrencies(db, [{ isin: COMI_ISIN, currency: "USD" }]);

      expect(sqlite.prepare("SELECT quote_currency FROM symbols").get()).toEqual({ quote_currency: "USD" });
    });
  });

  describe("upsertFigures", () => {
    it("keeps the dated row current across undated changes and returns to the dated value", async () => {
      await upsertFigures(db, [figure(PERIOD_END, DATED_VALUE, FIRST_FETCH)]);
      await upsertFigures(db, [figure(null, DATED_VALUE, SECOND_FETCH)]);
      const afterSameUndated = storedFigures();
      await upsertFigures(db, [figure(null, CHANGED_VALUE, THIRD_FETCH)]);
      const afterChangedUndated = storedFigures();
      await upsertFigures(db, [figure(PERIOD_END, DATED_VALUE, FOURTH_FETCH)]);
      const afterDatedAgain = storedFigures();
      await upsertFigures(db, [figure(PERIOD_END, DATED_VALUE, FIFTH_FETCH)]);

      expect(afterSameUndated).toEqual([{ period_end: PERIOD_END, value: DATED_VALUE, fetched_at: FIRST_FETCH }]);
      expect(afterChangedUndated).toEqual([
        { period_end: PERIOD_END, value: DATED_VALUE, fetched_at: FIRST_FETCH },
        { period_end: UNKNOWN_PERIOD_END, value: CHANGED_VALUE, fetched_at: THIRD_FETCH },
      ]);
      expect(afterDatedAgain).toEqual([
        { period_end: PERIOD_END, value: DATED_VALUE, fetched_at: FOURTH_FETCH },
        { period_end: UNKNOWN_PERIOD_END, value: CHANGED_VALUE, fetched_at: THIRD_FETCH },
      ]);
      expect(storedFigures()).toEqual(afterDatedAgain);
    });

    it("bumps a row once per source flip between undated and dated values", async () => {
      const dated = (value: number, fetchedAt: number) => figure(PERIOD_END, value, fetchedAt);
      const undated = (value: number, fetchedAt: number) => figure(null, value, fetchedAt);
      const steps: { row: FigureRow; stored: StoredFigure[] }[] = [
        { row: undated(5, 1), stored: [{ period_end: UNKNOWN_PERIOD_END, value: 5, fetched_at: 1 }] },
        {
          row: dated(7, 2),
          stored: [
            { period_end: PERIOD_END, value: 7, fetched_at: 2 },
            { period_end: UNKNOWN_PERIOD_END, value: 5, fetched_at: 1 },
          ],
        },
        {
          row: undated(5, 3),
          stored: [
            { period_end: PERIOD_END, value: 7, fetched_at: 2 },
            { period_end: UNKNOWN_PERIOD_END, value: 5, fetched_at: 3 },
          ],
        },
        {
          row: undated(5, 4),
          stored: [
            { period_end: PERIOD_END, value: 7, fetched_at: 2 },
            { period_end: UNKNOWN_PERIOD_END, value: 5, fetched_at: 3 },
          ],
        },
        {
          row: dated(7, 5),
          stored: [
            { period_end: PERIOD_END, value: 7, fetched_at: 5 },
            { period_end: UNKNOWN_PERIOD_END, value: 5, fetched_at: 3 },
          ],
        },
        {
          row: dated(7, 6),
          stored: [
            { period_end: PERIOD_END, value: 7, fetched_at: 5 },
            { period_end: UNKNOWN_PERIOD_END, value: 5, fetched_at: 3 },
          ],
        },
        {
          row: undated(9, 7),
          stored: [
            { period_end: PERIOD_END, value: 7, fetched_at: 5 },
            { period_end: UNKNOWN_PERIOD_END, value: 9, fetched_at: 7 },
          ],
        },
        {
          row: dated(7, 8),
          stored: [
            { period_end: PERIOD_END, value: 7, fetched_at: 8 },
            { period_end: UNKNOWN_PERIOD_END, value: 9, fetched_at: 7 },
          ],
        },
      ];

      for (const step of steps) {
        await upsertFigures(db, [step.row]);
        expect(storedFigures()).toEqual(step.stored);
      }
    });
  });
});
