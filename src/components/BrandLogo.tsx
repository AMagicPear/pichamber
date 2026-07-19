import type { CSSProperties } from "react";

interface Props {
  size?: number;
  className?: string;
  style?: CSSProperties;
  animated?: boolean;
}

export function BrandLogo({ size = 88, className, style, animated = false }: Props) {
  const s = size;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 96 96"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden
    >
      <defs>
        <linearGradient id="pc-face-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="pc-face-left" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id="pc-face-right" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      {/* Left face */}
      <polygon
        points="12,52 44,32 44,80 12,100"
        fill="url(#pc-face-left)"
      />
      {/* Right face */}
      <polygon
        points="44,32 84,52 84,100 44,80"
        fill="url(#pc-face-right)"
      />
      {/* Top face */}
      <polygon
        points="12,52 44,32 84,52 44,72"
        fill="url(#pc-face-top)"
      />
      {/* Isometric grid lines on the top face */}
      <g
        stroke="var(--surface-raised)"
        strokeOpacity={animated ? 0.7 : 0.45}
        strokeWidth={0.8}
      >
        <line x1="22" y1="49" x2="50" y2="40" />
        <line x1="32" y1="46" x2="60" y2="36" />
        <line x1="22" y1="58" x2="50" y2="48" />
        <line x1="32" y1="55" x2="60" y2="45" />
        <line x1="22" y1="68" x2="50" y2="58" />
        <line x1="32" y1="65" x2="60" y2="55" />
        <line x1="44" y1="32" x2="44" y2="72" />
        <line x1="62" y1="40" x2="62" y2="80" />
        <line x1="84" y1="52" x2="84" y2="100" />
        <line x1="44" y1="32" x2="84" y2="52" />
        <line x1="44" y1="72" x2="84" y2="100" />
        <line x1="12" y1="52" x2="44" y2="72" />
      </g>
    </svg>
  );
}

export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size, fontSize: size * 0.7 }}>
      π
    </span>
  );
}