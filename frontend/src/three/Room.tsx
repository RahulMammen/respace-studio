// Floors, walls with real openings, door leaves, windows, ceilings.
// Openings come from the same openingSegment/doorLeaf formulas the validator uses.
import { memo, useMemo } from "react";
import * as THREE from "three";
import type { MaterialInfo, Room, RoomFinish } from "../api/types";
import { materialTexture } from "../catalog/materials";
import { doorLeaf, edgeFrame, signedArea } from "../geometry/shapes";

export type WallMode = "full" | "cutaway" | "low" | "hidden";

interface Props {
  room: Room;
  finish: RoomFinish | undefined;
  materials: Record<string, MaterialInfo>;
  wallMode: WallMode;
  ceiling: boolean;
  lowQuality: boolean;
  cameraPos: THREE.Vector3 | null;
  planStyle?: boolean;
}

const glass = new THREE.MeshPhysicalMaterial({ color: "#dfe9ea", roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
const frameMat = new THREE.MeshStandardMaterial({ color: "#efebe4", roughness: 0.6 });
const doorMat = new THREE.MeshStandardMaterial({ color: "#e9e4da", roughness: 0.7 });
const skirting = new THREE.MeshStandardMaterial({ color: "#e6e0d5", roughness: 0.7 });

export const RoomMesh = memo(function RoomMesh({ room, finish, materials, wallMode, ceiling, lowQuality, cameraPos, planStyle }: Props) {
  const floorMat = useMemo(() => {
    const f = finish?.floor ?? { material: "oak", color: "#c9a27a" };
    const info = materials[f.material] ?? { kind: "wood", color: f.color, roughness: 0.6, label: f.material };
    const tex = lowQuality ? null : materialTexture(info, f.color, 1);
    if (tex) {
      tex.repeat.set(1 / 1.2, 1 / 1.2); // one texture tile per 1.2 m
    }
    // rotateX(+90deg) leaves the face normal pointing down; render both sides.
    return new THREE.MeshStandardMaterial({ color: tex ? "#ffffff" : f.color, map: tex, roughness: info.roughness, side: THREE.DoubleSide });
  }, [finish, materials, lowQuality]);

  const wallMat = useMemo(() => {
    // Plan view draws walls as solid poché, as on an architectural plan.
    if (planStyle) return new THREE.MeshBasicMaterial({ color: "#2b2a28" });
    const f = finish?.walls ?? { material: "plaster", color: "#efe9df" };
    return new THREE.MeshStandardMaterial({ color: f.color, roughness: 0.92, side: THREE.DoubleSide });
  }, [finish, planStyle]);

  const floorGeom = useMemo(() => {
    const shape = new THREE.Shape(room.polygon.map((p) => new THREE.Vector2(p.x, p.y)));
    const g = new THREE.ShapeGeometry(shape);
    // shape lies in XY; rotate so plan Y maps to three Z (x stays x)
    g.rotateX(Math.PI / 2);
    // UVs in metres for consistent texture scale
    const pos = g.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i);
      uv[i * 2 + 1] = pos.getZ(i);
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    return g;
  }, [room.polygon]);

  const ccw = signedArea(room.polygon) > 0;
  const H = room.wall_height_m;
  const t = room.wall_thickness_m;
  const wallHeight = wallMode === "full" ? H : wallMode === "low" ? Math.min(1.0, H) : wallMode === "hidden" ? 0.08 : H;

  return (
    <group>
      <mesh geometry={floorGeom} material={floorMat} receiveShadow position={[0, 0.0005, 0]} />
      {room.polygon.map((_, i) => {
        const f = edgeFrame(room, i);
        if (f.length === 0) return null;
        // cutaway: lower walls whose outside faces the camera
        let h = wallHeight;
        if (wallMode === "cutaway" && cameraPos) {
          const mid = [f.start[0] + (f.dir[0] * f.length) / 2, f.start[1] + (f.dir[1] * f.length) / 2];
          const toCam = [cameraPos.x - mid[0], cameraPos.z - mid[1]];
          const outward = [-f.inward[0], -f.inward[1]];
          if (toCam[0] * outward[0] + toCam[1] * outward[1] > 0) h = Math.min(0.32, H);
        }
        const n = room.polygon.length;
        const prev = edgeFrame(room, (i - 1 + n) % n);
        const next = edgeFrame(room, (i + 1) % n);
        const convex = (a: typeof f, b: typeof f) => {
          const cross = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
          return ccw ? cross > 0 : cross < 0;
        };
        const extStart = convex(prev, f) ? t : 0;
        const extEnd = convex(f, next) ? t : 0;
        return (
          <Wall key={i} room={room} index={i} height={h} fullHeight={H} thickness={t} extStart={extStart} extEnd={extEnd} mat={wallMat} />
        );
      })}
      {ceiling && (
        <mesh geometry={floorGeom} position={[0, H, 0]} rotation={[0, 0, 0]}>
          <meshStandardMaterial color="#f6f3ee" side={THREE.FrontSide} roughness={0.95} />
        </mesh>
      )}
    </group>
  );
});

function Wall({ room, index, height, fullHeight, thickness, extStart, extEnd, mat }: { room: Room; index: number; height: number; fullHeight: number; thickness: number; extStart: number; extEnd: number; mat: THREE.Material }) {
  const f = edgeFrame(room, index);
  const angle = Math.atan2(f.dir[1], f.dir[0]);
  const openings = room.openings.filter((o) => o.wall_index === index).map((o) => ({ o, s: o.offset_m - o.width_m / 2, e: o.offset_m + o.width_m / 2 })).sort((a, b) => a.s - b.s);
  // pieces along the wall in local edge coordinates (0..length), wall centred t/2 outside the face
  const pieces: { a: number; b: number; y0: number; y1: number }[] = [];
  let cursor = -extStart;
  for (const { o, s, e } of openings) {
    if (s > cursor) pieces.push({ a: cursor, b: s, y0: 0, y1: height });
    const top = o.kind === "window" ? o.sill_m + o.height_m : o.height_m;
    if (height > top) pieces.push({ a: s, b: e, y0: top, y1: height });
    if (o.kind === "window" && o.sill_m > 0) pieces.push({ a: s, b: e, y0: 0, y1: Math.min(o.sill_m, height) });
    cursor = Math.max(cursor, e);
  }
  if (cursor < f.length + extEnd) pieces.push({ a: cursor, b: f.length + extEnd, y0: 0, y1: height });
  const out = -thickness / 2;
  return (
    <group position={[f.start[0], 0, f.start[1]]} rotation={[0, -angle, 0]}>
      {pieces
        .filter((p) => p.b - p.a > 1e-4 && p.y1 - p.y0 > 1e-4)
        .map((p, k) => (
          <mesh key={k} position={[(p.a + p.b) / 2, (p.y0 + p.y1) / 2, signZ(room, out, f)]} material={mat} castShadow receiveShadow>
            <boxGeometry args={[p.b - p.a, p.y1 - p.y0, thickness]} />
          </mesh>
        ))}
      {height > 0.2 && (
        <mesh position={[f.length / 2, 0.04, signZ(room, 0.006, f)]} material={skirting}>
          <boxGeometry args={[f.length, 0.08, 0.012]} />
        </mesh>
      )}
      {openings.map(({ o, s, e }) => {
        if (o.kind === "window") {
          const y0 = o.sill_m;
          const y1 = Math.min(o.sill_m + o.height_m, fullHeight);
          if (y0 >= height) return null;
          return (
            <group key={o.id}>
              <mesh position={[(s + e) / 2, (y0 + Math.min(y1, height)) / 2, signZ(room, out, f)]} material={glass}>
                <boxGeometry args={[e - s, Math.min(y1, height) - y0, 0.01]} />
              </mesh>
              <mesh position={[(s + e) / 2, y0 + 0.02, signZ(room, out * 0.2, f)]} material={frameMat}>
                <boxGeometry args={[e - s + 0.04, 0.04, thickness * 0.6 + 0.04]} />
              </mesh>
            </group>
          );
        }
        return null;
      })}
      {height >= 1.2 &&
        openings
          .filter(({ o }) => o.kind === "door")
          .map(({ o }) => <DoorLeafMesh key={o.id} room={room} openingId={o.id} edgeAngle={angle} origin={f.start} />)}
    </group>
  );
}

/** Wall pieces sit on the outside of the interior face: local -z is outward when we
 *  orient each wall by rotation -angle about Y (three z = plan y). */
function signZ(room: Room, value: number, f: ReturnType<typeof edgeFrame>): number {
  // In the rotated frame, local +z maps to plan direction (-dir.y, dir.x) rotated... compute directly:
  const localZ: [number, number] = [-f.dir[1], f.dir[0]];
  const inwardDot = localZ[0] * f.inward[0] + localZ[1] * f.inward[1];
  void room;
  return inwardDot > 0 ? value : -value;
}

function DoorLeafMesh({ room, openingId, edgeAngle, origin }: { room: Room; openingId: string; edgeAngle: number; origin: [number, number] }) {
  const op = room.openings.find((o) => o.id === openingId)!;
  const leaf = doorLeaf(room, op);
  if (!leaf) return null;
  // leaf is drawn fully open (90°), exactly along the edge of the validated swing sector
  const local = toLocal(leaf.hinge, origin, edgeAngle);
  const a = leaf.angle - edgeAngle;
  const w = op.width_m;
  return (
    <group position={[local[0], 0, local[1]]} rotation={[0, -a, 0]}>
      <mesh position={[w / 2, op.height_m / 2, 0]} material={doorMat} castShadow>
        <boxGeometry args={[w - 0.02, op.height_m - 0.02, 0.04]} />
      </mesh>
    </group>
  );
}

function toLocal(p: [number, number], origin: [number, number], angle: number): [number, number] {
  const dx = p[0] - origin[0];
  const dy = p[1] - origin[1];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [dx * c + dy * s, -dx * s + dy * c];
}
