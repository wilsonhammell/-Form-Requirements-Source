// The shape behind the three name lists, the DB fields, the system fields and
// the signing buttons. Each is a list of entries carrying an identifier, and
// each asks the same two questions of a name.
//
// One copy because the trim and dedupe rule decides which names the tool
// recognises, and a name is the critical output. The DB list and the system
// list drifting on it would be a silent failure downstream.

// First entry wins, blanks and repeats dropped, order kept. entry maps the rest
// of the fields, since only the identifier is common to all three.
export function normalizeIdentifierList(raw, { what, entry = () => ({}) }) {
  if (!Array.isArray(raw)) throw new Error(`${what} must be a JSON array.`);
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const identifier = String(item?.identifier ?? '').trim();
    if (!identifier || seen.has(identifier)) continue;
    seen.add(identifier);
    out.push({ identifier, ...entry(item, identifier) });
  }
  return out;
}

// Fetched rather than bundled, so the business can swap the file without a
// build.
export async function fetchIdentifierList(url, options) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status}).`);
  return normalizeIdentifierList(await res.json(), options);
}

export const publicUrl = (file) => `${import.meta.env?.BASE_URL ?? '/'}${file}`;

export function indexByIdentifier(entries) {
  return new Map(entries.map((e) => [e.identifier, e]));
}

// Derived from the name, never stored on the field, so swapping a list
// reclassifies everything at once.
export function hasIdentifier(name, index) {
  if (!name || !index) return false;
  return index.has(name.trim());
}
