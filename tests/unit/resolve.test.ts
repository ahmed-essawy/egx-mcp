import { describe, expect, it } from "vitest";
import { normalizeArabic } from "../../src/domain/arabic";
import {
  MAX_AMBIGUOUS_CANDIDATES,
  MAX_NOT_FOUND_SUGGESTIONS,
  resolveFund,
  resolveSymbol,
  searchDirectory,
} from "../../src/mcp/resolve";
import type { Directory, DirectoryFund, DirectorySymbol } from "../../src/store/kv";

const COMI_ISIN = "EGS60121C018";
const COMI_NAME_AR = "البنك التجاري الدولي";
const COMI_NAME_EN = "Commercial International Bank";
const CEMENT_NAME_PLAIN = "اسمنت السويس";
const CEMENT_NAME_HAMZA = "أسمنت السويس";
const BANK_COUNT = 12;
const SEARCH_LIMIT = 3;
const SEARCH_ALL = 20;

function symbol(
  isin: string,
  ticker: string,
  nameAr: string | null,
  nameEn: string | null,
  aliases: string[] = [],
): DirectorySymbol {
  return [
    isin,
    ticker,
    nameAr,
    nameEn,
    null,
    "active",
    normalizeArabic(nameAr ?? ""),
    normalizeArabic(nameEn ?? ""),
    aliases.map(normalizeArabic),
  ];
}

function fund(
  fundId: string,
  nameAr: string,
  nameEn: string | null,
  manager: string | null,
): DirectoryFund {
  return [
    fundId,
    nameAr,
    nameEn,
    manager,
    "EGP",
    normalizeArabic(nameAr),
    normalizeArabic(nameEn ?? ""),
  ];
}

function directory(symbols: DirectorySymbol[], funds: DirectoryFund[] = []): Directory {
  const tickerToIsin: Record<string, string> = {};
  for (const entry of symbols) {
    tickerToIsin[entry[1]] = entry[0];
    for (const alias of entry[8]) tickerToIsin[alias.toUpperCase()] = entry[0];
  }
  return { v: 1, builtAt: 0, symbols, tickerToIsin, funds };
}

const comi = symbol(COMI_ISIN, "COMI", COMI_NAME_AR, COMI_NAME_EN, ["CIB"]);
const cement = symbol("EGS3C071C017", "SUCE", CEMENT_NAME_PLAIN, "Suez Cement");
const bankGroup = Array.from({ length: BANK_COUNT }, (_, index) =>
  symbol(
    `EGS0000${index}C010`,
    `BNK${String(index).padStart(2, "0")}`,
    null,
    `Delta Bank ${index}`,
  ),
);
const alpha = fund("mubasher:1", "صندوق الأهلي الأول", "Ahli First Fund", "Beltone");
const beta = fund("mubasher:2", "صندوق مصر الثاني", null, "Beltone");
const gamma = fund("mubasher:3", "صندوق بنك مصر", "Banque Misr Fund", "Misr Capital");

const dir = directory([comi, cement, ...bankGroup], [alpha, beta, gamma]);

