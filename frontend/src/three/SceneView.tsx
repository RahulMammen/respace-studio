import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Environment, GizmoHelper, GizmoViewport, Html, Lightformer, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Catalog, Geometry, Room, Scene, SceneObject, ValidationReport } from "../api/types";
import { convexOverlap, doorSwing, footprint, pointInPolygon, polygonCentroid, polygonInside, type Vec } from "../geometry/shapes";
import { Furniture, kelvinToColor } from "./Furniture";
import { RoomMesh, type WallMode } from "./Room";

export type ViewMode = "plan" | "orbit" | "walk";
export type Preset = "reset" | "top" | "entrance" | "corner-a" | "corner-b";

export interface SceneViewHandle {
  capture: () => string;
  preset: (p: Preset) => void;
}

export interface WalkInput {
  forward: number;
  turn: number;
}

interface Props {
  scene: Scene;
  geometry: Geometry;
  catalog: Catalog;
  viewMode: ViewMode;
  wallMode: WallMode;
  ceiling: boolean;
  lowQuality: boolean;
  selection: string[];
  highlight: string[];
  ghosts?: SceneObject[];
  validation: ValidationReport | null;
  showWalkway: boolean;
  showDimensions: boolean;
  interactive: boolean;
  onSelect: (ids: string[]) => void;
  onMove: (id: string, x: number, y: number) => void;
  walkInput?: React.MutableRefObject<WalkInput>;
  presentation?: boolean;
}

const SNAP = 0.05;

function roomBounds(rooms: Room[]) {
  const xs = rooms.flatMap((r) => r.polygon.map((p) => p.x));
  const ys = rooms.flatMap((r) => r.polygon.map((p) => p.y));
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, size: Math.max(maxX - minX, maxY - minY), height: Math.max(...rooms.map((r) => r.wall_height_m)) };
}

export const SceneView = forwardRef<SceneViewHandle, Props>(function SceneView(props, ref) {
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const presetRef = useRef<(p: Preset) => void>(() => undefined);
  useImperativeHandle(ref, () => ({
    capture: () => glRef.current?.domElement.toDataURL("image/png") ?? "",
    preset: (p) => presetRef.current(p),
  }));
  const low = props.lowQuality;
  return (
    <Canvas
      shadows={!low}
      dpr={low ? 1 : [1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: !low, powerPreference: low ? "low-power" : "high-performance" }}
      onCreated={({ gl }) => {
        glRef.current = gl;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.0;
      }}
      onPointerMissed={(e) => props.interactive && e.button === 0 && props.onSelect([])}
      style={{ touchAction: "none" }}
      data-testid="scene-canvas"
    >
      <color attach="background" args={["#f3f0ea"]} />
      <SceneContent {...props} presetRef={presetRef} />
    </Canvas>
  );
});

