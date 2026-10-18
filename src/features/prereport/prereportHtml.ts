import {
  DRAFT_BANNER,
  COLUMN_LABEL,
  MATRIX_COLUMNS,
  annexMeasurements,
  documentSummary,
  effectiveText,
  evidenceBlocks,
  formatNumber,
  formatUnit,
  formatValue,
  includedResearch,
  isEdited,
  missingEvidence,
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
 * Es autocontenido: las imágenes van como data URL y los estilos, en línea. Para el PDF se usa la impresión del navegador
 * (A4 vertical, márgenes y numeración de página definidos acá con `@page`); ver docs/PREINFORME_VISUAL.md.
 */

export type ImageState = { status: "loading" } | { status: "ready"; image: ComposedImage } | { status: "failed"; error: string };

export type DocumentMeta = {
  generatedAt: string;
  draftVersion: number | null;
  fingerprint: string;
  /** El borrador se creó con fuentes distintas a las actuales. */
  stale: boolean;
};

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
@page { size: A4; margin: 20mm 14mm 18mm 14mm;
  @top-left { content: "MIRA·L"; font: 700 8pt 'Segoe UI', Arial, sans-serif; color: #0f3d63; }
  @top-right { content: "Preinforme · Borrador pendiente de revisión profesional"; font: 8pt 'Segoe UI', Arial, sans-serif; color: #b45309; }
  @bottom-center { content: "Página " counter(page) " de " counter(pages); font: 8pt 'Segoe UI', Arial, sans-serif; color: #64748b; } }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 10pt/1.45 'Segoe UI', Inter, Arial, sans-serif; color: #102033; background: #e9eef4; }
.sheet { max-width: 182mm; margin: 12px auto; background: #fff; padding: 12mm 12mm; box-shadow: 0 6px 24px rgba(15,23,42,.12); }
@media print { body { background: #fff; } .sheet { max-width: none; margin: 0; padding: 0; box-shadow: none; } }
h1 { font-size: 20pt; margin: 2pt 0 4pt; letter-spacing: -.01em; }
h2 { font-size: 12.5pt; margin: 16pt 0 6pt; color: #0f3d63; border-bottom: 1.2px solid #cbd9e8; padding-bottom: 3pt; break-after: avoid; }
h3 { font-size: 11pt; margin: 0; break-after: avoid; }
h4 { font-size: 9pt; margin: 9pt 0 3pt; color: #475569; text-transform: uppercase; letter-spacing: .05em; break-after: avoid; }
p { margin: 3pt 0; }
.brand { font-weight: 800; letter-spacing: .12em; color: #0f3d63; font-size: 9pt; }
.draft-badge { display: inline-block; margin: 2pt 0 8pt; padding: 3pt 9pt; border: 1px solid #f59e0b; background: #fffbeb; color: #92400e; border-radius: 99px; font-weight: 700; font-size: 9pt; }
.meta { display: grid; grid-template-columns: 1fr 1fr; gap: 3pt 18pt; margin: 6pt 0; font-size: 9pt; }
.meta div { break-inside: avoid; }
.meta dt { color: #64748b; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; }
.meta dd { margin: 0 0 3pt; }
.meta .wide { grid-column: 1 / -1; }
.muted { color: #64748b; }
.note { border: 1px solid #bfdbfe; background: #eff6ff; border-radius: 6px; padding: 5pt 8pt; font-size: 9pt; margin: 6pt 0; }
.warn { border-color: #fcd34d; background: #fffbeb; }
table { border-collapse: collapse; width: 100%; font-size: 9pt; }
th { text-align: left; background: #eef4fb; color: #334155; font-size: 8pt; text-transform: uppercase; letter-spacing: .03em; }
th, td { border-bottom: 1px solid #e2e8f0; padding: 3pt 5pt; vertical-align: top; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
.matrix td.present { font-weight: 700; color: #7c2d12; background: #fff7ed; }
.matrix td.absent { color: #475569; }
.matrix td.graded { color: #1e3a5f; }
.matrix td.not_evaluated { color: #94a3b8; font-style: italic; }
.ficha { margin: 10pt 0; }
.ficha-block { break-inside: avoid; border: 1px solid #d5e1ee; border-radius: 8px; padding: 8pt 10pt; margin-bottom: 8pt; }
.ficha-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 3pt; margin-bottom: 4pt; }
.ficha-head .tag { font-size: 8pt; color: #92400e; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 99px; padding: 1pt 7pt; white-space: nowrap; }
.pred { margin: 2pt 0; padding-left: 10pt; position: relative; }
.pred::before { content: "▸"; position: absolute; left: 0; color: #0f3d63; }
.edited { font-size: 7.5pt; color: #6d28d9; margin-left: 4pt; }
.evidence { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt; margin-top: 4pt; }
.evidence figure { margin: 0; }
.evidence img { width: 100%; height: auto; display: block; border: 1px solid #94a3b8; border-radius: 3px; background: #000; }
.evidence figcaption { font-size: 8pt; color: #475569; margin-top: 2pt; }
.legend { font-size: 8.5pt; margin: 3pt 0 0; padding: 0; list-style: none; }
.legend li { margin: 1pt 0; }
.dot { display: inline-block; width: 8pt; height: 8pt; border-radius: 50%; margin-right: 4pt; vertical-align: -1pt; }
.verify { border: 1px solid #fcd34d; background: #fffbeb; color: #5b3b05; border-radius: 6px; padding: 4pt 8pt; font-size: 8.5pt; margin: 4pt 0; }
.obs { border-left: 3px solid #0f3d63; background: #f8fafc; padding: 4pt 8pt; margin-top: 5pt; font-size: 9.5pt; }
.obs strong { display: block; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; color: #475569; }
.missing { font-size: 8.5pt; color: #92400e; margin: 3pt 0; }
.research { border: 1px dashed #94a3b8; border-radius: 8px; padding: 6pt 10pt; background: #fbfdff; break-inside: avoid; }
.annex { break-before: page; }
.annex h2:first-child { margin-top: 0; }
.small { font-size: 8.5pt; }
ul.plain { margin: 2pt 0 2pt 14pt; padding: 0; }
.footer-note { font-size: 8pt; color: #64748b; margin-top: 12pt; }
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
    ? model.series.map((s) => `${escapeHtml(s.label)}${s.sliceCount ? ` · ${s.sliceCount} cortes` : ""}${s.analyzed ? " · analizada" : " · usada por los resultados P10.7"}`).join("<br>")
    : "No informadas";
  return `<header>
<div class="brand">MIRA·L</div>
<h1>Preinforme de análisis de RM lumbar</h1>
<div class="draft-badge">${escapeHtml(DRAFT_BANNER)}</div>
${meta.stale ? `<div class="note warn"><strong>Basado en datos anteriores:</strong> las correcciones o el contexto del estudio cambiaron después de generar este borrador. El contenido no se actualizó.</div>` : ""}
<dl class="meta">
<div><dt>Estudio</dt><dd>${escapeHtml(model.study.caseId)}</dd></div>
<div><dt>Referencia de sujeto (de-identificada)</dt><dd>${escapeHtml(model.study.subjectRef ?? "No informada")}</dd></div>
<div><dt>Fecha del estudio</dt><dd>${escapeHtml(dateText(model.study.studyDate))}</dd></div>
<div><dt>Fecha de generación</dt><dd>${escapeHtml(dateTimeText(meta.generatedAt))}</dd></div>
<div><dt>Edad al estudio</dt><dd>${escapeHtml(age)}</dd></div>
<div><dt>Modalidad</dt><dd>${escapeHtml(model.study.modality ?? "No informada")}</dd></div>
${informed.length ? informed.map(([label, value]) => `<div class="wide"><dt>${escapeHtml(label)}</dt><dd>${para(value ?? "")}</dd></div>`).join("") : `<div class="wide"><dt>Contexto clínico</dt><dd class="muted">No informado para este estudio.</dd></div>`}
<div class="wide"><dt>Series analizadas</dt><dd>${series}</dd></div>
</dl>
</header>`;
}

function summarySection(model: PreReportGenerated, edits: PreReportEdits): string {
  const summary = documentSummary(model, edits);
  const cov = model.coverage;
  const absences: string[] = [];
  if (model.study.clinical.ageAtStudy === null) absences.push("La edad al estudio no está informada.");
  if (!model.study.clinical.reason && !model.study.clinical.symptoms) absences.push("No hay motivo de consulta ni síntomas registrados.");
  if (!model.study.studyDate) absences.push("La fecha del estudio no está informada.");
  if (model.findingsStatus === "none") absences.push("Esta corrida no tiene resultados P10.7 persistidos. Eso no equivale a que ninguna categoría esté ausente.");
  if (model.findingsStatus === "invalid") absences.push(`Los resultados P10.7 de la corrida no cumplen el contrato y no se muestran (${model.findingsStatusReason ?? "motivo no informado"}).`);
  if (cov.findingsRejected > 0) absences.push(`${cov.findingsRejected} resultado(s) P10.7 no cumplen el contrato y no se muestran; no se interpretan como «ausente».`);
  const noLevel = model.measurements.filter((m) => m.level === null).length;
  if (noLevel > 0) absences.push(`${noLevel} medición(es) sin nivel asignado (figuran en el anexo).`);
  const matrix = model.findingsStatus === "available"
    ? `<table class="matrix"><thead><tr><th>Nivel</th>${MATRIX_COLUMNS.map((c) => `<th>${escapeHtml(COLUMN_LABEL[c])}</th>`).join("")}</tr></thead><tbody>${
      summaryMatrix(model).map((row) => `<tr><td><strong>${escapeHtml(row.level)}</strong></td>${MATRIX_COLUMNS.map((c) => `<td class="${row.cells[c].state}">${escapeHtml(row.cells[c].text)}</td>`).join("")}</tr>`).join("")
    }</tbody></table><p class="small muted">Predicciones del modelo (probabilidad de la clase). Los resultados experimentales o de investigación no tienen validación externa. «No evaluado» = la corrida no devolvió resultado para ese nivel y categoría.</p>`
    : "";
  return `<section>
<h2>Resumen</h2>
<p>Este borrador incluye <strong>${summary.cards}</strong> ficha(s) por nivel con <strong>${summary.findingsIncluded}</strong> predicción(es) del modelo y <strong>${summary.measurementsIncluded}</strong> medición(es) seleccionadas, con <strong>${summary.imagesPlanned}</strong> imagen(es) de evidencia.${summary.researchIncluded ? ` Además incluye ${summary.researchIncluded} resultado(s) de investigación en un apartado aparte.` : ""}</p>
<p>La corrida contiene ${cov.measurementsTotal} mediciones (${cov.measurementsWithTrace} con trazo guardado, ${cov.measurementsCorrected} con corrección profesional) y ${cov.findingsTotal} resultados P10.7. El detalle completo está en el anexo.</p>
${absences.length ? `<h4>Datos ausentes</h4><ul class="plain">${absences.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>` : ""}
${matrix}
</section>`;
}

function legendItem(color: string, text: string): string {
  return `<li><span class="dot" style="background:${color}"></span>${escapeHtml(text)}</li>`;
}

function evidenceHtml(block: EvidenceBlock, state: ImageState | undefined): string {
  const slice = block.sliceNumber === null ? "corte no informado" : `corte ${block.sliceNumber}${block.sliceTotal ? ` de ${block.sliceTotal}` : ""}`;
  const title = block.kind === "trace"
    ? "Fuente: análisis inicial · Corte analizado con los trazos de las mediciones"
    : "Fuente: P10.7 · Región evaluada por el modelo (no delimita una lesión)";
  if (!state || state.status === "loading") {
    return `<div class="missing">Imagen en preparación: ${escapeHtml(block.seriesLabel)} · ${escapeHtml(slice)}.</div>`;
  }
  if (state.status === "failed") {
    return `<div class="missing"><strong>Imagen no disponible</strong> (${escapeHtml(block.seriesLabel)} · ${escapeHtml(slice)}): ${escapeHtml(state.error)} Se conserva el resultado textual.</div>`;
  }
  const legend = block.traces.map((t) => legendItem(t.origin === "profesional" ? "#f59e0b" : "#0ea5e9", `${t.n} · ${t.label} (trazo ${t.origin === "profesional" ? "profesional" : "de la IA"})`)).join("")
    + block.regions.map((r) => legendItem("#facc15", `${r.n} · ${r.label} (región evaluada)`)).join("");
  return `<div class="evidence">
<figure><img alt="${escapeHtml(title)}" src="${state.image.full}"><figcaption>${escapeHtml(block.seriesLabel)} · ${escapeHtml(slice)} · imagen completa</figcaption></figure>
<figure><img alt="Ampliación" src="${state.image.zoom}"><figcaption>Ampliación de la misma zona, sin deformar</figcaption></figure>
</div>
<ul class="legend">${legend}</ul>
<p class="small muted">${escapeHtml(title)}.${block.regions.length ? " El recuadro y la cruz indican dónde se evaluó el resultado." : ""}</p>`;
}

function measurementRows(selection: LevelSelection, edits: PreReportEdits, blocks: EvidenceBlock[]): string {
  const traceBlock = blocks.find((b) => b.kind === "trace");
  return selection.measurements.map((m) => {
    if (isEdited(edits, m.key, m.text)) {
      return `<tr><td colspan="4">${para(effectiveText(edits, m.key, m.text))}<span class="edited">texto editado</span></td></tr>`;
    }
    const trace = traceBlock?.traces.find((t) => t.ref === m.key);
    const origin = m.corrected !== null
      ? `Corrección profesional (IA: ${formatValue(m.original, m.unit)})`
      : "IA";
    const evidence = trace ? ` · imagen ${trace.n}` : m.imagePath ? "" : " · sin trazo guardado";
    return `<tr><td>${escapeHtml(m.label)}</td><td><strong>${escapeHtml(formatValue(m.effective, m.unit))}</strong></td><td>${escapeHtml(origin)}</td><td>${m.sliceIndex === null ? "—" : `corte ${m.sliceIndex + 1}`}${escapeHtml(evidence)}</td></tr>`;
  }).join("");
}

function fichaHtml(model: PreReportGenerated, edits: PreReportEdits, selection: LevelSelection, images: Record<string, ImageState>): string {
  const blocks = evidenceBlocks(model, edits, selection);
  const traceBlocks = blocks.filter((b) => b.kind === "trace");
  const regionBlocks = blocks.filter((b) => b.kind === "region");
  const note = edits.levelNotes?.[selection.level]?.trim();
  const sectionOrder = { principal: 0, experimental: 1, investigacion: 2 } as const;
  const predictions = selection.findings.slice().sort((a, b) => sectionOrder[a.section] - sectionOrder[b.section]).map((f) =>
    `<p class="pred">${para(effectiveText(edits, f.key, f.text))}${isEdited(edits, f.key, f.text) ? '<span class="edited">texto editado</span>' : ""}</p>`).join("");
  const hasPositive = selection.findings.some((f) => f.section === "principal" && f.positive);
  const measurementTable = selection.measurements.length
    ? `<table><thead><tr><th>Medición</th><th>Valor</th><th>Procedencia</th><th>Corte</th></tr></thead><tbody>${measurementRows(selection, edits, traceBlocks)}</tbody></table>`
    : "";
  const missing = selection.findings.flatMap((f) => f.sources.filter((s) => s.available && !s.region).map((s) =>
    `<p class="missing"><strong>Sin región evaluada</strong> · ${escapeHtml(f.typeLabel)} (${escapeHtml(s.roleLabel)}): ${escapeHtml(s.regionIssue ? `la corrida guardó una región inválida (${s.regionIssue}); se conserva la clasificación sin localización.` : "la corrida no guardó la región evaluada.")}</p>`));
  const unlocated = selection.measurements.filter((m) => !m.imagePath && !m.invalidReason && !isEdited(edits, m.key, m.text)).length;
  const missingTraces = unlocated ? `<p class="missing">${unlocated} medición(es) sin trazo guardado: se informa solo el valor.</p>` : "";
  const both = selection.measurements.length > 0 && selection.findings.length > 0;
  const verification = both
    ? `<p class="verify" data-testid="level-verification"><strong>Correspondencia pendiente de verificación.</strong> Las mediciones (análisis inicial) y las predicciones P10.7 de ${escapeHtml(selection.level)} provienen de circuitos distintos: cada uno asigna el nivel por su cuenta (conteo de espacios discales desde el inferior, sobre cortes y series diferentes) y el sistema no guarda un vínculo entre ambos. No se presentan como evidencia de un mismo disco.</p>`
    : "";
  const head = (suffix: string, tag = "") => `<div class="ficha-head"><h3>${escapeHtml(selection.level)}${suffix ? ` <span class="muted">· ${escapeHtml(suffix)}</span>` : ""}</h3>${tag}</div>`;
  const parts: string[] = [];
  if (selection.measurements.length) {
    parts.push(`<div class="ficha-block">${head("Mediciones del análisis inicial")}${verification}<h4>Mediciones seleccionadas</h4>${measurementTable}${missingTraces}${traceBlocks[0] ? evidenceHtml(traceBlocks[0], images[traceBlocks[0].id]) : ""}</div>`);
    for (const block of traceBlocks.slice(1)) parts.push(`<div class="ficha-block">${head("Mediciones del análisis inicial · continuación")}${evidenceHtml(block, images[block.id])}</div>`);
  }
  if (selection.findings.length) {
    parts.push(`<div class="ficha-block">${head("Predicciones del modelo (P10.7)", hasPositive ? '<span class="tag">Predicción para revisar</span>' : "")}${selection.measurements.length ? "" : verification}<h4>Predicciones del modelo</h4>${predictions}${missing.join("")}${regionBlocks[0] ? evidenceHtml(regionBlocks[0], images[regionBlocks[0].id]) : ""}</div>`);
    for (const block of regionBlocks.slice(1)) parts.push(`<div class="ficha-block">${head("Predicciones del modelo (P10.7) · continuación")}${evidenceHtml(block, images[block.id])}</div>`);
  }
  if (note) parts.push(`<div class="ficha-block">${head("")}<div class="obs"><strong>Observaciones del profesional</strong>${para(note)}</div></div>`);
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

function annexTable(rows: PreReportMeasurement[]): string {
  return `<table><thead><tr><th>Nivel</th><th>Plano</th><th>Medición</th><th>Valor original (IA)</th><th>Corrección profesional</th><th>Valor informado</th><th>Corte</th><th>Trazo</th></tr></thead><tbody>${
    rows.map((m) => `<tr>
<td>${escapeHtml(m.level ?? "Sin nivel")}</td><td>${escapeHtml(m.plane === "axial" ? "Axial" : "Sagital")}</td><td>${escapeHtml(m.label)}${m.experimental ? " (experimental)" : ""}</td>
<td>${escapeHtml(formatValue(m.original, m.unit))}</td><td>${m.corrected === null ? "No registrada" : escapeHtml(formatValue(m.corrected, m.unit))}</td>
<td>${m.invalidReason ? `<span class="muted">${escapeHtml(m.invalidReason)}</span>` : `<strong>${escapeHtml(formatValue(m.effective, m.unit))}</strong>`}</td>
<td>${m.sliceIndex === null ? "—" : m.sliceIndex + 1}</td><td>${m.trace.origin === "profesional" ? "Profesional" : m.trace.origin === "ia" ? "IA" : "Sin trazo"}</td></tr>`).join("")
  }</tbody></table>`;
}

function annex(model: PreReportGenerated, edits: PreReportEdits, meta: DocumentMeta): string {
  const missing = missingEvidence(model, edits);
  return `<section class="annex">
<h2>Anexo A · Tabla completa de mediciones</h2>
<p class="small muted">Todas las mediciones de la corrida (${model.measurements.length}). Unidades: mm (longitudes), mm² (áreas), ° (ángulos). «Corrección profesional: No registrada» significa que no hay corrección guardada; no indica que alguien haya revisado el valor.</p>
${annexTable(annexMeasurements(model))}
<h2>Anexo B · Resultados omitidos del cuerpo</h2>
${model.omitted.length || missing.length ? `<ul class="plain small">${model.omitted.map((o) => `<li><strong>${escapeHtml(o.what)}</strong>: ${escapeHtml(o.reason)}</li>`).join("")}${missing.map((m) => `<li><strong>Evidencia no disponible · ${escapeHtml(m.what)}</strong>: ${escapeHtml(m.reason)}</li>`).join("")}</ul>` : `<p class="small muted">No hay resultados omitidos.</p>`}
<h2>Anexo C · Trazabilidad técnica</h2>
<table class="small"><tbody>
<tr><th>Corrida</th><td>${escapeHtml(model.run.runId)}</td></tr>
<tr><th>Modelo sagital</th><td>${escapeHtml(model.run.modelKey)}</td></tr>
<tr><th>Modo de inferencia</th><td>${escapeHtml(model.run.inferenceMode)}</td></tr>
<tr><th>Estado de revisión del estudio</th><td>${escapeHtml(model.run.reviewStatus)} (mecanismo de aprobación del estudio; este preinforme no lo modifica ni lo reemplaza)</td></tr>
<tr><th>Huella de las fuentes</th><td>${escapeHtml(meta.fingerprint)}</td></tr>
<tr><th>Versión del borrador</th><td>${meta.draftVersion === null ? "Sin guardar" : meta.draftVersion}</td></tr>
<tr><th>Series</th><td>${model.series.map((s) => `${escapeHtml(s.label)} (${escapeHtml(s.inputId)})`).join("<br>") || "—"}</td></tr>
</tbody></table>
<h2>Anexo D · Alcance y limitaciones</h2>
<ul class="plain small">${model.limitations.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
<p class="footer-note">Uso académico y de investigación. Datos de-identificados. Para corregir una medición use el flujo de revisión del estudio: editar este preinforme no modifica predicciones ni correcciones.</p>
</section>`;
}

export function buildPreReportHtml(model: PreReportGenerated, edits: PreReportEdits, images: Record<string, ImageState>, meta: DocumentMeta): string {
  const fichas = selectedLevels(model, edits).map((selection) => fichaHtml(model, edits, selection, images)).join("");
  const observations = (edits.observations ?? "").trim();
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>MIRA·L · Preinforme (borrador) · ${escapeHtml(model.study.caseId)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head>
<body><main class="sheet">
${header(model, meta)}
${summarySection(model, edits)}
<section><h2>Fichas por nivel</h2>${fichas || `<p class="muted">No hay fichas seleccionadas. El resumen y el anexo contienen los resultados de la corrida.</p>`}${researchSection(model, edits)}</section>
<section><h2>Observaciones del profesional</h2>${observations ? `<div class="obs">${para(observations)}</div>` : `<p class="muted">Sin observaciones registradas. Este documento no contiene una conclusión diagnóstica generada automáticamente.</p>`}</section>
${annex(model, edits, meta)}
</main></body></html>`;
}

export { formatNumber, formatUnit };
