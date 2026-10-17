import { API_BASE_URL } from "../../api";
import { fetchAuthenticatedAiAsset } from "../../authenticatedAssets";
import type { EvidenceBlock } from "./prereportModel";
import type { RenderParams } from "./prereportTypes";

/**
 * Compone, en el navegador, las imágenes de evidencia del preinforme: el corte persistido de la serie exacta con
 * los trazos o la región evaluada que la corrida guardó, y una ampliación de esa misma zona.
 *
 * Reglas:
 * - La imagen se pide por la ruta que dio el Backend (corte de la serie exacta, o `input.png` de la corrida cuando es el corte
 *   analizado). No se sustituye por otro corte.
 * - Las coordenadas se llevan del espacio declarado (base 0..256 del plano, o píxeles nativos de la serie para la región) a la
 *   imagen con la misma escala que usa el visor; nunca se deducen del nombre del nivel.
 * - La ampliación es un recorte con la MISMA proporción de la imagen: no se deforma.
 * - El resultado son data URLs: el documento exportado no depende de una sesión ni de una URL temporal.
 */

export type ComposedImage = {
  full: string;
  zoom: string;
  width: number;
  height: number;
  params: RenderParams;
};

const FULL_WIDTH = 640;
const ZOOM_WIDTH = 560;
const BASE = 256;
const COLORS = { ia: "#0ea5e9", profesional: "#f59e0b", region: "#facc15" } as const;

type Pt = { x: number; y: number };
type Shape =
  | { kind: "trace"; ref: string; n: number; origin: "ia" | "profesional"; points: Pt[]; segments: [number, number][] }
  | { kind: "region"; ref: string; n: number; box: { x0: number; y0: number; x1: number; y1: number }; point: Pt };

type Crop = { x: number; y: number; w: number; h: number };

function shapesFor(block: EvidenceBlock, width: number, height: number): Shape[] {
  const shapes: Shape[] = [];
  for (const trace of block.traces) {
    const sw = trace.space.width ?? BASE;
    const sh = trace.space.height ?? BASE;
    const points = trace.points.map(([x, y]) => ({ x: (x / sw) * width, y: (y / sh) * height }));
    // Segmento: dos puntos. Ángulo: dos rectas (p0-p1 y p2-p3). Otra forma no se dibuja: no se inventa.
    const segments: [number, number][] = points.length === 2 ? [[0, 1]] : points.length === 4 ? [[0, 1], [2, 3]] : [];
    if (segments.length) shapes.push({ kind: "trace", ref: trace.ref, n: trace.n, origin: trace.origin, points, segments });
  }
  for (const region of block.regions) {
    const r = region.region;
    const sx = width / r.width;
    const sy = height / r.height;
    shapes.push({
      kind: "region",
      ref: region.ref,
      n: region.n,
      box: { x0: r.bbox.x0 * sx, y0: r.bbox.y0 * sy, x1: r.bbox.x1 * sx, y1: r.bbox.y1 * sy },
      point: { x: r.point.x * sx, y: r.point.y * sy },
    });
  }
  return shapes;
}

