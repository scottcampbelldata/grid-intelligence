"use client";

import { useMemo, useState, type ReactNode } from "react";

// Reusable executive-style table: muted uppercase headers, hairline dividers,
// row hover, right-aligned numeric columns. Columns that supply `sortValue`
// become clickable to sort; sorting is handled internally. Used by Interchange,
// Anomalies, Weather, and Operations.
export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  /** extra classes on the cell (e.g. font-mono for numbers) */
  cellClassName?: string;
  /** if provided, the column is sortable by this value */
  sortValue?: (row: T) => number | string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  /** initial sort; omit to keep the rows in the order given */
  initialSort?: { key: string; dir: "asc" | "desc" };
}

export function DataTable<T>({ columns, rows, rowKey, initialSort }: Props<T>) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    initialSort ?? null,
  );

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av < bv) return -1 * factor;
      if (av > bv) return 1 * factor;
      return 0;
    });
  }, [rows, sort, columns]);

  function toggleSort(key: string) {
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => {
              const sortable = Boolean(c.sortValue);
              const isActive = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  onClick={sortable ? () => toggleSort(c.key) : undefined}
                  className={`whitespace-nowrap px-3 py-2 text-xs font-normal uppercase tracking-[0.08em] ${
                    c.align === "right" ? "text-right" : "text-left"
                  } ${
                    sortable
                      ? "cursor-pointer select-none text-muted hover:text-text"
                      : "text-muted"
                  }`}
                >
                  {c.header}
                  {isActive && <span className="ml-1 text-accent">{sort?.dir === "asc" ? "▲" : "▼"}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-hover"
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`whitespace-nowrap px-3 py-2 ${
                    c.align === "right" ? "text-right" : "text-left"
                  } ${c.cellClassName ?? ""}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