describe("resolveSymbol", () => {
  it("resolves an exact ISIN, ignoring case", () => {
    expect(resolveSymbol(dir, COMI_ISIN.toLowerCase())).toEqual({ ok: true, entry: comi });
  });

  it("resolves an exact ticker, ignoring case and padding", () => {
    expect(resolveSymbol(dir, " comi ")).toEqual({ ok: true, entry: comi });
  });

  it("resolves a ticker alias", () => {
    expect(resolveSymbol(dir, "CIB")).toEqual({ ok: true, entry: comi });
  });

  it("resolves an exact Arabic name", () => {
    expect(resolveSymbol(dir, COMI_NAME_AR)).toEqual({ ok: true, entry: comi });
  });

  it("resolves an exact English name, ignoring case", () => {
    expect(resolveSymbol(dir, "commercial international bank")).toEqual({ ok: true, entry: comi });
  });

  it("resolves a normalized substring of a name", () => {
    expect(resolveSymbol(dir, "التجاري")).toEqual({ ok: true, entry: comi });
  });

  it("treats hamza variants of an Arabic name as the same input", () => {
    expect(resolveSymbol(dir, CEMENT_NAME_HAMZA)).toEqual({ ok: true, entry: cement });
    expect(resolveSymbol(dir, CEMENT_NAME_PLAIN)).toEqual({ ok: true, entry: cement });
  });

  it("prefers an earlier tier over a later substring match", () => {
    const shadow = symbol("EGS00001C010", "SHDW", null, "Prefix COMI Holdings");
    expect(resolveSymbol(directory([shadow, comi]), "COMI")).toEqual({ ok: true, entry: comi });
  });

  it("returns ambiguous with at most 10 candidates when a substring matches many", () => {
    const result = resolveSymbol(dir, "delta bank");
    expect(result).toMatchObject({ ok: false, code: "ambiguous" });
    if (result.ok) throw new Error("expected a failure");
    expect(result.candidates).toHaveLength(MAX_AMBIGUOUS_CANDIDATES);
    expect(result.candidates[0]).toBe(bankGroup[0]);
  });

  it("returns ambiguous with every candidate when there are fewer than the cap", () => {
    const result = resolveSymbol(directory(bankGroup.slice(0, 2)), "delta bank");
    expect(result).toEqual({ ok: false, code: "ambiguous", candidates: bankGroup.slice(0, 2) });
  });

  it("returns not_found with up to 5 suggestions ordered by ticker", () => {
    const result = resolveSymbol(dir, "bnk99");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.code).toBe("not_found");
    expect(result.candidates).toHaveLength(MAX_NOT_FOUND_SUGGESTIONS);
    expect(result.candidates.map((entry) => entry[1])).toEqual([
      "BNK00",
      "BNK01",
      "BNK02",
      "BNK03",
      "BNK04",
    ]);
  });

  it("suggests the entry sharing the longest prefix", () => {
    expect(resolveSymbol(dir, "COMX")).toEqual({ ok: false, code: "not_found", candidates: [comi] });
  });

  it("returns no suggestions for an unrelated code that only shares one or two letters", () => {
    expect(resolveSymbol(dir, "NOPE123")).toEqual({ ok: false, code: "not_found", candidates: [] });
  });

  it("suggests a ticker that starts with the input before one that merely contains it", () => {
    const prefixed = symbol("EGS00000C900", "OMIX", null, null);
    const result = resolveSymbol(directory([comi, prefixed]), "omi");

    expect(result).toEqual({ ok: false, code: "not_found", candidates: [prefixed, comi] });
  });

  it("orders fuzzy suggestions by the longest shared prefix before the ticker", () => {
    const early = symbol("EGS00000C910", "AAA1", null, "Alpha Holdings");
    const closer = symbol("EGS00000C911", "ZZZ1", null, "Alphabet Industries");
    const result = resolveSymbol(directory([early, closer]), "alphabxyz");

    expect(result).toEqual({ ok: false, code: "not_found", candidates: [closer, early] });
  });

  it("returns no suggestions for a one letter input", () => {
    const single = symbol("EGS00000C901", "QQQ1", null, null);

    expect(resolveSymbol(directory([single]), "q")).toEqual({ ok: false, code: "not_found", candidates: [] });
  });

  it("suggests a ticker that contains the input", () => {
    expect(resolveSymbol(dir, "OMI")).toEqual({ ok: false, code: "not_found", candidates: [comi] });
  });

  it("returns not_found without suggestions when nothing shares a prefix", () => {
    expect(resolveSymbol(dir, "zzz")).toEqual({ ok: false, code: "not_found", candidates: [] });
  });

  it("returns not_found for blank input", () => {
    expect(resolveSymbol(dir, "   ")).toEqual({ ok: false, code: "not_found", candidates: [] });
  });
});

