import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Check, Download, HelpCircle, MessageSquareHeart, Redo2, Settings, Undo2 } from "lucide-react";
import { apiBlob, downloadBlob } from "../api/client";
import { BrandMark } from "../components/Brand";
import { usePrefs } from "../state/ui";
import { useWorkspace, type Step } from "../state/workspace";
import { FeedbackDialog, SettingsDialog, ShortcutsDialog } from "./Dialogs";
import FurnishStep from "./FurnishStep";
import PlanStep, { saveLabel } from "./PlanStep";

const DesignStep = lazy(() => import("./DesignStep"));

const STEPS: { id: Step; label: string; hint: string }[] = [
  { id: "plan", label: "Plan", hint: "Import and confirm geometry" },
  { id: "furnish", label: "Furnish", hint: "Furniture and brief" },
  { id: "design", label: "Design", hint: "Proposals and editing" },
];

export default function Workspace() {
  const { projectId } = useParams();
  const ws = useWorkspace();
  const { project, step, setStep, loading, loadError, geometry, sceneSave, undoStack, redoStack, alt } = ws;
  const prefs = usePrefs();
  const [dialog, setDialog] = useState<"shortcuts" | "feedback" | "settings" | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (projectId) void ws.load(projectId);
    return () => ws.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "?") setDialog("shortcuts");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      const s = useWorkspace.getState();
      if (s.sceneSave === "unsaved" || s.sceneSave === "saving" || s.inventorySave !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  if (loadError)
    return (
      <div className="center-screen">
        <div className="card" style={{ padding: 24, display: "grid", gap: 12 }}>
          <h2>Project unavailable</h2>
          <p className="muted">{loadError}</p>
          <Link to="/" className="btn">
            Back to projects
          </Link>
        </div>
      </div>
    );
  if (loading || !project || !geometry)
    return (
      <div className="center-screen" role="status">
        <span className="spinner" /> <span className="muted">Opening project…</span>
      </div>
    );

  const confirmed = geometry.confirmed;
  const canGo = (s: Step) => s === "plan" || confirmed;
  const exportJson = async () => {
    const blob = await apiBlob(`/api/projects/${project.id}/export`);
    downloadBlob(blob, `${project.name.replace(/[^\w -]/g, "") || "project"}.respace.json`);
  };

  return (
    <div className="workspace">
      <header className="topbar">
        <div className="topbar-left">
          <Link to="/" className="icon-btn" aria-label="Back to projects">
            <ArrowLeft size={18} />
          </Link>
          <BrandMark compact />
          <div className="project-title">
            <span className="truncate">{project.name}</span>
            {project.is_sample && <span className="chip outline">Synthetic sample</span>}
          </div>
        </div>
        <nav className="stepper-nav" aria-label="Workflow steps">
          {STEPS.map((s, i) => {
            const done = (s.id === "plan" && confirmed) || (s.id === "furnish" && confirmed && ws.alternatives.length > 0);
            return (
              <button key={s.id} className={`step-btn ${step === s.id ? "active" : ""}`} onClick={() => canGo(s.id) && setStep(s.id)} disabled={!canGo(s.id)} aria-current={step === s.id ? "step" : undefined} title={s.hint} data-testid={`step-${s.id}`}>
                <span className={`step-num ${done ? "done" : ""}`}>{done ? <Check size={12} /> : i + 1}</span>
                <span className="step-label">{s.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="topbar-right">
          {step === "design" && alt && (
            <>
              <span className={`save-state ${sceneSave}`} aria-live="polite" data-testid="save-state">
                {saveLabel(sceneSave)}
              </span>
              <button className="icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!undoStack.length} onClick={ws.undo} data-testid="undo">
                <Undo2 size={17} />
              </button>
              <button className="icon-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!redoStack.length} onClick={ws.redo} data-testid="redo">
                <Redo2 size={17} />
              </button>
            </>
          )}
          <button className="icon-btn" aria-label="Export project JSON" title="Export project (JSON)" onClick={() => void exportJson()}>
            <Download size={17} />
          </button>
          <button className="icon-btn" aria-label="Record feedback" title="Record feedback" onClick={() => setDialog("feedback")} data-testid="feedback">
            <MessageSquareHeart size={17} />
          </button>
          <button className="icon-btn" aria-label="Keyboard shortcuts" title="Shortcuts (?)" onClick={() => setDialog("shortcuts")}>
            <HelpCircle size={17} />
          </button>
          <button className="icon-btn" aria-label="Settings" title="Settings and diagnostics" onClick={() => setDialog("settings")}>
            <Settings size={17} />
          </button>
        </div>
      </header>

      {!prefs.onboardingDone && (
        <div className="onboarding-strip" role="note">
          <ol>
            {STEPS.map((s, i) => (
              <li key={s.id} className={step === s.id ? "active" : ""}>
                <strong>{i + 1}.</strong> {["Import the plan", "Confirm geometry and furniture", "Describe the design and explore proposals"][i]}
              </li>
            ))}
          </ol>
          <button className="btn sm ghost" onClick={() => prefs.set({ onboardingDone: true })}>
            Got it
          </button>
        </div>
      )}

      <main className="workspace-main">
        {step === "plan" && <PlanStep />}
        {step === "furnish" && <FurnishStep />}
        {step === "design" && (
          <Suspense fallback={<div className="center-screen"><span className="spinner" /></div>}>
            <DesignStep onDiagnostics={setDiagnostics} />
          </Suspense>
        )}
      </main>

      {dialog === "shortcuts" && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === "feedback" && <FeedbackDialog onClose={() => setDialog(null)} />}
      {dialog === "settings" && <SettingsDialog onClose={() => setDialog(null)} diagnostics={diagnostics} />}
    </div>
  );
}