function SceneContent(p: Props & { presetRef: React.MutableRefObject<(p: Preset) => void> }) {
  const { scene, geometry, catalog, viewMode, lowQuality: low } = p;
  const rooms = geometry.rooms;
  const b = useMemo(() => roomBounds(rooms), [rooms]);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const { camera, size } = useThree();
  const [camPos, setCamPos] = useState<THREE.Vector3 | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const dragInfo = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);

  const lampColor = kelvinToColor(scene.lighting.color_temperature_k);
  const lampsOn = scene.lighting.mood === "evening" || scene.lighting.mood === "night" || scene.lighting.accent_lights;

  // ------------------------------------------------------------ camera presets
  const applyPreset = (preset: Preset) => {
    const cam = camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    const target = new THREE.Vector3(b.cx, viewMode === "walk" ? 1.55 : 0.6, b.cy);
    if (viewMode === "plan") {
      // Looking straight down with a tiny +z offset keeps plan "up" (smaller y) at the top
      // of the screen and avoids the degenerate lookAt that would spin the view.
      cam.position.set(b.cx, 30, b.cy + 0.02);
      (cam as THREE.OrthographicCamera).zoom = Math.min(size.width / (b.maxX - b.minX + 1.4), size.height / (b.maxY - b.minY + 1.4));
      cam.lookAt(b.cx, 0, b.cy);
      cam.updateProjectionMatrix();
      controls.current?.target.set(b.cx, 0, b.cy);
      controls.current?.update();
      return;
    }
    const entrance = rooms.flatMap((r) => r.openings.filter((o) => o.kind === "door").map((o) => ({ r, o }))).sort((a, c) => Number(c.o.is_entrance) - Number(a.o.is_entrance))[0];
    if (viewMode === "walk" || preset === "entrance") {
      let pos = new THREE.Vector3(b.cx, 1.55, b.maxY - 0.6);
      if (entrance) {
        const room = entrance.r;
        const c = polygonCentroid(room.polygon);
        const n = room.polygon.length;
        const a = room.polygon[entrance.o.wall_index % n];
        const bb = room.polygon[(entrance.o.wall_index + 1) % n];
        const dx = bb.x - a.x, dy = bb.y - a.y, L = Math.hypot(dx, dy) || 1;
        const px = a.x + (dx / L) * entrance.o.offset_m;
        const py = a.y + (dy / L) * entrance.o.offset_m;
        const vx = c.x - px, vy = c.y - py, vl = Math.hypot(vx, vy) || 1;
        pos = new THREE.Vector3(px + (vx / vl) * 0.45, 1.55, py + (vy / vl) * 0.45);
        target.set(c.x, viewMode === "walk" ? 1.45 : 0.7, c.y);
      }
      if (viewMode === "walk") {
        cam.position.copy(pos);
        cam.lookAt(target);
        return;
      }
      cam.position.set(pos.x, 1.7, pos.z);
    } else if (preset === "top") {
      cam.position.set(b.cx + 0.01, b.size * 1.6 + 4, b.cy + 0.01);
    } else {
      const sx = preset === "corner-b" ? -1 : 1;
      const dist = b.size * 0.95 + 2.5;
      cam.position.set(b.cx + sx * dist * 0.7, b.height + b.size * 0.55 + 0.8, b.cy + dist * 0.75);
    }
    controls.current?.target.copy(target);
    controls.current?.update();
    cam.lookAt(target);
  };
  p.presetRef.current = applyPreset;

  // Opt-in diagnostics (?debug=geometry): reports each object's rendered bounds in its
  // own frame so tests can check meshes stay inside the validated footprint box.
  const three = useThree();
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("debug")) return;
    (window as unknown as { __respaceBounds?: () => unknown }).__respaceBounds = () => {
      const out: Record<string, { min: number[]; max: number[]; size: number[] }> = {};
      three.scene.traverse((g) => {
        const id = g.userData?.objectId;
        if (!id || g.userData?.pick || !(g instanceof THREE.Group)) return;
        g.updateMatrixWorld(true);
        const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
        const box = new THREE.Box3();
        g.traverse((m) => {
          const mesh = m as THREE.Mesh;
          if (!mesh.isMesh || mesh.userData?.pick || mesh.userData?.decor || !mesh.geometry) return;
          mesh.geometry.computeBoundingBox();
          const bb = mesh.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
          box.union(bb);
        });
        const o = scene.objects.find((x) => x.id === id);
        if (o) out[id] = { min: box.min.toArray(), max: box.max.toArray(), size: [o.size.w, o.size.h, o.size.d] };
      });
      return out;
    };
  }, [three.scene, scene.objects]);

  useEffect(() => {
    // Wait until the camera for this view mode is the default camera.
    const isOrtho = (camera as THREE.OrthographicCamera).isOrthographicCamera === true;
    if (isOrtho !== (viewMode === "plan")) return;
    applyPreset(viewMode === "walk" ? "entrance" : "reset");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, camera, b.cx, b.cy, b.size]);

  useFrame(() => {
    if (p.wallMode === "cutaway") {
      const cp = camera.position;
      if (!camPos || camPos.distanceToSquared(cp) > 0.04) setCamPos(cp.clone());
    }
  });

  // ------------------------------------------------------------ dragging on the floor plane
  const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = new THREE.Vector3();

  const onObjDown = (e: ThreeEvent<PointerEvent>, obj: SceneObject) => {
    if (!p.interactive || viewMode === "walk") return;
    e.stopPropagation();
    p.onSelect([obj.id]);
    if (obj.locks.includes("position")) return;
    if (!e.ray.intersectPlane(floorPlane, hit)) return;
    dragInfo.current = { id: obj.id, dx: obj.position.x - hit.x, dy: obj.position.y - hit.z, moved: false };
    (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
    if (controls.current) controls.current.enabled = false;
  };

  const onMoveEvt = (e: ThreeEvent<PointerEvent>) => {
    const d = dragInfo.current;
    if (!d) return;
    if (!e.ray.intersectPlane(floorPlane, hit)) return;
    let x = hit.x + d.dx;
    let y = hit.z + d.dy;
    if (!e.shiftKey) {
      x = Math.round(x / SNAP) * SNAP;
      y = Math.round(y / SNAP) * SNAP;
      const obj = scene.objects.find((o) => o.id === d.id)!;
      [x, y] = snapToWalls(obj, x, y, rooms);
    }
    d.moved = true;
    setDrag({ id: d.id, x: +x.toFixed(3), y: +y.toFixed(3) });
  };

  const onUp = () => {
    const d = dragInfo.current;
    dragInfo.current = null;
    if (controls.current) controls.current.enabled = true;
    if (d?.moved && drag) p.onMove(drag.id, drag.x, drag.y);
    setDrag(null);
  };

  const objects = scene.objects.map((o) => (drag && drag.id === o.id ? { ...o, position: { x: drag.x, y: drag.y } } : o));
  const dragged = drag ? objects.find((o) => o.id === drag.id) : undefined;
  const dragConflict = dragged ? conflicts(dragged, objects, rooms, catalog) : false;

  // ------------------------------------------------------------ lighting
  const L = scene.lighting;
  const mood = {
    daylight: { hemi: 0.95, sun: 2.4, sunColor: "#fff4e6", env: 0.55 },
    overcast: { hemi: 1.15, sun: 0.6, sunColor: "#eef1f3", env: 0.6 },
    evening: { hemi: 0.32, sun: 0.35, sunColor: "#ffb27a", env: 0.18 },
    night: { hemi: 0.1, sun: 0.0, sunColor: "#9fb3d6", env: 0.06 },
  }[L.mood];
  const k = L.intensity;
  const lamps = objects.filter((o) => o.category === "lamp");

  return (
    <>
      {viewMode === "plan" ? (
        <OrthographicCamera makeDefault position={[b.cx, 30, b.cy + 0.02]} near={0.1} far={200} zoom={60} />
      ) : (
        <PerspectiveCamera makeDefault fov={viewMode === "walk" ? 70 : 42} near={0.05} far={200} position={[b.cx + 6, 6, b.cy + 7]} />
      )}
      {viewMode === "walk" ? (
        <WalkControls rooms={rooms} input={p.walkInput} />
      ) : (
        <OrbitControls
          ref={controls}
          makeDefault
          enableDamping
          dampingFactor={0.12}
          enableRotate={viewMode === "orbit"}
          screenSpacePanning
          maxPolarAngle={Math.PI / 2 - 0.04}
          minDistance={1.2}
          maxDistance={60}
          target={[b.cx, 0.6, b.cy]}
        />
      )}

      <hemisphereLight args={["#fbf7f0", "#cfc6b8", mood.hemi * k]} />
      <directionalLight
        position={[b.cx - b.size * 0.8, b.height * 3.2, b.cy - b.size * 0.6]}
        intensity={mood.sun * k}
        color={mood.sunColor}
        castShadow={!low}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-b.size}
        shadow-camera-right={b.size}
        shadow-camera-top={b.size}
        shadow-camera-bottom={-b.size}
        shadow-camera-near={0.5}
        shadow-camera-far={b.height * 8 + b.size * 4}
        target-position={[b.cx, 0, b.cy]}
      />
      {!low && (
        <Environment resolution={64} environmentIntensity={mood.env * k}>
          <Lightformer form="rect" intensity={2} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} color="#fffaf1" />
          <Lightformer form="rect" intensity={0.8} position={[-8, 3, 2]} rotation-y={Math.PI / 2} scale={[10, 4, 1]} color="#f2e6d5" />
        </Environment>
      )}
      {lampsOn &&
        lamps.map((o) => (
          <pointLight
            key={`l-${o.id}`}
            position={[o.position.x, o.elevation_m + o.size.h * 0.85, o.position.y]}
            intensity={(o.variant === "pendant" ? 3.2 : 2.4) * k}
            distance={o.variant === "pendant" ? 6 : 4.5}
            decay={1.6}
            color={lampColor}
            castShadow={!low && o.variant === "pendant"}
          />
        ))}
      {L.accent_lights &&
        rooms.flatMap((r) =>
          r.polygon.map((pt, i) => {
            const q = r.polygon[(i + 1) % r.polygon.length];
            const c = polygonCentroid(r.polygon);
            const mx = (pt.x + q.x) / 2, my = (pt.y + q.y) / 2;
            const vx = c.x - mx, vy = c.y - my, vl = Math.hypot(vx, vy) || 1;
            return <pointLight key={`a-${r.id}-${i}`} position={[mx + (vx / vl) * 0.35, r.wall_height_m - 0.35, my + (vy / vl) * 0.35]} intensity={0.9 * k} distance={3.2} decay={1.8} color={lampColor} />;
          }),
        )}

      {/* ground beyond the rooms */}
      <mesh rotation-x={-Math.PI / 2} position={[b.cx, -0.01, b.cy]} receiveShadow>
        <planeGeometry args={[b.size * 6 + 20, b.size * 6 + 20]} />
        <meshStandardMaterial color="#ebe6dc" roughness={1} />
      </mesh>

      <group onPointerMove={onMoveEvt} onPointerUp={onUp}>
        {/* drag catcher: an invisible floor so moves keep tracking off-object */}
        <mesh rotation-x={-Math.PI / 2} position={[b.cx, 0.001, b.cy]} visible={false} onPointerUp={onUp}>
          <planeGeometry args={[b.size * 4 + 10, b.size * 4 + 10]} />
        </mesh>
        {rooms.map((r) => (
          <RoomMesh key={r.id} room={r} finish={scene.finishes.find((f) => f.room_id === r.id)} materials={catalog.materials} wallMode={viewMode === "plan" ? "low" : p.wallMode} ceiling={p.ceiling && viewMode === "walk"} lowQuality={low} cameraPos={camPos} planStyle={viewMode === "plan"} />
        ))}
        {objects.map((o) => (
          <group key={o.id} onPointerDown={(e) => onObjDown(e, o)}>
            <Furniture obj={o} materials={catalog.materials} lowQuality={low} lampColor={lampColor} lampsOn={lampsOn} />
          </group>
        ))}
        {p.ghosts?.map((o) => (
          <Furniture key={`g-${o.id}`} obj={o} materials={catalog.materials} lowQuality={true} lampColor={lampColor} lampsOn={false} ghost />
        ))}
      </group>

      <Overlays
        objects={objects}
        rooms={rooms}
        selection={p.selection}
        highlight={p.highlight}
        validation={p.validation}
        showWalkway={p.showWalkway && !p.presentation}
        showDimensions={p.showDimensions && !p.presentation}
        planMode={viewMode === "plan"}
        dragConflict={dragConflict}
        draggedId={drag?.id ?? null}
        presentation={!!p.presentation}
        lift={viewMode === "plan" ? b.height + 0.2 : 0}
      />

      {viewMode === "orbit" && !p.presentation && (
        <GizmoHelper alignment="top-right" margin={[56, 56]}>
          <GizmoViewport axisColors={["#9c4234", "#5f7a64", "#4a6b78"]} labels={["X", "Up", "Y"]} labelColor="#2b2a28" />
        </GizmoHelper>
      )}
    </>
  );
}

