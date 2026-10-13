import {
  normalizeFormat,
  FORMAT_CATEGORIES,
  SEPARATOR_STYLES,
  CURRENCY_SYMBOLS,
  MAX_DECIMALS,
  DATE_PATTERN,
  CUSTOM,
} from '../core/fieldFormat.js';

const LABEL = 'block text-xs font-medium text-slate-600';
const SELECT =
  'mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500';
const CHECK = 'h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500';

const DECIMALS = Array.from({ length: MAX_DECIMALS + 1 }, (_, n) => n);

// Acrobat's Format tab with the choices cut down. Custom is only ever read off a
// form, so it shows while a field carries it and cannot be picked back.
export default function FormatEditor({ format, onChange }) {
  const set = (patch) => onChange(normalizeFormat({ ...format, ...patch }));

  return (
    <div>
      <label className={LABEL}>Format</label>
      <select
        className={SELECT}
        value={format.category}
        onChange={(e) => onChange(normalizeFormat({ category: e.target.value }))}
      >
        {FORMAT_CATEGORIES.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
        {format.category === CUSTOM && (
          <option value={CUSTOM} disabled>
            Custom
          </option>
        )}
      </select>

      {format.category === 'date' && (
        <p className="mt-1 font-mono text-xs text-slate-600">{DATE_PATTERN}</p>
      )}

      {(format.category === 'number' || format.category === 'percent') && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label className={LABEL}>Decimal Places</label>
            <select
              className={SELECT}
              value={format.decimals}
              onChange={(e) => set({ decimals: Number(e.target.value) })}
            >
              {DECIMALS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL}>Separator Style</label>
            <select
              className={SELECT}
              value={format.separator}
              onChange={(e) => set({ separator: e.target.value })}
            >
              {SEPARATOR_STYLES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {format.category === 'number' && (
          <>
          <div className="col-span-2">
            <label className={LABEL}>Currency Symbol</label>
            <select
              className={SELECT}
              value={format.currency}
              onChange={(e) => set({ currency: e.target.value })}
            >
              {CURRENCY_SYMBOLS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={LABEL}>Negative Number Style</label>
            <div className="mt-1 flex gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className={CHECK}
                  checked={format.parentheses}
                  onChange={(e) => set({ parentheses: e.target.checked })}
                />
                Show parentheses
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className={CHECK}
                  checked={format.redText}
                  onChange={(e) => set({ redText: e.target.checked })}
                />
                Use red text
              </label>
            </div>
          </div>
          </>
          )}
        </div>
      )}
    </div>
  );
}
