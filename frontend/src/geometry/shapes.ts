// Same formulas as backend/app/geometry/shapes.py, pinned by shared/geometry_fixtures.json.
// The renderer and the 2D overlays use these functions so what is drawn is what is validated.

import type { Calibration, Opening, PlanPoint, Point, Room, SceneObject } from "../api/types";

export type Vec = [number, number];

const DEG = Math.PI / 180;

export function metresPerPixel(cal: Calibration): number {
  const px = Math.hypot(cal.b.u - cal.a.u, cal.b.v - cal.a.v);
  if (px < 1) throw new Error("calibration segment is too short");
  return cal.length_m / px;
}

export function planToWorld(p: PlanPoint, cal: Calibration): Point {
  const s = metresPerPixel(cal);
  return { x: p.u * s, y: p.v * s };
}

export function worldToPlan(p: Point, cal: Calibration): PlanPoint {
  const s = metresPerPixel(cal);
  return { u: p.x / s, v: p.y / s };
}

/** World (X right, Y down-plan) to Three.js (x, y up, z). */
export function worldToThree(x: number, y: number, elevation = 0): [number, number, number] {
  return [x, elevation, y];
}

/** Clockwise-from-above plan rotation to Three.js rotation about +Y (radians). */
export function rotationToThreeY(rotationDeg: number): number {
  return -rotationDeg * DEG;
}

export function rotate(v: Vec, rotationDeg: number): Vec {
  const a = rotationDeg * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
}

export function localToWorld(pos: Point, rotationDeg: number, local: Vec): Vec {
  const [rx, ry] = rotate(local, rotationDeg);
  return [pos.x + rx, pos.y + ry];
}

/** Corners: back-left, back-right, front-right, front-left (front = +Y local). */
export function rectCorners(pos: Point, rotationDeg: number, w: number, d: number, y0 = -d / 2, y1 = d / 2): Vec[] {
  const local: Vec[] = [
    [-w / 2, y0],
    [w / 2, y0],
    [w / 2, y1],
    [-w / 2, y1],
  ];
  return local.map((p) => localToWorld(pos, rotationDeg, p));
}

export function footprint(obj: Pick<SceneObject, "position" | "rotation_deg" | "size">): Vec[] {
  return rectCorners(obj.position, obj.rotation_deg, obj.size.w, obj.size.d);
}

export function signedArea(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += a.x * b.y - b.x * a.y;
  }
  return total / 2;
}

export interface EdgeFrame {
  start: Vec;
  dir: Vec;
  inward: Vec;
  length: number;
}

export function edgeFrame(room: Pick<Room, "polygon">, index: number): EdgeFrame {
  const pts = room.polygon;
  const a = pts[index % pts.length];
  const b = pts[(index + 1) % pts.length];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { start: [a.x, a.y], dir: [1, 0], inward: [0, 1], length: 0 };
  const ux = dx / length;
  const uy = dy / length;
  const inward: Vec = signedArea(pts) > 0 ? [-uy, ux] : [uy, -ux];
  return { start: [a.x, a.y], dir: [ux, uy], inward, length };
}

export function openingSegment(room: Pick<Room, "polygon">, op: Pick<Opening, "wall_index" | "offset_m" | "width_m">): [Vec, Vec] {
  const { start, dir } = edgeFrame(room, op.wall_index);
  const c0 = op.offset_m - op.width_m / 2;
  const c1 = op.offset_m + op.width_m / 2;
  return [
    [start[0] + dir[0] * c0, start[1] + dir[1] * c0],
    [start[0] + dir[0] * c1, start[1] + dir[1] * c1],
  ];
}

/** Quarter-circle swept by an inward-swinging door; null for other openings. */
export function doorSwing(room: Pick<Room, "polygon">, op: Opening, segments = 16): Vec[] | null {
  if (op.kind !== "door" || op.swing !== "in") return null;
  const [p0, p1] = openingSegment(room, op);
  const { inward } = edgeFrame(room, op.wall_index);
  const [hinge, free] = op.hinge === "start" ? [p0, p1] : [p1, p0];
  const r = op.width_m;
  const startAngle = Math.atan2(free[1] - hinge[1], free[0] - hinge[0]);
  const endAngle = Math.atan2(inward[1], inward[0]);
  const delta = ((((endAngle - startAngle + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const pts: Vec[] = [hinge];
  for (let i = 0; i <= segments; i++) {
    const ang = startAngle + (delta * i) / segments;
    pts.push([hinge[0] + r * Math.cos(ang), hinge[1] + r * Math.sin(ang)]);
  }
  return pts;
}

export function doorLeaf(room: Pick<Room, "polygon">, op: Opening): { hinge: Vec; angle: number } | null {
  if (op.kind !== "door" || op.swing === "none") return null;
  const [p0, p1] = openingSegment(room, op);
  const { inward } = edgeFrame(room, op.wall_index);
  const hinge = op.hinge === "start" ? p0 : p1;
  const n: Vec = op.swing === "in" ? inward : [-inward[0], -inward[1]];
  return { hinge, angle: Math.atan2(n[1], n[0]) };
}

export function bounds(points: Vec[]): [number, number, number, number] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function polygonCentroid(points: Point[]): Point {
  const a = signedArea(points);
  if (Math.abs(a) < 1e-9) {
    return { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(pt: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Separating-axis overlap test for two convex polygons (quick drag feedback only;
 *  the backend validator is authoritative). Returns true when interiors overlap. */
export function convexOverlap(a: Vec[], b: Vec[], eps = 1e-4): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = -(q[1] - p[1]);
      const ny = q[0] - p[0];
      const len = Math.hypot(nx, ny) || 1;
      const project = (pts: Vec[]) => pts.map((v) => (v[0] * nx + v[1] * ny) / len);
      const pa = project(a);
      const pb = project(b);
      if (Math.max(...pa) <= Math.min(...pb) + eps || Math.max(...pb) <= Math.min(...pa) + eps) return false;
    }
  }
  return true;
}

export function polygonInside(inner: Vec[], room: Vec[], tol = 0.005): boolean {
  // Corners inside (or within tolerance of) a simple room polygon; edges of a convex
  // footprint cannot leave a polygon without a corner leaving, except at concave
  // room corners, which the backend validator catches exactly.
  return inner.every((c) => pointInPolygon(c, room) || distanceToPolygon(c, room) <= tol);
}

export function distanceToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function distanceToPolygon(p: Vec, poly: Vec[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distanceToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

export function segmentsIntersect(p1: Vec, p2: Vec, p3: Vec, p4: Vec): boolean {
  const d = (a: Vec, b: Vec, c: Vec) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True if a closed polygon's edges cross (non-adjacent edges intersect). */
export function selfIntersects(points: Point[]): boolean {
  const n = points.length;
  const v = points.map((p) => [p.x, p.y] as Vec);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(v[i], v[(i + 1) % n], v[j], v[(j + 1) % n])) return true;
    }
  }
  return false;
}

export function areaOf(points: Point[]): number {
  return Math.abs(signedArea(points));
}
