import type { PieceMotif } from "../types";

/** Simplified, recognisable silhouettes for each piece, drawn in a 0..100 box. */
const PIECE_PATHS: Record<PieceMotif, string> = {
  pawn:
    "M50 18c-7 0-12 5-12 12 0 4 2 8 5 10-5 4-8 11-9 20h32c-1-9-4-16-9-20 3-2 5-6 5-10 0-7-5-12-12-12zM33 64h34c3 0 5 4 6 9 1 4 2 7 4 11H23c2-4 3-7 4-11 1-5 3-9 6-9z",
  knight:
    "M40 16c-2 5-2 7-6 11-6 6-12 12-12 24 0 5 3 8 7 8 2 0 3-1 5-3l2 3c-4 5-9 9-9 17h44c0-20-3-34-13-46-5-6-11-9-13-14-1-2-3-4-5-4-1 0-2 1-2 2 0 1 1 2 1 3-2 1-3 0-4-2 0 1 0 1 0 1zM36 40c0-2 1-3 3-3s3 1 3 3-1 3-3 3-3-1-3-3z",
  bishop:
    "M50 12c-3 0-5 2-5 5 0 2 1 4 3 5-6 5-12 14-12 24 0 7 4 12 9 14l-2 2c-2 2-3 4-3 6h20c0-2-1-4-3-6l-2-2c5-2 9-7 9-14 0-10-6-19-12-24 2-1 3-3 3-5 0-3-2-5-5-5zm-7 30h14l-7 9-7-9zM33 74h34c3 0 5 4 6 9H27c1-5 3-9 6-9z",
  rook:
    "M30 22v12h6v-6h6v6h6v-6h6v6h6v-12h-6v6h-6v-6h-6v6h-6v-6zM34 36c-1 12-2 22-4 30h40c-2-8-3-18-4-30zM28 70h44c3 0 5 4 6 9H22c1-5 3-9 6-9z",
  queen:
    "M22 28c-3 0-5 2-5 5s2 5 5 5c1 0 2 0 3-1l6 22h38l6-22c1 1 2 1 3 1 3 0 5-2 5-5s-2-5-5-5-5 2-5 5c0 1 0 1 0 2l-11 8 4-18c2-1 3-3 3-5 0-3-2-5-5-5s-5 2-5 5c0 2 1 4 3 5l-7 17-7-17c2-1 3-3 3-5 0-3-2-5-5-5s-5 2-5 5c0 2 1 4 3 5l4 18-11-8c0-1 0-1 0-2 0-3-2-5-5-5zM28 64h44c3 0 5 4 6 9H22c1-5 3-9 6-9z",
  king:
    "M50 8c-2 0-3 1-3 3v4h-4c-2 0-3 1-3 3s1 3 3 3h4v5c-9 1-16 8-16 17 0 7 4 12 9 14l-2 2c-2 2-3 4-3 6h32c0-2-1-4-3-6l-2-2c5-2 9-7 9-14 0-9-7-16-16-17v-5h4c2 0 3-1 3-3s-1-3-3-3h-4v-4c0-2-1-3-3-3zM33 74h34c3 0 5 4 6 9H27c1-5 3-9 6-9z",
};

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function darken(hex: string, amt: number) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v: number) => Math.max(0, Math.round(v * (1 - amt)));
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}

interface AvatarProps {
  accent: string;
  motif: PieceMotif;
  size?: number;
  imageUrl?: string | null;
  name?: string;
  /** A subtle ring; turn off for compact contexts. */
  ring?: boolean;
}

export function Avatar({ accent, motif, size = 96, imageUrl, name, ring = true }: AvatarProps) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name ? `${name} portrait` : "Character portrait"}
        width={size}
        height={size}
        style={{
          display: "block",
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          boxShadow: ring ? "inset 0 0 0 1.5px rgba(247,240,224,0.35)" : undefined,
        }}
      />
    );
  }

  const gid = `g-${motif}-${accent.replace("#", "")}`;
  const vid = `v-${motif}-${accent.replace("#", "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`${motif} portrait`}
      style={{ display: "block", borderRadius: "50%" }}
    >
      <defs>
        <radialGradient id={gid} cx="50%" cy="34%" r="78%">
          <stop offset="0%" stopColor={accent} />
          <stop offset="62%" stopColor={darken(accent, 0.34)} />
          <stop offset="100%" stopColor={darken(accent, 0.62)} />
        </radialGradient>
        <radialGradient id={vid} cx="50%" cy="38%" r="70%">
          <stop offset="60%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.45)" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="50" fill={`url(#${gid})`} />
      {/* soft light from top-left */}
      <ellipse cx="36" cy="30" rx="26" ry="20" fill="rgba(255,255,255,0.14)" />
      <path d={PIECE_PATHS[motif]} fill="rgba(247,240,224,0.92)" />
      <circle cx="50" cy="50" r="50" fill={`url(#${vid})`} />
      {ring && (
        <circle
          cx="50"
          cy="50"
          r="48"
          fill="none"
          stroke="rgba(247,240,224,0.35)"
          strokeWidth="1.5"
        />
      )}
    </svg>
  );
}