function boundsOf(shapes: Shape[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const shape of shapes) {
    if (shape.kind === "trace") shape.points.forEach((p) => add(p.x, p.y));
    else {
      add(shape.box.x0, shape.box.y0);
      add(shape.box.x1, shape.box.y1);
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Recorte de la ampliación: centrado en la evidencia, con la proporción de la imagen y dentro de sus límites. */
export function zoomCropFor(shapesBounds: { minX: number; minY: number; maxX: number; maxY: number }, width: number, height: number): Crop {
  const spanX = Math.max(shapesBounds.maxX - shapesBounds.minX, 1);
  const spanY = Math.max(shapesBounds.maxY - shapesBounds.minY, 1);
  const aspect = height / width;
  let w = Math.max(spanX * 1.9, (spanY * 1.9) / aspect, width * 0.3);
  w = Math.min(w, width);
  let h = w * aspect;
  if (h > height) {
    h = height;
    w = h / aspect;
  }
  const cx = (shapesBounds.minX + shapesBounds.maxX) / 2;
  const cy = (shapesBounds.minY + shapesBounds.maxY) / 2;
  const x = Math.min(Math.max(cx - w / 2, 0), width - w);
  const y = Math.min(Math.max(cy - h / 2, 0), height - h);
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

const round = (value: number) => Math.round(value * 100) / 100;

function render(bitmap: ImageBitmap, crop: Crop, outWidth: number, shapes: Shape[]): string {
  const outHeight = Math.round((outWidth * crop.h) / crop.w);
  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo preparar el lienzo de la imagen.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, outWidth, outHeight);
  const k = outWidth / crop.w;
  const t = (p: Pt): Pt => ({ x: (p.x - crop.x) * k, y: (p.y - crop.y) * k });
  const lw = Math.max(2, outWidth / 280);
  const badge = (at: Pt, n: number, color: string) => {
    const radius = lw * 3.4;
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#0b1320";
    ctx.fill();
    ctx.lineWidth = lw * 0.8;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.round(radius * 1.5)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), at.x, at.y + 0.5);
  };
  for (const shape of shapes) {
    if (shape.kind === "trace") {
      const color = shape.origin === "profesional" ? COLORS.profesional : COLORS.ia;
      for (const [a, b] of shape.segments) {
        const pa = t(shape.points[a]);
        const pb = t(shape.points[b]);
        for (const [width, stroke] of [[lw * 2.4, "rgba(0,0,0,0.65)"], [lw, color]] as const) {
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.lineWidth = width;
          ctx.strokeStyle = stroke;
          ctx.lineCap = "round";
          ctx.stroke();
        }
        // Marcas perpendiculares en las puntas: se lee como una cota y no como una marca cualquiera.
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * lw * 2.2;
        const ny = (dx / len) * lw * 2.2;
        for (const p of [pa, pb]) {
          ctx.beginPath();
          ctx.moveTo(p.x - nx, p.y - ny);
          ctx.lineTo(p.x + nx, p.y + ny);
          ctx.lineWidth = lw;
          ctx.strokeStyle = color;
          ctx.stroke();
        }
      }
      // La etiqueta va pasando la segunda punta de la cota, sobre su misma dirección: dos cotas que se cruzan en el centro
      // del disco no superponen sus números.
      const first = t(shape.points[shape.segments[0][0]]);
      const second = t(shape.points[shape.segments[0][1]]);
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const len = Math.hypot(dx, dy) || 1;
      badge({ x: second.x + (dx / len) * lw * 6, y: second.y + (dy / len) * lw * 6 }, shape.n, color);
    } else {
      const p0 = t({ x: shape.box.x0, y: shape.box.y0 });
      const p1 = t({ x: shape.box.x1, y: shape.box.y1 });
      const c = t(shape.point);
      for (const [width, stroke] of [[lw * 2.2, "rgba(0,0,0,0.6)"], [lw * 0.9, COLORS.region]] as const) {
        ctx.setLineDash([lw * 3, lw * 2]);
        ctx.lineWidth = width;
        ctx.strokeStyle = stroke;
        ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
        ctx.setLineDash([]);
        const arm = lw * 3;
        ctx.beginPath();
        ctx.moveTo(c.x - arm, c.y);
        ctx.lineTo(c.x + arm, c.y);
        ctx.moveTo(c.x, c.y - arm);
        ctx.lineTo(c.x, c.y + arm);
        ctx.stroke();
      }
      badge({ x: p0.x + lw * 4, y: p0.y - lw * 4 }, shape.n, COLORS.region);
    }
  }
  return canvas.toDataURL("image/jpeg", 0.92);
}

export async function composeBlock(block: EvidenceBlock): Promise<ComposedImage> {
  const blob = await fetchAuthenticatedAiAsset(`${API_BASE_URL}${block.imagePath}`);
  const bitmap = await createImageBitmap(blob);
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    const shapes = shapesFor(block, width, height);
    if (!shapes.length) throw new Error("No hay una geometría válida para dibujar sobre esta imagen.");
    const fullCrop: Crop = { x: 0, y: 0, w: width, h: height };
    const zoomCrop = zoomCropFor(boundsOf(shapes), width, height);
    return {
      full: render(bitmap, fullCrop, FULL_WIDTH, shapes),
      zoom: render(bitmap, zoomCrop, ZOOM_WIDTH, shapes),
      width,
      height,
      params: {
        imagePath: block.imagePath,
        imageSize: [width, height],
        fullCrop,
        zoomCrop,
        outputWidth: { full: FULL_WIDTH, zoom: ZOOM_WIDTH },
        overlays: shapes.map((shape) => ({ kind: shape.kind, ref: shape.ref })),
      },
    };
  } finally {
    bitmap.close();
  }
}
