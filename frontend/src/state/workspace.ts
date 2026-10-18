import { create } from "zustand";
import { api, ApiError } from "../api/client";
import type {
  AIStatus,
  Alternative,
  AlternativeSummary,
  Brief,
  Catalog,
  ChangeProposal,
  Geometry,
  Inventory,
  Issue,
  ProjectDetail,
  Scene,
  SceneObject,
  ValidationReport,
} from "../api/types";
import { toast } from "./ui";

export type Step = "plan" | "furnish" | "design";
export type SaveState = "saved" | "saving" | "unsaved" | "error" | "stale";

const HISTORY_LIMIT = 80;

interface WorkspaceState {
  project: ProjectDetail | null;
  catalog: Catalog | null;
  aiStatus: AIStatus | null;
  step: Step;
  loading: boolean;
  loadError: string;

  geometry: Geometry | null;
  geometryIssues: Issue[];
  geometrySave: SaveState;

  inventory: Inventory | null;
  brief: Brief | null;
  inventorySave: SaveState;

  alternatives: AlternativeSummary[];
  alt: Alternative | null;
  scene: Scene | null;
  validation: ValidationReport | null;
  sceneSave: SaveState;
  undoStack: Scene[];
  redoStack: Scene[];
  selection: string[];
  proposal: ChangeProposal | null;
  previewBefore: boolean;
  highlight: string[];

  load: (projectId: string) => Promise<void>;
  reset: () => void;
  setStep: (s: Step) => void;
  refreshProject: () => Promise<void>;

  setGeometry: (g: Geometry, autosave?: boolean) => void;
  saveGeometry: (confirm: boolean) => Promise<boolean>;

  setInventory: (inv: Inventory) => void;
  setBrief: (b: Brief) => void;

  openAlternative: (id: string) => Promise<void>;
  upsertAlternatives: (alts: Alternative[]) => void;
  removeAlternative: (id: string) => void;

  commit: (next: Scene, summary?: string) => void;
  updateObject: (id: string, patch: Partial<SceneObject>, summary?: string) => void;
  undo: () => void;
  redo: () => void;
  flushSave: () => Promise<void>;
  reloadLatest: () => Promise<void>;

  select: (ids: string[]) => void;
  setProposal: (p: ChangeProposal | null) => void;
  setPreviewBefore: (v: boolean) => void;
  setHighlight: (ids: string[]) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let geometryTimer: ReturnType<typeof setTimeout> | null = null;
let inventoryTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;
let pendingSource: "manual" | "undo" | "redo" = "manual";
let pendingSummary = "";

const clone = <T,>(v: T): T => structuredClone(v);

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  project: null,
  catalog: null,
  aiStatus: null,
  step: "plan",
  loading: false,
  loadError: "",
  geometry: null,
  geometryIssues: [],
  geometrySave: "saved",
  inventory: null,
  brief: null,
  inventorySave: "saved",
  alternatives: [],
  alt: null,
  scene: null,
  validation: null,
  sceneSave: "saved",
  undoStack: [],
  redoStack: [],
  selection: [],
  proposal: null,
  previewBefore: false,
  highlight: [],

  reset: () =>
    set({
      project: null, geometry: null, inventory: null, brief: null, alternatives: [], alt: null, scene: null,
      validation: null, undoStack: [], redoStack: [], selection: [], proposal: null, highlight: [], loadError: "",
    }),

  load: async (projectId) => {
    set({ loading: true, loadError: "" });
    try {
      const [project, catalog, aiStatus] = await Promise.all([
        api<ProjectDetail>(`/api/projects/${projectId}`),
        get().catalog ? Promise.resolve(get().catalog!) : api<Catalog>("/api/catalog"),
        api<AIStatus>("/api/ai/status").catch(() => null),
      ]);
      const alternatives = await api<Alternative[]>(`/api/projects/${projectId}/alternatives`);
      const step: Step = !project.geometry.confirmed ? "plan" : alternatives.length ? "design" : "furnish";
      set({
        project, catalog, aiStatus, geometry: project.geometry, inventory: project.inventory, brief: project.brief,
        alternatives, step, loading: false, alt: null, scene: null, undoStack: [], redoStack: [], selection: [],
        proposal: null,
      });
      if (alternatives.length) await get().openAlternative(alternatives[alternatives.length - 1].id);
    } catch (err) {
      set({ loading: false, loadError: (err as Error).message });
    }
  },

