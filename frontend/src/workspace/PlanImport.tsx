import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api } from "../api/client";
import type { Asset } from "../api/types";
import { Dialog } from "../components/common";
import { toast } from "../state/ui";
import { canvasToPng, openPdf, renderPage } from "./pdf";

const MAX_BYTES = 15 * 1024 * 1024;

export function PlanImport({ projectId, onUploaded, compact }: { projectId: string; onUploaded: (a: Asset) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pdf, setPdf] = useState<{ doc: PDFDocumentProxy; name: string; thumbs: string[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = async (blob: Blob, name: string, source: string) => {
    if (blob.size > MAX_BYTES) throw new Error("The plan image is larger than 15 MB.");
    const form = new FormData();
    form.append("file", blob, name);
    form.append("kind", "plan");
    form.append("source", source);
    const asset = await api<Asset>(`/api/projects/${projectId}/assets`, { method: "POST", body: form });
    onUploaded(asset);
  };

  const handle = async (file: File) => {
    setBusy(true);
    try {
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        if (file.size > 60 * 1024 * 1024) throw new Error("PDF is larger than 60 MB.");
        const doc = await openPdf(file);
        const thumbs: string[] = [];
        for (let i = 1; i <= Math.min(doc.numPages, 12); i++) {
          const c = await renderPage(doc, i, 220);
          thumbs.push(c.toDataURL("image/png"));
        }
        setPdf({ doc, name: file.name, thumbs });
      } else if (["image/png", "image/jpeg"].includes(file.type)) {
        await upload(file, file.name, "image upload");
        toast("Plan uploaded. Next: calibrate a known length.");
      } else {
        throw new Error("Use a PNG, JPEG or PDF file.");
      }
    } catch (err) {
      toast((err as Error).message || "Could not read that file.", "error");
    } finally {
      setBusy(false);
    }
  };

  const choosePage = async (n: number) => {
    if (!pdf) return;
    setBusy(true);
    try {
      const canvas = await renderPage(pdf.doc, n, 2600);
      const blob = await canvasToPng(canvas);
      await upload(blob, `${pdf.name.replace(/\.pdf$/i, "")}-page-${n}.png`, `PDF page ${n} of ${pdf.doc.numPages}`);
      setPdf(null);
      toast(`Imported page ${n}. Next: calibrate a known length.`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/png,image/jpeg,application/pdf,.pdf"
        data-testid="plan-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handle(f);
          e.target.value = "";
        }}
      />
      {compact ? (
        <button className="btn sm" onClick={() => input.current?.click()} disabled={busy}>
          <FileUp size={15} /> Replace plan
        </button>
      ) : (
        <button
          className={`dropzone ${dragOver ? "over" : ""}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handle(f);
          }}
          disabled={busy}
        >
          {busy ? <span className="spinner" /> : <FileUp size={22} />}
          <strong>Import floor plan</strong>
          <span className="muted small">PNG, JPEG or a page from a PDF · up to 15 MB</span>
        </button>
      )}
      {pdf && (
        <Dialog title="Choose a PDF page" subtitle={`${pdf.name} · ${pdf.doc.numPages} page${pdf.doc.numPages === 1 ? "" : "s"}`} onClose={() => setPdf(null)} wide>
          <div className="pdf-pages">
            {pdf.thumbs.map((t, i) => (
              <button key={i} className="pdf-page" onClick={() => void choosePage(i + 1)} disabled={busy}>
                <img src={t} alt={`Page ${i + 1}`} />
                <span>Page {i + 1}</span>
              </button>
            ))}
          </div>
          {pdf.doc.numPages > 12 && <p className="muted small">Showing the first 12 pages.</p>}
        </Dialog>
      )}
    </>
  );
}
