import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Eye, EyeOff, MessageSquare, Square, X } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { ChangeProposal, ChatMessage } from "../api/types";
import { toast } from "../state/ui";
import { useWorkspace } from "../state/workspace";

const EXAMPLES = [
  "Keep everything except the flooring. Make it pale oak.",
  "Move only the desk nearer the window.",
  "Make the lighting warmer.",
  "Try another arrangement using the same required inventory.",
];

interface ChatReply {
  intent: string;
  reply: string;
  conflicts: string[];
  proposal: ChangeProposal | null;
  model: string;
  test_double: boolean;
}

export function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { project, alt, selection, scene, setProposal, proposal, aiStatus, flushSave } = useWorkspace();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!project || !open) return;
    api<{ messages: ChatMessage[] }>(`/api/projects/${project.id}/chat`).then((r) => setMessages(r.messages)).catch(() => undefined);
  }, [project, open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  const send = async (msg: string) => {
    if (!project || !alt || !msg.trim()) return;
    await flushSave();
    const current = useWorkspace.getState().alt!;
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const optimistic: ChatMessage = { id: `tmp-${Date.now()}`, role: "user", text: msg, alternative_id: alt.id, proposal_id: null, proposal_status: null, created_at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    setText("");
    try {
      const r = await api<ChatReply>(`/api/projects/${project.id}/alternatives/${alt.id}/chat`, {
        method: "POST",
        json: { message: msg, base_revision: current.revision, selected_ids: selection },
        signal: ctrl.signal,
      });
      const fresh = await api<{ messages: ChatMessage[] }>(`/api/projects/${project.id}/chat`);
      setMessages(fresh.messages);
      if (r.proposal) {
        if (r.proposal.status === "stale") toast("The design changed while the assistant was working. The proposal was not applied.", "error");
        else setProposal(r.proposal);
      }
    } catch (err) {
      const e = err as ApiError;
      setMessages((m) => [...m, { ...optimistic, id: `err-${Date.now()}`, role: "system", text: e.code === "cancelled" ? "Request cancelled." : e.message }]);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  if (!open) return null;
  return (
    <section className="chat-panel" aria-label="Design assistant">
      <header className="chat-head">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MessageSquare size={16} />
          <h3>Design assistant</h3>
          {aiStatus?.test_double && <span className="chip warn">Test double</span>}
        </div>
        <button className="icon-btn" aria-label="Close assistant" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      {!aiStatus?.configured && <div className="notice warn small">AI is not configured on this server. Manual editing and sample layouts still work.</div>}
      <div className="chat-list" ref={listRef} aria-live="polite">
        {!messages.length && (
          <div className="chat-empty">
            <p className="muted small">Describe a change. Locked properties are always kept.</p>
            {EXAMPLES.map((e) => (
              <button key={e} className="example" onClick={() => setText(e)}>
                {e}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <p>{m.text}</p>
            {m.proposal_id && (
              <span className={`chip ${m.proposal_status === "applied" ? "ok" : m.proposal_status === "pending" ? "dark" : ""}`}>
                {proposal?.id === m.proposal_id ? "Previewing" : m.proposal_status ?? "proposal"}
              </span>
            )}
          </div>
        ))}
        {busy && (
          <div className="msg assistant thinking">
            <span className="spinner" /> Working on it. Your current design stays as it is.
          </div>
        )}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        {selection.length > 0 && scene && (
          <span className="chip outline">Selected: {selection.join(", ")}</span>
        )}
        <textarea
          className="textarea"
          rows={2}
          maxLength={1500}
          placeholder="Ask for a change…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          aria-label="Message to the design assistant"
          data-testid="chat-input"
        />
        {busy ? (
          <button type="button" className="btn sm" onClick={() => abort.current?.abort()}>
            <Square size={13} /> Stop
          </button>
        ) : (
          <button className="btn sm primary" disabled={!text.trim() || !aiStatus?.configured} aria-label="Send">
            <ArrowUp size={15} />
          </button>
        )}
      </form>
    </section>
  );
}

export function ProposalBar() {
  const { project, proposal, setProposal, previewBefore, setPreviewBefore, openAlternative, alt, flushSave, validation } = useWorkspace();
  const [busy, setBusy] = useState(false);
  if (!proposal || !project || proposal.status !== "pending") return null;
  const d = proposal.report.diff;
  const changes = [
    ...d.added.map((id) => `+ ${id}`),
    ...d.removed.map((id) => `− ${id}`),
    ...Object.entries(d.changed).map(([id, props]) => `${id}: ${props.join(", ")}`),
    ...(d.lighting_changed ? ["lighting"] : []),
    ...d.finishes_changed.map((r) => `finishes (${r})`),
  ];
  // A proposal may not introduce new validation errors (the server enforces the same rule).
  const key = (i: { code: string; object_ids: string[] }) => `${i.code}:${i.object_ids.join(",")}`;
  const before = new Set((validation?.issues ?? []).filter((i) => i.severity === "error").map(key));
  const newErrors = proposal.report.issues.filter((i) => i.severity === "error" && !before.has(key(i)));
  const invalid = newErrors.length > 0;
  const apply = async () => {
    setBusy(true);
    try {
      await flushSave();
      await api(`/api/projects/${project.id}/proposals/${proposal.id}/apply`, { method: "POST" });
      setProposal(null);
      if (alt) await openAlternative(alt.id);
      toast("Changes applied as a new revision.");
    } catch (err) {
      const e = err as ApiError;
      toast(e.message, "error");
      if (e.status === 409) setProposal(null);
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    await api(`/api/projects/${project.id}/proposals/${proposal.id}/discard`, { method: "POST" }).catch(() => undefined);
    setProposal(null);
  };
  return (
    <div className="proposal-bar" role="region" aria-label="Proposed changes" data-testid="proposal-bar">
      <div className="proposal-text">
        <span className="eyebrow">{proposal.source === "ai_review" ? "Review suggestion" : "Proposed change"}</span>
        <p>{proposal.summary || "The assistant proposed these changes."}</p>
        <div className="chips">
          {changes.slice(0, 6).map((c) => (
            <span key={c} className="chip proposal">
              {c}
            </span>
          ))}
          {changes.length > 6 && <span className="chip">+{changes.length - 6} more</span>}
          {!changes.length && <span className="chip">No changes</span>}
        </div>
        {!!proposal.report.rejected.length && (
          <p className="small warn-text">Not applied: {proposal.report.rejected.map((r) => `${r.target_id || r.op} (${r.reason})`).join("; ")}</p>
        )}
        {!!proposal.report.conflicts.length && <p className="small warn-text">Conflicts: {proposal.report.conflicts.join("; ")}</p>}
        {invalid && <p className="small error-text">Cannot apply: {newErrors.slice(0, 2).map((i) => i.message).join(" ")}</p>}
      </div>
      <div className="proposal-actions">
        <button className="btn sm" onClick={() => setPreviewBefore(!previewBefore)} aria-pressed={previewBefore}>
          {previewBefore ? <Eye size={14} /> : <EyeOff size={14} />} {previewBefore ? "Showing before" : "Showing after"}
        </button>
        <button className="btn sm" onClick={() => void discard()} disabled={busy}>
          Discard
        </button>
        <button className="btn sm accent" onClick={() => void apply()} disabled={busy || invalid || !changes.length} data-testid="apply-proposal">
          <Check size={14} /> Apply
        </button>
      </div>
    </div>
  );
}
