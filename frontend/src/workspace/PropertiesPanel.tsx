import { Copy, Lock, LockOpen, Plus, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Category, LockableProperty, Mood, Scene, SceneObject } from "../api/types";
import { LOCKABLE } from "../api/types";
import { ColorPicker, MaterialPicker, MetreInput } from "../components/common";
import { Thumbnail } from "../catalog/thumbnails";
import { polygonCentroid } from "../geometry/shapes";
import { useWorkspace } from "../state/workspace";

const LOCK_LABEL: Record<LockableProperty, string> = {
  position: "Position",
  rotation: "Rotation",
  size: "Size",
  material: "Material",
  presence: "Keep in design",
};

export function ObjectPanel({ obj }: { obj: SceneObject }) {
  const { catalog, inventory, updateObject, scene, commit, select } = useWorkspace();
  if (!catalog || !scene) return null;
  const cat = catalog.categories.find((c) => c.id === obj.category)!;
  const req = inventory?.items.find((i) => i.id === obj.requirement_id);
  const locked = (p: LockableProperty) => obj.locks.includes(p);
  const status = obj.existing ? "Existing" : req ? (req.required ? "Required" : "Optional") : "Optional addition";
  const lo = req?.size?.min ?? { w: cat.min_size[0], d: cat.min_size[1], h: cat.min_size[2] };
  const hi = req?.size?.max ?? { w: cat.max_size[0], d: cat.max_size[1], h: cat.max_size[2] };

  const toggleLock = (p: LockableProperty) => {
    const locks = locked(p) ? obj.locks.filter((l) => l !== p) : [...obj.locks, p];
    updateObject(obj.id, { locks: LOCKABLE.filter((l) => locks.includes(l)) }, `${locked(p) ? "Unlocked" : "Locked"} ${p} of ${obj.id}`);
  };
  const lockAll = () => {
    const all = obj.locks.length === LOCKABLE.length;
    updateObject(obj.id, { locks: all ? [] : [...LOCKABLE] }, `${all ? "Unlocked" : "Locked"} ${obj.id}`);
  };
  const remove = () => {
    commit({ ...scene, objects: scene.objects.filter((o) => o.id !== obj.id) }, `Removed ${obj.id}`);
    select([]);
  };
  const duplicate = () => {
    const ids = scene.objects.map((o) => o.id);
    let n = 2;
    const base = obj.id.replace(/-\d+$/, "");
    while (ids.includes(`${base}-${n}`)) n++;
    const copy: SceneObject = { ...obj, id: `${base}-${n}`, position: { x: obj.position.x + 0.3, y: obj.position.y + 0.3 }, locks: [], existing: false };
    commit({ ...scene, objects: [...scene.objects, copy] }, `Duplicated ${obj.id}`);
    select([copy.id]);
  };

  return (
    <div className="props" data-testid="object-panel">
      <div className="props-head">
        <Thumbnail category={obj.category} size={52} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <input
            className="title-input"
            value={obj.label || cat.label}
            maxLength={60}
            aria-label="Label"
            onChange={(e) => updateObject(obj.id, { label: e.target.value })}
          />
          <div className="chips">
            <span className={`chip ${status === "Required" ? "ok" : status === "Existing" ? "dark" : "outline"}`}>{status}</span>
            <span className="chip outline">{obj.id}</span>
          </div>
        </div>
      </div>

      <section className="panel-section tight">
        <div className="panel-title">
          <h3 className="small-title">Locks</h3>
          <button className="btn sm ghost" onClick={lockAll} data-testid="lock-all">
            {obj.locks.length === LOCKABLE.length ? <LockOpen size={14} /> : <Lock size={14} />}
            {obj.locks.length === LOCKABLE.length ? "Unlock all" : "Lock all"}
          </button>
        </div>
        <div className="lock-row">
          {LOCKABLE.map((p) => (
            <button key={p} className={`lock-chip ${locked(p) ? "on" : ""}`} aria-pressed={locked(p)} onClick={() => toggleLock(p)}>
              {locked(p) ? <Lock size={12} /> : <LockOpen size={12} />} {LOCK_LABEL[p]}
            </button>
          ))}
        </div>
        <p className="muted small">Locked properties are never changed by AI edits.</p>
      </section>

      <section className="panel-section tight">
        <label className="field">
          <span>Model</span>
          <select className="select" value={obj.variant} disabled={locked("size")} onChange={(e) => {
            const v = cat.variants.find((x) => x.id === e.target.value)!;
            updateObject(obj.id, { variant: v.id, size: { w: v.default[0], d: v.default[1], h: v.default[2] } }, `Changed model of ${obj.id}`);
          }}>
            {cat.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid-3">
          <MetreInput label="Width" value={obj.size.w} min={lo.w} max={hi.w} disabled={locked("size")} onCommit={(w) => updateObject(obj.id, { size: { ...obj.size, w } }, `Resized ${obj.id}`)} testId="size-w" />
          <MetreInput label="Depth" value={obj.size.d} min={lo.d} max={hi.d} disabled={locked("size")} onCommit={(d) => updateObject(obj.id, { size: { ...obj.size, d } }, `Resized ${obj.id}`)} />
          <MetreInput label="Height" value={obj.size.h} min={lo.h} max={hi.h} disabled={locked("size")} onCommit={(h) => updateObject(obj.id, { size: { ...obj.size, h } }, `Resized ${obj.id}`)} />
        </div>
        <p className="muted small num">
          Allowed {lo.w.toFixed(2)}–{hi.w.toFixed(2)} × {lo.d.toFixed(2)}–{hi.d.toFixed(2)} × {lo.h.toFixed(2)}–{hi.h.toFixed(2)} m{req?.size ? " (from brief)" : ""}. Approximate envelope, not a product.
        </p>
        <div className="grid-3">
          <MetreInput label="x" value={obj.position.x} digits={2} disabled={locked("position")} onCommit={(x) => updateObject(obj.id, { position: { ...obj.position, x } }, `Moved ${obj.id}`)} testId="pos-x" />
          <MetreInput label="y" value={obj.position.y} digits={2} disabled={locked("position")} onCommit={(y) => updateObject(obj.id, { position: { ...obj.position, y } }, `Moved ${obj.id}`)} />
          <MetreInput label="Rotation" unit="°" value={obj.rotation_deg} digits={0} step={15} min={-720} max={720} disabled={locked("rotation")} onCommit={(r) => updateObject(obj.id, { rotation_deg: ((r % 360) + 360) % 360 }, `Rotated ${obj.id}`)} />
        </div>
        <div className="btn-row">
          <button className="btn sm" disabled={locked("rotation")} onClick={() => updateObject(obj.id, { rotation_deg: (obj.rotation_deg + 345) % 360 }, `Rotated ${obj.id}`)} aria-label="Rotate 15 degrees anticlockwise">
            <RotateCcw size={14} /> 15°
          </button>
          <button className="btn sm" disabled={locked("rotation")} onClick={() => updateObject(obj.id, { rotation_deg: (obj.rotation_deg + 15) % 360 }, `Rotated ${obj.id}`)} aria-label="Rotate 15 degrees clockwise">
            <RotateCw size={14} /> 15°
          </button>
          <button className="btn sm" disabled={locked("rotation")} onClick={() => updateObject(obj.id, { rotation_deg: (obj.rotation_deg + 90) % 360 }, `Rotated ${obj.id}`)}>
            90°
          </button>
        </div>
        {(obj.category === "wall_art" || (obj.category === "lamp" && obj.variant === "pendant")) && (
          <MetreInput label="Height above floor" value={obj.elevation_m} min={0} max={4} disabled={locked("position")} onCommit={(elevation_m) => updateObject(obj.id, { elevation_m })} />
        )}
      </section>

      <section className="panel-section tight">
        <MaterialPicker materials={cat.materials} catalog={catalog.materials} value={obj.finish.material} disabled={locked("material")} onChange={(m) => updateObject(obj.id, { finish: { material: m, color: catalog.materials[m]?.color ?? obj.finish.color } }, `Changed material of ${obj.id}`)} />
        <ColorPicker value={obj.finish.color} disabled={locked("material")} onChange={(c) => updateObject(obj.id, { finish: { ...obj.finish, color: c } }, `Changed colour of ${obj.id}`)} />
      </section>

      <div className="btn-row" style={{ padding: "0 16px 16px" }}>
        <button className="btn sm" onClick={duplicate}>
          <Copy size={14} /> Duplicate
        </button>
        <button className="btn sm danger" onClick={remove} disabled={locked("presence") || obj.existing} title={obj.existing ? "Existing furniture must be retained" : undefined}>
          <Trash2 size={14} /> Remove
        </button>
      </div>
    </div>
  );
}

export function ScenePanel() {
  const { catalog, scene, geometry, commit, inventory, select } = useWorkspace();
  const [adding, setAdding] = useState(false);
  if (!catalog || !scene || !geometry) return null;
  const L = scene.lighting;
  const setLighting = (patch: Partial<Scene["lighting"]>) => commit({ ...scene, lighting: { ...L, ...patch } }, "Changed lighting");
  const setFinish = (roomId: string, surface: "floor" | "walls", patch: { material?: string; color?: string }) =>
    commit(
      {
        ...scene,
        finishes: scene.finishes.map((f) => (f.room_id === roomId ? { ...f, [surface]: { ...f[surface], ...patch } } : f)),
      },
      `Changed ${surface} in ${roomId}`,
    );

  const addItem = (category: Category) => {
    const cat = catalog.categories.find((c) => c.id === category)!;
    const room = geometry.rooms[0];
    const c = polygonCentroid(room.polygon);
    const placedFor = (rid: string) => scene.objects.filter((o) => o.requirement_id === rid).length;
    const req = inventory?.items.find((i) => i.category === category && placedFor(i.id) < i.count);
    const ids = scene.objects.map((o) => o.id);
    let n = 1;
    const base = req?.id ?? category.replace("_", "-");
    while (ids.includes(`${base}-${n}`) || (n === 1 && ids.includes(base))) n++;
    const v = cat.variants.find((x) => x.id === req?.variant) ?? cat.variants[0];
    const obj: SceneObject = {
      id: n === 1 ? base : `${base}-${n}`,
      category,
      variant: v.id,
      room_id: req?.room_id ?? room.id,
      requirement_id: req?.id ?? null,
      label: "",
      position: { x: +c.x.toFixed(2), y: +c.y.toFixed(2) },
      rotation_deg: 0,
      size: { w: v.default[0], d: v.default[1], h: v.default[2] },
      finish: req?.finish ?? { material: cat.default_material, color: cat.default_color },
      accent: null,
      elevation_m: category === "wall_art" ? 1.2 : v.id === "pendant" ? Math.max(0, room.wall_height_m - 1.0) : 0,
      locks: [],
      existing: false,
    };
    commit({ ...scene, objects: [...scene.objects, obj] }, `Added ${obj.id}`);
    select([obj.id]);
    setAdding(false);
  };

  return (
    <div className="props" data-testid="scene-panel">
      <section className="panel-section tight">
        <div className="panel-title">
          <h3>Furniture</h3>
          <span className="muted small">{scene.objects.length}</span>
        </div>
        <div className="object-list" role="list">
          {scene.objects.map((o) => (
            <button key={o.id} role="listitem" className="object-row" onClick={() => select([o.id])} data-testid={`object-${o.id}`}>
              <Thumbnail category={o.category} size={28} />
              <span className="truncate">{o.label || catalog.categories.find((c) => c.id === o.category)?.label}</span>
              {o.locks.length > 0 && <Lock size={12} aria-label="Locked" />}
              <span className="muted small num">{o.size.w.toFixed(2)} × {o.size.d.toFixed(2)}</span>
            </button>
          ))}
          {!scene.objects.length && <p className="muted small">No furniture yet. Add items below or ask the assistant.</p>}
        </div>
      </section>
      <section className="panel-section tight">
        <div className="panel-title">
          <h3>Lighting</h3>
        </div>
        <div className="seg" role="group" aria-label="Lighting mood">
          {(["daylight", "overcast", "evening", "night"] as Mood[]).map((m) => (
            <button key={m} aria-pressed={L.mood === m} onClick={() => setLighting({ mood: m })}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <label className="field">
          <span>
            Colour temperature <strong className="num">{L.color_temperature_k} K</strong>
          </span>
          <input type="range" className="kelvin" min={2200} max={6500} step={100} value={L.color_temperature_k} onChange={(e) => setLighting({ color_temperature_k: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>
            Intensity <strong className="num">{Math.round(L.intensity * 100)}%</strong>
          </span>
          <input type="range" min={0.1} max={2} step={0.05} value={L.intensity} onChange={(e) => setLighting({ intensity: Number(e.target.value) })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={L.accent_lights} onChange={(e) => setLighting({ accent_lights: e.target.checked })} /> Warm accent lighting
        </label>
        <p className="muted small">Indicative mood only, not a lighting calculation.</p>
      </section>
      {scene.finishes.map((f) => {
        const room = geometry.rooms.find((r) => r.id === f.room_id);
        return (
          <section key={f.room_id} className="panel-section tight">
            <h3>{room?.name ?? f.room_id} finishes</h3>
            <MaterialPicker label="Floor" materials={catalog.floor_materials} catalog={catalog.materials} value={f.floor.material} onChange={(m) => setFinish(f.room_id, "floor", { material: m, color: catalog.materials[m]?.color })} />
            <ColorPicker label="Wall colour" value={f.walls.color} onChange={(c) => setFinish(f.room_id, "walls", { color: c })} />
          </section>
        );
      })}
      <section className="panel-section tight">
        <div className="panel-title">
          <h3>Add furniture</h3>
          <button className="btn sm" onClick={() => setAdding(!adding)} aria-expanded={adding}>
            <Plus size={14} /> Add
          </button>
        </div>
        {adding && (
          <div className="mini-catalog">
            {catalog.categories.map((c) => (
              <button key={c.id} onClick={() => addItem(c.id)} className="catalog-tile small">
                <Thumbnail category={c.id} size={34} />
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        )}
        <p className="muted small">Items not in the brief are kept separate as optional additions.</p>
      </section>
    </div>
  );
}
