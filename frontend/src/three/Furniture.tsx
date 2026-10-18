// Procedural furniture. Every model is built inside its declared bounding box:
// local x in [-w/2, w/2], local z in [-d/2, d/2] (front = +z), y in [0, h].
// The group is placed with the same transform the validator uses, so the
// visible footprint equals the validated footprint (see shapes.test.ts).
import { memo, useMemo } from "react";
import * as THREE from "three";
import { RoundedBox } from "@react-three/drei";
import type { MaterialInfo, SceneObject } from "../api/types";
import { materialTexture } from "../catalog/materials";
import { rotationToThreeY, worldToThree } from "../geometry/shapes";

export interface FurnitureProps {
  obj: SceneObject;
  materials: Record<string, MaterialInfo>;
  lowQuality: boolean;
  lampColor: string;
  lampsOn: boolean;
  ghost?: boolean;
}

function useMat(materials: Record<string, MaterialInfo>, material: string, color: string, lowQuality: boolean, ghost?: boolean, repeat = 1) {
  return useMemo(() => {
    const info = materials[material] ?? { kind: "paint", color, roughness: 0.8, label: material };
    const map = lowQuality ? null : materialTexture(info, color, repeat);
    const m = new THREE.MeshStandardMaterial({
      color: map ? "#ffffff" : color,
      map,
      roughness: info.roughness,
      metalness: info.kind === "metal" ? 0.75 : 0,
      transparent: ghost || info.kind === "glass",
      opacity: ghost ? 0.28 : info.kind === "glass" ? 0.45 : 1,
      depthWrite: !ghost,
    });
    return m;
  }, [materials, material, color, lowQuality, ghost, repeat]);
}

const dark = new THREE.MeshStandardMaterial({ color: "#2f2c28", roughness: 0.5, metalness: 0.2 });
const linen = new THREE.MeshStandardMaterial({ color: "#f3efe7", roughness: 0.95 });

function Box({ size, pos, mat, radius = 0, cast = true, low }: { size: [number, number, number]; pos: [number, number, number]; mat: THREE.Material; radius?: number; cast?: boolean; low: boolean }) {
  const [w, h, d] = size;
  if (radius > 0 && !low) {
    const r = Math.min(radius, w / 2.01, h / 2.01, d / 2.01);
    return <RoundedBox args={[w, h, d]} radius={r} smoothness={3} position={pos} material={mat} castShadow={cast} receiveShadow />;
  }
  return (
    <mesh position={pos} material={mat} castShadow={cast} receiveShadow>
      <boxGeometry args={size} />
    </mesh>
  );
}

function Legs({ w, d, h, inset, r, mat, low }: { w: number; d: number; h: number; inset: number; r: number; mat: THREE.Material; low: boolean }) {
  const pts: [number, number][] = [
    [-w / 2 + inset, -d / 2 + inset],
    [w / 2 - inset, -d / 2 + inset],
    [w / 2 - inset, d / 2 - inset],
    [-w / 2 + inset, d / 2 - inset],
  ];
  return (
    <>
      {pts.map(([x, z], i) => (
        <mesh key={i} position={[x, h / 2, z]} material={mat} castShadow>
          <cylinderGeometry args={[r, r * 0.8, h, low ? 6 : 12]} />
        </mesh>
      ))}
    </>
  );
}

export const Furniture = memo(function Furniture({ obj, materials, lowQuality: low, lampColor, lampsOn, ghost }: FurnitureProps) {
  const { w, d, h } = obj.size;
  const main = useMat(materials, obj.finish.material, obj.finish.color, low, ghost, Math.max(1, Math.round(Math.max(w, d))));
  const accent = useMat(materials, obj.accent?.material ?? "oak", obj.accent?.color ?? "#b08d57", low, ghost);
  const wood = useMat(materials, ["oak", "walnut", "ash", "pale_oak"].includes(obj.finish.material) ? obj.finish.material : "oak", "#a58360", low, ghost);
  const [x, , z] = worldToThree(obj.position.x, obj.position.y);
  const rotY = rotationToThreeY(obj.rotation_deg);
  const body = useMemo(() => buildBody(obj, main, accent, wood, low, lampColor, lampsOn), [obj, main, accent, wood, low, lampColor, lampsOn]);
  return (
    <group position={[x, obj.elevation_m, z]} rotation={[0, rotY, 0]} userData={{ objectId: obj.id }} name={obj.id}>
      {body}
      {/* invisible exact bounding box used for picking */}
      <mesh position={[0, h / 2, 0]} userData={{ objectId: obj.id, pick: true }} visible={false}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
    </group>
  );
});