function snapToWalls(obj: SceneObject, x: number, y: number, rooms: Room[]): [number, number] {
  // pull the object's back edge flush to a nearby, parallel wall face (within 12 cm)
  const a = (obj.rotation_deg * Math.PI) / 180;
  const back: Vec = [Math.sin(a), -Math.cos(a)]; // local -Y in world
  const room = rooms.find((r) => r.id === obj.room_id) ?? rooms[0];
  if (!room) return [x, y];
  const n = room.polygon.length;
  for (let i = 0; i < n; i++) {
    const p0 = room.polygon[i], p1 = room.polygon[(i + 1) % n];
    const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len; // either normal; test alignment with back vector
    const align = nx * back[0] + ny * back[1];
    if (Math.abs(Math.abs(align) - 1) > 0.02) continue;
    const bx = x + back[0] * (obj.size.d / 2);
    const by = y + back[1] * (obj.size.d / 2);
    const dist = (bx - p0.x) * nx + (by - p0.y) * ny;
    if (Math.abs(dist) < 0.12) {
      return [x - nx * dist, y - ny * dist];
    }
  }
  return [x, y];
}

function conflicts(obj: SceneObject, all: SceneObject[], rooms: Room[], catalog: Catalog): boolean {
  const kindOf = (o: SceneObject) => catalog.categories.find((c) => c.id === o.category)?.variants.find((v) => v.id === o.variant)?.collision ?? "floor";
  const room = rooms.find((r) => r.id === obj.room_id);
  const fp = footprint(obj);
  if (room && kindOf(obj) !== "wall" && !polygonInside(fp, room.polygon.map((q) => [q.x, q.y] as Vec))) return true;
  if (kindOf(obj) !== "floor") return false;
  return all.some((o) => o.id !== obj.id && o.room_id === obj.room_id && kindOf(o) === "floor" && !(obj.category === "dining_chair" || o.category === "dining_chair") && convexOverlap(fp, footprint(o)));
}

