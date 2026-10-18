import { useEffect, useState } from "react";
import { History, RotateCcw, Star, Tag } from "lucide-react";
import { api, apiBlob, downloadBlob } from "../api/client";
import type { Revision, Scene, SceneDiff, ValidationReport } from "../api/types";
import { Dialog, StatusChip } from "../components/common";
import { toast, usePrefs } from "../state/ui";
import { useWorkspace } from "../state/workspace";
import { PlanMini } from "./PlanMini";

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["1 / 2 / 3", "Plan, orbit, walkthrough view"],
    ["F", "Reset camera"],
    ["Click / tap", "Select furniture"],
    ["Drag", "Move (snaps to 5 cm and walls; hold Shift for free)"],
    ["Arrow keys", "Nudge 5 cm (Shift: 25 cm)"],
    ["R / Shift+R", "Rotate 15° / 90°"],
    ["L", "Lock or unlock selected"],
    ["Delete", "Remove selected"],
    ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
    ["W A S D, arrows", "Walk and turn (walkthrough)"],
    ["Esc", "Clear selection or close"],
    ["?", "This guide"],
  ];
  return (
    <Dialog title="Keyboard and touch" subtitle="Pinch to zoom and two-finger drag to orbit on touch screens." onClose={onClose}>
      <dl className="shortcuts">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>
              {k.split(" / ").map((part, i) => (
                <span key={i}>
                  {i > 0 && " / "}
                  <kbd>{part}</kbd>
                </span>
              ))}
            </dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

const TASKS = [
  "Import and calibrate a plan",
  "Trace and confirm geometry",
  "Set furniture and brief",
  "Generate proposals",
  "Edit in 3D",
  "Lock an object",
  "Conversational edit",
  "Compare and export",
  "General",
];

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const { project, alt } = useWorkspace();
  const [task, setTask] = useState(TASKS[TASKS.length - 1]);
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!project) return;
    setBusy(true);
    try {
      await api(`/api/projects/${project.id}/feedback`, {
        method: "POST",
        json: { alternative_id: alt?.id ?? null, revision: alt?.revision ?? null, task, rating, text },
      });
      toast("Thank you. Feedback saved with this design revision.");
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Record feedback"
      subtitle={alt ? `Linked to “${alt.name}”, revision ${alt.revision}.` : "Linked to this project."}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!text.trim() || busy} onClick={() => void submit()} data-testid="submit-feedback">
            Save feedback
          </button>
        </>
      }
    >
      <label className="field">
        <span>Task</span>
        <select className="select" value={task} onChange={(e) => setTask(e.target.value)}>
          {TASKS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <div className="field">
        <span>How well did it work?</span>
        <div className="stars" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} role="radio" aria-checked={rating === n} aria-label={`${n} of 5`} className={rating && n <= rating ? "on" : ""} onClick={() => setRating(n)}>
              <Star size={20} />
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>What happened? What would you change?</span>
        <textarea className="textarea" rows={5} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} data-testid="feedback-text" />
      </label>
    </Dialog>
  );
}

