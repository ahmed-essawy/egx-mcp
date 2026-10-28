import { describe, expect, it } from "vitest";
import { toCairoIso } from "../../src/domain/calendar";
import type { IndexEntry, QuoteEntry } from "../../src/store/kv";
import {
  closeProvenance,
  computedProvenance,
  DIRECTORY_SOURCE,
  groupBySource,
  indexProvenance,
  MARKET_EVENTS_SOURCE,
  quoteProvenance,
  STORED_BARS_SOURCE,
  STORED_INDEX_SOURCE,
  stockBasis,
  SYMBOL_MASTER_SOURCE,
} from "../../src/mcp/provenance";
import type { MarketClock } from "../../src/mcp/session";

const PRIMARY = "tradingview";

describe("stockBasis", () => {
  it("is primary when the source is the configured primary provider", () => {
    expect(stockBasis("tradingview", PRIMARY)).toBe("primary");
  });

  it("is backup when the source is not the configured primary provider", () => {
    expect(stockBasis("mubasher", PRIMARY)).toBe("backup");
  });

  it("follows the configured primary when it is mubasher", () => {
    expect(stockBasis("mubasher", "mubasher")).toBe("primary");
    expect(stockBasis("tradingview", "mubasher")).toBe("backup");
  });
});

describe("groupBySource", () => {
  it("groups items by source in first-seen order", () => {
    const groups = groupBySource([{ s: "b" }, { s: "a" }, { s: "b" }], (item) => item.s);

    expect([...groups.keys()]).toEqual(["b", "a"]);
    expect(groups.get("b")).toHaveLength(2);
  });
});

const CLOCK: MarketClock = {
  now: 0,
  today: "2026-10-22",
  todayRow: null,
  holidays: new Set<string>(),
  sessionDate: "2026-10-22",
};

const TT_A = 1_761_130_000;
const TT_B = TT_A + 60;
const TT_C = TT_A + 120;

function quote(src: string, tt: number, td = "2026-10-22"): QuoteEntry {
  return { t: "X", p: 1, o: null, h: null, l: null, pc: null, ch: null, chp: null, v: 0, val: null, tt, td, src };
}

function index(src: string, tt: number): IndexEntry {
  return { v: 1, chp: null, tt, src };
}

describe("quoteProvenance", () => {
  it("groups quotes by source in first-seen order with the newest trade time", () => {
    const entries = quoteProvenance(
      ["quotes"],
      [quote("tradingview", TT_A), quote("mubasher", TT_B), quote("tradingview", TT_C)],
      PRIMARY,
      CLOCK,
    );

    expect(entries).toEqual([
      { fields: ["quotes"], source: "tradingview", dataTime: toCairoIso(TT_C), timeKind: "trade", stale: false, basis: "primary" },
      { fields: ["quotes"], source: "mubasher", dataTime: toCairoIso(TT_B), timeKind: "trade", stale: false, basis: "backup" },
    ]);
  });

  it("bases a mixed snapshot on the configured primary provider", () => {
    const entries = quoteProvenance(["quotes"], [quote("tradingview", TT_A), quote("mubasher", TT_B)], "mubasher", CLOCK);

    expect(entries.map(({ source, basis }) => ({ source, basis }))).toEqual([
      { source: "tradingview", basis: "backup" },
      { source: "mubasher", basis: "primary" },
    ]);
  });

  it("marks a group stale when any of its quotes is 3 sessions old", () => {
    const entries = quoteProvenance(
      ["quotes"],
      [quote("tradingview", TT_A), quote("tradingview", TT_B, "2026-10-19")],
      PRIMARY,
      CLOCK,
    );

    expect(entries[0]?.stale).toBe(true);
  });

  it("is empty for no quotes", () => {
    expect(quoteProvenance(["quotes"], [], PRIMARY, CLOCK)).toEqual([]);
  });
});

describe("indexProvenance", () => {
  it("is empty for no entries", () => {
    expect(indexProvenance(["indices"], [])).toEqual([]);
  });

  it("gives one primary entry per source with the newest trade time", () => {
    const entries = indexProvenance(["indices"], [index("tradingview", TT_A), index("tradingview", TT_C), index("other", TT_B)]);

    expect(entries).toEqual([
      { fields: ["indices"], source: "tradingview", dataTime: toCairoIso(TT_C), timeKind: "trade", stale: false, basis: "primary" },
      { fields: ["indices"], source: "other", dataTime: toCairoIso(TT_B), timeKind: "trade", stale: false, basis: "primary" },
    ]);
  });
});

describe("closeProvenance", () => {
  it("groups rows by source, marking filled sources computed", () => {
    const entries = closeProvenance(
      ["bars"],
      [
        { date: "2026-10-20", source: "tradingview" },
        { date: "2026-10-22", source: "tradingview+filled" },
        { date: "2026-10-21", source: "tradingview" },
      ],
      true,
    );

    expect(entries).toEqual([
      { fields: ["bars"], source: "tradingview", dataTime: "2026-10-21", timeKind: "close", stale: true, basis: "primary" },
      { fields: ["bars"], source: "tradingview+filled", dataTime: "2026-10-22", timeKind: "close", stale: true, basis: "computed" },
    ]);
  });

  it("is empty for no rows", () => {
    expect(closeProvenance(["bars"], [], false)).toEqual([]);
  });
});

describe("computedProvenance", () => {
  it("builds a single computed entry", () => {
    expect(computedProvenance(["x"], "s", null, "period", false)).toEqual({
      fields: ["x"],
      source: "s",
      dataTime: null,
      timeKind: "period",
      stale: false,
      basis: "computed",
    });
  });
});

describe("source constants", () => {
  it("carry the contract values", () => {
    expect(STORED_BARS_SOURCE).toBe("stored daily bars");
    expect(STORED_INDEX_SOURCE).toBe("stored index closes");
    expect(SYMBOL_MASTER_SOURCE).toBe("symbol master");
    expect(MARKET_EVENTS_SOURCE).toBe("market events");
    expect(DIRECTORY_SOURCE).toBe("directory");
  });
});
