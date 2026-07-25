import { useId } from 'react';

// Single-series sparkline: a 2px line over a soft gradient area. Stretches to
// its container width (preserveAspectRatio="none") while the stroke stays 2px
// via vector-effect, so it reads the same at any width. No axes/legend — it's a
// glance metric; the big number beside it carries the current value.
export function Sparkline({
  data,
  color = '#34D399',
  height = 40,
  className,
}: {
  data: number[];
  color?: string;
  height?: number;
  className?: string;
}) {
  const id = useId();
  const W = 100;
  const H = height;

  if (data.length < 2) {
    // Not enough samples yet — a flat baseline so the card doesn't jump.
    return (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} height={H}>
        <line
          x1="0"
          y1={H - 1}
          x2={W}
          y2={H - 1}
          stroke={color}
          strokeOpacity="0.25"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  const max = Math.max(...data, 1e-6);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pad = 3; // keep the peak off the top edge

  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = pad + (1 - (v - min) / range) * (H - pad * 2);
    return [x, y] as const;
  });

  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} height={H}>
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
