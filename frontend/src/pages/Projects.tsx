import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, FolderOpen, LogOut, MoreHorizontal, Pencil, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { api, apiBlob, downloadBlob } from "../api/client";
import type { ProjectDetail, ProjectSummary } from "../api/types";
import { BrandMark } from "../components/Brand";
import { Dialog } from "../components/common";
import { useAuth } from "../state/auth";
import { toast } from "../state/ui";

export default function Projects() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setProjects(await api<ProjectSummary[]>("/api/projects"));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addSamples = async () => {
    setBusy(true);
    try {
      await api("/api/samples", { method: "POST" });
      toast("Added three synthetic sample projects.");
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error("Project file is larger than 30 MB.");
      const document = JSON.parse(await file.text());
      const p = await api<ProjectDetail>("/api/projects/import", { method: "POST", json: { document } });
      toast(`Imported “${p.name}”.`);
      navigate(`/projects/${p.id}`);
    } catch (err) {
      toast(err instanceof SyntaxError ? "That file is not valid JSON." : (err as Error).message, "error");
    }
  };

  return (
    <div className="projects-page">
      <header className="projects-top">
        <BrandMark />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="muted small">{user?.email}</span>
          <button className="btn ghost sm" onClick={() => void logout()}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </header>
      <main className="projects-main">
        <div className="projects-head">
          <div style={{ display: "grid", gap: 8 }}>
            <span className="eyebrow">Your studio</span>
            <h1>Projects</h1>
            <p className="muted">Each project holds a measured floor plan, its furniture brief, and design alternatives.</p>
          </div>
          <div className="projects-actions">
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = "";
              }}
            />
            <button className="btn" onClick={() => importRef.current?.click()}>
              <Upload size={16} /> Import
            </button>
            <button className="btn" onClick={() => void apiBlob("/api/feedback/export.csv").then((b) => downloadBlob(b, "respace-feedback.csv"))}>
              <Download size={16} /> Feedback CSV
            </button>
            <button className="btn primary" onClick={() => setCreating(true)} data-testid="new-project">
              <Plus size={16} /> New project
            </button>
          </div>
        </div>

        {error && <div className="notice error">{error}</div>}
        {projects === null && !error && (
          <div className="project-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 248 }} />
            ))}
          </div>
        )}
        {projects?.length === 0 && (
          <div className="empty card">
            <svg viewBox="0 0 120 80" width="160" aria-hidden="true">
              <path d="M10 10 H80 V40 H110 V70 H10 Z" fill="#fcfbf8" stroke="#2b2a28" strokeWidth="3" />
              <rect x="22" y="48" width="36" height="12" rx="3" fill="#d8d0c2" />
              <rect x="66" y="18" width="8" height="18" fill="#a7b39b" />
            </svg>
            <h2>Start with a plan</h2>
            <p className="muted" style={{ maxWidth: 440, textAlign: "center" }}>
              Create a project and upload a PNG, JPEG or PDF floor plan, or explore the synthetic samples first.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => void addSamples()} disabled={busy}>
                <Sparkles size={16} /> Add sample projects
              </button>
              <button className="btn primary" onClick={() => setCreating(true)}>
                <Plus size={16} /> New project
              </button>
            </div>
          </div>
        )}
        {!!projects?.length && (
          <>
            <div className="project-grid">
              {projects.map((p) => (
                <ProjectCard key={p.id} p={p} onOpen={() => navigate(`/projects/${p.id}`)} onRename={() => setRenaming(p)} onDelete={() => setDeleting(p)} />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
              <button className="btn ghost" onClick={() => void addSamples()} disabled={busy}>
                <Sparkles size={16} /> Add sample projects
              </button>
            </div>
          </>
        )}
      </main>

      {creating && <CreateDialog onClose={() => setCreating(false)} onCreated={(id) => navigate(`/projects/${id}`)} />}
      {renaming && (
        <RenameDialog
          project={renaming}
          onClose={() => setRenaming(null)}
          onDone={() => {
            setRenaming(null);
            void load();
          }}
        />
      )}
      {deleting && (
        <Dialog
          title="Delete project?"
          subtitle={`“${deleting.name}” and its uploaded plans, alternatives and revisions will be permanently removed.`}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                style={{ background: "var(--error)", borderColor: "var(--error)" }}
                onClick={async () => {
                  await api(`/api/projects/${deleting.id}`, { method: "DELETE" });
                  setDeleting(null);
                  toast("Project deleted.");
                  void load();
                }}
              >
                Delete project
              </button>
            </>
          }
        >
          <span />
        </Dialog>
      )}
    </div>
  );
}

function ProjectCard({ p, onOpen, onRename, onDelete }: { p: ProjectSummary; onOpen: () => void; onRename: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let url = "";
    let cancelled = false;
    api<ProjectDetail>(`/api/projects/${p.id}`)
      .then(async (d) => {
        const plan = d.assets.find((a) => a.kind === "plan");
        if (!plan || cancelled) return;
        const blob = await apiBlob(plan.url);
        url = URL.createObjectURL(blob);
        if (!cancelled) setThumb(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [p.id]);
  return (
    <article className="project-card card">
      <button className="project-thumb" onClick={onOpen} aria-label={`Open ${p.name}`}>
        {thumb ? <img src={thumb} alt="" /> : <span className="muted small">No plan yet</span>}
      </button>
      <div className="project-meta">
        <div style={{ minWidth: 0 }}>
          <h3 className="truncate">{p.name}</h3>
          <div className="chips">
            {p.is_sample && <span className="chip outline">Synthetic sample</span>}
            <span className={`chip ${p.confirmed ? "ok" : ""}`}>{p.confirmed ? `${p.rooms} room${p.rooms === 1 ? "" : "s"} confirmed` : "Plan not confirmed"}</span>
            <span className="chip">{p.alternatives} alternative{p.alternatives === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div className="menu-wrap">
          <button className="icon-btn" aria-label={`Actions for ${p.name}`} aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={18} />
          </button>
          {menu && (
            <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
              <button role="menuitem" onClick={onOpen}>
                <FolderOpen size={15} /> Open
              </button>
              <button role="menuitem" onClick={onRename}>
                <Pencil size={15} /> Rename
              </button>
              <button role="menuitem" className="danger" onClick={onDelete}>
                <Trash2 size={15} /> Delete
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="muted small" style={{ padding: "0 16px 14px" }}>
        Updated {new Date(p.updated_at + "Z").toLocaleString()}
      </p>
    </article>
  );
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const p = await api<ProjectDetail>("/api/projects", { method: "POST", json: { name: name.trim() } });
      onCreated(p.id);
    } catch (err) {
      toast((err as Error).message, "error");
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="New project"
      subtitle="You will import the floor plan next."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void submit()} disabled={busy || !name.trim()} data-testid="create-project">
            Create project
          </button>
        </>
      }
    >
      <label className="field">
        <span>Project name</span>
        <input
          className="input"
          value={name}
          placeholder="e.g. Harbour Street apartment"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          maxLength={120}
        />
      </label>
    </Dialog>
  );
}

function RenameDialog({ project, onClose, onDone }: { project: ProjectSummary; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(project.name);
  const save = async () => {
    await api(`/api/projects/${project.id}`, { method: "PATCH", json: { name } });
    onDone();
  };
  return (
    <Dialog
      title="Rename project"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={!name.trim()}>
            Save
          </button>
        </>
      }
    >
      <label className="field">
        <span>Project name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} onKeyDown={(e) => e.key === "Enter" && void save()} />
      </label>
    </Dialog>
  );
}
