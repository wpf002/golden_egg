import { useMemo } from "react";

/**
 * Tiny inline price history. Hand-rolled SVG — a charting library would be
 * orders of magnitude more bytes than a polyline.
 *
 * Data comes from the local daily-close cache (one shared request for the whole
 * page), so drawing these costs no API calls.
 */
export function Sparkline({
  closes,
  width = 68,
  height = 20,
}: {
  closes: { date: string; close: number }[];
  width?: number;
  height?: number;
}) {
  const path = useMemo(() => {
    if (closes.length < 2) return null;
    const values = closes.map((c) => c.close);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;
    // A flat series would divide by zero — draw it down the middle instead.
    const y = (v: number) => (span < 1e-9 ? height / 2 : height - ((v - min) / span) * height);
    const step = width / (values.length - 1);
    return values.map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  }, [closes, width, height]);

  if (!path) return null;

  const first = closes[0].close;
  const last = closes[closes.length - 1].close;
  const up = last >= first;
  const stroke = up ? "rgb(52 211 153)" : "rgb(251 113 133)"; // emerald-400 / rose-400

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      aria-hidden="true"
      data-testid="sparkline"
    >
      <polyline
        points={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
