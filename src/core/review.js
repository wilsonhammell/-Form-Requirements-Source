// Review mode: the app served by the form cleaner's review station
// (designer/review_server.mjs), which hands it every form of the handover and
// keeps a verdict for each - approved, or needs changes and why - on disk,
// where the next round of fixes is worked out from.
//
// Opened any other way there is no station to ask, and the app is the bulk
// designer as before.
//
// A verdict carries the sha1 of the file it was given on. A form rebuilt since
// reads as rebuilt rather than as still approved, or still waiting on changes.

export const VERDICT = {
  NONE: 'none',
  APPROVED: 'approved',
  CHANGES: 'changes',
  // given on an earlier build of the form
  REBUILT: 'rebuilt',
};

const api = (route) => `api/review/${route}`;

// The forms on offer, or null where the app was not opened by the station.
export async function fetchReviewForms(fetchImpl = fetch) {
  try {
    const res = await fetchImpl(api('forms'));
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const forms = await res.json();
    return Array.isArray(forms) ? forms : null;
  } catch {
    return null;
  }
}

export async function fetchVerdicts(fetchImpl = fetch) {
  const res = await fetchImpl(api('verdicts'));
  return res.ok ? res.json() : {};
}

export async function saveVerdict({ name, status, note, sha1 }, fetchImpl = fetch) {
  const res = await fetchImpl(api('verdicts'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, status, note, sha1 }),
  });
  if (!res.ok) throw new Error(`The verdict was not saved (${res.status}).`);
  return res.json();
}

// Stands in for a File in a batch: named for the form, read from the station
// only when the form is first shown.
export function remoteForm(form, fetchImpl = fetch) {
  return {
    name: `${form.name}.pdf`,
    type: 'application/pdf',
    review: form,
    arrayBuffer: async () => {
      const res = await fetchImpl(`${api('file')}?path=${encodeURIComponent(form.path)}`);
      if (!res.ok) throw new Error(`${form.name} could not be read from the handover (${res.status}).`);
      return res.arrayBuffer();
    },
  };
}

// Where a form stands: no verdict, approved, needs changes - or a verdict
// given on a build of it that has since been replaced.
export function verdictStatus(verdict, sha1) {
  if (!verdict || verdict.status === VERDICT.NONE || !verdict.status) return VERDICT.NONE;
  if (verdict.sha1 && sha1 && verdict.sha1 !== sha1) return VERDICT.REBUILT;
  return verdict.status;
}

export function verdictCounts(forms, verdicts) {
  const counts = { [VERDICT.NONE]: 0, [VERDICT.APPROVED]: 0, [VERDICT.CHANGES]: 0, [VERDICT.REBUILT]: 0 };
  for (const f of forms) counts[verdictStatus(verdicts[f.name], f.sha1)] += 1;
  return counts;
}
