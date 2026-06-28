// A tiny, dependency-free trend line for KPI cards - the terminal vernacular of
// a headline number carrying its own recent shape. Pure SVG: no axes, no labels,
// no interaction; the card's number is the datum, this is the glance. A flat
// low-opacity fill and a dot on the latest point echo the main demand chart.
// Decorative, so aria-hidden - screen readers get the number, not the squiggle.

interface Props {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

export function Sparkline({
  values,
  width = 76,
  height = 28,
  color = "#4f8bf5",
  className = "",
}: Props) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  // Inset by the stroke so the line never clips at the edges.
  const pad = 1.5;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const pt = (v: number, i: number) => {
    const x = pad + (i / (clean.length - 1)) * w;
    const y = pad + (1 - (v - min) / span) * h;
    return [x, y] as const;
  };

  const pts = clean.map(pt);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = pts[pts.length - 1];
  const area = `${pad},${height - pad} ${line} ${(width - pad).toFixed(1)},${height - pad}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
      preserveAspectRatio="none"
    >
      <polygon points={area} fill={color} fillOpacity={0.08} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={1.8} fill={color} />
    </svg>
  );
}
