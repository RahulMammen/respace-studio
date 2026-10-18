import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Download, Printer } from "lucide-react";
import { api, apiBlob, downloadBlob } from "../api/client";
import type { Alternative, Catalog, ProjectDetail } from "../api/types";
import { StatusChip } from "../components/common";
import { PlanMini } from "../workspace/PlanMini";

export default function Summary() {
  const { projectId, alternativeId } = useParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [alt, setAlt] = useState<Alternative | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      api<ProjectDetail>(`/api/projects/${projectId}`),
      api<Alternative>(`/api/projects/${projectId}/alternatives/${alternativeId}`),
      api<Catalog>("/api/catalog"),
    ])
      .then(([p, a, c]) => {
        setProject(p);
        setAlt(a);
        setCatalog(c);
      })
      .catch((e) => setError((e as Error).message));
  }, [projectId, alternativeId]);
  if (error) return <div className="center-screen">{error}</div>;
  if (!project || !alt || !catalog) return <div className="center-screen"><span className="spinner" /></div>;
  const s = alt.scene;
  const reqs = Object.fromEntries(project.inventory.items.map((i) => [i.id, i]));
  const required = s.objects.filter((o) => o.requirement_id && reqs[o.requirement_id]?.required);
  const optional = s.objects.filter((o) => !(o.requirement_id && reqs[o.requirement_id]?.required));
  const label = (cat: string, v: string) => catalog.categories.find((c) => c.id === cat)?.variants.find((x) => x.id === v)?.label ?? v;
  const mat = (m: string) => catalog.materials[m]?.label ?? m;
  const Row = ({ o }: { o: (typeof s.objects)[number] }) => (
    <tr>
      <td>{o.label || label(o.category, o.variant)}</td>
      <td>{label(o.category, o.variant)}</td>
      <td>{project.geometry.rooms.find((r) => r.id === o.room_id)?.name ?? o.room_id}</td>
      <td className="num">
        {o.size.w.toFixed(2)} × {o.size.d.toFixed(2)} × {o.size.h.toFixed(2)}
      </td>
      <td>
        <span className="color-dot static" style={{ background: o.finish.color }} /> {mat(o.finish.material)}
      </td>
      <td>{o.existing ? "Existing" : o.locks.length ? `Locked (${o.locks.join(", ")})` : ""}</td>
    </tr>
  );
  return (
    <article className="summary-page">
      <div className="no-print btn-row">
        <Link className="btn sm" to={`/projects/${project.id}`}>
          Back to workspace
        </Link>
        <button className="btn sm" onClick={() => window.print()}>
          <Printer size={14} /> Print / PDF
        </button>
        <button className="btn sm" onClick={() => void apiBlob(`/api/projects/${project.id}/alternatives/${alt.id}/schedule.csv`).then((b) => downloadBlob(b, `${alt.name} schedule.csv`))}>
          <Download size={14} /> Schedule CSV
        </button>
      </div>
      <header style={{ display: "grid", gap: 6 }}>
        <span className="eyebrow">{project.name} · design summary</span>
        <h1>{alt.name}</h1>
        <div className="chips">
          <StatusChip status={alt.validation?.status ?? alt.validation_status} />
          <span className="chip outline">{alt.origin === "ai" ? "AI proposal, edited" : alt.origin === "sample" ? "Rule-based sample, not AI" : alt.origin}</span>
          <span className="chip">Revision {alt.revision}</span>
        </div>
      </header>
      <PlanMini geometry={project.geometry} scene={s} width={900} />
      {s.rationale && (
        <section>
          <h2>Concept</h2>
          <p>{s.rationale}</p>
        </section>
      )}
      {(s.tradeoffs.length > 0 || s.unresolved.length > 0) && (
        <section className="grid-2">
          <div>
            <h3>Trade-offs</h3>
            <ul>{s.tradeoffs.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </div>
          <div>
            <h3>Unresolved</h3>
            <ul>{s.unresolved.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </div>
        </section>
      )}
      <section>
        <h2>Finishes and lighting</h2>
        <ul>
          {s.finishes.map((f) => (
            <li key={f.room_id}>
              {project.geometry.rooms.find((r) => r.id === f.room_id)?.name}: floor {mat(f.floor.material)}, walls {f.walls.color}
            </li>
          ))}
          <li>
            Lighting: {s.lighting.mood}, {s.lighting.color_temperature_k} K{s.lighting.accent_lights ? ", warm accent lights" : ""} (indicative only)
          </li>
        </ul>
      </section>
      <section>
        <h2>Furniture schedule</h2>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Model</th>
              <th>Room</th>
              <th>W × D × H (m)</th>
              <th>Finish</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {required.map((o) => <Row key={o.id} o={o} />)}
          </tbody>
        </table>
        {optional.length > 0 && (
          <>
            <h3 style={{ marginTop: 18 }}>Optional additions</h3>
            <table>
              <tbody>{optional.map((o) => <Row key={o.id} o={o} />)}</tbody>
            </table>
          </>
        )}
        <p className="muted small" style={{ marginTop: 10 }}>Dimensions are approximate concept envelopes, not product specifications.</p>
      </section>
      <section>
        <h2>Checks</h2>
        <ul>
          {alt.validation?.checks.map((c) => (
            <li key={c.id}>
              {c.label}: {c.status === "valid" ? "pass" : `${c.status} (${c.count})`}
            </li>
          ))}
        </ul>
        <p className="muted small">Automated concept-level checks (containment, collisions, openings, counts, sizes and an approximate walkway connectivity test). Not a building-code or accessibility assessment.</p>
      </section>
    </article>
  );
}
