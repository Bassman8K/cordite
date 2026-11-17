export interface ScriptLine {
  chapter: string;
  who: string;
  text: string;
  key: string;
}
export function scriptLines(root: string): ScriptLine[];
export function lineKey(who: string, text: string): string;
export function spoken(text: string): string;
export const STOCK: Record<string, string[]>;
export const CAST: Record<string, { voice: string | Record<string, number>; lang: string; speed: number }>;
