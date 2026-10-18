// Procedural material textures (generated on canvas at runtime; no image downloads).
import * as THREE from "three";
import type { MaterialInfo } from "../api/types";

type Kind = "wood" | "fabric" | "weave" | "stone" | "metal" | "glass" | "paint" | "paper" | "leather";

function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amount)));
  return `#${c.getHexString()}`;
}

function paint(ctx: CanvasRenderingContext2D, kind: Kind, base: string, size: number, seed: number) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  if (kind === "wood") {
    const planks = 4;
    for (let p = 0; p < planks; p++) {
      const y0 = (p * size) / planks;
      ctx.fillStyle = shade(base, (hash(seed + p) - 0.5) * 0.06);
      ctx.fillRect(0, y0, size, size / planks);
      for (let i = 0; i < 14; i++) {
        const y = y0 + hash(seed + p * 31 + i) * (size / planks);
        ctx.strokeStyle = shade(base, -0.05 - hash(i + p) * 0.06);
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 0.6 + hash(i * 3 + p) * 1.2;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= size; x += size / 16) ctx.lineTo(x, y + Math.sin(x / 18 + i + p) * 1.6);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = shade(base, -0.12);
      ctx.fillRect(0, y0, size, 1);
      ctx.globalAlpha = 1;
    }
  } else if (kind === "fabric" || kind === "leather") {
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const px = (i / 4) % size;
      const py = Math.floor(i / 4 / size);
      const weave = kind === "fabric" ? ((px + py) % 2 ? 4 : -4) : 0;
      const n = (hash(i * 0.37 + seed) - 0.5) * (kind === "fabric" ? 14 : 8) + weave;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  } else if (kind === "weave") {
    ctx.strokeStyle = shade(base, -0.12);
    ctx.lineWidth = 2;
    for (let i = 0; i < size; i += 8) {
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + size, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i + size, 0);
      ctx.lineTo(i, size);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (kind === "stone") {
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = shade(base, (hash(i + seed) - 0.5) * 0.18);
      ctx.globalAlpha = 0.35;
      const r = 1 + hash(i * 7) * 3;
      ctx.beginPath();
      ctx.arc(hash(i * 13 + seed) * size, hash(i * 17 + seed) * size, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (kind === "paint" || kind === "paper") {
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (hash(i * 0.11 + seed) - 0.5) * 5;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }
}

const textureCache = new Map<string, THREE.CanvasTexture>();

export function materialTexture(info: MaterialInfo, color: string, repeat = 1): THREE.CanvasTexture | null {
  const kind = info.kind as Kind;
  if (kind === "glass" || kind === "metal") return null;
  const key = `${kind}:${color}:${repeat}`;
  const hit = textureCache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return null;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paint(ctx, kind, color, size, color.length * 7);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textureCache.set(key, tex);
  return tex;
}

const swatchCache = new Map<string, string>();

/** Small data-URL swatch for UI chips (same generator as the 3D textures). */
export function swatchUrl(info: MaterialInfo | undefined, color: string): string {
  if (!info || typeof document === "undefined") return "";
  const key = `${info.kind}:${color}`;
  const hit = swatchCache.get(key);
  if (hit) return hit;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  if (info.kind === "metal") {
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, shade(color, 0.18));
    g.addColorStop(0.5, color);
    g.addColorStop(1, shade(color, -0.15));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  } else if (info.kind === "glass") {
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, "#f5f8f7");
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  } else {
    paint(ctx, info.kind as Kind, color, size, color.length * 7);
  }
  const url = canvas.toDataURL("image/png");
  swatchCache.set(key, url);
  return url;
}

export const PALETTE_COLORS = [
  "#f1ebdf", "#e7e1d6", "#d8d0c2", "#b9ae9c", "#8f877a", "#2b2a28",
  "#dcc3a1", "#c9a27a", "#8a5a3c", "#6f4e37",
  "#a7b39b", "#7f8f7a", "#6b7c65", "#4b6450",
  "#c8a46e", "#b08d57", "#a4473a", "#4a6b78",
];