export function SettingsDialog({ onClose, diagnostics }: { onClose: () => void; diagnostics: Record<string, unknown> | null }) {
  const { aiStatus, project } = useWorkspace();
  const prefs = usePrefs();
  const [feedback, setFeedback] = useState<{ id: string; task: string; rating: number | null; text: string; revision: number | null; created_at: string }[]>([]);
  useEffect(() => {
    if (project) api<typeof feedback>(`/api/projects/${project.id}/feedback`).then(setFeedback).catch(() => undefined);
  }, [project]);
  return (
    <Dialog title="Settings and diagnostics" onClose={onClose} wide>
      <section className="settings-grid">
        <div className="panel-section">
          <h3>Display</h3>
          <label className="check">
            <input type="checkbox" checked={prefs.lowQuality} onChange={(e) => prefs.set({ lowQuality: e.target.checked })} /> Lower quality for slower devices (no shadows or textures)
          </label>
          <label className="check">
            <input type="checkbox" checked={prefs.showWalkway} onChange={(e) => prefs.set({ showWalkway: e.target.checked })} /> Show walkway check overlay
          </label>
          <label className="check">
            <input type="checkbox" checked={prefs.showDimensions} onChange={(e) => prefs.set({ showDimensions: e.target.checked })} /> Show dimensions of the selection
          </label>
          <button className="btn sm ghost" onClick={() => prefs.set({ onboardingDone: false })}>
            Show the getting-started guide again
          </button>
        </div>
        <div className="panel-section">
          <h3>AI provider</h3>
          <div className="kv">
            <span>Provider</span>
            <span>{aiStatus?.provider ?? "unknown"}</span>
            <span>Model</span>
            <span className="mono">{aiStatus?.model ?? "-"}</span>
            <span>Status</span>
            <span>{aiStatus?.configured ? <span className="chip ok">Configured</span> : <span className="chip warn">Not configured</span>}</span>
            {aiStatus?.test_double && (
              <>
                <span>Mode</span>
                <span className="chip warn">Test double (not live AI)</span>
              </>
            )}
          </div>
          <p className="muted small">
            The server sends the confirmed room geometry, furniture list, brief text, selected reference images and, for reviews, a screenshot of the current view to Google Gemini. On the free tier, Google may use this content to improve its products and human reviewers may read it. Use synthetic or anonymised plans. The API key stays on the server.
          </p>
          {diagnostics && (
            <details className="disclosure">
              <summary>Last AI request</summary>
              <pre className="mono small">{JSON.stringify(diagnostics, null, 2)}</pre>
            </details>
          )}
        </div>
        <div className="panel-section">
          <div className="panel-title">
            <h3>Feedback for this project</h3>
            <button className="btn sm" onClick={() => void apiBlob("/api/feedback/export.csv").then((b) => downloadBlob(b, "respace-feedback.csv"))}>
              Export CSV
            </button>
          </div>
          {!feedback.length && <p className="muted small">No feedback recorded yet.</p>}
          {feedback.slice(0, 8).map((f) => (
            <div key={f.id} className="feedback-row">
              <span className="small">
                <strong>{f.task}</strong> {f.rating ? `· ${f.rating}/5` : ""} {f.revision ? `· r${f.revision}` : ""}
              </span>
              <span className="small muted">{f.text}</span>
            </div>
          ))}
        </div>
      </section>
    </Dialog>
  );
}