function buildBody(o: SceneObject, main: THREE.Material, accent: THREE.Material, wood: THREE.Material, low: boolean, lampColor: string, lampsOn: boolean) {
  const { w, d, h } = o.size;
  switch (o.category) {
    case "sofa": {
      const legH = Math.min(0.1, h * 0.12);
      const seatH = Math.min(0.45, h * 0.55);
      const arm = Math.min(0.2, w * 0.1);
      const backD = Math.min(0.22, d * 0.26);
      const corner = o.variant === "corner";
      const seatD = corner ? Math.min(0.95, d) : d;
      return (
        <group>
          <Legs w={w} d={seatD} h={legH} inset={0.06} r={0.02} mat={dark} low={low} />
          <Box low={low} size={[w, seatH - legH, seatD]} pos={[0, legH + (seatH - legH) / 2, -d / 2 + seatD / 2]} mat={main} radius={0.05} />
          {corner && <Box low={low} size={[Math.min(0.95, w * 0.4), seatH - legH, d - seatD]} pos={[w / 2 - Math.min(0.95, w * 0.4) / 2, legH + (seatH - legH) / 2, -d / 2 + seatD + (d - seatD) / 2]} mat={main} radius={0.05} />}
          <Box low={low} size={[w, h - legH, backD]} pos={[0, legH + (h - legH) / 2, -d / 2 + backD / 2]} mat={main} radius={0.06} />
          <Box low={low} size={[arm, h * 0.78 - legH, seatD]} pos={[-w / 2 + arm / 2, legH + (h * 0.78 - legH) / 2, -d / 2 + seatD / 2]} mat={main} radius={0.05} />
          {!corner && <Box low={low} size={[arm, h * 0.78 - legH, seatD]} pos={[w / 2 - arm / 2, legH + (h * 0.78 - legH) / 2, -d / 2 + seatD / 2]} mat={main} radius={0.05} />}
          {[...Array(Math.max(2, Math.round((w - 2 * arm) / 0.75)))].map((_, i, arr) => {
            const cw = (w - 2 * arm) / arr.length;
            return <Box key={i} low={low} size={[cw - 0.02, 0.14, seatD - backD - 0.04]} pos={[-w / 2 + arm + cw * (i + 0.5), seatH + 0.05, -d / 2 + backD + (seatD - backD) / 2]} mat={main} radius={0.05} />;
          })}
        </group>
      );
    }
    case "armchair": {
      const slim = o.variant === "slim";
      const legH = slim ? 0.18 : 0.08;
      const seatH = 0.42;
      const arm = slim ? 0.05 : Math.min(0.16, w * 0.18);
      const backD = Math.min(0.18, d * 0.24);
      return (
        <group>
          <Legs w={w} d={d} h={legH} inset={0.05} r={slim ? 0.015 : 0.02} mat={slim ? wood : dark} low={low} />
          <Box low={low} size={[w, seatH - legH, d]} pos={[0, legH + (seatH - legH) / 2, 0]} mat={main} radius={0.05} />
          <Box low={low} size={[w, h - legH, backD]} pos={[0, legH + (h - legH) / 2, -d / 2 + backD / 2]} mat={main} radius={0.06} />
          <Box low={low} size={[arm, Math.min(h, 0.62) - legH, d]} pos={[-w / 2 + arm / 2, legH + (Math.min(h, 0.62) - legH) / 2, 0]} mat={slim ? wood : main} radius={0.03} />
          <Box low={low} size={[arm, Math.min(h, 0.62) - legH, d]} pos={[w / 2 - arm / 2, legH + (Math.min(h, 0.62) - legH) / 2, 0]} mat={slim ? wood : main} radius={0.03} />
          <Box low={low} size={[w - 2 * arm - 0.02, 0.1, d - backD - 0.03]} pos={[0, seatH + 0.04, backD / 2]} mat={main} radius={0.04} />
        </group>
      );
    }
    case "table": {
      const top = Math.min(0.045, h * 0.12);
      const round = o.variant === "round_dining" || o.variant === "side";
      return (
        <group>
          {round ? (
            <mesh position={[0, h - top / 2, 0]} scale={[w, 1, d]} material={main} castShadow receiveShadow>
              <cylinderGeometry args={[0.5, 0.5, top, low ? 16 : 48]} />
            </mesh>
          ) : (
            <Box low={low} size={[w, top, d]} pos={[0, h - top / 2, 0]} mat={main} radius={0.012} />
          )}
          {round ? (
            <>
              <mesh position={[0, (h - top) / 2, 0]} material={wood} castShadow>
                <cylinderGeometry args={[0.04, 0.05, h - top, low ? 8 : 16]} />
              </mesh>
              <mesh position={[0, 0.015, 0]} scale={[Math.min(w, d) * 0.55, 1, Math.min(w, d) * 0.55]} material={wood} castShadow>
                <cylinderGeometry args={[0.5, 0.5, 0.03, low ? 12 : 32]} />
              </mesh>
            </>
          ) : (
            <Legs w={w} d={d} h={h - top} inset={0.06} r={o.variant === "coffee" ? 0.025 : 0.03} mat={wood} low={low} />
          )}
          {o.variant === "coffee" && <Box low={low} size={[w * 0.86, 0.02, d * 0.8]} pos={[0, h * 0.28, 0]} mat={wood} />}
        </group>
      );
    }
    case "dining_chair": {
      const seatH = Math.min(0.46, h * 0.56);
      return (
        <group>
          <Legs w={w} d={d} h={seatH - 0.04} inset={0.03} r={0.016} mat={wood} low={low} />
          <Box low={low} size={[w, 0.05, d]} pos={[0, seatH - 0.02, 0]} mat={main} radius={0.02} />
          <Box low={low} size={[w, h - seatH, 0.04]} pos={[0, seatH + (h - seatH) / 2, -d / 2 + 0.02]} mat={main} radius={0.015} />
        </group>
      );
    }
    case "desk": {
      const top = 0.035;
      return (
        <group>
          <Box low={low} size={[w, top, d]} pos={[0, h - top / 2, 0]} mat={main} radius={0.01} />
          <Legs w={w} d={d} h={h - top} inset={0.04} r={0.02} mat={dark} low={low} />
          <Box low={low} size={[Math.min(0.42, w * 0.3), Math.min(0.5, h * 0.62), d - 0.08]} pos={[w / 2 - Math.min(0.42, w * 0.3) / 2 - 0.05, h - top - Math.min(0.5, h * 0.62) / 2, 0]} mat={main} radius={0.01} />
        </group>
      );
    }
    case "bed": {
      const frameH = Math.min(0.32, h * 0.35);
      const mattress = 0.22;
      const head = Math.min(0.08, d * 0.05);
      return (
        <group>
          <Box low={low} size={[w, frameH, d - head]} pos={[0, frameH / 2, head / 2]} mat={wood} radius={0.02} />
          <Box low={low} size={[w - 0.06, mattress, d - head - 0.06]} pos={[0, frameH + mattress / 2, head / 2]} mat={linen} radius={0.05} />
          <Box low={low} size={[w + 0.01, mattress * 0.5, (d - head) * 0.62]} pos={[0, frameH + mattress + 0.03, d / 2 - (d - head) * 0.31 - 0.02]} mat={main} radius={0.05} />
          <Box low={low} size={[w, h, head]} pos={[0, h / 2, -d / 2 + head / 2]} mat={main} radius={0.03} />
          {[-1, 1].map((s) => (
            <Box key={s} low={low} size={[Math.min(0.6, w / 2 - 0.08), 0.12, 0.38]} pos={[(s * w) / 4, frameH + mattress + 0.06, -d / 2 + head + 0.26]} mat={linen} radius={0.05} />
          ))}
        </group>
      );
    }
    case "wardrobe":
      return (
        <group>
          <Box low={low} size={[w, h - 0.06, d]} pos={[0, 0.06 + (h - 0.06) / 2, 0]} mat={main} radius={0.008} />
          <Box low={low} size={[w - 0.04, 0.06, d - 0.04]} pos={[0, 0.03, 0]} mat={dark} />
          {[...Array(Math.max(2, Math.round(w / 0.5)))].map((_, i, arr) => (
            <group key={i}>
              <mesh position={[-w / 2 + (w / arr.length) * (i + 1), h / 2 + 0.03, d / 2 + 0.001]} material={dark}>
                <boxGeometry args={[0.004, h - 0.12, 0.002]} />
              </mesh>
              <mesh position={[-w / 2 + (w / arr.length) * (i + 0.5) + (i % 2 ? -1 : 1) * (w / arr.length) * 0.38, h * 0.52, d / 2 + 0.012]} material={accent}>
                <boxGeometry args={[0.012, 0.22, 0.012]} />
              </mesh>
            </group>
          ))}
        </group>
      );
    case "bookshelf": {
      const shelves = Math.max(2, Math.round(h / 0.36));
      const t = 0.025;
      const books = ["#8f877a", "#5f7a64", "#c9a27a", "#d8d0c2", "#6f4e37", "#a4473a", "#4a6b78"];
      return (
        <group>
          <Box low={low} size={[t, h, d]} pos={[-w / 2 + t / 2, h / 2, 0]} mat={main} />
          <Box low={low} size={[t, h, d]} pos={[w / 2 - t / 2, h / 2, 0]} mat={main} />
          <Box low={low} size={[w, h, 0.012]} pos={[0, h / 2, -d / 2 + 0.006]} mat={main} cast={false} />
          {[...Array(shelves + 1)].map((_, i) => (
            <Box key={i} low={low} size={[w - 2 * t, t, d - 0.012]} pos={[0, (i * (h - t)) / shelves + t / 2, 0.006]} mat={main} />
          ))}
          {!low &&
            [...Array(shelves)].map((_, s) => {
              const y0 = (s * (h - t)) / shelves + t;
              const gap = (h - t) / shelves - t;
              let xCursor = -w / 2 + t + 0.02;
              const items = [];
              let k = 0;
              while (xCursor < w / 2 - t - 0.06 && k < 30) {
                const bw = 0.025 + ((s * 7 + k * 13) % 5) * 0.008;
                const bh = gap * (0.62 + ((s + k * 3) % 4) * 0.08);
                if ((s + k) % 7 === 5) {
                  xCursor += 0.12;
                  k++;
                  continue;
                }
                items.push(
                  <mesh key={k} position={[xCursor + bw / 2, y0 + bh / 2, 0.02]} castShadow>
                    <boxGeometry args={[bw, bh, d * 0.7]} />
                    <meshStandardMaterial color={books[(s * 3 + k) % books.length]} roughness={0.85} />
                  </mesh>,
                );
                xCursor += bw + 0.003;
                k++;
              }
              return <group key={s}>{items}</group>;
            })}
        </group>
      );
    }
    case "rug":
      return o.variant === "round" ? (
        <mesh position={[0, h / 2, 0]} scale={[w, 1, d]} material={main} receiveShadow>
          <cylinderGeometry args={[0.5, 0.5, h, low ? 24 : 64]} />
        </mesh>
      ) : (
        <mesh position={[0, h / 2, 0]} material={main} receiveShadow>
          <boxGeometry args={[w, h, d]} />
        </mesh>
      );
    case "lamp": {
      const glow = new THREE.MeshStandardMaterial({ color: "#f6eedd", emissive: lampColor, emissiveIntensity: lampsOn ? 1.6 : 0.05, roughness: 0.9, transparent: true, opacity: 0.95 });
      if (o.variant === "pendant") {
        return (
          <group>
            <mesh position={[0, h * 0.4, 0]} scale={[w, 1, d]} material={glow}>
              <cylinderGeometry args={[0.32, 0.5, h * 0.8, low ? 12 : 32, 1, true]} />
            </mesh>
            <mesh position={[0, h * 0.9 + 0.6 / 2, 0]} material={dark}>
              <cylinderGeometry args={[0.004, 0.004, 0.6 + h * 0.2, 4]} />
            </mesh>
          </group>
        );
      }
      const shadeH = Math.min(0.32, h * 0.3);
      return (
        <group>
          <mesh position={[0, 0.015, 0]} scale={[w * 0.7, 1, d * 0.7]} material={accent} castShadow>
            <cylinderGeometry args={[0.5, 0.5, 0.03, low ? 12 : 32]} />
          </mesh>
          <mesh position={[0, (h - shadeH) / 2, 0]} material={accent} castShadow>
            <cylinderGeometry args={[0.012, 0.012, h - shadeH, 8]} />
          </mesh>
          <mesh position={[0, h - shadeH / 2, 0]} scale={[w, 1, d]} material={glow} castShadow>
            <cylinderGeometry args={[0.36, 0.5, shadeH, low ? 12 : 32, 1, true]} />
          </mesh>
        </group>
      );
    }
    case "wall_art":
      return (
        <group>
          <Box low={low} size={[w, h, d]} pos={[0, h / 2, 0]} mat={dark} />
          <mesh position={[0, h / 2, d / 2 + 0.001]} material={main}>
            <planeGeometry args={[w - 0.06, h - 0.06]} />
          </mesh>
        </group>
      );
    default:
      return <Box low={low} size={[w, h, d]} pos={[0, h / 2, 0]} mat={main} />;
  }
}

export function kelvinToColor(k: number): string {
  // Tanner Helland approximation, clamped to 1800–6500 K.
  const t = Math.min(6500, Math.max(1800, k)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v)));
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}