  refreshProject: async () => {
    const p = get().project;
    if (!p) return;
    const project = await api<ProjectDetail>(`/api/projects/${p.id}`);
    set({ project });
  },

  setStep: (step) => set({ step }),

  setGeometry: (geometry, autosave = false) => {
    set({ geometry: { ...geometry, confirmed: false }, geometrySave: "unsaved" });
    if (geometryTimer) clearTimeout(geometryTimer);
    geometryTimer = autosave ? setTimeout(() => void get().saveGeometry(false), 900) : null;
  },

  saveGeometry: async (confirm) => {
    const { project, geometry } = get();
    if (!project || !geometry) return false;
    // A confirmation supersedes any pending draft autosave (which would un-confirm).
    if (geometryTimer) clearTimeout(geometryTimer);
    geometryTimer = null;
    set({ geometrySave: "saving" });
    try {
      const r = await api<{ geometry: Geometry; issues: Issue[] }>(`/api/projects/${project.id}/geometry`, {
        method: "PUT",
        json: { geometry, confirm },
      });
      set({ geometry: r.geometry, geometryIssues: r.issues, geometrySave: "saved" });
      await get().refreshProject();
      return true;
    } catch (err) {
      const e = err as ApiError;
      const issues = (e.detail as { issues?: Issue[] } | null)?.issues;
      set({ geometrySave: "error", geometryIssues: issues ?? get().geometryIssues });
      toast(e.message, "error");
      return false;
    }
  },

  setInventory: (inventory) => {
    set({ inventory, inventorySave: "unsaved" });
    scheduleInventorySave();
  },
  setBrief: (brief) => {
    set({ brief, inventorySave: "unsaved" });
    scheduleInventorySave();
  },

  openAlternative: async (id) => {
    const project = get().project;
    if (!project) return;
    await get().flushSave();
    const alt = await api<Alternative>(`/api/projects/${project.id}/alternatives/${id}`);
    set({
      alt, scene: clone(alt.scene), validation: alt.validation ?? null, undoStack: [], redoStack: [], selection: [],
      proposal: null, previewBefore: false, highlight: [], sceneSave: "saved",
    });
  },

  upsertAlternatives: (alts) => {
    const existing = get().alternatives.filter((a) => !alts.some((b) => b.id === a.id));
    set({ alternatives: [...existing, ...alts.map(({ id, name, origin, revision, validation_status }) => ({ id, name, origin, revision, validation_status }))] });
  },

  removeAlternative: (id) => {
    const alternatives = get().alternatives.filter((a) => a.id !== id);
    set({ alternatives });
    if (get().alt?.id === id) {
      set({ alt: null, scene: null, validation: null });
      if (alternatives.length) void get().openAlternative(alternatives[alternatives.length - 1].id);
    }
  },

  commit: (next, summary = "") => {
    const { scene, undoStack } = get();
    if (!scene) return;
    set({
      undoStack: [...undoStack.slice(-HISTORY_LIMIT + 1), clone(scene)],
      redoStack: [],
      scene: next,
      sceneSave: "unsaved",
      proposal: null,
    });
    pendingSource = "manual";
    pendingSummary = summary;
    scheduleSave();
  },

  updateObject: (id, patch, summary) => {
    const scene = get().scene;
    if (!scene) return;
    const next = clone(scene);
    next.objects = next.objects.map((o) => (o.id === id ? { ...o, ...patch } : o));
    get().commit(next, summary);
  },

