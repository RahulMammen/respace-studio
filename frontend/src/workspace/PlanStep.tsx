import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  DoorOpen,
  Hand,
  LayoutTemplate,
  Maximize,
  MousePointer2,
  PenLine,
  Ruler,
  Sparkles,
  SquareDashed,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { api, ApiError } from "../api/client";
import type { Asset, Calibration, Geometry, Issue, Opening, OpeningKind, Point, Room } from "../api/types";
import { Dialog, MetreInput } from "../components/common";
import {
  areaOf,
  distanceToSegment,
  doorSwing,
  edgeFrame,
  metresPerPixel,
  openingSegment,
  polygonCentroid,
  selfIntersects,
  type Vec,
} from "../geometry/shapes";
import { toast } from "../state/ui";
import { useWorkspace } from "../state/workspace";
import { PlanImport } from "./PlanImport";

type Tool = "select" | "pan" | "calibrate" | "trace" | "door" | "window" | "opening";
const PROVISIONAL_MPP = 0.01;
const GRID = 0.05;

interface ViewT {
  scale: number; // screen px per metre
  ox: number;
  oy: number;
}

interface Selection {
  roomId: string | null;
  vertex: number | null;
  openingId: string | null;
}

interface Extraction {
  rooms: (Room & { confidence: string })[];
  uncertain: string[];
  dimension_labels: string[];
  note: string;
  test_double?: boolean;
  issues: Issue[];
}

