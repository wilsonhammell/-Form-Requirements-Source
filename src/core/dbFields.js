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

export function searchDbFields(dbFields, query) {
  const q = query.trim().toLowerCase();
  if (!q) return dbFields;
  const scored = [];
  for (const f of dbFields) {
    const id = f.identifier.toLowerCase();
    const label = f.label.toLowerCase();
    let score = -1;
    if (id === q) score = 0;
    else if (id.startsWith(q)) score = 1;
    else if (label.startsWith(q)) score = 2;
    else if (id.includes(q)) score = 3;
    else if (label.includes(q)) score = 4;
    if (score >= 0) scored.push({ f, score });
  }
  scored.sort((a, b) => a.score - b.score || a.f.identifier.localeCompare(b.f.identifier));
  return scored.map((s) => s.f);
}
