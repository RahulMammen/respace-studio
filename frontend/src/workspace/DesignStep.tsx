import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Copy,
  Eye,
  Footprints,
  History,
  Layers,
  LayoutGrid,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Presentation,
  RotateCcw,
  ScanEye,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { api, ApiError } from "../api/client";
import type { Alternative, ChangeProposal } from "../api/types";
import { Dialog, OriginChip, StatusChip } from "../components/common";
import { SceneView, type Preset, type SceneViewHandle, type ViewMode, type WalkInput } from "../three/SceneView";
import type { WallMode } from "../three/Room";
import { toast, usePrefs } from "../state/ui";
import { useWorkspace } from "../state/workspace";
import { ChatPanel, ProposalBar } from "./ChatPanel";
import { CompareDialog, HistoryDialog } from "./Dialogs";
import { ObjectPanel, ScenePanel } from "./PropertiesPanel";
import { PresentationMode } from "./PresentationMode";

interface GenerateResult {
  alternatives: Alternative[];
  conflicts: string[];
  model: string;
  calls: number;
  test_double: boolean;
}

export default function DesignStep({ onDiagnostics }: { onDiagnostics: (d: Record<string, unknown>) => void }) {
  const ws = useWorkspace();
  const { project, catalog, geometry, alternatives, alt, scene, validation, selection, select, highlight, proposal, previewBefore, aiStatus } = ws;
  const prefs = usePrefs();
  const [viewMode, setViewMode] = useState<ViewMode>("orbit");
  const [wallMode, setWallMode] = useState<WallMode>("cutaway");
  const [ceiling, setCeiling] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [altsOpen, setAltsOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<"props" | "checks">("props");
  const [generating, setGenerating] = useState(false);
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [history, setHistory] = useState(false);
  const [compare, setCompare] = useState<[string, string] | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [renaming, setRenaming] = useState<Alternative | null>(null);
  const viewRef = useRef<SceneViewHandle>(null);
  const walk = useRef<WalkInput>({ forward: 0, turn: 0 });
  const abort = useRef<AbortController | null>(null);

  // Rendered scene: the proposal while previewing, otherwise the working scene.
  const shown = useWorkspace((s) => (s.proposal && s.proposal.status === "pending" && !s.previewBefore ? s.proposal.scene : s.scene));
  const ghosts = useMemo(() => {
    if (!proposal || previewBefore || !scene) return [];
    const changed = new Set([...Object.keys(proposal.report.diff.changed), ...proposal.report.diff.removed]);
    return scene.objects.filter((o) => changed.has(o.id));
  }, [proposal, previewBefore, scene]);
  const shownValidation = proposal && !previewBefore ? proposal.report : validation;
  const selected = scene?.objects.find((o) => o.id === selection[0]) ?? null;

  const generate = async () => {
    if (!project) return;
    setGenerating(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const r = await api<GenerateResult>(`/api/projects/${project.id}/ai/generate`, { method: "POST", json: { count: 3 }, signal: ctrl.signal });
      ws.upsertAlternatives(r.alternatives);
      onDiagnostics({
        task: "generate",
        model: r.model,
        calls: r.calls,
        test_double: r.test_double,
        proposals: r.alternatives.map((a) => ({ name: a.name, status: a.validation_status, repair_rounds: a.repair_rounds, notes: a.notes })),
      });
      if (r.alternatives.length) await ws.openAlternative(r.alternatives[0].id);
      if (r.conflicts.length) setConflicts(r.conflicts);
      const ok = r.alternatives.filter((a) => a.validation_status !== "invalid").length;
      toast(`${r.alternatives.length} proposal${r.alternatives.length === 1 ? "" : "s"} ready · ${ok} pass the required checks.`);
    } catch (err) {
      const e = err as ApiError;
      if (e.code !== "cancelled") toast(e.message, "error");
    } finally {
      setGenerating(false);
      abort.current = null;
    }
  };

  const ruleBased = async () => {
    if (!project) return;
    try {
      const seed = alternatives.filter((a) => a.origin === "sample").length;
      const a = await api<Alternative>(`/api/projects/${project.id}/alternatives`, { method: "POST", json: { name: `Sample layout ${seed + 1} (not AI)`, mode: "rule_based", seed } });
      ws.upsertAlternatives([a]);
      await ws.openAlternative(a.id);
      toast("Rule-based sample layout added. It is not AI-generated.");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const blank = async () => {
    if (!project) return;
    const a = await api<Alternative>(`/api/projects/${project.id}/alternatives`, { method: "POST", json: { name: "Manual layout", mode: "empty" } });
    ws.upsertAlternatives([a]);
    await ws.openAlternative(a.id);
  };

  const duplicate = async (id: string) => {
    if (!project) return;
    await ws.flushSave();
    const src = alternatives.find((a) => a.id === id);
    const a = await api<Alternative>(`/api/projects/${project.id}/alternatives`, { method: "POST", json: { name: `${src?.name ?? "Alternative"} copy`.slice(0, 80), mode: "duplicate", source_alternative_id: id } });
    ws.upsertAlternatives([a]);
    await ws.openAlternative(a.id);
  };

  const remove = async (id: string) => {
    if (!project) return;
    await api(`/api/projects/${project.id}/alternatives/${id}`, { method: "DELETE" });
    ws.removeAlternative(id);
  };

  const runReview = async () => {
    if (!project || !alt) return;
    const png = viewRef.current?.capture();
    if (!png) return;
    setReviewing(true);
    try {
      await ws.flushSave();
      const current = useWorkspace.getState().alt!;
      const r = await api<ReviewResult>(`/api/projects/${project.id}/alternatives/${alt.id}/review`, { method: "POST", json: { base_revision: current.revision, image_png_base64: png } });
      setReview(r);
      if (r.proposal) ws.setProposal(r.proposal);
      onDiagnostics({ task: "review", model: r.model, test_double: r.test_double, dropped_ungrounded: r.dropped_ungrounded });
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setReviewing(false);
    }
  };

  const exportPng = useCallback(() => {
    const url = viewRef.current?.capture();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(alt?.name ?? "design").replace(/[^\w -]/g, "")}.png`;
    a.click();
  }, [alt]);

  // ------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [role=dialog]")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) ws.redo();
        else ws.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        ws.redo();
        return;
      }
      if (mod) return;
      if (e.key === "1") setViewMode("plan");
      if (e.key === "2") setViewMode("orbit");
      if (e.key === "3") setViewMode("walk");
      if (e.key.toLowerCase() === "f") viewRef.current?.preset("reset");
      if (e.key === "Escape") select([]);
      if (!selected || viewMode === "walk") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected.locks.includes("presence") || selected.existing) return toast("This item is locked in the design.", "error");
        ws.commit({ ...scene!, objects: scene!.objects.filter((o) => o.id !== selected.id) }, `Removed ${selected.id}`);
        select([]);
      }
      if (e.key.toLowerCase() === "r") {
        if (selected.locks.includes("rotation")) return toast("Rotation is locked.", "error");
        ws.updateObject(selected.id, { rotation_deg: (selected.rotation_deg + (e.shiftKey ? 90 : 15)) % 360 }, `Rotated ${selected.id}`);
      }
      if (e.key.toLowerCase() === "l") {
        const all = selected.locks.length > 0;
        ws.updateObject(selected.id, { locks: all ? [] : ["position", "rotation", "size", "material", "presence"] }, `${all ? "Unlocked" : "Locked"} ${selected.id}`);
      }
      if (e.key.startsWith("Arrow")) {
        if (selected.locks.includes("position")) return;
        e.preventDefault();
        const s = e.shiftKey ? 0.25 : 0.05;
        const d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key] ?? [0, 0];
        ws.updateObject(selected.id, { position: { x: +(selected.position.x + d[0]).toFixed(3), y: +(selected.position.y + d[1]).toFixed(3) } }, `Moved ${selected.id}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!project || !catalog || !geometry) return null;

  const checks = shownValidation?.checks ?? [];
  const errors = shownValidation?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = shownValidation?.issues.filter((i) => i.severity === "warning") ?? [];

  return (
    <div className={`design-step ${altsOpen ? "alts-open" : ""}`}>
      <aside className={`alts-panel ${altsOpen ? "" : "collapsed"}`} aria-label="Design alternatives">
        <div className="alts-head">
          {altsOpen && <h3>Alternatives</h3>}
          <button className="icon-btn" aria-label={altsOpen ? "Collapse alternatives" : "Expand alternatives"} onClick={() => setAltsOpen(!altsOpen)}>
            {altsOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
        {altsOpen && (
          <>
            <div className="gen-box">
              <button className="btn accent block" onClick={() => void generate()} disabled={generating || !aiStatus?.configured} data-testid="generate" title={aiStatus?.configured ? "" : "AI is not configured on the server"}>
                {generating ? <span className="spinner" /> : <Sparkles size={16} />} {generating ? "Generating…" : "Generate 3 proposals"}
              </button>
              {generating && (
                <button className="btn sm ghost block" onClick={() => abort.current?.abort()}>
                  Cancel
                </button>
              )}
              {!aiStatus?.configured && <p className="small muted">AI is not configured. Use a rule-based sample layout or start manually.</p>}
              {aiStatus?.test_double && <p className="small warn-text">Test double provider: output is not live AI.</p>}
              <div className="btn-row">
                <button className="btn sm" onClick={() => void ruleBased()} data-testid="rule-based">
                  <Wand2 size={14} /> Sample layout (not AI)
                </button>
                <button className="btn sm ghost" onClick={() => void blank()}>
                  Blank
                </button>
              </div>
            </div>
            <div className="alt-list" role="list">
              {!alternatives.length && <p className="muted small">No alternatives yet.</p>}
              {alternatives.map((a) => (
                <AltCard
                  key={a.id}
                  a={a}
                  active={alt?.id === a.id}
                  onOpen={() => void ws.openAlternative(a.id)}
                  onRename={() => setRenaming(a as Alternative)}
                  onDuplicate={() => void duplicate(a.id)}
                  onDelete={() => void remove(a.id)}
                  onCompare={() => alt && setCompare([alt.id, a.id])}
                />
              ))}
            </div>
          </>
        )}
      </aside>

      <section className="canvas-area">
        <div className="view-toolbar" role="toolbar" aria-label="View">
          <div className="seg" role="group" aria-label="View mode">
            <button aria-pressed={viewMode === "plan"} onClick={() => setViewMode("plan")} title="Plan view (1)">
              <LayoutGrid size={14} /> Plan
            </button>
            <button aria-pressed={viewMode === "orbit"} onClick={() => setViewMode("orbit")} title="Orbit view (2)">
              <Box size={14} /> Orbit
            </button>
            <button aria-pressed={viewMode === "walk"} onClick={() => setViewMode("walk")} title="Walkthrough (3)">
              <Footprints size={14} /> Walk
            </button>
          </div>
          {viewMode === "orbit" && (
            <label className="select-inline" title="Camera viewpoint">
              <Camera size={14} />
              <select
                className="select"
                aria-label="Camera viewpoint"
                value=""
                onChange={(e) => {
                  if (e.target.value) viewRef.current?.preset(e.target.value as Preset);
                }}
              >
                <option value="">Viewpoint…</option>
                <option value="corner-a">Corner</option>
                <option value="corner-b">Opposite corner</option>
                <option value="entrance">From the door</option>
                <option value="top">Top-down</option>
              </select>
            </label>
          )}
          <button className="icon-btn" title="Reset camera (F)" aria-label="Reset camera" onClick={() => viewRef.current?.preset("reset")}>
            <RotateCcw size={16} />
          </button>
          {viewMode !== "plan" && (
            <label className="select-inline" title="Wall visibility">
              <Layers size={14} />
              <select className="select" value={wallMode} onChange={(e) => setWallMode(e.target.value as WallMode)} aria-label="Wall visibility">
                <option value="cutaway">Cutaway walls</option>
                <option value="full">Full walls</option>
                <option value="low">Low walls</option>
                <option value="hidden">No walls</option>
              </select>
            </label>
          )}
          {viewMode === "walk" && (
            <label className="check small">
              <input type="checkbox" checked={ceiling} onChange={(e) => setCeiling(e.target.checked)} /> Ceiling
            </label>
          )}
          <span className="toolbar-spacer" />
          <button className={`icon-btn ${prefs.showWalkway ? "" : ""}`} aria-pressed={prefs.showWalkway} title="Walkway overlay" aria-label="Toggle walkway overlay" onClick={() => prefs.set({ showWalkway: !prefs.showWalkway })}>
            <Eye size={16} />
          </button>
          <button className="btn sm" onClick={() => void runReview()} disabled={!alt || reviewing || !aiStatus?.configured} title="Ask the assistant to review this view" aria-label="Review this view">
            {reviewing ? <span className="spinner" /> : <ScanEye size={14} />} <span className="hide-narrow">Review</span>
          </button>
          <button className="btn sm" onClick={exportPng} disabled={!alt} title="Export this view as PNG" aria-label="Export PNG" data-testid="export-png">
            <Camera size={14} /> <span className="hide-narrow">PNG</span>
          </button>
          <button className="btn sm" onClick={() => setPresenting(true)} disabled={!alt} title="Presentation mode" aria-label="Present">
            <Presentation size={14} /> <span className="hide-narrow">Present</span>
          </button>
        </div>

        <ProposalBar />

        <div className="canvas-host">
          {alt && shown ? (
            <SceneView
              ref={viewRef}
              scene={shown}
              geometry={geometry}
              catalog={catalog}
              viewMode={viewMode}
              wallMode={wallMode}
              ceiling={ceiling}
              lowQuality={prefs.lowQuality}
              selection={selection}
              highlight={highlight}
              ghosts={ghosts}
              validation={shownValidation}
              showWalkway={prefs.showWalkway}
              showDimensions={prefs.showDimensions}
              interactive={!proposal}
              onSelect={select}
              onMove={(id, x, y) => ws.updateObject(id, { position: { x, y } }, `Moved ${id}`)}
              walkInput={walk}
            />
          ) : (
            <div className="canvas-empty">
              <div className="card onboarding-card">
                <span className="eyebrow">Step 3 of 3</span>
                <h2>Describe the design and explore proposals</h2>
                <p className="muted">Generate three AI proposals from your brief, or add a rule-based sample layout to explore without AI.</p>
                <div className="btn-row">
                  <button className="btn accent" onClick={() => void generate()} disabled={generating || !aiStatus?.configured}>
                    <Sparkles size={16} /> Generate proposals
                  </button>
                  <button className="btn" onClick={() => void ruleBased()}>
                    <Wand2 size={16} /> Sample layout (not AI)
                  </button>
                </div>
              </div>
            </div>
          )}
          {viewMode === "walk" && alt && <WalkPad input={walk} />}
          {alt && (
            <div className="canvas-legend" aria-hidden="true">
              <span><i className="lg sel" /> Selected</span>
              <span><i className="lg prop" /> Proposed change</span>
              <span><i className="lg lock" /> Locked</span>
              <span><i className="lg bad" /> Conflict</span>
              {prefs.showWalkway && <span><i className="lg walk" /> Walkway {validation?.derived.clearance_m?.toFixed(2)} m · access {validation?.derived.access_clearance_m?.toFixed(2)} m</span>}
            </div>
          )}
          {proposal && !previewBefore && <div className="preview-flag">Preview: not applied yet</div>}
          <button className={`chat-fab ${chatOpen ? "hidden" : ""}`} onClick={() => setChatOpen(true)} disabled={!alt} data-testid="open-chat">
            <MessageSquare size={16} /> Ask for changes
          </button>
          <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
        </div>
      </section>

      <aside className="side-panel design-panel" aria-label="Properties">
        <div className="seg tabs" role="tablist">
          <button role="tab" aria-selected={panelTab === "props"} aria-pressed={panelTab === "props"} onClick={() => setPanelTab("props")}>
            {selected ? "Selection" : "Scene"}
          </button>
          <button role="tab" aria-selected={panelTab === "checks"} aria-pressed={panelTab === "checks"} onClick={() => setPanelTab("checks")}>
            Checks {errors.length > 0 ? <span className="badge error">{errors.length}</span> : warnings.length > 0 ? <span className="badge warn">{warnings.length}</span> : null}
          </button>
        </div>
        {alt && panelTab === "props" && (selected ? <ObjectPanel obj={selected} /> : <ScenePanel />)}
        {alt && panelTab === "checks" && (
          <div className="props">
            <section className="panel-section tight">
              <div className="panel-title">
                <h3>Component checks</h3>
                {shownValidation && <StatusChip status={shownValidation.status} />}
              </div>
              <ul className="check-list">
                {checks.map((c) => (
                  <li key={c.id} className={c.status}>
                    {c.status === "valid" ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
                    <span>{c.label}</span>
                    {c.count > 0 && <span className="num small">{c.count}</span>}
                  </li>
                ))}
              </ul>
              <p className="muted small">Automated geometric checks for concept design. They do not establish code compliance or design quality.</p>
            </section>
            <section className="panel-section tight">
              {[...errors, ...warnings].map((i, k) => (
                <button key={k} className={`issue ${i.severity}`} onClick={() => { ws.setHighlight(i.object_ids); if (i.object_ids[0]) select([i.object_ids[0]]); }}>
                  <span>{i.message}</span>
                </button>
              ))}
              {!errors.length && !warnings.length && <div className="notice ok">All checks pass.</div>}
            </section>
            {!!scene?.rationale && (
              <section className="panel-section tight">
                <h3>Rationale</h3>
                <p className="small">{scene.rationale}</p>
                {!!scene.tradeoffs.length && (
                  <>
                    <h3 className="small-title">Trade-offs</h3>
                    <ul className="small">{scene.tradeoffs.map((t, k) => <li key={k}>{t}</li>)}</ul>
                  </>
                )}
                {!!scene.unresolved.length && (
                  <>
                    <h3 className="small-title">Unresolved</h3>
                    <ul className="small warn-text">{scene.unresolved.map((t, k) => <li key={k}>{t}</li>)}</ul>
                  </>
                )}
              </section>
            )}
            {review && <ReviewPanel review={review} onClose={() => setReview(null)} />}
          </div>
        )}
        {alt && (
          <div className="panel-foot">
            <button className="btn sm ghost" onClick={() => setHistory(true)}>
              <History size={14} /> History
            </button>
            <a className="btn sm ghost" href={`/projects/${project.id}/summary/${alt.id}`} target="_blank" rel="noreferrer">
              Summary
            </a>
          </div>
        )}
      </aside>

      {conflicts && (
        <Dialog title="Some requirements conflict" subtitle="The assistant could not satisfy everything. Consider these changes:" onClose={() => setConflicts(null)} footer={<button className="btn primary" onClick={() => setConflicts(null)}>OK</button>}>
          <ul>{conflicts.map((c, i) => <li key={i}>{c}</li>)}</ul>
          <p className="small muted">Adjust the furniture list, size ranges or walkway clearance in step 2, then generate again.</p>
        </Dialog>
      )}
      {history && <HistoryDialog onClose={() => setHistory(false)} onCompare={(a, b) => { setHistory(false); setCompare([a, b]); }} />}
      {compare && <CompareDialog a={compare[0]} b={compare[1]} onClose={() => setCompare(null)} />}
      {presenting && alt && shown && <PresentationMode onClose={() => setPresenting(false)} />}
      {renaming && (
        <RenameAlt
          alt={renaming}
          onClose={() => setRenaming(null)}
          onSaved={(name) => {
            ws.upsertAlternatives([{ ...renaming, name }]);
            setRenaming(null);
          }}
        />
      )}
    </div>
  );
}

function AltCard({ a, active, onOpen, onRename, onDuplicate, onDelete, onCompare }: { a: { id: string; name: string; origin: string; revision: number; validation_status: string }; active: boolean; onOpen: () => void; onRename: () => void; onDuplicate: () => void; onDelete: () => void; onCompare: () => void }) {
  const [menu, setMenu] = useState(false);
  return (
    <div role="listitem" className={`alt-card ${active ? "active" : ""}`}>
      <button className="alt-main" onClick={onOpen} aria-current={active}>
        <strong className="truncate">{a.name}</strong>
        <span className="chips">
          <OriginChip origin={a.origin} />
          <StatusChip status={a.validation_status} />
        </span>
        <span className="muted small num">Revision {a.revision}</span>
      </button>
      <div className="menu-wrap">
        <button className="icon-btn" aria-label={`Actions for ${a.name}`} onClick={() => setMenu(!menu)}>
          <MoreHorizontal size={16} />
        </button>
        {menu && (
          <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
            <button role="menuitem" onClick={() => { setMenu(false); onRename(); }}><Pencil size={14} /> Rename</button>
            <button role="menuitem" onClick={() => { setMenu(false); onDuplicate(); }}><Copy size={14} /> Duplicate</button>
            {!active && <button role="menuitem" onClick={() => { setMenu(false); onCompare(); }}><Layers size={14} /> Compare with current</button>}
            <button role="menuitem" className="danger" onClick={() => { setMenu(false); onDelete(); }}><Trash2 size={14} /> Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}

function RenameAlt({ alt, onClose, onSaved }: { alt: Alternative; onClose: () => void; onSaved: (n: string) => void }) {
  const { project } = useWorkspace();
  const [name, setName] = useState(alt.name);
  const save = async () => {
    await api(`/api/projects/${project!.id}/alternatives/${alt.id}`, { method: "PATCH", json: { label: name } });
    onSaved(name);
  };
  return (
    <Dialog title="Rename alternative" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => void save()} disabled={!name.trim()}>Save</button></>}>
      <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Name" />
    </Dialog>
  );
}

interface ReviewResult {
  summary: string;
  observations: { text: string; object_ids: string[]; kind: string }[];
  dropped_ungrounded: number;
  suggestions: { title: string; category: string | null; dimensions: string; finish: string; color: string; rationale: string }[];
  proposal: ChangeProposal | null;
  model: string;
  test_double: boolean;
}

function ReviewPanel({ review, onClose }: { review: ReviewResult; onClose: () => void }) {
  const { setHighlight, select } = useWorkspace();
  return (
    <section className="panel-section tight review">
      <div className="panel-title">
        <h3>View review</h3>
        <button className="btn sm ghost" onClick={onClose}>Close</button>
      </div>
      {review.test_double && <span className="chip warn">Test double</span>}
      <p className="small">{review.summary}</p>
      {review.observations.map((o, i) => (
        <button key={i} className={`issue ${o.kind === "concern" ? "warning" : "info"}`} onClick={() => { setHighlight(o.object_ids); if (o.object_ids[0]) select([o.object_ids[0]]); }}>
          <span>{o.text}</span>
        </button>
      ))}
      {review.dropped_ungrounded > 0 && <p className="muted small">{review.dropped_ungrounded} observation(s) referred to objects not in the scene and were hidden.</p>}
      {!!review.suggestions.length && (
        <>
          <h3 className="small-title">Optional additions</h3>
          {review.suggestions.map((s, i) => (
            <div key={i} className="suggestion">
              <strong className="small">{s.title}</strong>
              <span className="small muted">{[s.category, s.dimensions, s.finish].filter(Boolean).join(" · ")}</span>
              {s.color && <span className="color-dot static" style={{ background: s.color }} aria-label={s.color} />}
              <span className="small">{s.rationale}</span>
            </div>
          ))}
          <p className="muted small">Suggestions name types and finishes, not products or prices.</p>
        </>
      )}
    </section>
  );
}

function WalkPad({ input }: { input: React.MutableRefObject<WalkInput> }) {
  const hold = (k: keyof WalkInput, v: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      input.current[k] = v;
    },
    onPointerUp: () => (input.current[k] = 0),
    onPointerCancel: () => (input.current[k] = 0),
    onPointerLeave: () => (input.current[k] = 0),
  });
  return (
    <div className="walk-pad" aria-label="Walk controls">
      <button aria-label="Turn left" {...hold("turn", 1)}>◀</button>
      <div style={{ display: "grid", gap: 6 }}>
        <button aria-label="Walk forward" {...hold("forward", 1)}>▲</button>
        <button aria-label="Walk back" {...hold("forward", -1)}>▼</button>
      </div>
      <button aria-label="Turn right" {...hold("turn", -1)}>▶</button>
      <span className="walk-hint small">Drag to look · WASD to move</span>
    </div>
  );
}
