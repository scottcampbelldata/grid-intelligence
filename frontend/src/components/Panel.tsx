import type { ReactNode } from "react";

interface Props {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, right, children, className = "" }: Props) {
  return (
    <section
      className={`rounded-sm border border-border bg-surface ${className}`}
    >
      {(title || right) && (
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
          {title && <h2 className="panel-title">{title}</h2>}
          {right && <div className="text-sm text-muted">{right}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