export function HistoryDialog({ onClose, onCompare }: { onClose: () => void; onCompare: (a: string, b: string) => void }) {
  const { project, alt, commit, flushSave } = useWorkspace();
  const [revs, setRevs] = useState<Revision[] | null>(null);
  const [labeling, setLabeling] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const load = () => {
    if (project && alt) api<Revision[]>(`/api/projects/${project.id}/alternatives/${alt.id}/revisions`).then(setRevs).catch(() => setRevs([]));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [project, alt?.id, alt?.revision]);
  if (!project || !alt) return null;
  const restore = async (n: number) => {
    await flushSave();
    const r = await api<{ scene: Scene }>(`/api/projects/${project.id}/alternatives/${alt.id}/revisions/${n}`);
    commit(r.scene, `Restored revision ${n}`);
    toast(`Restored revision ${n} as a new revision.`);
    onClose();
  };
  const saveLabel = async (n: number) => {
    await api(`/api/projects/${project.id}/alternatives/${alt.id}/revisions/${n}/label`, { method: "PUT", json: { label } });
    setLabeling(null);
    load();
  };
  return (
    <Dialog title="Revision history" subtitle={`${alt.name}: every saved change is kept.`} onClose={onClose} wide>
      {!revs && <div className="skeleton" style={{ height: 120 }} />}
      <ol className="rev-list">
        {revs?.map((r) => (
          <li key={r.id} className={r.number === alt.revision ? "current" : ""}>
            <div className="rev-num num">r{r.number}</div>
            <div className="rev-body">
              <div className="rev-title">
                {r.label ? <strong>{r.label}</strong> : <span className="muted">{sourceLabel(r.source)}</span>}
                <StatusChip status={r.validation_status} />
              </div>
              <span className="small muted">
                {r.summary} · {new Date(r.created_at + "Z").toLocaleString()}
              </span>
              {labeling === r.number && (
                <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void saveLabel(r.number); }}>
                  <input className="input" autoFocus value={label} maxLength={80} placeholder="e.g. Shown to client" onChange={(e) => setLabel(e.target.value)} />
                  <button className="btn sm">Save</button>
                </form>
              )}
            </div>
            <div className="rev-actions">
              <button className="btn sm ghost" onClick={() => { setLabeling(r.number); setLabel(r.label); }} aria-label={`Name revision ${r.number}`}>
                <Tag size={14} />
              </button>
              {r.number !== alt.revision && (
                <>
                  <button className="btn sm ghost" onClick={() => onCompare(`${alt.id}@${r.number}`, `${alt.id}@${alt.revision}`)}>
                    Compare
                  </button>
                  <button className="btn sm" onClick={() => void restore(r.number)}>
                    <RotateCcw size={14} /> Restore
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Dialog>
  );
}

function sourceLabel(s: string) {
  return { manual: "Manual edit", undo: "Undo", redo: "Redo", restore: "Restored", ai_edit: "AI edit", ai_review: "Review suggestion", ai_generate: "AI proposal", import: "Imported", sample: "Sample layout" }[s] ?? s;
}

export function CompareDialog({ a, b, onClose }: { a: string; b: string; onClose: () => void }) {
  const { project, geometry, alternatives } = useWorkspace();
  const [left, setLeft] = useState(a);
  const [right, setRight] = useState(b);
  const [data, setData] = useState<{ a: { label: string; scene: Scene; validation: ValidationReport }; b: { label: string; scene: Scene; validation: ValidationReport }; diff: SceneDiff } | null>(null);
  useEffect(() => {
    if (!project) return;
    setData(null);
    api<typeof data>(`/api/projects/${project.id}/compare?a=${encodeURIComponent(left)}&b=${encodeURIComponent(right)}`).then(setData).catch((e) => toast((e as Error).message, "error"));
  }, [project, left, right]);
  if (!geometry) return null;
  const changed = data ? [...data.diff.added, ...data.diff.removed, ...Object.keys(data.diff.changed)] : [];
  const options = alternatives.map((x) => ({ value: x.id, label: x.name }));
  return (
    <Dialog title="Compare" subtitle="Before and after, drawn from the validated footprints." onClose={onClose} wide>
      <div className="compare-grid">
        {[
          [left, setLeft, data?.a] as const,
          [right, setRight, data?.b] as const,
        ].map(([val, setVal, side], i) => (
          <div key={i} className="compare-col">
            <select className="select" value={val.split("@")[0]} onChange={(e) => setVal(e.target.value)} aria-label={i === 0 ? "Left design" : "Right design"}>
              {!options.some((o) => o.value === val) && <option value={val.split("@")[0]}>{side?.label ?? val}</option>}
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="compare-plan">{side ? <PlanMini geometry={geometry} scene={side.scene} highlight={changed} /> : <div className="skeleton" style={{ height: 260 }} />}</div>
            {side && (
              <div className="chips">
                <span className="chip outline">{side.label}</span>
                <StatusChip status={side.validation.status} />
                <span className="chip">{side.scene.objects.length} items</span>
              </div>
            )}
          </div>
        ))}
      </div>
      {data && (
        <div className="diff-list">
          <h3>
            <History size={15} /> Differences
          </h3>
          {!changed.length && !data.diff.lighting_changed && !data.diff.finishes_changed.length && <p className="muted small">No differences.</p>}
          <ul className="small">
            {data.diff.added.map((id) => (
              <li key={`a${id}`}>Added {id}</li>
            ))}
            {data.diff.removed.map((id) => (
              <li key={`r${id}`}>Removed {id}</li>
            ))}
            {Object.entries(data.diff.changed).map(([id, props]) => (
              <li key={id}>
                {id}: {props.join(", ")}
              </li>
            ))}
            {data.diff.lighting_changed && <li>Lighting changed</li>}
            {data.diff.finishes_changed.map((r) => (
              <li key={r}>Finishes changed in {r}</li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
