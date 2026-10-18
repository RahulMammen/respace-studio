import { useEffect, useRef, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, X } from "lucide-react";
import { SceneView, type Preset, type SceneViewHandle } from "../three/SceneView";
import { usePrefs } from "../state/ui";
import { useWorkspace } from "../state/workspace";

const SHOTS: { preset: Preset; label: string }[] = [
  { preset: "corner-a", label: "Corner view" },
  { preset: "corner-b", label: "Opposite corner" },
  { preset: "entrance", label: "From the entrance" },
  { preset: "top", label: "Overview" },
];

export function PresentationMode({ onClose }: { onClose: () => void }) {
  const { project, alt, scene, geometry, catalog, validation } = useWorkspace();
  const prefs = usePrefs();
  const [shot, setShot] = useState(0);
  const ref = useRef<SceneViewHandle>(null);

  useEffect(() => {
    const t = setTimeout(() => ref.current?.preset(SHOTS[shot].preset), 60);
    return () => clearTimeout(t);
  }, [shot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setShot((s) => (s + 1) % SHOTS.length);
      if (e.key === "ArrowLeft") setShot((s) => (s - 1 + SHOTS.length) % SHOTS.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!alt || !scene || !geometry || !catalog || !project) return null;
  const save = () => {
    const url = ref.current?.capture();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${alt.name.replace(/[^\w -]/g, "")} - ${SHOTS[shot].label}.png`;
    a.click();
  };
  return (
    <div className="presentation" role="dialog" aria-modal="true" aria-label="Presentation">
      <SceneView
        ref={ref}
        scene={scene}
        geometry={geometry}
        catalog={catalog}
        viewMode="orbit"
        wallMode="cutaway"
        ceiling={false}
        lowQuality={prefs.lowQuality}
        selection={[]}
        highlight={[]}
        validation={validation}
        showWalkway={false}
        showDimensions={false}
        interactive={false}
        onSelect={() => undefined}
        onMove={() => undefined}
        presentation
      />
      <div className="pres-caption">
        <span className="eyebrow">{project.name}</span>
        <h1>{alt.name}</h1>
        {scene.rationale && <p>{scene.rationale}</p>}
        <p className="small muted">Concept visualisation of the editable scene. Furniture is approximate; not a photographic render.</p>
      </div>
      <div className="pres-controls">
        <button className="icon-btn" aria-label="Previous view" onClick={() => setShot((s) => (s - 1 + SHOTS.length) % SHOTS.length)}>
          <ChevronLeft size={18} />
        </button>
        <span className="small">{SHOTS[shot].label}</span>
        <button className="icon-btn" aria-label="Next view" onClick={() => setShot((s) => (s + 1) % SHOTS.length)}>
          <ChevronRight size={18} />
        </button>
        <button className="btn sm" onClick={save}>
          <Camera size={14} /> Save PNG
        </button>
        <button className="icon-btn" aria-label="Exit presentation" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
