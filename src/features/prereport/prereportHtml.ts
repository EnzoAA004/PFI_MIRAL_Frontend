import {
  COLUMN_LABEL,
  DRAFT_BANNER,
  MATRIX_COLUMNS,
  SECTION_ORDER,
  annexMeasurements,
  documentSummary,
  effectiveText,
  evidenceBlocks,
  formatValue,
  includedResearch,
  isEdited,
  missingEvidence,
  modalityLabel,
  plural,
  resultsSummary,
  selectedLevels,
  summaryMatrix,
  type EvidenceBlock,
  type LevelSelection,
} from "./prereportModel";
import type { ComposedImage } from "./prereportImages";
import type { PreReportEdits, PreReportGenerated, PreReportMeasurement } from "./prereportTypes";

/**
 * El documento del preinforme, uno solo: lo comparten la vista previa, «Guardar HTML» y la impresión a PDF. Si cada salida
 * armara su propio HTML, el PDF y la pantalla podrían decir cosas distintas.
 *
 * Dos variantes del MISMO contenido: «Preinforme» (predeterminada: contexto, resumen, tabla de resultados, fichas, evidencia y
 * observaciones) y «Preinforme con anexos» (agrega tablas completas y trazabilidad técnica). Ambas conservan el estado de borrador,
 * la identificación del estudio y de la versión de fuentes, las limitaciones relevantes y los avisos de evidencia faltante y de
 * correspondencia anatómica pendiente. Excluir los anexos de una exportación no borra datos ni cambia lo guardado.
 *
 * Es autocontenido: las imágenes van como data URL y los estilos, en línea. Para el PDF se usa la impresión del navegador
 * (A4 vertical, márgenes y numeración de página definidos acá con `@page`); ver docs/PREINFORME_VISUAL.md.
 */

export type ImageState = { status: "loading" } | { status: "ready"; image: ComposedImage } | { status: "failed"; error: string };

export type ExportVariant = "brief" | "full";

export const VARIANT_LABEL: Record<ExportVariant, string> = { brief: "Preinforme", full: "Preinforme con anexos" };

export type DocumentMeta = {
  generatedAt: string;
  draftVersion: number | null;
  fingerprint: string;
  /** El borrador se creó con fuentes distintas a las actuales. */
  stale: boolean;
};

export const CORRESPONDENCE_NOTICE = "La correspondencia anatómica entre estas mediciones y clasificaciones requiere verificación profesional.";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const para = (text: string) => escapeHtml(text).replace(/\n/g, "<br>");

function dateText(iso: string | null): string {
  if (!iso) return "No informada";
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });
}