  undo: () => {
    const { undoStack, redoStack, scene } = get();
    if (!undoStack.length || !scene) return;
    const prev = undoStack[undoStack.length - 1];
    set({ undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, clone(scene)], scene: clone(prev), sceneSave: "unsaved" });
    pendingSource = "undo";
    pendingSummary = "Undo";
    scheduleSave(150);
  },

  redo: () => {
    const { undoStack, redoStack, scene } = get();
    if (!redoStack.length || !scene) return;
    const next = redoStack[redoStack.length - 1];
    set({ redoStack: redoStack.slice(0, -1), undoStack: [...undoStack, clone(scene)], scene: clone(next), sceneSave: "unsaved" });
    pendingSource = "redo";
    pendingSummary = "Redo";
    scheduleSave(150);
  },

  flushSave: async () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await doSave();
    } else if (saving) {
      await saving;
    }
  },

  reloadLatest: async () => {
    const alt = get().alt;
    if (!alt) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    await get().openAlternative(alt.id);
    toast("Loaded the latest saved version.");
  },

  select: (selection) => set({ selection }),
  setProposal: (proposal) => set({ proposal, previewBefore: false, highlight: proposal ? proposal.report.affected_ids : [] }),
  setPreviewBefore: (previewBefore) => set({ previewBefore }),
  setHighlight: (highlight) => set({ highlight }),
}));

function scheduleSave(delay = 450) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void doSave();
  }, delay);
}

async function doSave(): Promise<void> {
  if (saving) {
    await saving;
  }
  const state = useWorkspace.getState();
  const { project, alt, scene } = state;
  if (!project || !alt || !scene || state.sceneSave === "stale") return;
  const snapshot = clone(scene);
  const source = pendingSource;
  const summary = pendingSummary;
  useWorkspace.setState({ sceneSave: "saving" });
  saving = (async () => {
    try {
      const r = await api<Alternative>(`/api/projects/${project.id}/alternatives/${alt.id}/scene`, {
        method: "PUT",
        json: { base_revision: alt.revision, scene: snapshot, source, summary },
      });
      const cur = useWorkspace.getState();
      const changedSince = JSON.stringify(cur.scene) !== JSON.stringify(snapshot);
      useWorkspace.setState({
        alt: { ...alt, revision: r.revision, validation_status: r.validation_status, scene: r.scene },
        validation: r.validation ?? cur.validation,
        sceneSave: changedSince ? "unsaved" : "saved",
        alternatives: cur.alternatives.map((a) => (a.id === alt.id ? { ...a, revision: r.revision, validation_status: r.validation_status } : a)),
      });
      if (changedSince) scheduleSave(100);
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 409 && e.code === "stale_revision") {
        useWorkspace.setState({ sceneSave: "stale" });
        toast("This design was changed elsewhere. Your last edit was not saved.", "error", {
          label: "Load latest",
          run: () => void useWorkspace.getState().reloadLatest(),
        });
      } else if (e.status === 409 && e.code === "locked") {
        useWorkspace.setState({ sceneSave: "saved" });
        toast(e.message, "error");
        void useWorkspace.getState().reloadLatest();
      } else {
        useWorkspace.setState({ sceneSave: "error" });
        toast(`Could not save: ${e.message}`, "error", { label: "Retry", run: () => scheduleSave(0) });
      }
    } finally {
      saving = null;
    }
  })();
  await saving;
}

function scheduleInventorySave() {
  if (inventoryTimer) clearTimeout(inventoryTimer);
  inventoryTimer = setTimeout(async () => {
    const { project, inventory, brief } = useWorkspace.getState();
    if (!project || !inventory || !brief) return;
    useWorkspace.setState({ inventorySave: "saving" });
    try {
      await api(`/api/projects/${project.id}/inventory`, { method: "PUT", json: inventory });
      await api(`/api/projects/${project.id}/brief`, { method: "PUT", json: brief });
      useWorkspace.setState({ inventorySave: "saved" });
    } catch (err) {
      useWorkspace.setState({ inventorySave: "error" });
      toast(`Could not save furniture or brief: ${(err as Error).message}`, "error");
    }
  }, 600);
}

export function displayScene(): Scene | null {
  const { scene, proposal, previewBefore } = useWorkspace.getState();
  if (proposal && proposal.status === "pending" && !previewBefore) return proposal.scene;
  return scene;
}
