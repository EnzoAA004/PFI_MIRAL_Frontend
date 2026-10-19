import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

/**
 * Auditoría de tema y contraste en 8288 (solo lectura: toda escritura se bloquea en el navegador).
 *
 * Para cada pantalla y cada tema mide el contraste de TODO el texto visible contra su fondo efectivo (compuesto sobre los
 * ancestros) y lista lo que no llega a 4,5:1 (3:1 en texto grande). Una mezcla accidental de temas (superficie clara con
 * texto claro, o al revés) aparece como contraste ≈ 1:1. Los píxeles médicos (img/canvas) no se miden.
 *
 * Uso: OUT_DIR=... [W=1366 H=768] [THEMES=light,dark] [SHOTS=1] node scripts/theme-audit.mjs
 */
const WEB = process.env.PFI_WEB ?? "http://localhost:8288";
const OUT = process.env.OUT_DIR ?? "theme-audit-out";
const W = Number(process.env.W ?? 1366);
const H = Number(process.env.H ?? 768);
const THEMES = (process.env.THEMES ?? "light,dark").split(",");
const SHOTS = process.env.SHOTS === "1";
const CASE = process.env.CASE ?? "REVFIN-2110";
mkdirSync(OUT, { recursive: true });

const COLLECT = () => {
  const parse = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  };
  const items = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node = walker.currentNode;
  while (node) {
    const el = node;
    node = walker.nextNode();
    if (!(el instanceof HTMLElement) || ["SCRIPT", "STYLE", "IMG", "CANVAS", "SVG", "PATH"].includes(el.tagName)) continue;
    // Se excluyen las anotaciones dibujadas sobre los píxeles médicos (su fondo es la imagen); todo el marco sí se mide.
    if (el.closest("canvas, [data-medical-pixels], .rr-corner, .rr-scalebar, .rr-orientation, .rr-viewport-role, .real-slice-frame, .segmentation-legend-panel, .rr-instances-panel")) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ");
    if (el instanceof HTMLInputElement && ["checkbox", "radio", "range", "file"].includes(el.type)) continue;
    const isControl = ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
    const text = own || (isControl ? (el.value || el.getAttribute("placeholder") || "") : "");
    if (!text || !visible(el)) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg || fg.a === 0) continue; // texto transparente a propósito (p. ej. reemplazado por un ::after)
    if (el.closest("details:not([open])") && el.tagName !== "SUMMARY" && !el.closest("summary")) continue;
    // Rectángulo del texto propio (no del contenedor completo) para muestrear el fondo detrás de las letras.
    const range = document.createRange();
    let rect = el.getBoundingClientRect();
    const textNode = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (textNode) { range.selectNodeContents(textNode); const r = range.getBoundingClientRect(); if (r.width > 0 && r.height > 0) rect = r; }
    // Si hay otra capa encima (un diálogo, el editor del preinforme), el elemento no se ve y no se mide.
    const left = Math.max(0, rect.left), right = Math.min(innerWidth - 1, rect.right), topEdge = Math.max(0, rect.top), bottom = Math.min(innerHeight - 1, rect.bottom);
    if (right <= left || bottom <= topEdge) continue;
    const cx = (left + right) / 2;
    const cy = (topEdge + bottom) / 2;
    const top = document.elementFromPoint(cx, cy);
    if (!top || !(el === top || el.contains(top) || top.contains(el))) continue;
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const disabled = el.disabled === true || el.getAttribute("aria-disabled") === "true" || Boolean(el.closest(":disabled, [aria-disabled='true']"));
    const cls = el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    items.push({ el: `${el.tagName.toLowerCase()}${cls}`, text: text.slice(0, 40), rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height }, fg: cs.color, a: fg.a * Number(cs.opacity || 1), size, bold, disabled });
  }
  return items;
};

