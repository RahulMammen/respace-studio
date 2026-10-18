// Client-side PDF page rasterisation (pdf.js). The PDF itself never leaves the browser;
// only the chosen page, rendered to PNG, is uploaded.
import type { PDFDocumentProxy } from "pdfjs-dist";

let lib: typeof import("pdfjs-dist") | null = null;

async function pdfjs() {
  if (!lib) {
    lib = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    lib.GlobalWorkerOptions.workerSrc = worker.default;
  }
  return lib;
}

export async function openPdf(file: File): Promise<PDFDocumentProxy> {
  const pdf = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  return pdf.getDocument({ data, enableXfa: false }).promise;
}

export async function renderPage(doc: PDFDocumentProxy, pageNo: number, maxSide: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(6, maxSide / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not render page"))), "image/png"));
}
