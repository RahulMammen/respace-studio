// Static 2D plan render of a scene, drawn from the same footprint/opening functions
// as validation. Used for comparisons and the printable summary.
import type { Geometry, Scene } from "../api/types";
import { doorSwing, footprint, openingSegment } from "../geometry/shapes";

export function PlanMini({ geometry, scene, highlight = [], width = 420 }: { geometry: Geometry; scene: Scene; highlight?: string[]; width?: number }) {
  const xs = geometry.rooms.flatMap((r) => r.polygon.map((p) => p.x));
  const ys = geometry.rooms.flatMap((r) => r.polygon.map((p) => p.y));
  const pad = 0.4;
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) - minX + pad, h = Math.max(...ys) - minY + pad;
  return (
    <svg viewBox={`${minX} ${minY} ${w} ${h}`} width={width} style={{ aspectRatio: `${w} / ${h}`, height: "auto", maxWidth: "100%" }} role="img" aria-label="Plan of the design">
      {geometry.rooms.map((r) => {
        const floor = scene.finishes.find((f) => f.room_id === r.id)?.floor.color ?? "#e9e3d8";
        return (
          <g key={r.id}>
            <polygon points={r.polygon.map((p) => `${p.x},${p.y}`).join(" ")} fill={floor} fillOpacity={0.35} stroke="#2b2a28" strokeWidth={r.wall_thickness_m} strokeLinejoin="miter" />
            {r.openings.map((o) => {
              if (o.wall_index >= r.polygon.length) return null;
              const [a, b] = openingSegment(r, o);
              const s = doorSwing(r, o);
              return (
                <g key={o.id}>
                  <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#fcfbf8" strokeWidth={r.wall_thickness_m + 0.03} />
                  {o.kind === "window" && <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#4a6b78" strokeWidth={0.04} />}
                  {s && <polyline points={s.map((p) => p.join(",")).join(" ")} fill="none" stroke="#a9a093" strokeWidth={0.015} strokeDasharray="0.05 0.04" />}
                </g>
              );
            })}
          </g>
        );
      })}
      {[...scene.objects]
        .sort((a, b) => Number(a.category !== "rug") - Number(b.category !== "rug"))
        .map((o) => {
          const fp = footprint(o);
          const hl = highlight.includes(o.id);
          return (
            <polygon
              key={o.id}
              points={fp.map((p) => p.join(",")).join(" ")}
              fill={o.category === "rug" ? o.finish.color : o.finish.color}
              fillOpacity={o.category === "rug" ? 0.35 : 0.9}
              stroke={hl ? "#5f7a64" : "#2b2a28"}
              strokeWidth={hl ? 0.05 : 0.015}
              strokeDasharray={hl ? "0.08 0.05" : undefined}
            >
              <title>{o.label || o.id}</title>
            </polygon>
          );
        })}
    </svg>
  );
}
