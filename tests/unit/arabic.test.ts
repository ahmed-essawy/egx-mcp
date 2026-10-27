import { describe, expect, it } from "vitest";
import { normalizeArabic } from "../../src/domain/arabic";

const TASHKEEL_FIRST = 0x064b;
const TASHKEEL_LAST = 0x065f;
const SUPERSCRIPT_ALEF = "\u0670";
const TATWEEL = "\u0640";

const ALEF = "\u0627";
const YEH = "\u064a";
const WAW = "\u0648";
const HEH = "\u0647";
const ARABIC_INDIC_DIGITS = "\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669";
const ASCII_DIGITS = "0123456789";

const tashkeelCodePoints = Array.from(
  { length: TASHKEEL_LAST - TASHKEEL_FIRST + 1 },
  (_, offset) => String.fromCodePoint(TASHKEEL_FIRST + offset),
);

describe("normalizeArabic", () => {
  it("makes hamza variants of a word match the plain spelling", () => {
    expect(normalizeArabic("أسمنت")).toBe(normalizeArabic("اسمنت"));
  });

  it.each([
    ["\u0623", "alef with hamza above"],
    ["\u0625", "alef with hamza below"],
    ["\u0622", "alef with madda"],
    ["\u0671", "alef wasla"],
  ])("maps %s (%s) to alef", (letter) => {
    expect(normalizeArabic(letter)).toBe(ALEF);
  });

  it.each([
    ["\u0649", "alef maksura"],
    ["\u0626", "yeh with hamza"],
  ])("maps %s (%s) to yeh", (letter) => {
    expect(normalizeArabic(letter)).toBe(YEH);
  });

  it("maps waw with hamza to waw", () => {
    expect(normalizeArabic("\u0624")).toBe(WAW);
  });

  it("maps teh marbuta to heh", () => {
    expect(normalizeArabic("\u0629")).toBe(HEH);
  });

  it("removes standalone hamza", () => {
    expect(normalizeArabic("\u0621")).toBe("");
    expect(normalizeArabic(`${ALEF}\u0621${YEH}`)).toBe(`${ALEF}${YEH}`);
  });

  it("removes every tashkeel code point from U+064B to U+065F", () => {
    for (const mark of tashkeelCodePoints) {
      expect(normalizeArabic(`${ALEF}${mark}${YEH}`)).toBe(`${ALEF}${YEH}`);
    }
  });

  it("removes the superscript alef", () => {
    expect(normalizeArabic(`${HEH}${SUPERSCRIPT_ALEF}${YEH}`)).toBe(`${HEH}${YEH}`);
  });

  it("removes tatweel", () => {
    expect(normalizeArabic(`${ALEF}${TATWEEL}${TATWEEL}${YEH}`)).toBe(`${ALEF}${YEH}`);
  });

  it("maps Arabic-Indic digits to ASCII digits", () => {
    expect(normalizeArabic(ARABIC_INDIC_DIGITS)).toBe(ASCII_DIGITS);
  });

  it("lowercases Latin letters", () => {
    expect(normalizeArabic("COMI Egx30")).toBe("comi egx30");
  });

  it("collapses runs of whitespace to one space and trims", () => {
    expect(normalizeArabic("  a \t\n  b   c  ")).toBe("a b c");
  });

  it("returns an empty string for blank input", () => {
    expect(normalizeArabic("")).toBe("");
    expect(normalizeArabic(" \t\n ")).toBe("");
  });

  it("applies every rule together", () => {
    const input = `  \u0623\u064e\u0633\u0652\u0645\u0650\u0646\u0652\u062a${TATWEEL}  \u0627\u0644\u0642\u0627\u0647\u0631\u0629 \u0661\u0662 ABC `;
    const expected = "\u0627\u0633\u0645\u0646\u062a \u0627\u0644\u0642\u0627\u0647\u0631\u0647 12 abc";
    expect(normalizeArabic(input)).toBe(expected);
  });
});