function dateTimeText(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("es-AR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const CSS = `
@page { size: A4; margin: 17mm 14mm 15mm 14mm;
  @top-left { content: "MIRA·L"; font: 700 8pt 'Segoe UI', Arial, sans-serif; color: #0f3d63; }
  @top-right { content: "Preinforme · Borrador pendiente de revisión profesional"; font: 8pt 'Segoe UI', Arial, sans-serif; color: #b45309; }
  @bottom-center { content: "Página " counter(page) " de " counter(pages); font: 8pt 'Segoe UI', Arial, sans-serif; color: #64748b; } }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 9.6pt/1.4 'Segoe UI', Inter, Arial, sans-serif; color: #102033; background: #e9eef4; }
.sheet { max-width: 182mm; margin: 12px auto; background: #fff; padding: 10mm 12mm; box-shadow: 0 6px 24px rgba(15,23,42,.12); }
@media print { body { background: #fff; } .sheet { max-width: none; margin: 0; padding: 0; box-shadow: none; } }
h1 { font-size: 19pt; margin: 2pt 0 3pt; letter-spacing: -.01em; }
h2 { font-size: 12pt; margin: 9pt 0 4pt; color: #0f3d63; border-bottom: 1.2px solid #cbd9e8; padding-bottom: 2pt; break-after: avoid; }
h3 { font-size: 10.5pt; margin: 0; break-after: avoid; }
h4 { font-size: 8.5pt; margin: 6pt 0 2pt; color: #475569; text-transform: uppercase; letter-spacing: .05em; break-after: avoid; }
p { margin: 2pt 0; }
.brand { font-weight: 800; letter-spacing: .12em; color: #0f3d63; font-size: 9pt; }
.draft-badge { display: inline-block; margin: 2pt 0 6pt; padding: 2pt 9pt; border: 1px solid #f59e0b; background: #fffbeb; color: #92400e; border-radius: 99px; font-weight: 700; font-size: 9pt; }
.meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2pt 18pt; margin: 4pt 0; font-size: 8.8pt; }
.meta div { break-inside: avoid; }
.meta dt { color: #64748b; font-size: 7.6pt; text-transform: uppercase; letter-spacing: .04em; }
.meta dd { margin: 0 0 2pt; }
.meta .wide { grid-column: 1 / -1; }
.muted { color: #64748b; }
.note { border: 1px solid #bfdbfe; background: #eff6ff; border-radius: 6px; padding: 4pt 8pt; font-size: 8.8pt; margin: 5pt 0; }
.warn { border-color: #fcd34d; background: #fffbeb; }
table { border-collapse: collapse; width: 100%; font-size: 8.8pt; }
th { text-align: left; background: #eef4fb; color: #334155; font-size: 7.8pt; text-transform: uppercase; letter-spacing: .03em; }
th, td { border-bottom: 1px solid #e2e8f0; padding: 2.5pt 5pt; vertical-align: top; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
.matrix td.present { font-weight: 700; color: #7c2d12; background: #fff7ed; }
.matrix td.absent { color: #475569; }
.matrix td.graded { color: #1e3a5f; }
.matrix td.not_evaluated { color: #94a3b8; font-style: italic; }
.summary ul { margin: 2pt 0 2pt 14pt; padding: 0; }
.summary li { margin: 1pt 0; }
.keep { break-inside: avoid; }
.ficha-block { break-inside: avoid; border: 1px solid #d5e1ee; border-radius: 8px; padding: 5pt 9pt; margin-bottom: 5pt; }
.ficha-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 2pt; margin-bottom: 3pt; }
.ficha-head .tag { font-size: 7.8pt; color: #92400e; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 99px; padding: 0 7px; white-space: nowrap; }
.ficha-head h3 .sub { font-weight: 400; color: #475569; }
.pred { margin: 1.5pt 0; padding-left: 10pt; position: relative; }
.pred::before { content: "▸"; position: absolute; left: 0; color: #0f3d63; }
.edited { font-size: 7.5pt; color: #6d28d9; margin-left: 4pt; }
.evidence { display: grid; grid-template-columns: repeat(2, minmax(0, 76mm)); gap: 2.5mm 6mm; margin-top: 3pt; }
.evidence figure { margin: 0; break-inside: avoid; }
.evidence img { width: 100%; height: auto; display: block; border: 1px solid #94a3b8; border-radius: 3px; background: #000; }
.evidence figcaption { font-size: 7.8pt; color: #475569; margin-top: 1.5pt; }
.series-row { grid-column: 1 / -1; font-size: 8.4pt; font-weight: 600; color: #0f3d63; margin: 3pt 0 -1pt; break-after: avoid; }
.legend { font-size: 8.2pt; margin: 3pt 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 1pt 14pt; break-inside: avoid; }
.legend li { margin: 0; }
.dot { display: inline-block; width: 8pt; height: 8pt; border-radius: 50%; margin-right: 4pt; vertical-align: -1pt; }
.src { font-size: 7.8pt; color: #64748b; margin: 2pt 0 0; }
.verify { border: 1px solid #fcd34d; background: #fffbeb; color: #5b3b05; border-radius: 6px; padding: 3pt 8pt; font-size: 8.4pt; margin: 3pt 0; }
.obs { border-left: 3px solid #0f3d63; background: #f8fafc; padding: 3pt 8pt; margin-top: 4pt; font-size: 9.2pt; }
.obs strong { display: block; font-size: 7.8pt; text-transform: uppercase; letter-spacing: .04em; color: #475569; }
.missing { font-size: 8.4pt; color: #92400e; margin: 2pt 0; }
.research { border: 1px dashed #94a3b8; border-radius: 8px; padding: 5pt 9pt; background: #fbfdff; break-inside: avoid; }
.annex { break-before: page; }
.annex h2:first-child { margin-top: 0; }
.small { font-size: 8.4pt; }
ul.plain { margin: 2pt 0 2pt 14pt; padding: 0; }
.footer-note { font-size: 7.8pt; color: #64748b; margin-top: 8pt; }
`;

function header(model: PreReportGenerated, meta: DocumentMeta): string {
  const clinical = model.study.clinical;
  const age = clinical.ageAtStudy === null
    ? "No informada"
    : `${clinical.ageAtStudy} años${clinical.ageProvenance === "calculated" ? " (calculada)" : clinical.ageProvenance === "reported" ? " (informada)" : ""}`;
  const context: [string, string | null][] = [
    ["Motivo de consulta", clinical.reason],
    ["Síntomas", clinical.symptoms],
    ["Duración de los síntomas", clinical.symptomDuration],
    ["Antecedentes relevantes", clinical.relevantHistory],
  ];
  const informed = context.filter(([, value]) => value);
  const series = model.series.length
    ? model.series.map((s) => `${escapeHtml(s.label)}${s.sliceCount ? ` · ${plural(s.sliceCount, "corte")}` : ""}${s.analyzed ? " · analizada" : " · usada por la clasificación degenerativa por IA"}`).join("<br>")
    : "No informadas";
  return `<header>
<div class="brand">MIRA·L</div>
<h1>Preinforme de análisis de RM lumbar</h1>
<div class="draft-badge">${escapeHtml(DRAFT_BANNER)}</div>
${meta.stale ? `<div class="note warn"><strong>Basado en datos anteriores:</strong> las correcciones o el contexto del estudio cambiaron después de generar este borrador. El contenido no se actualizó.</div>` : ""}
<dl class="meta">
<div><dt>Estudio</dt><dd>${escapeHtml(model.study.caseId)}</dd></div>
<div><dt>Referencia de paciente</dt><dd>${escapeHtml(model.study.subjectRef ?? "No informada")}</dd></div>
<div><dt>Fecha del estudio</dt><dd>${escapeHtml(dateText(model.study.studyDate))}</dd></div>
<div><dt>Fecha de generación</dt><dd>${escapeHtml(dateTimeText(meta.generatedAt))}</dd></div>
<div><dt>Edad al estudio</dt><dd>${escapeHtml(age)}</dd></div>
<div><dt>Modalidad</dt><dd>${escapeHtml(modalityLabel(model.study.modality))}</dd></div>
<div><dt>Versión del borrador</dt><dd>${meta.draftVersion === null ? "Sin guardar" : meta.draftVersion}</dd></div>
${informed.length ? informed.map(([label, value]) => `<div class="wide"><dt>${escapeHtml(label)}</dt><dd>${para(value ?? "")}</dd></div>`).join("") : `<div class="wide"><dt>Contexto clínico</dt><dd class="muted">No informado para este estudio.</dd></div>`}
<div class="wide"><dt>Series analizadas</dt><dd>${series}</dd></div>
</dl>
</header>`;
}

function summarySection(model: PreReportGenerated, edits: PreReportEdits, variant: ExportVariant): string {
  const blocks = resultsSummary(model, edits).map((block) =>
    block.kind === "p"
      ? `<p>${escapeHtml(block.text)}</p>`
      : `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`).join("");
  const absences: string[] = [];
  if (model.study.clinical.ageAtStudy === null) absences.push("La edad al estudio no está informada.");
  if (!model.study.clinical.reason && !model.study.clinical.symptoms) absences.push("No hay motivo de consulta ni síntomas registrados.");
  if (!model.study.studyDate) absences.push("La fecha del estudio no está informada.");
  if (model.coverage.findingsRejected > 0) absences.push(`${plural(model.coverage.findingsRejected, "resultado no cumple", "resultados no cumplen")} el contrato y no se muestran; no se interpreta${model.coverage.findingsRejected === 1 ? "" : "n"} como «ausente».`);
  const noLevel = model.measurements.filter((m) => m.level === null).length;
  if (noLevel > 0) absences.push(`${plural(noLevel, "medición sin nivel asignado", "mediciones sin nivel asignado")} (${variant === "full" ? "véase el Anexo A" : "disponible" + (noLevel === 1 ? "" : "s") + " en la versión con anexos"}).`);
  return `<section class="summary">
<h2>Resumen</h2>
${blocks}
${absences.length ? `<h4>Datos ausentes</h4><ul class="plain">${absences.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>` : ""}
</section>`;
}

function matrixSection(model: PreReportGenerated): string {
  if (model.findingsStatus !== "available") return "";
  return `<section>
<h2>Clasificación degenerativa por IA · resultados por nivel</h2>
<table class="matrix"><thead><tr><th>Nivel</th>${MATRIX_COLUMNS.map((c) => `<th>${escapeHtml(COLUMN_LABEL[c])}</th>`).join("")}</tr></thead><tbody>${
    summaryMatrix(model).map((row) => `<tr><td><strong>${escapeHtml(row.level)}</strong></td>${MATRIX_COLUMNS.map((c) => `<td class="${row.cells[c].state}">${escapeHtml(row.cells[c].text)}</td>`).join("")}</tr>`).join("")
  }</tbody></table>
<p class="small muted">Predicciones del modelo (probabilidad de la clase). «No evaluado»: la corrida no devolvió resultado para ese nivel y categoría. Los resultados experimentales o de investigación no tienen validación externa.</p>
</section>`;
}

function legendItem(color: string, text: string): string {
  return `<li><span class="dot" style="background:${color}"></span>${escapeHtml(text)}</li>`;
}

function sliceText(block: EvidenceBlock): string {
  return block.sliceNumber === null ? "corte no informado" : `corte ${block.sliceNumber}${block.sliceTotal ? ` de ${block.sliceTotal}` : ""}`;
}

/** Un par «Imagen completa» + «Detalle ampliado» de una imagen, o el motivo por el que no está. */
function figures(block: EvidenceBlock, state: ImageState | undefined): string {
  if (!state || state.status === "loading") return `<p class="missing" style="grid-column:1/-1">Imagen en preparación: ${escapeHtml(block.seriesLabel)} · ${escapeHtml(sliceText(block))}.</p>`;
  if (state.status === "failed") {
    return `<p class="missing" style="grid-column:1/-1"><strong>Imagen no disponible</strong> (${escapeHtml(block.seriesLabel)} · ${escapeHtml(sliceText(block))}): ${escapeHtml(state.error)} Se conserva el resultado textual.</p>`;
  }
  return `<figure><img alt="Imagen completa" src="${state.image.full}"><figcaption>Imagen completa</figcaption></figure>
<figure><img alt="Detalle ampliado" src="${state.image.zoom}"><figcaption>Detalle ampliado</figcaption></figure>`;
}

/** Evidencia de las mediciones: una imagen del corte analizado con los trazos del análisis inicial. */
function traceEvidenceHtml(level: string, block: EvidenceBlock, state: ImageState | undefined): string {
  const legend = block.traces.map((t) => legendItem(t.origin === "profesional" ? "#f59e0b" : "#0ea5e9", `${t.n} · ${t.label} (trazo ${t.origin === "profesional" ? "profesional" : "de la IA"})`)).join("");
  return `<div class="ficha-block"><div class="ficha-head"><h3>${escapeHtml(level)} <span class="sub">· Mediciones del análisis inicial · ${escapeHtml(block.seriesLabel)} · ${escapeHtml(sliceText(block))}</span></h3></div>
<div class="evidence">${figures(block, state)}</div>
<ul class="legend">${legend}</ul>
<p class="src">Trazos de las mediciones del análisis inicial sobre el corte analizado.</p></div>`;
}

/**
 * Evidencia de la clasificación: las regiones evaluadas de TODAS las series del nivel en un solo bloque, con título y leyenda
 * compartidos (una fila de imágenes por serie). Es otra fuente que las mediciones y nunca se superpone con ellas.
 */
function regionEvidenceHtml(level: string, blocks: EvidenceBlock[], images: Record<string, ImageState>): string {
  const legend = new Map<number, string>();
  for (const block of blocks) for (const region of block.regions) legend.set(region.n, region.label);
  const rows = blocks.map((block) => `<div class="series-row">${escapeHtml(block.seriesLabel)} · ${escapeHtml(sliceText(block))}</div>${figures(block, images[block.id])}`).join("");
  return `<div class="ficha-block"><div class="ficha-head"><h3>${escapeHtml(level)} <span class="sub">· Región evaluada por el clasificador</span></h3></div>
<div class="evidence">${rows}</div>
<ul class="legend">${[...legend.entries()].sort((a, b) => a[0] - b[0]).map(([n, label]) => legendItem("#facc15", `${n} · ${label}`)).join("")}</ul>
<p class="src">Recuadro y cruz: dónde evaluó el modelo cada resultado. No delimitan una lesión.</p></div>`;
}

function measurementRows(selection: LevelSelection, edits: PreReportEdits, traceBlocks: EvidenceBlock[]): string {
  const traceBlock = traceBlocks[0];
  return selection.measurements.map((m) => {
    if (isEdited(edits, m.key, m.text)) {
      return `<tr><td colspan="4">${para(effectiveText(edits, m.key, m.text))}<span class="edited">texto editado</span></td></tr>`;
    }
    const trace = traceBlock?.traces.find((t) => t.ref === m.key);
    const origin = m.corrected !== null ? `Corrección profesional (IA: ${formatValue(m.original, m.unit)})` : "IA";
    const evidence = trace ? ` · imagen ${trace.n}` : m.imagePath ? "" : " · sin trazo guardado";
    return `<tr><td>${escapeHtml(m.label)}</td><td><strong>${escapeHtml(formatValue(m.effective, m.unit))}</strong></td><td>${escapeHtml(origin)}</td><td>${m.sliceIndex === null ? "—" : `corte ${m.sliceIndex + 1}`}${escapeHtml(evidence)}</td></tr>`;
  }).join("");
}

function fichaHtml(model: PreReportGenerated, edits: PreReportEdits, selection: LevelSelection, images: Record<string, ImageState>): string {
  const blocks = evidenceBlocks(model, edits, selection);
  const traceBlocks = blocks.filter((b) => b.kind === "trace");
  const regionBlocks = blocks.filter((b) => b.kind === "region");
  const note = edits.levelNotes?.[selection.level]?.trim();
  const predictions = selection.findings.slice().sort((a, b) => SECTION_ORDER[a.section] - SECTION_ORDER[b.section]).map((f) =>
    `<p class="pred">${para(effectiveText(edits, f.key, f.text))}${isEdited(edits, f.key, f.text) ? '<span class="edited">texto editado</span>' : ""}</p>`).join("");
  const hasPositive = selection.findings.some((f) => f.section === "principal" && f.positive);
  const missing = selection.findings.flatMap((f) => f.sources.filter((s) => s.available && !s.region).map((s) =>
    `<p class="missing"><strong>Sin región evaluada</strong> · ${escapeHtml(f.typeLabel)} (${escapeHtml(s.roleLabel)}): ${escapeHtml(s.regionIssue ? `la corrida guardó una región inválida (${s.regionIssue}); se conserva la clasificación sin localización.` : "la corrida no guardó la región evaluada.")}</p>`));
  const unlocated = selection.measurements.filter((m) => !m.imagePath && !m.invalidReason && !isEdited(edits, m.key, m.text)).length;
  const missingTraces = unlocated ? `<p class="missing">${plural(unlocated, "medición sin trazo guardado", "mediciones sin trazo guardado")}: se informa solo el valor.</p>` : "";
  const both = selection.measurements.length > 0 && selection.findings.length > 0;
  const verification = both ? `<p class="verify" data-testid="level-verification"><strong>Correspondencia pendiente de verificación.</strong> ${escapeHtml(CORRESPONDENCE_NOTICE)}</p>` : "";
  const head = (suffix: string, tag = "") => `<div class="ficha-head"><h3>${escapeHtml(selection.level)}${suffix ? ` <span class="sub">· ${escapeHtml(suffix)}</span>` : ""}</h3>${tag}</div>`;
  const parts: string[] = [];
  if (selection.measurements.length) {
    const table = `<div class="ficha-block">${head("Mediciones del análisis inicial")}${verification}<table><thead><tr><th>Medición</th><th>Valor</th><th>Procedencia</th><th>Corte</th></tr></thead><tbody>${measurementRows(selection, edits, traceBlocks)}</tbody></table>${missingTraces}</div>`;
    const traces = traceBlocks.map((block) => traceEvidenceHtml(selection.level, block, images[block.id]));
    // Título, tabla y primera evidencia juntos; cada bloque de evidencia repite nivel y título si continúa.
    parts.push(traces.length ? `<div class="keep">${table}${traces[0]}</div>` : table, ...traces.slice(1));
  }
  if (selection.findings.length) {
    parts.push(`<div class="ficha-block">${head("Clasificación degenerativa por IA", hasPositive ? '<span class="tag">Predicción para revisar</span>' : "")}${selection.measurements.length ? "" : verification}${predictions}${missing.join("")}</div>`);
    if (regionBlocks.length) parts.push(regionEvidenceHtml(selection.level, regionBlocks, images));
  }
  if (note) parts.push(`<div class="ficha-block">${head("Observaciones")}<div class="obs"><strong>Observaciones del profesional</strong>${para(note)}</div></div>`);
  if (!parts.length) parts.push(`<div class="ficha-block">${head("")}<p class="muted">Sin elementos seleccionados en este nivel.</p></div>`);
  return `<div class="ficha">${parts.join("")}</div>`;
}

function researchSection(model: PreReportGenerated, edits: PreReportEdits): string {
  const items = includedResearch(model, edits);
  if (!items.length) return "";
  return `<section class="research"><h3>Resultados de investigación</h3>
<p class="small muted">No son una capacidad soportada para producto: se incluyen por decisión del profesional y no se cuentan entre las predicciones por nivel.</p>
<ul class="plain">${items.map((f) => `<li><strong>${escapeHtml(f.level)}</strong> — ${escapeHtml(effectiveText(edits, f.key, f.text))}</li>`).join("")}</ul></section>`;
}

/** Limitaciones relevantes para interpretar el cuerpo del documento (en las dos variantes) y avisos de evidencia faltante. */
function scopeSection(model: PreReportGenerated, edits: PreReportEdits, variant: ExportVariant): string {
  const missing = missingEvidence(model, edits);
  const items = [
    "Documento en borrador: requiere revisión profesional y no constituye un diagnóstico.",
    "Las clasificaciones son predicciones de un modelo; el grado de Pfirrmann es experimental y ninguna tiene validación externa.",
    CORRESPONDENCE_NOTICE,
    "Cada medición sale de un único corte; una corrección numérica del profesional no modifica el trazo original de la IA.",
  ];
  const annexNote = variant === "brief"
    ? "<p class=\"small muted\">Disponibles en la versión con anexos: tablas completas, trazabilidad técnica (incluida la versión de las fuentes) y explicación técnica de las limitaciones. Esta exportación no las incluye; no se eliminó ningún dato.</p>"
    : "";
  return `<section>
<h2>Alcance y limitaciones</h2>
<ul class="plain small">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
${missing.length ? `<div class="keep"><h4>Evidencia visual no disponible</h4><ul class="plain small">${missing.map((m) => `<li><strong>${escapeHtml(m.what)}</strong>: ${escapeHtml(m.reason)}</li>`).join("")}</ul></div>` : ""}
${annexNote}
</section>`;
}

function annexTable(rows: PreReportMeasurement[]): string {
  const hasRaw = rows.some((m) => (m.labelKey ?? "").startsWith("raw_"));
  const table = `<table><thead><tr><th>Nivel</th><th>Plano</th><th>Medición</th><th>Valor original (IA)</th><th>Corrección profesional</th><th>Valor informado</th><th>Corte</th><th>Trazo</th></tr></thead><tbody>${
    rows.map((m) => {
      const raw = (m.labelKey ?? "").startsWith("raw_");
      return `<tr>
<td>${escapeHtml(m.level ?? "Sin nivel")}</td><td>${escapeHtml(m.plane === "axial" ? "Axial" : "Sagital")}</td><td>${escapeHtml(m.label)}${raw ? " ‡" : ""}${m.experimental ? " (experimental)" : ""}</td>
<td>${escapeHtml(formatValue(m.original, m.unit))}</td><td>${m.corrected === null ? "No registrada" : escapeHtml(formatValue(m.corrected, m.unit))}</td>
<td>${m.invalidReason ? `<span class="muted">${escapeHtml(m.invalidReason)}</span>` : `<strong>${escapeHtml(formatValue(m.effective, m.unit))}</strong>`}</td>
<td>${m.sliceIndex === null ? "—" : m.sliceIndex + 1}</td><td>${m.trace.origin === "profesional" ? "Profesional" : m.trace.origin === "ia" ? "IA" : "Sin trazo"}</td></tr>`;
    }).join("")
  }</tbody></table>`;
  return table + (hasRaw ? `<p class="small muted">‡ Clase técnica del análisis (códigos raw_…) sin correspondencia anatómica verificada: se conserva el código tal como lo emite el análisis y no se traduce a una estructura.</p>` : "");
}

function annex(model: PreReportGenerated, edits: PreReportEdits, meta: DocumentMeta): string {
  const missing = missingEvidence(model, edits);
  const cov = model.coverage;
  const summary = documentSummary(model, edits);
  return `<section class="annex">
<h2>Anexo A · Tabla completa de mediciones</h2>
<p class="small muted">Todas las mediciones de la corrida (${model.measurements.length}). Unidades: mm (longitudes), mm² (áreas), ° (ángulos). «Corrección profesional: No registrada» significa que no hay corrección guardada; no indica que alguien haya revisado el valor.</p>
${annexTable(annexMeasurements(model))}
<div class="keep"><h2>Anexo B · Cobertura y resultados omitidos del cuerpo</h2>
<ul class="plain small">
<li>La corrida contiene ${plural(cov.measurementsTotal, "medición", "mediciones")} (${cov.measurementsWithTrace} con trazo guardado, ${cov.measurementsCorrected} con corrección profesional) y ${plural(cov.findingsTotal, "resultado")} de clasificación degenerativa por IA (código P10.7).</li>
<li>Este documento incluye ${plural(summary.cards, "ficha")} por nivel, ${plural(summary.findingsIncluded, "predicción", "predicciones")}, ${plural(summary.measurementsIncluded, "medición", "mediciones")} y ${plural(summary.imagesPlanned, "imagen", "imágenes")} de evidencia${summary.researchIncluded ? `, y ${plural(summary.researchIncluded, "resultado")} de investigación en un apartado aparte` : ""}.</li>
${model.omitted.map((o) => `<li><strong>${escapeHtml(o.what)}</strong>: ${escapeHtml(o.reason.replace(/figuran en el anexo/g, "figuran en el Anexo A"))}</li>`).join("")}${missing.map((m) => `<li><strong>Evidencia visual no disponible · ${escapeHtml(m.what)}</strong>: ${escapeHtml(m.reason)}</li>`).join("")}
</ul></div>
<div class="keep"><h2>Anexo C · Trazabilidad técnica</h2>
<table class="small"><tbody>
<tr><th>Corrida</th><td>${escapeHtml(model.run.runId)}</td></tr>
<tr><th>Modelo sagital</th><td>${escapeHtml(model.run.modelKey)}</td></tr>
<tr><th>Modo de inferencia</th><td>${escapeHtml(model.run.inferenceMode)}</td></tr>
<tr><th>Estado de revisión del estudio</th><td>${escapeHtml(model.run.reviewStatus)} (mecanismo de aprobación del estudio; este preinforme no lo modifica ni lo reemplaza)</td></tr>
<tr><th>Versión de las fuentes</th><td>${escapeHtml(meta.fingerprint)}</td></tr>
<tr><th>Versión del borrador</th><td>${meta.draftVersion === null ? "Sin guardar" : meta.draftVersion}</td></tr>
<tr><th>Series</th><td>${model.series.map((s) => `${escapeHtml(s.label)} (${escapeHtml(s.inputId)})`).join("<br>") || "—"}</td></tr>
<tr><th>Clasificación degenerativa por IA</th><td>Código P10.7 (esquema pfi.disc-degenerative-findings.v1)</td></tr>
</tbody></table></div>
<div class="keep"><h2>Anexo D · Alcance, limitaciones y correspondencia anatómica</h2>
<ul class="plain small">${model.limitations.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
<p class="footer-note">Uso académico y de investigación. El documento no incluye identificadores directos del paciente. Para corregir una medición use el flujo de revisión del estudio: editar este preinforme no modifica predicciones ni correcciones.</p></div>
</section>`;
}

export function buildPreReportHtml(
  model: PreReportGenerated,
  edits: PreReportEdits,
  images: Record<string, ImageState>,
  meta: DocumentMeta,
  options: { variant?: ExportVariant } = {},
): string {
  const variant = options.variant ?? "brief";
  const fichas = selectedLevels(model, edits).map((selection) => fichaHtml(model, edits, selection, images)).join("");
  const observations = (edits.observations ?? "").trim();
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>MIRA·L · ${escapeHtml(VARIANT_LABEL[variant])} (borrador) · ${escapeHtml(model.study.caseId)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head>
<body data-variant="${variant}"><main class="sheet">
${header(model, meta)}
${summarySection(model, edits, variant)}
${matrixSection(model)}
<section><h2>Fichas por nivel</h2>${fichas || `<p class="muted">No hay fichas seleccionadas. El resumen, la tabla de resultados${variant === "full" ? " y los anexos" : ""} contienen lo que informa la corrida.</p>`}${researchSection(model, edits)}</section>
<section><h2>Observaciones del profesional</h2>${observations ? `<div class="obs">${para(observations)}</div>` : `<p class="muted">Sin observaciones registradas. Este documento no contiene una conclusión diagnóstica generada automáticamente.</p>`}</section>
${scopeSection(model, edits, variant)}
${variant === "full" ? annex(model, edits, meta) : ""}
</main></body></html>`;
}