const round = (v: number, step = 0.001) => Math.round(v / step) * step;
const uid = (prefix: string, taken: string[]) => {
  let n = 1;
  while (taken.includes(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
};

export default function PlanStep() {
  const { project, geometry, setGeometry, saveGeometry, geometryIssues, geometrySave, refreshProject, setStep } = useWorkspace();
  const [tool, setTool] = useState<Tool>("select");
  const [view, setView] = useState<ViewT>({ scale: 80, ox: 40, oy: 40 });
  const [sel, setSel] = useState<Selection>({ roomId: null, vertex: null, openingId: null });
  const [trace, setTrace] = useState<Point[]>([]);
  const [hover, setHover] = useState<Point | null>(null);
  const [calPts, setCalPts] = useState<Point[]>([]);
  const [calDialog, setCalDialog] = useState<{ a: Point; b: Point } | null>(null);
  const [rectDialog, setRectDialog] = useState(false);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ kind: "pan" | "vertex"; startX: number; startY: number; ox: number; oy: number; roomId?: string; index?: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number; cx: number; cy: number } | null>(null);

  const plan: Asset | undefined = project?.assets.find((a) => a.id === geometry?.plan_asset_id) ?? project?.assets.find((a) => a.kind === "plan");
  const mpp = geometry?.calibration ? safeMpp(geometry.calibration) : PROVISIONAL_MPP;
  const calibrated = !!geometry?.calibration;
  const rooms = useMemo(() => geometry?.rooms ?? [], [geometry]);
  const selectedRoom = rooms.find((r) => r.id === sel.roomId) ?? null;

  // Attach the most recent plan to the geometry when none is set.
  useEffect(() => {
    if (geometry && !geometry.plan_asset_id && plan) setGeometry({ ...geometry, plan_asset_id: plan.id });
  }, [geometry, plan, setGeometry]);

  const update = useCallback((g: Geometry) => setGeometry(g, true), [setGeometry]);

  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const w = svg.clientWidth;
    const h = svg.clientHeight;
    let bx = 0, by = 0, bw = 10, bh = 8;
    if (plan) {
      bw = plan.width_px * mpp;
      bh = plan.height_px * mpp;
    } else if (rooms.length) {
      const xs = rooms.flatMap((r) => r.polygon.map((p) => p.x));
      const ys = rooms.flatMap((r) => r.polygon.map((p) => p.y));
      bx = Math.min(...xs) - 1;
      by = Math.min(...ys) - 1;
      bw = Math.max(...xs) - bx + 1;
      bh = Math.max(...ys) - by + 1;
    }
    const scale = Math.min((w - 80) / bw, (h - 80) / bh);
    setView({ scale, ox: (w - bw * scale) / 2 - bx * scale, oy: (h - bh * scale) / 2 - by * scale });
  }, [plan, mpp, rooms]);

  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id, calibrated]);

  const toWorld = (clientX: number, clientY: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.ox) / view.scale, y: (clientY - r.top - view.oy) / view.scale };
  };

  const snap = (p: Point, prev?: Point, free = false): Point => {
    if (free) return { x: round(p.x), y: round(p.y) };
    // snap to existing vertices within 10 screen px
    for (const r of rooms) {
      for (const v of r.polygon) {
        if (Math.hypot(v.x - p.x, v.y - p.y) * view.scale < 10) return { ...v };
      }
    }
    let q = { x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID };
    if (prev) {
      // orthogonal snap: lock to horizontal / vertical when within 8 degrees
      const ang = Math.atan2(q.y - prev.y, q.x - prev.x);
      const deg = ((ang * 180) / Math.PI + 360) % 90;
      if (deg < 8 || deg > 82) {
        if (Math.abs(q.x - prev.x) > Math.abs(q.y - prev.y)) q = { x: q.x, y: prev.y };
        else q = { x: prev.x, y: q.y };
      }
    }
    return { x: round(q.x), y: round(q.y) };
  };

  // ------------------------------------------------------------------ pointer handling

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      dragRef.current = null;
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    if (tool === "pan" || e.button === 1 || e.altKey) {
      dragRef.current = { kind: "pan", startX: e.clientX, startY: e.clientY, ox: view.ox, oy: view.oy };
      return;
    }
    if (tool === "calibrate") {
      if (!plan) return toast("Import a plan first.", "error");
      const pts = [...calPts, { x: round(w.x), y: round(w.y) }];
      if (pts.length === 2) {
        setCalDialog({ a: pts[0], b: pts[1] });
        setCalPts([]);
      } else setCalPts(pts);
      return;
    }
    if (tool === "trace") {
      if (plan && !calibrated) return toast("Calibrate the plan before tracing so dimensions are measured.", "error");
      const prev = trace[trace.length - 1];
      const p = snap(w, prev, e.shiftKey);
      if (trace.length >= 3 && Math.hypot(p.x - trace[0].x, p.y - trace[0].y) * view.scale < 12) {
        finishTrace();
        return;
      }
      setTrace([...trace, p]);
      return;
    }
    if (tool === "door" || tool === "window" || tool === "opening") {
      placeOpening(w, tool);
      return;
    }
    // select: vertex hit-test first
    for (const r of rooms) {
      const idx = r.polygon.findIndex((v) => Math.hypot(v.x - w.x, v.y - w.y) * view.scale < 9);
      if (idx >= 0) {
        setSel({ roomId: r.id, vertex: idx, openingId: null });
        dragRef.current = { kind: "vertex", startX: e.clientX, startY: e.clientY, ox: 0, oy: 0, roomId: r.id, index: idx };
        return;
      }
    }
    for (const r of rooms) {
      const op = r.openings.find((o) => {
        if (o.wall_index >= r.polygon.length) return false;
        const [a, b] = openingSegment(r, o);
        return distanceToSegment([w.x, w.y], a, b) * view.scale < 8;
      });
      if (op) {
        setSel({ roomId: r.id, vertex: null, openingId: op.id });
        return;
      }
    }
    const hit = rooms.find((r) => pointIn(w, r.polygon));
    setSel({ roomId: hit?.id ?? null, vertex: null, openingId: null });
    if (!hit) dragRef.current = { kind: "pan", startX: e.clientX, startY: e.clientY, ox: view.ox, oy: view.oy };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(pinch.current.cx, pinch.current.cy, (pinch.current.scale * dist) / pinch.current.dist / view.scale);
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    setHover(tool === "trace" ? snap(w, trace[trace.length - 1], e.shiftKey) : w);
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "pan") {
      setView((v) => ({ ...v, ox: d.ox + e.clientX - d.startX, oy: d.oy + e.clientY - d.startY }));
    } else if (d.kind === "vertex" && geometry) {
      const room = rooms.find((r) => r.id === d.roomId)!;
      const n = room.polygon.length;
      const prev = room.polygon[(d.index! - 1 + n) % n];
      const p = snap(w, prev, e.shiftKey);
      setGeometry({
        ...geometry,
        rooms: rooms.map((r) => (r.id === d.roomId ? { ...r, polygon: r.polygon.map((v, i) => (i === d.index ? p : v)) } : r)),
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (dragRef.current?.kind === "vertex" && geometry) update(useWorkspace.getState().geometry!);
    dragRef.current = null;
  };

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const cx = clientX - r.left;
    const cy = clientY - r.top;
    setView((v) => {
      const scale = Math.min(800, Math.max(8, v.scale * factor));
      const k = scale / v.scale;
      return { scale, ox: cx - (cx - v.ox) * k, oy: cy - (cy - v.oy) * k };
    });
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || Math.abs(e.deltaY) > 0) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  });

  // ------------------------------------------------------------------ editing actions

  const finishTrace = () => {
    if (!geometry || trace.length < 3) return;
    const id = uid("room", rooms.map((r) => r.id));
    const room: Room = { id, name: `Room ${rooms.length + 1}`, polygon: trace, wall_height_m: 2.7, wall_thickness_m: 0.15, openings: [] };
    update({ ...geometry, rooms: [...rooms, room] });
    setTrace([]);
    setTool("select");
    setSel({ roomId: id, vertex: null, openingId: null });
    toast("Room traced. Add doors and windows on its walls.");
  };

  const placeOpening = (w: Point, kind: OpeningKind) => {
    if (!geometry) return;
    let best: { room: Room; edge: number; t: number; d: number } | null = null;
    for (const room of rooms) {
      for (let i = 0; i < room.polygon.length; i++) {
        const f = edgeFrame(room, i);
        const t = (w.x - f.start[0]) * f.dir[0] + (w.y - f.start[1]) * f.dir[1];
        const d = Math.abs((w.x - f.start[0]) * f.inward[0] + (w.y - f.start[1]) * f.inward[1]);
        if (t < 0 || t > f.length) continue;
        if (!best || d < best.d) best = { room, edge: i, t, d };
      }
    }
    if (!best || best.d * view.scale > 24) return toast("Click on a wall to place the opening.", "error");
    const width = kind === "door" ? 0.9 : kind === "window" ? 1.2 : 1.0;
    const len = edgeFrame(best.room, best.edge).length;
    const offset = Math.min(Math.max(best.t, width / 2 + 0.05), len - width / 2 - 0.05);
    const op: Opening = {
      id: uid(kind, best.room.openings.map((o) => o.id)),
      kind,
      wall_index: best.edge,
      offset_m: round(offset, 0.01),
      width_m: width,
      height_m: kind === "window" ? 1.3 : 2.1,
      sill_m: kind === "window" ? 0.9 : 0,
      swing: kind === "door" ? "in" : "none",
      hinge: "start",
      is_entrance: kind === "door" && !rooms.some((r) => r.openings.some((o) => o.is_entrance)),
    };
    update({ ...geometry, rooms: rooms.map((r) => (r.id === best!.room.id ? { ...r, openings: [...r.openings, op] } : r)) });
    setSel({ roomId: best.room.id, vertex: null, openingId: op.id });
  };

  const updateRoom = (id: string, patch: Partial<Room>) => {
    if (!geometry) return;
    update({ ...geometry, rooms: rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  };

  const updateOpening = (roomId: string, opId: string, patch: Partial<Opening>) => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    updateRoom(roomId, { openings: room.openings.map((o) => (o.id === opId ? { ...o, ...patch } : o)) });
  };

  const deleteSelected = useCallback(() => {
    if (!geometry || !sel.roomId) return;
    const room = rooms.find((r) => r.id === sel.roomId);
    if (!room) return;
    if (sel.openingId) {
      updateRoom(room.id, { openings: room.openings.filter((o) => o.id !== sel.openingId) });
    } else if (sel.vertex !== null) {
      if (room.polygon.length <= 3) return toast("A room needs at least three corners.", "error");
      // removing a vertex shifts wall indices: keep openings on the walls they were on
      const v = sel.vertex;
      const openings = room.openings
        .filter((o) => o.wall_index !== v && o.wall_index !== (v - 1 + room.polygon.length) % room.polygon.length)
        .map((o) => ({ ...o, wall_index: o.wall_index > v ? o.wall_index - 1 : o.wall_index }));
      updateRoom(room.id, { polygon: room.polygon.filter((_, i) => i !== v), openings });
    } else {
      update({ ...geometry, rooms: rooms.filter((r) => r.id !== room.id) });
    }
    setSel({ roomId: null, vertex: null, openingId: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, sel, rooms]);

  const insertVertex = (room: Room, edge: number) => {
    const a = room.polygon[edge];
    const b = room.polygon[(edge + 1) % room.polygon.length];
    const mid = { x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) };
    const polygon = [...room.polygon.slice(0, edge + 1), mid, ...room.polygon.slice(edge + 1)];
    const half = edgeFrame(room, edge).length / 2;
    const openings = room.openings.map((o) => {
      if (o.wall_index > edge) return { ...o, wall_index: o.wall_index + 1 };
      if (o.wall_index === edge && o.offset_m > half) return { ...o, wall_index: edge + 1, offset_m: round(o.offset_m - half, 0.01) };
      return o;
    });
    updateRoom(room.id, { polygon, openings });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "Escape") {
        setTrace([]);
        setCalPts([]);
        setSel({ roomId: null, vertex: null, openingId: null });
      } else if (e.key === "Enter" && tool === "trace") finishTrace();
      else if ((e.key === "Delete" || e.key === "Backspace") && sel.roomId) {
        e.preventDefault();
        deleteSelected();
      } else if (!e.ctrlKey && !e.metaKey) {
        const map: Record<string, Tool> = { v: "select", h: "pan", c: "calibrate", t: "trace", d: "door", w: "window" };
        if (map[e.key]) setTool(map[e.key]);
        if (e.key === "f") fit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ------------------------------------------------------------------ calibration

  const applyCalibration = (a: Point, b: Point, length: number) => {
    if (!geometry || !plan) return;
    // points are in current world units; convert back to plan pixels
    const cal: Calibration = { a: { u: a.x / mpp, v: a.y / mpp }, b: { u: b.x / mpp, v: b.y / mpp }, length_m: length };
    let newMpp: number;
    try {
      newMpp = metresPerPixel(cal);
    } catch {
      return toast("Mark two points further apart.", "error");
    }
    const k = newMpp / mpp;
    const scaled = rooms.map((r) => ({
      ...r,
      polygon: r.polygon.map((p) => ({ x: round(p.x * k), y: round(p.y * k) })),
      openings: r.openings.map((o) => ({ ...o, offset_m: round(o.offset_m * k, 0.001), width_m: round(o.width_m * k, 0.001) })),
    }));
    update({ ...geometry, calibration: cal, rooms: scaled });
    if (rooms.length) toast("Calibration updated. Traced rooms were rescaled to match.");
    else toast(`Scale set: 1 px = ${(newMpp * 1000).toFixed(1)} mm. Next: trace the room.`);
    setTool("trace");
    setTimeout(fit, 0);
  };

  // ------------------------------------------------------------------ AI tracing

  const suggestOutline = async () => {
    if (!project || !plan || !geometry?.calibration) return;
    setExtracting(true);
    try {
      const r = await api<Extraction>(`/api/projects/${project.id}/ai/extract-geometry`, {
        method: "POST",
        json: { asset_id: plan.id, calibration: geometry.calibration },
      });
      if (!r.rooms.length) toast("The assistant could not find a room outline. Trace it manually.", "error");
      setExtraction(r);
    } catch (err) {
      toast((err as ApiError).message, "error");
    } finally {
      setExtracting(false);
    }
  };

  const acceptExtraction = () => {
    if (!extraction || !geometry) return;
    update({
      ...geometry,
      rooms: extraction.rooms.map(({ confidence: _c, ...r }) => ({
        ...r,
        wall_height_m: 2.7,
        wall_thickness_m: 0.15,
        openings: r.openings.map((o: Partial<Opening>) => ({ ...o, swing: o.swing ?? (o.kind === "door" ? "in" : "none"), hinge: o.hinge ?? "start", is_entrance: o.is_entrance ?? false }) as Opening),
      })),
    });
    setExtraction(null);
    toast("Suggested outline applied as a draft. Check every wall and opening before confirming.");
  };

  // ------------------------------------------------------------------ checks

  const clientIssues = useMemo(() => {
    const out: string[] = [];
    for (const r of rooms) {
      if (selfIntersects(r.polygon)) out.push(`${r.name}: the boundary crosses itself.`);
      else if (areaOf(r.polygon) < 1) out.push(`${r.name}: area is under 1 m².`);
    }
    return out;
  }, [rooms]);
  const serverErrors = geometryIssues.filter((i) => i.severity === "error");
  const canConfirm = rooms.length > 0 && clientIssues.length === 0 && (calibrated || !plan);

  const confirm = async () => {
    setConfirmOpen(false);
    const ok = await saveGeometry(true);
    if (ok) {
      toast("Geometry confirmed. Next: furniture and brief.");
      await refreshProject();
      setStep("furnish");
    }
  };

  if (!project || !geometry) return null;

  // ------------------------------------------------------------------ render

  const px = (p: Point | Vec) => (Array.isArray(p) ? `${p[0]},${p[1]}` : `${p.x},${p.y}`);
  const sw = 1.5 / view.scale;
  const fs = 12 / view.scale;

  return (
    <div className="plan-step">
      <nav className="tool-rail" aria-label="Plan tools">
        <ToolBtn icon={<MousePointer2 size={18} />} label="Select and edit (V)" active={tool === "select"} onClick={() => setTool("select")} />
        <ToolBtn icon={<Hand size={18} />} label="Pan (H)" active={tool === "pan"} onClick={() => setTool("pan")} />
        <span className="rail-sep" />
        <ToolBtn icon={<Ruler size={18} />} label="Calibrate a known length (C)" active={tool === "calibrate"} onClick={() => setTool("calibrate")} disabled={!plan} />
        <ToolBtn icon={<PenLine size={18} />} label="Trace room outline (T)" active={tool === "trace"} onClick={() => setTool("trace")} />
        <ToolBtn icon={<DoorOpen size={18} />} label="Add door (D)" active={tool === "door"} onClick={() => setTool("door")} disabled={!rooms.length} />
        <ToolBtn icon={<LayoutTemplate size={18} />} label="Add window (W)" active={tool === "window"} onClick={() => setTool("window")} disabled={!rooms.length} />
        <ToolBtn icon={<SquareDashed size={18} />} label="Add open passage" active={tool === "opening"} onClick={() => setTool("opening")} disabled={!rooms.length} />
        <span className="rail-sep" />
        <ToolBtn icon={<ZoomIn size={18} />} label="Zoom in" onClick={() => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25)} />
        <ToolBtn icon={<ZoomOut size={18} />} label="Zoom out" onClick={() => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 0.8)} />
        <ToolBtn icon={<Maximize size={18} />} label="Fit to view (F)" onClick={fit} />
      </nav>

      <div className="plan-canvas-wrap">
        <svg
          ref={svgRef}
          className={`plan-canvas tool-${tool}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(e) => {
            if (tool !== "select") return;
            const w = toWorld(e.clientX, e.clientY);
            for (const r of rooms)
              for (let i = 0; i < r.polygon.length; i++) {
                const a = r.polygon[i];
                const b = r.polygon[(i + 1) % r.polygon.length];
                if (distanceToSegment([w.x, w.y], [a.x, a.y], [b.x, b.y]) * view.scale < 8) return insertVertex(r, i);
              }
          }}
          role="application"
          aria-label="Floor plan editor"
          data-testid="plan-canvas"
        >
          <defs>
            <pattern id="plan-grid" width={1} height={1} patternUnits="userSpaceOnUse">
              <path d={`M1 0H0V1`} fill="none" stroke="#e7e2d8" strokeWidth={1 / view.scale} />
            </pattern>
          </defs>
          <g transform={`translate(${view.ox} ${view.oy}) scale(${view.scale})`}>
            <rect x={-200} y={-200} width={400} height={400} fill="url(#plan-grid)" />
            {plan && (
              <image href={plan.url} x={0} y={0} width={plan.width_px * mpp} height={plan.height_px * mpp} opacity={rooms.length ? 0.55 : 0.92} preserveAspectRatio="none" />
            )}
            {extraction &&
              extraction.rooms.map((r) => (
                <polygon key={`x-${r.id}`} points={r.polygon.map(px).join(" ")} className="proposal-outline" strokeWidth={sw * 1.4} />
              ))}
            {rooms.map((r) => {
              const isSel = sel.roomId === r.id;
              const c = polygonCentroid(r.polygon);
              return (
                <g key={r.id}>
                  <polygon points={r.polygon.map(px).join(" ")} className={`room-fill ${isSel ? "sel" : ""}`} />
                  <polygon points={r.polygon.map(px).join(" ")} className="room-wall" strokeWidth={Math.max(r.wall_thickness_m, sw * 3)} />
                  {r.openings.map((o) => {
                    if (o.wall_index >= r.polygon.length) return null;
                    const [a, b] = openingSegment(r, o);
                    const swing = doorSwing(r, o);
                    return (
                      <g key={o.id} className={`opening ${o.kind} ${sel.openingId === o.id ? "sel" : ""}`}>
                        <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="opening-gap" strokeWidth={Math.max(r.wall_thickness_m + 0.04, sw * 5)} />
                        <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="opening-line" strokeWidth={sw * (o.kind === "window" ? 3 : 1.5)} />
                        {swing && <polyline points={swing.map(px).join(" ")} className="door-swing" strokeWidth={sw} />}
                        {o.is_entrance && (
                          <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2} dy={-fs * 1.2} fontSize={fs * 0.9} textAnchor="middle" className="plan-tag">
                            ENTRANCE
                          </text>
                        )}
                      </g>
                    );
                  })}
                  {r.polygon.map((v, i) => {
                    const n = r.polygon[(i + 1) % r.polygon.length];
                    const f = edgeFrame(r, i);
                    const mx = (v.x + n.x) / 2 - f.inward[0] * fs * 1.6;
                    const my = (v.y + n.y) / 2 - f.inward[1] * fs * 1.6;
                    return (
                      <text key={`l${i}`} x={mx} y={my} fontSize={fs} textAnchor="middle" dominantBaseline="middle" className="dim-label">
                        {f.length.toFixed(2)} m
                      </text>
                    );
                  })}
                  {(isSel || tool === "select") &&
                    r.polygon.map((v, i) => (
                      <circle key={`v${i}`} cx={v.x} cy={v.y} r={(isSel && sel.vertex === i ? 6 : 4.5) / view.scale} className={`vertex ${isSel && sel.vertex === i ? "sel" : ""}`} strokeWidth={sw} />
                    ))}
                  <text x={c.x} y={c.y} fontSize={fs * 1.1} textAnchor="middle" className="room-label">
                    {r.name}
                  </text>
                  <text x={c.x} y={c.y + fs * 1.4} fontSize={fs * 0.9} textAnchor="middle" className="room-area">
                    {areaOf(r.polygon).toFixed(1)} m²
                  </text>
                </g>
              );
            })}
            {trace.length > 0 && (
              <g>
                <polyline points={[...trace, ...(hover ? [hover] : [])].map(px).join(" ")} className="trace-line" strokeWidth={sw * 1.5} />
                {trace.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={4 / view.scale} className={`vertex ${i === 0 ? "first" : ""}`} strokeWidth={sw} />
                ))}
                {hover && trace.length > 0 && (
                  <text x={hover.x} y={hover.y} dy={-fs} fontSize={fs} className="dim-label live">
                    {Math.hypot(hover.x - trace[trace.length - 1].x, hover.y - trace[trace.length - 1].y).toFixed(2)} m
                  </text>
                )}
              </g>
            )}
            {calPts.length === 1 && hover && (
              <line x1={calPts[0].x} y1={calPts[0].y} x2={hover.x} y2={hover.y} className="cal-line" strokeWidth={sw * 2} />
            )}
            {geometry.calibration && plan && (
              <line
                x1={geometry.calibration.a.u * mpp}
                y1={geometry.calibration.a.v * mpp}
                x2={geometry.calibration.b.u * mpp}
                y2={geometry.calibration.b.v * mpp}
                className="cal-line set"
                strokeWidth={sw * 2}
              />
            )}
          </g>
        </svg>

        <div className="canvas-hint" aria-live="polite">
          {hint(tool, plan, calibrated, trace.length, calPts.length)}
        </div>
        <div className="scale-bar" aria-hidden="true">
          <span style={{ width: view.scale }} />
          1 m{!calibrated && plan ? " (uncalibrated)" : ""}
        </div>
        {!plan && !rooms.length && (
          <div className="canvas-empty">
            <div className="card onboarding-card">
              <span className="eyebrow">Step 1 of 3</span>
              <h2>Import the plan</h2>
              <p className="muted">Upload a floor plan, mark a known length to set its scale, then trace the room. Or start from dimensions.</p>
              <PlanImport projectId={project.id} onUploaded={async () => { await refreshProject(); setTool("calibrate"); }} />
              <button className="btn ghost" onClick={() => setRectDialog(true)}>
                Start from room dimensions instead
              </button>
            </div>
          </div>
        )}
      </div>

      <aside className="side-panel" aria-label="Plan properties">
        <section className="panel-section">
          <div className="panel-title">
            <h3>Plan</h3>
            {plan && <PlanImport projectId={project.id} compact onUploaded={async (a) => { await refreshProject(); update({ ...geometry, plan_asset_id: a.id, calibration: null }); setTool("calibrate"); }} />}
          </div>
          {plan ? (
            <div className="kv">
              <span>Source</span>
              <span className="truncate" title={plan.original_name}>{plan.source || plan.original_name}</span>
              <span>Scale</span>
              <span>{calibrated ? <strong className="num">1 px = {(mpp * 1000).toFixed(1)} mm</strong> : <span className="chip warn">Not calibrated</span>}</span>
            </div>
          ) : (
            <p className="muted small">No plan image. Rooms are drawn directly in metres.</p>
          )}
          <div className="btn-row">
            {plan && (
              <button className="btn sm" onClick={() => setTool("calibrate")}>
                <Ruler size={15} /> {calibrated ? "Recalibrate" : "Calibrate"}
              </button>
            )}
            {plan && calibrated && (
              <button className="btn sm" onClick={() => void suggestOutline()} disabled={extracting} data-testid="ai-trace">
                {extracting ? <span className="spinner" /> : <Sparkles size={15} />} Suggest outline
              </button>
            )}
            <button className="btn sm ghost" onClick={() => setRectDialog(true)}>
              Add rectangle
            </button>
          </div>
        </section>

        {extraction && (
          <section className="panel-section proposal-box">
            <div className="panel-title">
              <h3>Suggested outline</h3>
              {extraction.test_double && <span className="chip warn">Test double</span>}
            </div>
            <p className="small muted">{extraction.note}</p>
            {extraction.rooms.map((r) => (
              <div key={r.id} className="kv">
                <span>{r.name}</span>
                <span>
                  <span className={`chip ${r.confidence === "high" ? "ok" : "warn"}`}>{r.confidence} confidence</span>
                </span>
              </div>
            ))}
            {!!extraction.uncertain.length && (
              <ul className="small">
                {extraction.uncertain.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            )}
            {!!extraction.dimension_labels.length && <p className="small">Dimensions read from drawing: {extraction.dimension_labels.join(", ")}. Compare them with the traced lengths.</p>}
            <div className="btn-row">
              <button className="btn sm accent" onClick={acceptExtraction} disabled={!extraction.rooms.length}>
                Use as draft
              </button>
              <button className="btn sm" onClick={() => setExtraction(null)}>
                Discard
              </button>
            </div>
          </section>
        )}

        <section className="panel-section">
          <div className="panel-title">
            <h3>Rooms</h3>
            <span className="muted small">{rooms.length}</span>
          </div>
          {!rooms.length && <p className="muted small">Trace a room with the pen tool, or add a rectangle.</p>}
          <div className="room-list">
            {rooms.map((r) => (
              <button key={r.id} className={`room-item ${sel.roomId === r.id ? "sel" : ""}`} onClick={() => setSel({ roomId: r.id, vertex: null, openingId: null })}>
                <span>{r.name}</span>
                <span className="muted small num">{areaOf(r.polygon).toFixed(1)} m² · {r.openings.length} openings</span>
              </button>
            ))}
          </div>
        </section>

        {selectedRoom && (
          <RoomEditor
            room={selectedRoom}
            selectedOpening={sel.openingId}
            onSelectOpening={(id) => setSel({ roomId: selectedRoom.id, vertex: null, openingId: id })}
            onChange={(patch) => updateRoom(selectedRoom.id, patch)}
            onOpening={(id, patch) => updateOpening(selectedRoom.id, id, patch)}
            onDelete={deleteSelected}
            selectedVertex={sel.vertex}
          />
        )}

        <section className="panel-section confirm-box">
          {[...clientIssues.map((m) => ({ message: m, severity: "error" })), ...geometryIssues].slice(0, 6).map((i, k) => (
            <div key={k} className={`notice ${i.severity === "error" ? "error" : "warn"}`}>
              {i.message}
            </div>
          ))}
          {geometry.confirmed ? (
            <div className="notice ok">
              <Check size={16} /> Geometry confirmed. Editing it will require confirming again.
            </div>
          ) : (
            <p className="small muted">Inferred or traced geometry stays a draft until you confirm it.</p>
          )}
          <div className="btn-row">
            <span className="muted small">{saveLabel(geometrySave)}</span>
            {geometry.confirmed ? (
              <button className="btn primary" onClick={() => setStep("furnish")}>
                Continue to furniture
              </button>
            ) : (
              <button className="btn primary" disabled={!canConfirm} onClick={() => setConfirmOpen(true)} data-testid="confirm-geometry">
                Confirm geometry
              </button>
            )}
          </div>
          {serverErrors.length > 0 && <span className="sr-only">{serverErrors.length} geometry errors</span>}
        </section>
      </aside>

      {calDialog && (
        <CalibrationDialog
          pixels={Math.hypot(calDialog.b.x - calDialog.a.x, calDialog.b.y - calDialog.a.y) / mpp}
          onClose={() => setCalDialog(null)}
          onApply={(len) => {
            applyCalibration(calDialog.a, calDialog.b, len);
            setCalDialog(null);
          }}
        />
      )}
      {rectDialog && (
        <RectDialog
          onClose={() => setRectDialog(false)}
          onAdd={(w, d, name) => {
            const id = uid("room", rooms.map((r) => r.id));
            const x0 = rooms.length ? Math.max(...rooms.flatMap((r) => r.polygon.map((p) => p.x))) : 1;
            const y0 = rooms.length ? Math.min(...rooms.flatMap((r) => r.polygon.map((p) => p.y))) : 1;
            const room: Room = {
              id,
              name,
              polygon: [
                { x: x0, y: y0 },
                { x: x0 + w, y: y0 },
                { x: x0 + w, y: y0 + d },
                { x: x0, y: y0 + d },
              ],
              wall_height_m: 2.7,
              wall_thickness_m: 0.15,
              openings: [],
            };
            update({ ...geometry, rooms: [...rooms, room] });
            setRectDialog(false);
            setSel({ roomId: id, vertex: null, openingId: null });
            setTimeout(fit, 0);
          }}
        />
      )}
      {confirmOpen && (
        <Dialog
          title="Confirm room geometry?"
          subtitle="Furniture layouts and AI proposals will use these walls, openings and dimensions as fixed."
          onClose={() => setConfirmOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmOpen(false)}>
                Keep editing
              </button>
              <button className="btn primary" onClick={() => void confirm()} data-testid="confirm-geometry-yes">
                Confirm
              </button>
            </>
          }
        >
          <div className="kv">
            {rooms.map((r) => (
              <FragmentRow key={r.id} a={r.name} b={`${areaOf(r.polygon).toFixed(1)} m² · walls ${r.wall_height_m.toFixed(2)} m · ${r.openings.length} openings`} />
            ))}
          </div>
          <p className="small muted">ReSpace supports concept exploration only. It does not verify building-code compliance or structure.</p>
        </Dialog>
      )}
    </div>
  );
}

function FragmentRow({ a, b }: { a: string; b: string }) {
  return (
    <>
      <span>{a}</span>
      <span>{b}</span>
    </>
  );
}

function safeMpp(cal: Calibration): number {
  try {
    return metresPerPixel(cal);
  } catch {
    return PROVISIONAL_MPP;
  }
}

function pointIn(p: Point, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function hint(tool: Tool, plan: Asset | undefined, calibrated: boolean, tracing: number, cal: number): string {
  if (tool === "calibrate") return cal === 0 ? "Click the start of a dimension you know, such as a wall or a dimension line." : "Click the end of the known length.";
  if (tool === "trace") {
    if (plan && !calibrated) return "Calibrate first so traced walls are measured.";
    return tracing === 0 ? "Click each interior corner. Hold Shift to place freely." : "Continue clicking corners. Click the first corner or press Enter to close.";
  }
  if (tool === "door" || tool === "window" || tool === "opening") return "Click on a wall to place it, then adjust its size in the panel.";
  if (tool === "pan") return "Drag to pan. Scroll or pinch to zoom.";
  return "Drag corners to adjust. Double-click a wall to add a corner. Delete removes the selection.";
}

export function saveLabel(s: string) {
  return { saved: "All changes saved", saving: "Saving…", unsaved: "Unsaved changes", error: "Save failed", stale: "Out of date" }[s] ?? s;
}

function ToolBtn({ icon, label, active, onClick, disabled }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="icon-btn rail-btn" aria-label={label} title={label} aria-pressed={active} onClick={onClick} disabled={disabled}>
      {icon}
    </button>
  );
}

function RoomEditor({
  room,
  onChange,
  onOpening,
  onDelete,
  selectedOpening,
  onSelectOpening,
  selectedVertex,
}: {
  room: Room;
  onChange: (p: Partial<Room>) => void;
  onOpening: (id: string, p: Partial<Opening>) => void;
  onDelete: () => void;
  selectedOpening: string | null;
  onSelectOpening: (id: string) => void;
  selectedVertex: number | null;
}) {
  const n = room.polygon.length;
  return (
    <section className="panel-section">
      <div className="panel-title">
        <h3>{room.name}</h3>
        <button className="icon-btn" aria-label={selectedOpening ? "Delete opening" : selectedVertex !== null ? "Delete corner" : "Delete room"} title="Delete selection" onClick={onDelete}>
          <Trash2 size={16} />
        </button>
      </div>
      <label className="field">
        <span>Name</span>
        <input className="input" value={room.name} maxLength={60} onChange={(e) => onChange({ name: e.target.value })} />
      </label>
      <div className="grid-2">
        <MetreInput label="Wall height" value={room.wall_height_m} min={2} max={6} onCommit={(v) => onChange({ wall_height_m: v })} />
        <MetreInput label="Wall thickness" value={room.wall_thickness_m} min={0.05} max={0.6} onCommit={(v) => onChange({ wall_thickness_m: v })} />
      </div>
      <details className="disclosure">
        <summary>Corners ({n})</summary>
        <div className="vertex-table">
          {room.polygon.map((p, i) => (
            <div key={i} className={`grid-3 ${selectedVertex === i ? "sel" : ""}`}>
              <span className="muted small">#{i + 1}</span>
              <MetreInput label="x" value={p.x} digits={3} onCommit={(v) => onChange({ polygon: room.polygon.map((q, k) => (k === i ? { ...q, x: v } : q)) })} />
              <MetreInput label="y" value={p.y} digits={3} onCommit={(v) => onChange({ polygon: room.polygon.map((q, k) => (k === i ? { ...q, y: v } : q)) })} />
            </div>
          ))}
        </div>
      </details>
      <div className="panel-title">
        <h3 className="small-title">Doors and windows</h3>
      </div>
      {!room.openings.length && <p className="muted small">Use the door or window tool and click a wall.</p>}
      {room.openings.map((o) => {
        const len = o.wall_index < n ? edgeFrame(room, o.wall_index).length : 0;
        const open = selectedOpening === o.id;
        return (
          <div key={o.id} className={`opening-card ${open ? "open" : ""}`}>
            <button className="opening-head" onClick={() => onSelectOpening(o.id)} aria-expanded={open}>
              <span className="chip">{o.kind}</span>
              <span className="num small">
                wall {o.wall_index + 1} · {o.width_m.toFixed(2)} m{o.is_entrance ? " · entrance" : ""}
              </span>
            </button>
            {open && (
              <div className="opening-body">
                <div className="grid-2">
                  <label className="field">
                    <span>Wall</span>
                    <select className="select" value={o.wall_index} onChange={(e) => onOpening(o.id, { wall_index: Number(e.target.value) })}>
                      {room.polygon.map((_, i) => (
                        <option key={i} value={i}>
                          Wall {i + 1} ({edgeFrame(room, i).length.toFixed(2)} m)
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Type</span>
                    <select className="select" value={o.kind} onChange={(e) => onOpening(o.id, { kind: e.target.value as OpeningKind })}>
                      <option value="door">Door</option>
                      <option value="window">Window</option>
                      <option value="opening">Open passage</option>
                    </select>
                  </label>
                  <MetreInput label="Centre from corner" value={o.offset_m} min={0} max={len} onCommit={(v) => onOpening(o.id, { offset_m: v })} />
                  <MetreInput label="Width" value={o.width_m} min={0.3} max={len} onCommit={(v) => onOpening(o.id, { width_m: v })} />
                  <MetreInput label="Height" value={o.height_m} min={0.3} max={room.wall_height_m} onCommit={(v) => onOpening(o.id, { height_m: v })} />
                  {o.kind === "window" && <MetreInput label="Sill height" value={o.sill_m} min={0} max={room.wall_height_m} onCommit={(v) => onOpening(o.id, { sill_m: v })} />}
                </div>
                {o.kind === "door" && (
                  <div className="grid-2">
                    <label className="field">
                      <span>Swing</span>
                      <select className="select" value={o.swing} onChange={(e) => onOpening(o.id, { swing: e.target.value as Opening["swing"] })}>
                        <option value="in">Into this room</option>
                        <option value="out">Out of this room</option>
                        <option value="none">Sliding / none</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Hinge side</span>
                      <select className="select" value={o.hinge} onChange={(e) => onOpening(o.id, { hinge: e.target.value as Opening["hinge"] })}>
                        <option value="start">Start of wall</option>
                        <option value="end">End of wall</option>
                      </select>
                    </label>
                  </div>
                )}
                {o.kind !== "window" && (
                  <label className="check">
                    <input type="checkbox" checked={o.is_entrance} onChange={(e) => onOpening(o.id, { is_entrance: e.target.checked })} /> Main entrance (walkway check starts here)
                  </label>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function CalibrationDialog({ pixels, onClose, onApply }: { pixels: number; onClose: () => void; onApply: (m: number) => void }) {
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<"m" | "mm">("mm");
  const metres = Number(value.replace(",", ".")) / (unit === "mm" ? 1000 : 1);
  const valid = Number.isFinite(metres) && metres > 0.1 && metres < 100;
  return (
    <Dialog
      title="Set the plan scale"
      subtitle={`You marked a segment ${pixels.toFixed(0)} px long. Enter its real length.`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={() => onApply(metres)} data-testid="apply-calibration">
            Apply scale
          </button>
        </>
      }
    >
      <div className="grid-2">
        <label className="field">
          <span>Known length</span>
          <input className="input num" inputMode="decimal" autoFocus value={value} placeholder={unit === "mm" ? "e.g. 5400" : "e.g. 5.4"} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && valid && onApply(metres)} data-testid="calibration-length" />
        </label>
        <label className="field">
          <span>Unit</span>
          <select className="select" value={unit} onChange={(e) => setUnit(e.target.value as "m" | "mm")}>
            <option value="mm">millimetres</option>
            <option value="m">metres</option>
          </select>
        </label>
      </div>
      {valid && <p className="small muted num">1 px = {((metres / pixels) * 1000).toFixed(2)} mm</p>}
      <p className="small muted">Use the longest dimension you can read reliably. Shorter segments magnify marking errors.</p>
    </Dialog>
  );
}

function RectDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (w: number, d: number, name: string) => void }) {
  const [w, setW] = useState(5);
  const [d, setD] = useState(4);
  const [name, setName] = useState("Living room");
  return (
    <Dialog
      title="Add a rectangular room"
      subtitle="Interior dimensions, wall face to wall face."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onAdd(w, d, name || "Room")}>
            Add room
          </button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="grid-2">
        <MetreInput label="Width" value={w} min={1} max={40} onCommit={setW} />
        <MetreInput label="Depth" value={d} min={1} max={40} onCommit={setD} />
      </div>
    </Dialog>
  );
}
