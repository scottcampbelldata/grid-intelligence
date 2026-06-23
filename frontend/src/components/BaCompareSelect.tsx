"use client";

// Compact multi-select for comparing balancing authorities: selected BAs show
// as removable color-coded chips (the colors match their lines on the chart);
// an "Add" dropdown offers the remaining BAs until the cap is reached. Caps the
// number of simultaneous selections so the overlay never becomes spaghetti.
// Shared by the Demand and Forecast comparison views.

interface Props {
  options: string[]; // all selectable BA codes
  selected: string[]; // currently selected, in display order
  onChange: (next: string[]) => void;
  colorOf: (index: number) => string; // color for the chip at a given selection index
  max: number; // cap on simultaneous selections
  min?: number; // floor below which chips can't be removed (default 1)
  addLabel?: string;
}

export function BaCompareSelect({
  options,
  selected,
  onChange,
  colorOf,
  max,
  min = 1,
  addLabel = "Add BA",
}: Props) {
  const remaining = options.filter((o) => !selected.includes(o));
  const atMax = selected.length >= max;
  const canRemove = selected.length > min;

  function add(ba: string) {
    if (!ba || selected.includes(ba) || atMax) return;
    onChange([...selected, ba]);
  }
  function remove(ba: string) {
    if (!canRemove) return;
    onChange(selected.filter((b) => b !== ba));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {selected.map((ba, i) => (
        <span
          key={ba}
          className="inline-flex items-center gap-1.5 rounded border border-border bg-surface py-1 pl-2 pr-1 text-sm text-text"
        >
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-[1px]"
            style={{ backgroundColor: colorOf(i) }}
          />
          {ba}
          <button
            type="button"
            onClick={() => remove(ba)}
            disabled={!canRemove}
            aria-label={`Remove ${ba}`}
            className="ml-0.5 rounded px-1 text-muted transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
          >
            ×
          </button>
        </span>
      ))}

      {!atMax && remaining.length > 0 && (
        <select
          // Controlled to a sentinel so it always shows the placeholder and fires
          // onChange even when the same BA is picked twice across interactions.
          value=""
          onChange={(e) => add(e.target.value)}
          aria-label={addLabel}
          className="rounded border border-border bg-surface px-2.5 py-1.5 text-sm text-muted outline-none transition-colors hover:border-muted focus:border-accent"
        >
          <option value="" disabled>
            + {addLabel}
          </option>
          {remaining.map((b) => (
            <option key={b} value={b} className="text-text">
              {b}
            </option>
          ))}
        </select>
      )}

      <span className="text-xs text-muted">
        {selected.length}/{max}
      </span>
    </div>
  );
}
