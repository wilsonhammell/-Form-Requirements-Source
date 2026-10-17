import { describe, expect, it } from 'vitest';
import {
  VERDICT, fetchReviewForms, remoteForm, saveVerdict, verdictCounts, verdictStatus,
} from '../src/core/review.js';
import { createBatch } from '../src/core/batch.js';

const json = (body, ok = true) => ({
  ok,
  status: ok ? 200 : 404,
  headers: { get: () => 'application/json' },
  json: async () => body,
});

describe('review mode', () => {
  it('is off where nothing serves the forms', async () => {
    expect(await fetchReviewForms(async () => { throw new Error('offline'); })).toBe(null);
    expect(await fetchReviewForms(async () => json({}, false))).toBe(null);
    // a plain static server answers with its index page, not a list
    const html = { ok: true, headers: { get: () => 'text/html' }, json: async () => [] };
    expect(await fetchReviewForms(async () => html)).toBe(null);
  });

  it('opens the station forms as a batch, read only when shown', async () => {
    const asked = [];
    const fetchImpl = async (url) => {
      asked.push(url);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(3) };
    };
    const forms = [{ name: 'B Form', path: '2 designer output/B Form/B Form.pdf', sha1: 'b' },
      { name: 'A Form', path: 'x/A Form.pdf', sha1: 'a' }];
    const batch = createBatch(forms.map((f) => remoteForm(f, fetchImpl)));
    expect(batch.entries.map((e) => e.name)).toEqual(['A Form.pdf', 'B Form.pdf']);
    expect(asked).toEqual([]);
    const bytes = await batch.entries[1].file.arrayBuffer();
    expect(bytes.byteLength).toBe(3);
    expect(asked).toEqual(['api/review/file?path=2%20designer%20output%2FB%20Form%2FB%20Form.pdf']);
    expect(batch.entries[1].file.review.sha1).toBe('b');
  });

  it('reads a verdict on an earlier build as rebuilt', () => {
    expect(verdictStatus(undefined, 'a')).toBe(VERDICT.NONE);
    expect(verdictStatus({ status: 'approved', sha1: 'a' }, 'a')).toBe(VERDICT.APPROVED);
    expect(verdictStatus({ status: 'changes', sha1: 'a' }, 'a')).toBe(VERDICT.CHANGES);
    expect(verdictStatus({ status: 'approved', sha1: 'a' }, 'b')).toBe(VERDICT.REBUILT);
    expect(verdictStatus({ status: 'changes', sha1: 'a' }, 'b')).toBe(VERDICT.REBUILT);
    // a note with no verdict yet is no verdict
    expect(verdictStatus({ status: 'none', note: 'x', sha1: 'a' }, 'b')).toBe(VERDICT.NONE);
  });

  it('counts where the forms stand', () => {
    const forms = [{ name: 'a', sha1: '1' }, { name: 'b', sha1: '2' }, { name: 'c', sha1: '3' }, { name: 'd', sha1: '4' }];
    const verdicts = { a: { status: 'approved', sha1: '1' }, b: { status: 'changes', sha1: '2' }, c: { status: 'approved', sha1: 'old' } };
    expect(verdictCounts(forms, verdicts)).toEqual({ none: 1, approved: 1, changes: 1, rebuilt: 1 });
  });

  it('saves a verdict with the build it was given on', async () => {
    let sent;
    const out = await saveVerdict({ name: 'a', status: 'approved', note: '', sha1: '1' },
      async (url, init) => { sent = { url, init }; return json({ status: 'approved', sha1: '1' }); });
    expect(sent.url).toBe('api/review/verdicts');
    expect(sent.init.method).toBe('PUT');
    expect(JSON.parse(sent.init.body)).toEqual({ name: 'a', status: 'approved', note: '', sha1: '1' });
    expect(out.status).toBe('approved');
    await expect(saveVerdict({ name: 'a', status: 'approved' }, async () => json({}, false))).rejects.toThrow();
  });
});
