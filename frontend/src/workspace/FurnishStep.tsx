import { useRef, useState } from "react";
import { ImagePlus, Minus, Plus, Trash2, X } from "lucide-react";
import { api } from "../api/client";
import type { Asset, Category, CatalogCategory, FurnitureRequirement, SizeRange } from "../api/types";
import { ColorPicker, MaterialPicker, MetreInput } from "../components/common";
import { Thumbnail } from "../catalog/thumbnails";
import { toast } from "../state/ui";
import { useWorkspace } from "../state/workspace";
import { saveLabel } from "./PlanStep";

const PRIORITIES = ["clear walkway", "conversation seating", "daylight", "storage", "work from home", "evening mood", "flexible use", "low maintenance"];

export default function FurnishStep() {
  const { project, catalog, inventory, brief, setInventory, setBrief, inventorySave, setStep, geometry, refreshProject } = useWorkspace();
  const [openId, setOpenId] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const refInput = useRef<HTMLInputElement>(null);
  if (!project || !catalog || !inventory || !brief || !geometry) return null;
  const cats = catalog.categories;
  const byId = Object.fromEntries(cats.map((c) => [c.id, c])) as Record<Category, CatalogCategory>;
  const references = project.assets.filter((a) => a.kind === "reference");

  const add = (cat: CatalogCategory) => {
    const taken = inventory.items.map((i) => i.id);
    let id = cat.id.replace("_", "-");
    let n = 2;
    while (taken.includes(id)) id = `${cat.id.replace("_", "-")}-${n++}`;
    const item: FurnitureRequirement = {
      id,
      category: cat.id,
      variant: cat.variants[0].id,
      room_id: geometry.rooms.length > 1 ? geometry.rooms[0].id : null,
      count: 1,
      required: !["rug", "lamp", "wall_art"].includes(cat.id),
      existing: false,
      size: null,
      finish: null,
      notes: "",
    };
    setInventory({ ...inventory, items: [...inventory.items, item] });
    setOpenId(id);
  };

  const patch = (id: string, p: Partial<FurnitureRequirement>) =>
    setInventory({ ...inventory, items: inventory.items.map((i) => (i.id === id ? { ...i, ...p } : i)) });

  const remove = (id: string) => setInventory({ ...inventory, items: inventory.items.filter((i) => i.id !== id) });

  const uploadReference = async (file: File) => {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("kind", "reference");
    try {
      const a = await api<Asset>(`/api/projects/${project.id}/assets`, { method: "POST", body: form });
      await refreshProject();
      setBrief({ ...brief, reference_asset_ids: [...brief.reference_asset_ids, a.id].slice(0, 3) });
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const required = inventory.items.filter((i) => i.required).reduce((s, i) => s + i.count, 0);
  const optional = inventory.items.filter((i) => !i.required).reduce((s, i) => s + i.count, 0);

  return (
    <div className="furnish-step">
      <section className="furnish-main">
        <header className="step-head">
          <div>
            <span className="eyebrow">Step 2 of 3</span>
            <h1>Furniture and brief</h1>
            <p className="muted">List what the room needs, what must stay, and how it should feel.</p>
          </div>
          <div className="btn-row">
            <span className="muted small">{saveLabel(inventorySave)}</span>
            <button className="btn primary" disabled={!inventory.items.length} onClick={() => setStep("design")} data-testid="to-design">
              Continue to design
            </button>
          </div>
        </header>

        <div className="catalog-strip" role="list" aria-label="Add furniture">
          {cats.map((c) => (
            <button key={c.id} role="listitem" className="catalog-tile" onClick={() => add(c)} data-testid={`add-${c.id}`}>
              <Thumbnail category={c.id} size={44} title={c.label} />
              <span>{c.label}</span>
              <Plus size={14} className="tile-plus" />
            </button>
          ))}
        </div>

        <div className="inventory-head">
          <h2>Inventory</h2>
          <span className="muted small num">
            {required} required · {optional} optional
          </span>
        </div>
        {!inventory.items.length && <div className="notice">Add furniture from the strip above. Each item can have a count, size limits and a preferred finish.</div>}
        <div className="inventory-list">
          {inventory.items.map((item) => {
            const cat = byId[item.category];
            const open = openId === item.id;
            const variant = cat.variants.find((v) => v.id === item.variant) ?? cat.variants[0];
            return (
              <article key={item.id} className={`inv-card ${open ? "open" : ""}`}>
                <div className="inv-row">
                  <button className="inv-main" onClick={() => setOpenId(open ? null : item.id)} aria-expanded={open}>
                    <Thumbnail category={item.category} size={44} />
                    <span className="inv-text">
                      <strong>{variant.label}</strong>
                      <span className="muted small">
                        {item.size ? `${fmtRange(item.size)}` : `${variant.default.map((v) => v.toFixed(2)).join(" × ")} m default`}
                        {item.room_id && geometry.rooms.length > 1 ? ` · ${geometry.rooms.find((r) => r.id === item.room_id)?.name ?? item.room_id}` : ""}
                      </span>
                    </span>
                  </button>
                  <div className="inv-tags">
                    {item.existing && <span className="chip dark">Existing</span>}
                    <button className={`chip ${item.required ? "ok" : "outline"}`} onClick={() => patch(item.id, { required: !item.required })} aria-label={`Toggle required for ${variant.label}`}>
                      {item.required ? "Required" : "Optional"}
                    </button>
                  </div>
                  <div className="stepper" aria-label={`Count of ${variant.label}`}>
                    <button className="icon-btn" aria-label="Fewer" onClick={() => item.count > 1 && patch(item.id, { count: item.count - 1 })}>
                      <Minus size={14} />
                    </button>
                    <span className="num">{item.count}</span>
                    <button className="icon-btn" aria-label="More" onClick={() => item.count < 24 && patch(item.id, { count: item.count + 1 })}>
                      <Plus size={14} />
                    </button>
                  </div>
                  <button className="icon-btn" aria-label={`Remove ${variant.label}`} onClick={() => remove(item.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
                {open && <ItemEditor item={item} cat={cat} onPatch={(p) => patch(item.id, p)} />}
              </article>
            );
          })}
        </div>
      </section>

      <aside className="brief-panel">
        <section className="panel-section">
          <h3>Design brief</h3>
          <textarea
            className="textarea"
            rows={7}
            maxLength={2000}
            value={brief.text}
            placeholder="Style, materials, colour, mood, how the room is used…"
            onChange={(e) => setBrief({ ...brief, text: e.target.value })}
            data-testid="brief-text"
            aria-label="Design brief"
          />
          <span className="muted small num">{brief.text.length} / 2000</span>
        </section>
        <section className="panel-section">
          <h3>Priorities</h3>
          <div className="chips">
            {[...new Set([...PRIORITIES, ...brief.priorities])].map((p) => {
              const on = brief.priorities.includes(p);
              return (
                <button
                  key={p}
                  className={`chip ${on ? "ok" : "outline"}`}
                  aria-pressed={on}
                  onClick={() => setBrief({ ...brief, priorities: on ? brief.priorities.filter((x) => x !== p) : [...brief.priorities, p].slice(0, 8) })}
                >
                  {p}
                </button>
              );
            })}
          </div>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) setBrief({ ...brief, priorities: [...brief.priorities, custom.trim()].slice(0, 8) });
              setCustom("");
            }}
          >
            <input className="input" placeholder="Add a priority" value={custom} maxLength={40} onChange={(e) => setCustom(e.target.value)} />
            <button className="btn sm">Add</button>
          </form>
        </section>
        <section className="panel-section">
          <h3>Walkway clearance</h3>
          <p className="muted small">Used to check that a route of this width connects the entrance to every piece of furniture.</p>
          <div className="range-row">
            <input
              type="range"
              min={0.6}
              max={1.5}
              step={0.05}
              value={inventory.walkway_clearance_m}
              onChange={(e) => setInventory({ ...inventory, walkway_clearance_m: Number(e.target.value) })}
              aria-label="Walkway clearance in metres"
            />
            <strong className="num">{inventory.walkway_clearance_m.toFixed(2)} m</strong>
          </div>
        </section>
        <section className="panel-section">
          <h3>Reference images</h3>
          <p className="muted small">Optional mood images (up to 3) sent with generation requests.</p>
          <div className="ref-grid">
            {references.map((r) => {
              const on = brief.reference_asset_ids.includes(r.id);
              return (
                <button key={r.id} className={`ref-thumb ${on ? "on" : ""}`} aria-pressed={on} onClick={() => setBrief({ ...brief, reference_asset_ids: on ? brief.reference_asset_ids.filter((x) => x !== r.id) : [...brief.reference_asset_ids, r.id].slice(0, 3) })}>
                  <img src={r.url} alt={r.original_name} />
                  {on && <span className="chip ok">Used</span>}
                </button>
              );
            })}
            {references.length < 6 && (
              <button className="ref-thumb add" onClick={() => refInput.current?.click()}>
                <ImagePlus size={18} />
                <span className="small">Add image</span>
              </button>
            )}
          </div>
          <input ref={refInput} type="file" hidden accept="image/png,image/jpeg" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadReference(f); e.target.value = ""; }} />
        </section>
      </aside>
    </div>
  );
}