// ------------------------------------------------------------ overlays

function ring(points: number[][], y: number): [number, number, number][] {
  const pts = points.map(([x, z]) => [x, y, z] as [number, number, number]);
  if (pts.length) pts.push(pts[0]);
  return pts;
}

function Overlays({
  objects,
  rooms,
  selection,
  highlight,
  validation,
  showWalkway,
  showDimensions,
  planMode,
  dragConflict,
  draggedId,
  presentation,
  lift,
}: {
  objects: SceneObject[];
  rooms: Room[];
  selection: string[];
  highlight: string[];
  validation: ValidationReport | null;
  showWalkway: boolean;
  showDimensions: boolean;
  planMode: boolean;
  dragConflict: boolean;
  draggedId: string | null;
  presentation: boolean;
  lift: number;
}) {
  const issueIds = new Set((validation?.issues ?? []).filter((i) => i.severity === "error").flatMap((i) => i.object_ids));
  const walkway = validation?.derived.walkway ?? [];
  return (
    // In plan view overlays are lifted above the furniture so they stay visible from above;
    // with an orthographic top camera their plan position is unchanged.
    <group position={[0, lift, 0]}>
      {showWalkway &&
        walkway.map((w) => (
          <group key={w.room_id}>
            {w.reachable.map((poly, i) => (
              <WalkShape key={`r${i}`} rings={poly} color="#5f7a64" opacity={0.16} />
            ))}
            {w.unreachable.map((poly, i) => (
              <WalkShape key={`u${i}`} rings={poly} color="#9c4234" opacity={0.18} />
            ))}
          </group>
        ))}
      {!presentation &&
        rooms.flatMap((r) =>
          r.openings.map((o) => {
            const swing = doorSwing(r, o);
            return swing ? <Line key={`${r.id}-${o.id}`} points={ring(swing, 0.012).slice(0, -1)} color="#857d71" lineWidth={1} dashed dashSize={0.06} gapSize={0.04} /> : null;
          }),
        )}
      {objects.map((o) => {
        const sel = selection.includes(o.id);
        const hl = highlight.includes(o.id);
        const locked = o.locks.length > 0;
        const bad = issueIds.has(o.id) || (draggedId === o.id && dragConflict);
        if (presentation) return null;
        if (!sel && !hl && !bad && !(planMode && locked) && !planMode) return null;
        const color = bad ? "#9c4234" : hl ? "#5f7a64" : sel ? "#2b2a28" : locked ? "#57534c" : "#6f6a62";
        const fp = footprint(o).map(([x, y]) => [x, y]);
        return (
          <group key={`o-${o.id}`}>
            <Line points={ring(fp, 0.015)} color={color} lineWidth={sel || hl || bad ? 2.2 : 1} dashed={hl && !sel} dashSize={0.08} gapSize={0.05} />
            {locked && (sel || planMode) && (
              <Html position={[o.position.x, lift ? 0.05 : o.elevation_m + o.size.h + 0.08, o.position.y]} center zIndexRange={[20, 0]}>
                <span className="lock-badge" title={`Locked: ${o.locks.join(", ")}`} aria-label={`Locked ${o.locks.join(", ")}`}>
                  <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 10V7a5 5 0 0 1 10 0v3h1.5A1.5 1.5 0 0 1 20 11.5v9A1.5 1.5 0 0 1 18.5 22h-13A1.5 1.5 0 0 1 4 20.5v-9A1.5 1.5 0 0 1 5.5 10H7Zm2 0h6V7a3 3 0 0 0-6 0v3Z" /></svg>
                </span>
              </Html>
            )}
            {sel && showDimensions && (
              <Html position={[o.position.x, 0.02, o.position.y]} center zIndexRange={[20, 0]}>
                <span className="dim-badge num">
                  {o.size.w.toFixed(2)} × {o.size.d.toFixed(2)} m
                </span>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

function WalkShape({ rings, color, opacity }: { rings: number[][][]; color: string; opacity: number }) {
  const geom = useMemo(() => {
    if (!rings.length) return null;
    const shape = new THREE.Shape(rings[0].map(([x, y]) => new THREE.Vector2(x, y)));
    for (const h of rings.slice(1)) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(Math.PI / 2);
    return g;
  }, [rings]);
  if (!geom) return null;
  return (
    <mesh geometry={geom} position={[0, 0.008, 0]} renderOrder={2}>
      <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

// ------------------------------------------------------------ walkthrough controls

function WalkControls({ rooms, input }: { rooms: Room[]; input?: React.MutableRefObject<WalkInput> }) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const yaw = useRef(0);
  const pitch = useRef(0);
  const polys = useMemo(() => rooms.map((r) => r.polygon.map((p) => [p.x, p.y] as Vec)), [rooms]);

  useEffect(() => {
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
    yaw.current = e.y;
    pitch.current = e.x;
    const down = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement).closest("input, textarea, select")) return;
      keys.current.add(ev.key.toLowerCase());
    };
    const up = (ev: KeyboardEvent) => keys.current.delete(ev.key.toLowerCase());
    let dragging = false;
    let lx = 0, ly = 0;
    const el = gl.domElement;
    const pd = (ev: PointerEvent) => {
      dragging = true;
      lx = ev.clientX;
      ly = ev.clientY;
      el.setPointerCapture(ev.pointerId);
    };
    const pm = (ev: PointerEvent) => {
      if (!dragging) return;
      yaw.current -= (ev.clientX - lx) * 0.004;
      pitch.current = Math.max(-1.0, Math.min(0.8, pitch.current - (ev.clientY - ly) * 0.004));
      lx = ev.clientX;
      ly = ev.clientY;
    };
    const pu = () => (dragging = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    el.addEventListener("pointerdown", pd);
    el.addEventListener("pointermove", pm);
    el.addEventListener("pointerup", pu);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      el.removeEventListener("pointerdown", pd);
      el.removeEventListener("pointermove", pm);
      el.removeEventListener("pointerup", pu);
    };
  }, [camera, gl]);

  useFrame((_, dt) => {
    const k = keys.current;
    const fwd = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0) + (input?.current.forward ?? 0);
    const strafe = (k.has("d") ? 1 : 0) - (k.has("a") ? 1 : 0);
    const turn = (k.has("arrowleft") ? 1 : 0) - (k.has("arrowright") ? 1 : 0) + (input?.current.turn ?? 0);
    yaw.current += turn * dt * 1.4;
    camera.quaternion.setFromEuler(new THREE.Euler(pitch.current, yaw.current, 0, "YXZ"));
    if (fwd || strafe) {
      const speed = 1.4 * Math.min(dt, 0.05);
      const dir = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
      const right = new THREE.Vector3(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
      const next = camera.position.clone().addScaledVector(dir, fwd * speed).addScaledVector(right, strafe * speed);
      // stay inside the rooms (walls are solid; doorways between adjacent rooms are crossable)
      if (polys.some((poly) => pointInPolygon([next.x, next.z], poly))) camera.position.copy(next);
    }
    camera.position.y = 1.55;
  });
  return null;
}