const SAMPLE = async ({ png, items }) => {
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = `data:image/png;base64,${png}`; });
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const parse = (value) => { const m = value.match(/rgba?\(([^)]+)\)/); const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2] }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const offenders = [];
  let measured = 0;
  for (const item of items) {
    const x = Math.max(0, Math.floor(item.rect.x));
    const y = Math.max(0, Math.floor(item.rect.y));
    const w = Math.min(canvas.width - x, Math.max(1, Math.ceil(item.rect.w)));
    const h = Math.min(canvas.height - y, Math.max(1, Math.ceil(item.rect.h)));
    if (w <= 0 || h <= 0) continue;
    const data = ctx.getImageData(x, y, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1; }
    const bg = { r: r / n, g: g / n, b: b / n };
    const fg = parse(item.fg);
    const front = { r: fg.r * item.a + bg.r * (1 - item.a), g: fg.g * item.a + bg.g * (1 - item.a), b: fg.b * item.a + bg.b * (1 - item.a) };
    const l1 = lum(front), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const large = item.size >= 24 || (item.size >= 18.66 && item.bold);
    const required = large ? 3 : 4.5;
    measured += 1;
    if (ratio < required && !item.disabled) offenders.push({ el: item.el, text: item.text, ratio: Math.round(ratio * 100) / 100, required, fg: item.fg, bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})` });
  }
  return { measured, offenders };
};

async function measure(page) {
  const items = await page.evaluate(COLLECT);
  // Se oculta el texto y se fotografía la pantalla: el fondo se muestrea de los píxeles reales (incluye degradados y capas).
  const style = await page.addStyleTag({ content: "* { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; } ::placeholder { color: transparent !important; } input, textarea, select { -webkit-text-fill-color: transparent !important; }" });
  await page.waitForTimeout(150);
  const png = (await page.screenshot()).toString("base64");
  await style.evaluate((node) => node.remove());
  return page.evaluate(SAMPLE, { png, items });
}

const browser = await chromium.launch({ headless: true });
const report = [];
for (const theme of THEMES) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: theme });
  await ctx.addInitScript((t) => { try { window.localStorage.setItem("pfi.theme", t); } catch { /* sin almacenamiento */ } }, theme);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.route(/localhost:8280\/api\/(?!auth)/, (route) => (route.request().method() === "GET" ? route.continue() : route.abort()));
  const shots = (name) => (SHOTS ? page.screenshot({ path: `${OUT}/${name}-${W}-${theme}.png` }) : Promise.resolve());
  const audit = async (name) => {
    await page.waitForTimeout(700);
    await shots(name);
    const result = await measure(page);
    const attr = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    report.push({ theme, screen: name, dataTheme: attr, ...result });
    console.log(`${theme.padEnd(5)} ${name.padEnd(34)} medidos ${String(result.measured).padStart(4)} · bajo contraste ${result.offenders.length}`);
  };

  // acceso
  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await audit("login");
  await page.getByRole("button", { name: /Entrar con doctor demo/ }).click();
  await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
  await page.waitForTimeout(1200);
  await audit("lista");
  await page.locator("tbody tr").first().click();
  await audit("lista-estudio-seleccionado");
  await page.getByRole("button", { name: "Nuevo estudio" }).click();
  await page.getByRole("heading", { name: "Nuevo estudio", level: 1 }).waitFor();
  await audit("nuevo-estudio-paso-1");
  await page.getByPlaceholder("CASE-XXXX").fill("TEMA-PRUEBA");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await audit("nuevo-estudio-paso-2");
  await page.goto(`${WEB}/pacientes`, { waitUntil: "networkidle" });
  await audit("pacientes");
  await page.goto(`${WEB}/pacientes/OSF-ID10`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await audit("historial");
  await page.goto(`${WEB}/ajustes`, { waitUntil: "networkidle" });
  await audit("ajustes-preferencias");
  await page.getByRole("tab", { name: /Ayuda y alcance/ }).click();
  await audit("ajustes-ayuda");
  await page.goto(`${WEB}/estudio/${CASE}`, { waitUntil: "networkidle" });
  await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2500);
  await audit("visor-resultados");
  await page.getByText("Hallazgos IA", { exact: true }).first().click();
  await audit("visor-hallazgos");
  await page.getByRole("tab", { name: "Revisión" }).click();
  await audit("visor-revision");
  await page.getByRole("tab", { name: "Contexto" }).click();
  await audit("visor-contexto");
  await page.getByRole("button", { name: "Editar datos" }).click();
  await audit("visor-editar-datos");
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.getByTestId("tools-open").click();
  await audit("visor-herramientas");
  await page.locator('[data-tool-id="assistant"]').click();
  await page.getByTestId("assistant-panel").waitFor();
  await page.waitForTimeout(1500);
  await audit("visor-asistente");
  await page.getByTestId("tools-open").click().catch(() => undefined);
  await page.getByRole("tab", { name: "Revisión" }).click();
  await page.getByTestId("prepare-prereport").click();
  await page.getByTestId("prereport-summary").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await audit("preinforme");
  if (process.env.DUAL_REF) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.goto(`${WEB}/estudio/${CASE}`, { waitUntil: "networkidle" });
    await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
    await page.waitForTimeout(2000);
    await page.getByTestId("tools-open").click();
    await page.locator('[data-tool-id="comparison"]').click();
    await page.getByTestId("initial-comparison").waitFor({ timeout: 60_000 });
    await page.locator("#rr-cmp-reference").selectOption(process.env.DUAL_REF);
    await page.waitForTimeout(3000);
    await audit("comparacion-panel");
    await page.getByTestId("open-dual-comparison").click();
    await page.getByTestId("dual-comparison").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(4000);
    await audit("comparacion-visual");
    await page.getByTestId("dual-tab-assistant").click();
    await page.getByTestId("assistant-panel").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await audit("comparacion-asistente");
  }
  await page.goto(`${WEB}/estudio/NO-EXISTE-999`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await audit("estudio-inexistente");
  if (pageErrors.length) console.log("  errores de página:", pageErrors.slice(0, 3));
  await ctx.close();
}
writeFileSync(`${OUT}/theme-audit.json`, JSON.stringify(report, null, 1));
const total = report.reduce((n, r) => n + r.offenders.length, 0);
console.log(`\nTotal con bajo contraste: ${total}`);
for (const r of report) {
  if (!r.offenders.length) continue;
  console.log(`\n[${r.theme}] ${r.screen}`);
  const grouped = new Map();
  for (const o of r.offenders) {
    const key = `${o.el} ${o.fg} / ${o.bg}`;
    const entry = grouped.get(key) ?? { ...o, n: 0 };
    entry.n += 1;
    grouped.set(key, entry);
  }
  [...grouped.values()].sort((a, b) => a.ratio - b.ratio).slice(0, 6).forEach((o) => console.log(`  ${String(o.ratio).padStart(5)} (${o.required}) ×${o.n} ${o.el} «${o.text}» ${o.fg} sobre ${o.bg}`));
}
await browser.close();