function fmtRange(r: SizeRange) {
  const f = (a: number, b: number) => (Math.abs(a - b) < 1e-6 ? a.toFixed(2) : `${a.toFixed(2)}–${b.toFixed(2)}`);
  return `${f(r.min.w, r.max.w)} × ${f(r.min.d, r.max.d)} × ${f(r.min.h, r.max.h)} m`;
}

function ItemEditor({ item, cat, onPatch }: { item: FurnitureRequirement; cat: CatalogCategory; onPatch: (p: Partial<FurnitureRequirement>) => void }) {
  const { catalog, geometry } = useWorkspace();
  const variant = cat.variants.find((v) => v.id === item.variant) ?? cat.variants[0];
  const [w, d, h] = variant.default;
  const range: SizeRange = item.size ?? { min: { w, d, h }, max: { w, d, h } };
  const setRange = (which: "min" | "max", key: "w" | "d" | "h", v: number) => {
    const next: SizeRange = { min: { ...range.min }, max: { ...range.max } };
    next[which][key] = v;
    if (which === "min" && next.max[key] < v) next.max[key] = v;
    if (which === "max" && next.min[key] > v) next.min[key] = v;
    onPatch({ size: next });
  };
  const idx = { w: 0, d: 1, h: 2 } as const;
  return (
    <div className="inv-editor">
      <div className="grid-2">
        <label className="field">
          <span>Model</span>
          <select className="select" value={variant.id} onChange={(e) => onPatch({ variant: e.target.value, size: null })}>
            {cat.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        {geometry && geometry.rooms.length > 1 && (
          <label className="field">
            <span>Room</span>
            <select className="select" value={item.room_id ?? ""} onChange={(e) => onPatch({ room_id: e.target.value || null })}>
              <option value="">Any room</option>
              {geometry.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="size-table" role="group" aria-label="Allowed size range">
        <span />
        <span className="eyebrow">Min</span>
        <span className="eyebrow">Max</span>
        {(["w", "d", "h"] as const).map((k) => (
          <SizeRow
            key={k}
            label={{ w: "Width", d: "Depth", h: "Height" }[k]}
            min={range.min[k]}
            max={range.max[k]}
            lo={cat.min_size[idx[k]]}
            hi={cat.max_size[idx[k]]}
            onMin={(v) => setRange("min", k, v)}
            onMax={(v) => setRange("max", k, v)}
          />
        ))}
      </div>
      <p className="muted small">Sizes are approximate concept envelopes, not specific products.</p>
      {item.size && (
        <button className="btn sm ghost" onClick={() => onPatch({ size: null })}>
          <X size={14} /> Use default size
        </button>
      )}
      {catalog && (
        <>
          <MaterialPicker materials={cat.materials} catalog={catalog.materials} value={item.finish?.material ?? ""} onChange={(m) => onPatch({ finish: { material: m, color: item.finish?.color ?? catalog.materials[m]?.color ?? cat.default_color } })} label="Preferred finish (optional)" />
          {item.finish && <ColorPicker value={item.finish.color} onChange={(c) => onPatch({ finish: { ...item.finish!, color: c } })} />}
          {item.finish && (
            <button className="btn sm ghost" onClick={() => onPatch({ finish: null })}>
              <X size={14} /> Let the design choose
            </button>
          )}
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={item.existing} onChange={(e) => onPatch({ existing: e.target.checked, required: e.target.checked ? true : item.required })} />
        Existing piece that must be retained
      </label>
      <label className="field">
        <span>Notes</span>
        <input className="input" maxLength={200} value={item.notes} placeholder="e.g. faces the window" onChange={(e) => onPatch({ notes: e.target.value })} />
      </label>
    </div>
  );
}

function SizeRow({ label, min, max, lo, hi, onMin, onMax }: { label: string; min: number; max: number; lo: number; hi: number; onMin: (v: number) => void; onMax: (v: number) => void }) {
  return (
    <>
      <span className="small">{label}</span>
      <MetreInput label={`${label} min`} value={min} min={lo} max={hi} onCommit={onMin} />
      <MetreInput label={`${label} max`} value={max} min={lo} max={hi} onCommit={onMax} />
    </>
  );
}
