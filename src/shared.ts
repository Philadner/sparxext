import type { CaptureAnswer, HistoryEntry } from "./types";

export const HISTORY_KEY = "bookworkHistory";
export const SETTINGS_KEY = "settings";
export const MAX_HISTORY = 80;

export const SUCCESS_PATTERN = /\bcorrect!?\b|your hard work has paid off/i;
export const CODE_PATTERN = /\b[A-Z]{1,3}\s?[-.]?\s?\d{1,4}[A-Z]?\b|\b\d{1,4}\s?[-.]?\s?[A-Z]{1,3}\b/g;
export const BOOKWORK_CODE_PATTERN = /book\s*work\s*code\s*:\s*([A-Z0-9][A-Z0-9\s.-]{0,10})/i;
export const BOOKWORK_PATTERN = /book\s*work|bookwork|code/gi;

export const api = (typeof browser !== "undefined" ? browser : chrome) as typeof browser;

export function normalizeCode(value: string): string {
  return value.replace(/[\s.-]+/g, "").toUpperCase();
}

export function isLikelyCode(value: string): boolean {
  const code = normalizeCode(value);
  if (code.length < 2 || code.length > 8) return false;
  if (!/[A-Z]/.test(code) || !/\d/.test(code)) return false;
  if (/^(H1|H2|H3|H4|H5|H6|CSS|HTML|HTTP|HTTPS)$/i.test(code)) return false;
  if (/XP$/i.test(code) || /^XP/i.test(code)) return false;
  return true;
}

export function cleanMathText(value: unknown): string {
  return String(value || "")
    .replace(/\\bigg\s*\(/g, "(")
    .replace(/\\bigg\s*\)/g, ")")
    .replace(/[{}]/g, "")
    .replace(/\\circ\b/g, "°")
    .replace(/\^°/g, "°")
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\,/g, " ")
    .replace(/\\/g, "")
    .trim();
}

export function cleanAnswerText(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .replace(/\s+°/g, "°")
    .trim();
}

export function normalizeAnswer(value: unknown): string {
  return cleanAnswerText(value).trim().slice(0, 500);
}

export function isUsefulAnswer(value: unknown): boolean {
  const text = normalizeAnswer(value);
  if (!text) return false;
  if (/^(check|submit|submit answer|next|continue|try again|show working)$/i.test(text)) return false;
  if (SUCCESS_PATTERN.test(text)) return false;
  return true;
}

export function normalizeQuestionId(value: unknown): string {
  return cleanAnswerText(String(value || "").replace(/\$.*?\$/g, "").replace(/ +/g, " "))
    .toLowerCase()
    .slice(0, 220);
}

export function getDisplayAnswer(entry: Partial<HistoryEntry>): string {
  const structured = entry.answers?.map((answer) => answer.value).filter(Boolean).join("; ");
  const answer = String(structured || entry.selectedAnswer || "")
    .replace(/\d{1,3}(?:,\d{3})*\s+XP[\s\S]*$/i, "")
    .replace(/\s+Sparx Maths\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return /^(check|submit|submit answer|next|continue|try again|show working)$/i.test(answer) ? "" : answer;
}

export function uniqueAnswers(answers: CaptureAnswer[]): CaptureAnswer[] {
  const seen = new Set<string>();
  return answers.filter((answer) => {
    const key = `${answer.kind}\u0001${answer.id}\u0001${answer.value}`;
    if (!answer.value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function csvEscape(value: unknown): string {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}
