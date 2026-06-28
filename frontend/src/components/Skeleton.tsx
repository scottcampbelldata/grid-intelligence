import type { CSSProperties } from "react";

// A single loading-skeleton block. Sized by the caller via className (width /
// height) or an inline style for dynamic dimensions. The `.skeleton` utility
// (globals.css) does the gradient sweep and honors prefers-reduced-motion.
// aria-hidden so screen readers skip the decorative placeholder - the
// surrounding region announces "Loading" instead.
export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return <span aria-hidden style={style} className={`skeleton block ${className}`} />;
}
