// The DB field list. The identifier is the PDF field name the downstream filler
// matches on, so it is the only half ever persisted. Labels help someone pick.

import {
  fetchIdentifierList,
  normalizeIdentifierList,
  indexByIdentifier,
  publicUrl,
} from './identifierList.js';

const DB_LIST = {
  what: 'DB field list',
  entry: (raw, identifier) => ({ label: String(raw?.label ?? identifier).trim() }),
};

export const loadDbFields = (url = publicUrl('dbFields.json')) =>
  fetchIdentifierList(url, DB_LIST);

export const normalizeDbFields = (raw) => normalizeIdentifierList(raw, DB_LIST);

export const buildDbIndex = indexByIdentifier;

// Names are matched exactly, since an almost right name is a silent failure
// downstream. A case insensitive index only drives the "did you mean" hint.
export function buildCaseInsensitiveIndex(dbFields) {
  const map = new Map();
  for (const f of dbFields) {
    const key = f.identifier.toLowerCase();
    if (!map.has(key)) map.set(key, f);
  }
  return map;
}

// Underscores, dashes and spaces all read as a word break, so "primary address"
// finds PRIMARY_ADDRESS and, ranked lower, PRIMARY_LEGAL_ADDRESS.
const words = (s) => s.toLowerCase().split(/[\s_\-.]+/).filter(Boolean);

// Lower is better, -1 is no match.
export function matchScore(identifier, label, query) {
  const qWords = words(query);
  if (!qWords.length) return 0;
  const q = qWords.join(' ');
  const id = words(identifier).join(' ');
  const lb = words(label).join(' ');
  if (id === q) return 0;
  if (id.startsWith(q)) return 1;
  if (lb.startsWith(q)) return 2;
  if (id.includes(q)) return 3;
  if (lb.includes(q)) return 4;
  const all = [...words(identifier), ...words(label)];
  if (qWords.every((w) => all.some((x) => x.startsWith(w)))) return 5;
  const text = `${id} ${lb}`;
  if (qWords.every((w) => text.includes(w))) return 6;
  return -1;
}

export function searchDbFields(dbFields, query) {
  if (!query.trim()) return dbFields;
  const scored = [];
  for (const f of dbFields) {
    const score = matchScore(f.identifier, f.label, query);
    if (score >= 0) scored.push({ f, score });
  }
  scored.sort((a, b) => a.score - b.score || a.f.identifier.localeCompare(b.f.identifier));
  return scored.map((s) => s.f);
}
