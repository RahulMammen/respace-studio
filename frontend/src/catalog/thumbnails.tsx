// Hand-drawn isometric line thumbnails for each furniture category (original artwork).
import type { Category } from "../api/types";

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
const F = { fill: "var(--thumb-fill, #e9e3d8)", stroke: "currentColor", strokeWidth: 1.4, strokeLinejoin: "round" as const };

function Sofa() {
  return (
    <g>
      <path {...F} d="M8 26 L24 18 L42 26 L26 34 Z" />
      <path {...F} d="M8 26 L8 32 L26 40 L26 34 Z" />
      <path {...F} d="M26 34 L26 40 L42 32 L42 26 Z" />
      <path {...F} d="M24 18 L24 11 L42 19 L42 26 Z" />
      <path {...S} d="M17 22 L33 30 M14 29 L14 34" />
      <path {...F} d="M8 26 L8 21 L12 19 L12 24" />
    </g>
  );
}
function Armchair() {
  return (
    <g>
      <path {...F} d="M14 27 L24 22 L35 27 L25 32 Z" />
      <path {...F} d="M14 27 L14 32 L25 37 L25 32 Z" />
      <path {...F} d="M25 32 L25 37 L35 32 L35 27 Z" />
      <path {...F} d="M24 22 L24 13 L35 18 L35 27 Z" />
      <path {...S} d="M15 33 L15 39 M25 37 L25 42 M34 32 L34 38" />
    </g>
  );
}
function Table() {
  return (
    <g>
      <path {...F} d="M8 22 L26 14 L42 22 L24 30 Z" />
      <path {...F} d="M8 22 L8 24 L24 32 L24 30 Z M24 30 L24 32 L42 24 L42 22 Z" />
      <path {...S} d="M11 25 L11 37 M24 32 L24 42 M39 25 L39 36 M26 17 L26 27" />
    </g>
  );
}
function DiningChair() {
  return (
    <g>
      <path {...F} d="M16 28 L24 24 L32 28 L24 32 Z" />
      <path {...F} d="M24 24 L24 10 L32 14 L32 28" />
      <path {...S} d="M16 28 L16 40 M24 32 L24 43 M32 28 L32 40" />
    </g>
  );
}
function Desk() {
  return (
    <g>
      <path {...F} d="M7 21 L27 12 L42 19 L22 28 Z" />
      <path {...F} d="M7 21 L7 23 L22 30 L22 28 Z M22 28 L22 30 L42 21 L42 19 Z" />
      <path {...F} d="M30 22 L30 34 L39 30 L39 23" />
      <path {...S} d="M9 24 L9 37 M22 30 L22 41" />
    </g>
  );
}
function Bed() {
  return (
    <g>
      <path {...F} d="M6 25 L24 16 L43 25 L25 34 Z" />
      <path {...F} d="M6 25 L6 30 L25 39 L25 34 Z M25 34 L25 39 L43 30 L43 25 Z" />
      <path {...F} d="M24 16 L24 8 L43 17 L43 25" />
      <path {...F} d="M24 18 L30 15 L36 18 L30 21 Z" />
      <path {...S} d="M13 25 L30 33" />
    </g>
  );
}
function Wardrobe() {
  return (
    <g>
      <path {...F} d="M12 12 L26 6 L38 12 L24 18 Z" />
      <path {...F} d="M12 12 L12 38 L24 44 L24 18 Z" />
      <path {...F} d="M24 18 L24 44 L38 38 L38 12 Z" />
      <path {...S} d="M18 15 L18 41 M21 27 L21 30" />
    </g>
  );
}
function Bookshelf() {
  return (
    <g>
      <path {...F} d="M12 10 L30 4 L38 8 L20 14 Z" />
      <path {...F} d="M20 14 L20 44 L38 38 L38 8 Z" />
      <path {...F} d="M12 10 L12 40 L20 44 L20 14 Z" />
      <path {...S} d="M20 22 L38 16 M20 30 L38 24 M20 38 L38 32" />
      <path {...S} d="M24 21 L24 17 M27 20 L27 15 M30 27 L30 22 M33 26 L33 21" />
    </g>
  );
}
function Rug() {
  return (
    <g>
      <path {...F} d="M5 26 L24 16 L43 26 L24 36 Z" />
      <path {...S} d="M10 26 L24 19 L38 26 L24 33 Z" strokeDasharray="2 2" />
    </g>
  );
}
function Lamp() {
  return (
    <g>
      <path {...F} d="M17 10 L31 10 L35 20 L13 20 Z" />
      <path {...S} d="M24 20 L24 40 M17 41 L31 41" />
      <path d="M24 24 L24 24" stroke="var(--accent)" strokeWidth={6} strokeLinecap="round" opacity={0.35} />
    </g>
  );
}
function WallArt() {
  return (
    <g>
      <path {...F} d="M11 10 L37 6 L37 34 L11 38 Z" />
      <path {...S} d="M14 31 L22 22 L27 27 L31 23 L35 28" />
      <circle cx={30} cy={13} r={2.3} {...S} />
    </g>
  );
}

const MAP: Record<Category, () => React.JSX.Element> = {
  sofa: Sofa,
  armchair: Armchair,
  table: Table,
  dining_chair: DiningChair,
  desk: Desk,
  bed: Bed,
  wardrobe: Wardrobe,
  bookshelf: Bookshelf,
  rug: Rug,
  lamp: Lamp,
  wall_art: WallArt,
};

export function Thumbnail({ category, size = 48, title }: { category: Category; size?: number; title?: string }) {
  const Art = MAP[category];
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} role="img" aria-label={title ?? category} className="thumb">
      <Art />
    </svg>
  );
}