describe("resolveFund", () => {
  it("resolves an exact fund id", () => {
    expect(resolveFund(dir, "MUBASHER:2")).toEqual({ ok: true, entry: beta });
  });

  it("resolves an exact Arabic name", () => {
    expect(resolveFund(dir, "صندوق الاهلي الاول")).toEqual({ ok: true, entry: alpha });
  });

  it("resolves an exact English name", () => {
    expect(resolveFund(dir, "ahli first fund")).toEqual({ ok: true, entry: alpha });
  });

  it("resolves a name substring", () => {
    expect(resolveFund(dir, "الثاني")).toEqual({ ok: true, entry: beta });
  });

  it("matches the manager by substring and reports several funds as ambiguous", () => {
    expect(resolveFund(dir, "beltone")).toEqual({
      ok: false,
      code: "ambiguous",
      candidates: [alpha, beta],
    });
  });

  it("resolves a single fund through a unique manager", () => {
    expect(resolveFund(dir, "Misr Capital")).toEqual({ ok: true, entry: gamma });
  });

  it("returns not_found with only the fund sharing most of the name", () => {
    expect(resolveFund(dir, "صندوق الاهلي الثالث")).toEqual({
      ok: false,
      code: "not_found",
      candidates: [alpha],
    });
  });
});

describe("searchDirectory", () => {
  const ranked = directory([
    symbol("EGS00000C010", "ZZZ1", null, "Bank of Alexandria"),
    symbol("EGS00001C010", "AAA1", null, "Big Bank Holdings"),
    symbol("EGS00002C010", "BBB1", null, "Bank"),
    symbol("EGS00003C010", "CCC1", null, "Bank Audi"),
  ]);

  it("orders by exact, prefix, substring, then ticker", () => {
    const tickers = searchDirectory(ranked, "bank", "any", SEARCH_ALL).map((hit) => hit.entry[1]);
    expect(tickers).toEqual(["BBB1", "CCC1", "ZZZ1", "AAA1"]);
  });

  it("finds a stock by ticker, ISIN, Arabic name and English name", () => {
    for (const query of ["COMI", COMI_ISIN, COMI_NAME_AR, "Commercial International"]) {
      const hits = searchDirectory(dir, query, "any", SEARCH_ALL);
      expect(hits[0]).toEqual({ type: "stock", entry: comi });
    }
  });

  it("returns identical results for hamza variants", () => {
    const plain = searchDirectory(dir, "اسمنت", "any", SEARCH_ALL);
    expect(searchDirectory(dir, "أسمنت", "any", SEARCH_ALL)).toEqual(plain);
    expect(plain).toEqual([{ type: "stock", entry: cement }]);
  });

  it("restricts results by type", () => {
    const funds = searchDirectory(dir, "مصر", "fund", SEARCH_ALL);
    expect(funds.length).toBeGreaterThan(0);
    expect(funds.every((hit) => hit.type === "fund")).toBe(true);
    const stocks = searchDirectory(dir, "bank", "stock", SEARCH_ALL);
    expect(stocks.length).toBeGreaterThan(0);
    expect(stocks.every((hit) => hit.type === "stock")).toBe(true);
  });

  it("includes funds under type any", () => {
    expect(searchDirectory(dir, "misr", "any", SEARCH_ALL)).toEqual([
      { type: "fund", entry: gamma },
    ]);
  });

  it("applies the limit", () => {
    expect(searchDirectory(dir, "bank", "any", SEARCH_LIMIT)).toHaveLength(SEARCH_LIMIT);
  });

  it("returns nothing for blank queries and empty directories", () => {
    expect(searchDirectory(dir, "  ", "any", SEARCH_ALL)).toEqual([]);
    expect(searchDirectory(directory([]), "COMI", "any", SEARCH_ALL)).toEqual([]);
  });
});
