import type { FitDocument, HistoryEntry } from './types.js';

const MAX_HISTORY = 50;
const GROUP_WINDOW_MS = 10 * 60 * 1000;
const clone = <T>(value: T): T => structuredClone(value);

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => deepEqual(value, b[index]));
  }
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).sort(), rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
}

export function recordHistory(prevDoc: FitDocument, nextDoc: FitDocument, now = new Date()): FitDocument {
  if (deepEqual(prevDoc.fit, nextDoc.fit)) return clone(nextDoc);
  const result = clone(nextDoc);
  const last = result.history.at(-1);
  if (!last || now.getTime() - Date.parse(last.at) > GROUP_WINDOW_MS) {
    result.history.push({ at: now.toISOString(), fit: clone(prevDoc.fit) });
    if (result.history.length > MAX_HISTORY) result.history.splice(0, result.history.length - MAX_HISTORY);
  }
  return result;
}

export function restoreHistory(doc: FitDocument, index: number, now = new Date()): FitDocument {
  const entry: HistoryEntry | undefined = doc.history[index];
  if (!entry) return clone(doc);
  const result = clone(doc);
  result.history.push({ at: now.toISOString(), fit: clone(doc.fit) });
  if (result.history.length > MAX_HISTORY) result.history.splice(0, result.history.length - MAX_HISTORY);
  result.fit = clone(entry.fit);
  return result;
}
