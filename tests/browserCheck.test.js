// The browser check is one long function, so a name declared twice in it is a
// SyntaxError. The module then never loads, window.__browserCheck is never set,
// and the runner sits there until it times out two minutes later with nothing
// to show. Parsing it here turns that into a one second failure that names the
// line.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const SOURCES = ['tests/browser/check.jsx', 'src/App.jsx'];

describe('sources that only a browser would otherwise parse', () => {
  for (const path of SOURCES) {
    it(`${path} parses`, () => {
      const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
      let error = null;
      try {
        transformSync(source, { loader: 'jsx' });
      } catch (err) {
        error = (err.errors ?? [])
          .map((e) => `line ${e.location?.line}: ${e.text}`)
          .join('\n');
      }
      expect(error).toBeNull();
    });
  }
});
