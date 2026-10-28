import type { CorporateActionKind } from "../domain/adjust.ts";
import type { ProviderAction } from "./types.ts";
import { asString } from "./values.ts";

export type Row = Record<string, unknown>;

const SOURCE_TEXT_SEPARATOR = " | ";
const ACTION_KIND_PREFIXES: ReadonlyArray<readonly [string, CorporateActionKind]> = [
  ["توزيع أرباح نقدية", "cash_dividend"],
  ["توزيع أسهم منحة", "bonus"],
  ["توزيع أسهم خزينة كأسهم منحة", "bonus"],
  ["تجزئة", "split"],
  ["تجميع", "reverse_split"],
  ["زيادة رأس مال", "rights"],
  ["تغيير اسم الشركة", "name_change"],
];
const ARABIC_DATE = /^(\d{1,2})\s+(\S+)\s+(\d{4})$/;
const ARABIC_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

export function parseArabicDate(text: string): string | null {
  const match = ARABIC_DATE.exec(text.trim());
  if (match === null) return null;
  const month = ARABIC_MONTHS.indexOf(match[2] as string) + 1;
  if (month === 0) return null;
  const day = Number(match[1]);
  const year = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function mapMubasherActionKind(type: string): CorporateActionKind {
  return ACTION_KIND_PREFIXES.find(([prefix]) => type.startsWith(prefix))?.[1] ?? "other";
}

function parseOptionalArabicDate(value: unknown): string | null {
  const text = asString(value);
  return text === null ? null : parseArabicDate(text);
}

export function parseMubasherActionRow(row: Row): ProviderAction | null {
  const ticker = asString(row.url)?.split("/").pop();
  const exDate = parseOptionalArabicDate(row.effectiveFrom);
  if (ticker === undefined || ticker === "" || exDate === null) return null;
  const type = asString(row.type) ?? "";
  return {
    ticker,
    kind: mapMubasherActionKind(type),
    announcedOn: parseOptionalArabicDate(row.announcedAt),
    exDate,
    sourceText: `${type}${SOURCE_TEXT_SEPARATOR}${asString(row.description) ?? ""}`,
  };
}
