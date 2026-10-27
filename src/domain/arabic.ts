const TASHKEEL_FIRST = "\u064b";
const TASHKEEL_LAST = "\u065f";
const SUPERSCRIPT_ALEF = "\u0670";
const TATWEEL = "\u0640";
const STANDALONE_HAMZA = "\u0621";

const REMOVED_MARKS = new RegExp(
  `[${TASHKEEL_FIRST}-${TASHKEEL_LAST}${SUPERSCRIPT_ALEF}${TATWEEL}${STANDALONE_HAMZA}]`,
  "g",
);

const LETTER_MAP: Readonly<Record<string, string>> = {
  "\u0623": "\u0627",
  "\u0625": "\u0627",
  "\u0622": "\u0627",
  "\u0671": "\u0627",
  "\u0649": "\u064a",
  "\u0626": "\u064a",
  "\u0624": "\u0648",
  "\u0629": "\u0647",
};

const ARABIC_INDIC_ZERO = 0x0660;
const ASCII_ZERO = 0x30;
const ARABIC_INDIC_DIGITS = /[\u0660-\u0669]/g;
const MAPPED_LETTERS = new RegExp(`[${Object.keys(LETTER_MAP).join("")}]`, "g");
const WHITESPACE_RUN = /\s+/g;

function toAsciiDigit(digit: string): string {
  const offset = digit.charCodeAt(0) - ARABIC_INDIC_ZERO;
  return String.fromCharCode(ASCII_ZERO + offset);
}

export function normalizeArabic(input: string): string {
  return input
    .replace(REMOVED_MARKS, "")
    .replace(MAPPED_LETTERS, (letter) => LETTER_MAP[letter] ?? letter)
    .replace(ARABIC_INDIC_DIGITS, toAsciiDigit)
    .toLowerCase()
    .replace(WHITESPACE_RUN, " ")
    .trim();
}
