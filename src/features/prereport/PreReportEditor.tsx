import { useMemo, useState } from "react";
import { VARIANT_LABEL, buildPreReportHtml, type DocumentMeta, type ExportVariant } from "./prereportHtml";
import {
  DRAFT_BANNER,
  documentSummary,
  effectiveText,
  evidenceBlocks,
  findingIncluded,
  includedResearch,
  isEdited,
  isIncluded,
  levelIncluded,
  levelKey,
  measurementIncluded,
  missingEvidence,
  plural,
  selectedLevels,
  withInclude,
  withLevelNote,
  withObservations,
  withText,
  type LevelSelection,
} from "./prereportModel";
import type { PreReportEdits, PreReportFinding, PreReportGenerated, PreReportMeasurement } from "./prereportTypes";
import { usePreReport } from "./usePreReport";

type Props = {
  caseId: string;
  runId: string;
  /** Vuelve al visor. El visor sigue montado por debajo: corte, zoom, W/L y selección se conservan. */
  onClose: () => void;
};

function ItemRow({
  edits,
  itemKey,
  generatedText,
  included,
  badge,
  detail,
  onChange,
}: {
  edits: PreReportEdits;
  itemKey: string;
  generatedText: string;
  included: boolean;
  badge?: string;
  detail?: string;
  onChange: (next: PreReportEdits) => void;
}) {
  const [editing, setEditing] = useState(false);
  const text = effectiveText(edits, itemKey, generatedText);
  const edited = isEdited(edits, itemKey, generatedText);
  return (
    <li className={`pre-item${included ? "" : " is-off"}`} data-testid={`pre-item-${itemKey}`}>
      <label className="pre-item-check">
        <input aria-label={`Incluir: ${generatedText}`} checked={included} onChange={(event) => onChange(withInclude(edits, itemKey, event.target.checked))} type="checkbox" />
        {editing ? null : <span className="pre-item-text">{text}</span>}
      </label>
      {badge && <span className="pre-badge">{badge}</span>}
      {edited && !editing && <span className="pre-edited">editado</span>}
      {editing && (
        <textarea
          aria-label={`Texto de: ${generatedText}`}
          className="pre-item-input"
          onChange={(event) => onChange(withText(edits, itemKey, event.target.value, generatedText))}
          rows={2}
          value={text}
        />
      )}
      <span className="pre-item-actions">
        <button className="pre-link" onClick={() => setEditing((value) => !value)} type="button">{editing ? "Listo" : "Editar texto"}</button>
        {edited && <button className="pre-link" onClick={() => onChange(withText(edits, itemKey, "", generatedText))} type="button">Restaurar</button>}
      </span>
      {detail && <span className="pre-item-detail">{detail}</span>}
    </li>
  );
}

function sectionBadge(finding: PreReportFinding): string | undefined {
  if (finding.section === "experimental") return "Experimental";
  if (finding.section === "investigacion") return "Investigación";
  return finding.positive ? "Predicción para revisar" : undefined;
}

function measurementDetail(m: PreReportMeasurement): string {
  if (m.invalidReason) return m.invalidReason;
  return m.imagePath ? "Con trazo guardado" : "Sin trazo guardado: solo el valor";
}

export function PreReportEditor({ caseId, runId, onClose }: Props) {
  const state = usePreReport(caseId, runId);
  const { model, view, edits, setEdits, dirty, busy, notice, imageStates, settleImages, save, updateSources } = state;
  const [previewOnly, setPreviewOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  /** Qué variante del documento se previsualiza y exporta. Excluir los anexos no borra datos ni cambia lo guardado. */
  const [variant, setVariant] = useState<ExportVariant>("brief");

  const meta = useMemo<DocumentMeta | null>(() => (view ? {
    generatedAt: view.draft?.updatedAt ?? view.generatedAt,
    draftVersion: view.draft?.version ?? null,
    fingerprint: view.draft?.sourceFingerprint ?? view.fingerprint,
    stale: view.stale,
  } : null), [view]);

  const html = useMemo(() => (model && meta ? buildPreReportHtml(model, edits, imageStates, meta, { variant }) : ""), [model, edits, imageStates, meta, variant]);

  async function documentHtml(): Promise<{ html: string; proceed: boolean }> {
    if (!model || !meta) return { html: "", proceed: false };
    setExporting(true);
    try {
      const settled = await settleImages();
      const missing = missingEvidence(model, edits).map((item) => `• ${item.what}: ${item.reason}`);
      for (const [id, image] of Object.entries(settled)) {
        if (image.status === "failed") missing.push(`• Imagen ${id.replace(/^img:/, "")}: ${image.error}`);
      }
      if (missing.length && !window.confirm(`Antes de exportar: falta evidencia visual para estos elementos. Se conserva el resultado textual y el documento lo indica.\n\n${missing.join("\n")}\n\n¿Exportar igual?`)) {
        return { html: "", proceed: false };
      }
      return { html: buildPreReportHtml(model, edits, settled, meta, { variant }), proceed: true };
    } finally {
      setExporting(false);
    }
  }

  async function exportPdf() {
    // La ventana se abre desde el clic (antes de esperar las imágenes): un window.open diferido lo bloquea el navegador.
    const target = window.open("", "_blank");
    if (!target) {
      state.setNotice({ kind: "error", text: "El navegador bloqueó la ventana del documento. Habilitá las ventanas emergentes para este sitio." });
      return;
    }
    target.document.write("<p style='font:14px sans-serif;padding:24px'>Preparando el preinforme…</p>");
    const result = await documentHtml();
    if (!result.proceed) {
      target.close();
      return;
    }
    target.document.open();
    target.document.write(result.html);
    target.document.close();
    target.focus();
    // Dar tiempo a que el documento (con sus imágenes incrustadas) asiente antes de abrir el diálogo de impresión.
    window.setTimeout(() => target.print(), 600);
  }

  async function exportHtmlFile() {
    const result = await documentHtml();
    if (!result.proceed) return;
    const blob = new Blob([result.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `preinforme-borrador${variant === "full" ? "-con-anexos" : ""}-${(model?.study.caseId ?? "estudio").replace(/[^A-Za-z0-9._-]/g, "_")}.html`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function close() {
    if (dirty && view?.draft && !window.confirm("Hay cambios sin guardar en el borrador. ¿Volver al visor y descartarlos?")) return;
    onClose();
  }

  return (
    <div aria-label="Preparar preinforme" className="pre-overlay" data-testid="prereport-editor" role="dialog">
      <header className="pre-bar">
        <div className="pre-bar-title">
          <strong>{DRAFT_BANNER}</strong>
          <span className="pre-sub">
            {model ? model.study.caseId : caseId} · borrador sin firma: no aprueba el estudio
            {view?.draft ? ` · versión ${view.draft.version}` : " · sin guardar"}
            {dirty && view?.draft ? " · cambios sin guardar" : ""}
          </span>
        </div>
        <div className="pre-bar-actions">
          <button className="rr-primary" data-testid="prereport-save" disabled={!view || busy !== null || (!dirty && !!view.draft)} onClick={() => void save()} type="button">
            {busy === "save" ? "Guardando…" : "Guardar borrador"}
          </button>
          <button data-testid="prereport-preview" disabled={!model} onClick={() => setPreviewOnly((value) => !value)} type="button">
            {previewOnly ? "Volver a editar" : "Vista previa"}
          </button>
          <label className="pre-variant">
            <span>Contenido</span>
            <select aria-label="Contenido a exportar" data-testid="prereport-variant" onChange={(event) => setVariant(event.target.value as ExportVariant)} value={variant}>
              <option value="brief">{VARIANT_LABEL.brief}</option>
              <option value="full">{VARIANT_LABEL.full}</option>
            </select>
          </label>
          <button data-testid="prereport-export-pdf" disabled={!model || exporting} onClick={() => void exportPdf()} type="button">
            {exporting ? "Preparando…" : "Exportar PDF (borrador)"}
          </button>
          <button data-testid="prereport-export-html" disabled={!model || exporting} onClick={() => void exportHtmlFile()} type="button">Guardar HTML</button>
          <button data-testid="prereport-close" onClick={close} type="button">Volver al visor</button>
        </div>
      </header>

      {state.phase.kind === "loading" && <p className="pre-state" role="status">Preparando el preinforme desde la corrida del visor…</p>}
      {state.phase.kind === "error" && <p className="pre-state pre-error" data-testid="prereport-error" role="alert">No se pudo preparar el preinforme: {state.phase.message}</p>}

      {view && model && (
        <>
          {notice && <p className={`pre-notice pre-notice-${notice.kind}`} data-testid="prereport-notice" role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
          {view.stale && (
            <section className="pre-stale" data-testid="prereport-stale" role="alert">
              <p><strong>Borrador basado en datos anteriores.</strong> Las correcciones o el contexto del estudio cambiaron después de crearlo. Tu contenido no se modificó ni se actualizó solo.</p>
              <div className="pre-stale-actions">
                <button onClick={() => setShowChanges((value) => !value)} type="button">{showChanges ? "Ocultar cambios" : `Ver cambios (${view.changes.length})`}</button>
                <button className="rr-primary" data-testid="prereport-update-sources" disabled={busy !== null} onClick={() => void updateSources()} type="button">
                  {busy === "update" ? "Actualizando…" : "Actualizar con los datos actuales"}
                </button>
              </div>
              {showChanges && (
                <ul className="pre-changes" data-testid="prereport-changes">
                  {view.changes.map((change) => (
                    <li key={`${change.key}-${change.kind}`}>
                      <strong>{change.kind === "added" ? "Nuevo" : change.kind === "removed" ? "Ya no está" : "Cambió"}:</strong> {change.label}
                      {change.before !== null && change.after !== null && <span className="pre-diff"> — antes: {change.before} · ahora: {change.after}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="pre-hint">Al actualizar se conservan tus ediciones. Para corregir una medición usá el flujo de revisión del estudio (pestaña Resultados): este editor no cambia predicciones ni correcciones.</p>
            </section>
          )}

          <div className={`pre-body${previewOnly ? " is-preview" : ""}`}>
            {!previewOnly && <EditorColumn edits={edits} model={model} onChange={setEdits} imageStates={imageStates} />}
            <section aria-label="Vista previa del documento" className="pre-preview">
              <iframe className="pre-frame" data-testid="prereport-frame" sandbox="allow-same-origin" srcDoc={html} title="Vista previa del preinforme" />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function EditorColumn({
  model,
  edits,
  onChange,
  imageStates,
}: {
  model: PreReportGenerated;
  edits: PreReportEdits;
  onChange: (next: PreReportEdits) => void;
  imageStates: ReturnType<typeof usePreReport>["imageStates"];
}) {
  const summary = documentSummary(model, edits);
  const missing = missingEvidence(model, edits);
  const research = model.findings.filter((f) => f.section === "investigacion");
  const levels = model.levels.filter((entry) => entry.lumbar || entry.evaluated);
  return (
    <aside aria-label="Contenido del preinforme" className="pre-editor" data-testid="prereport-editor-column">
      <section className="pre-card">
        <h3>Contenido</h3>
        <p className="pre-hint" data-testid="prereport-summary">
          {plural(summary.cards, "ficha")} · {plural(summary.findingsIncluded, "predicción", "predicciones")} · {plural(summary.measurementsIncluded, "medición", "mediciones")} · {plural(summary.imagesPlanned, "imagen", "imágenes")}
          {summary.researchIncluded ? ` · ${plural(summary.researchIncluded, "resultado")} de investigación` : ""}
        </p>
        <p className="pre-hint">Excluir algo de este documento no lo borra del estudio. Los resultados de investigación quedan fuera por defecto.</p>
        {missing.length > 0 && (
          <details className="pre-missing" data-testid="prereport-missing">
            <summary>{plural(missing.length, "elemento")} sin evidencia visual completa</summary>
            <ul>{missing.map((item, index) => <li key={`${item.what}-${index}`}><strong>{item.what}:</strong> {item.reason}</li>)}</ul>
          </details>
        )}
      </section>

      {levels.map((entry) => {
        const included = levelIncluded(model, edits, entry.level);
        const findings = model.findings.filter((f) => f.level === entry.level && f.section !== "investigacion");
        const measurements = model.measurements.filter((m) => m.level === entry.level);
        const selection: LevelSelection = {
          level: entry.level,
          findings: findings.filter((f) => findingIncluded(edits, f)),
          measurements: measurements.filter((m) => measurementIncluded(edits, m)),
        };
        const blocks = evidenceBlocks(model, edits, selection, { all: true });
        return (
          <section className="pre-card" data-testid={`pre-level-${entry.level}`} key={entry.level}>
            <label className="pre-level-head">
              <input aria-label={`Incluir la ficha de ${entry.level}`} checked={included} disabled={!entry.evaluated} onChange={(event) => onChange(withInclude(edits, levelKey(entry.level), event.target.checked))} type="checkbox" />
              <h3>{entry.level}</h3>
              {!entry.evaluated && <span className="pre-hint">Sin resultados en este nivel (no evaluado)</span>}
              {entry.evaluated && findings.some((f) => f.positive && f.section === "principal") && <span className="pre-badge">Predicción para revisar</span>}
            </label>
            {included && (
              <div className="pre-level-body">
                {findings.length > 0 && (
                  <>
                    <h4>Predicciones del modelo</h4>
                    <ul className="pre-list">
                      {findings.map((f) => (
                        <ItemRow edits={edits} generatedText={f.text} included={findingIncluded(edits, f)} itemKey={f.key} key={f.key} badge={sectionBadge(f)} onChange={onChange} />
                      ))}
                    </ul>
                  </>
                )}
                {measurements.length > 0 && (
                  <>
                    <h4>Mediciones</h4>
                    <ul className="pre-list">
                      {measurements.map((m) => (
                        <ItemRow edits={edits} generatedText={m.text} included={measurementIncluded(edits, m)} itemKey={m.key} key={m.key} detail={measurementDetail(m)} onChange={onChange} />
                      ))}
                    </ul>
                  </>
                )}
                {blocks.length > 0 && (
                  <>
                    <h4>Imágenes de evidencia</h4>
                    <ul className="pre-list">
                      {blocks.map((block) => {
                        const imageState = imageStates[block.id];
                        const status = !block.included ? "excluida" : !imageState || imageState.status === "loading" ? "preparando…" : imageState.status === "ready" ? "lista" : `no disponible: ${imageState.error}`;
                        const label = `${block.kind === "trace" ? "Análisis inicial" : "Clasificación por IA"} · ${block.seriesLabel} · corte ${block.sliceNumber ?? "—"}: ${
                          block.kind === "trace" ? plural(block.traces.length, "trazo") : plural(block.regions.length, "región evaluada", "regiones evaluadas")
                        }`;
                        return (
                          <li className="pre-item" key={block.id}>
                            <label className="pre-item-check">
                              <input aria-label={`Incluir imagen: ${label}`} checked={isIncluded(edits, block.id, true)} onChange={(event) => onChange(withInclude(edits, block.id, event.target.checked))} type="checkbox" />
                              <span className="pre-item-text">{label}</span>
                            </label>
                            <span className="pre-item-detail">{status}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                <label className="pre-field">
                  <span>Observaciones del profesional sobre {entry.level}</span>
                  <textarea
                    aria-label={`Observaciones sobre ${entry.level}`}
                    onChange={(event) => onChange(withLevelNote(edits, entry.level, event.target.value))}
                    placeholder="Texto libre. No se genera ninguna conclusión automática."
                    rows={2}
                    value={edits.levelNotes?.[entry.level] ?? ""}
                  />
                </label>
              </div>
            )}
          </section>
        );
      })}

      {research.length > 0 && (
        <details className="pre-card" data-testid="pre-research">
          <summary><h3 className="pre-inline">Resultados de investigación ({research.length})</h3></summary>
          <p className="pre-hint">No son una capacidad soportada para producto. Si los incluís, van en un apartado identificado.</p>
          <ul className="pre-list">
            {research.map((f) => (
              <ItemRow edits={edits} generatedText={`${f.level} · ${f.text}`} included={findingIncluded(edits, f)} itemKey={f.key} key={f.key} badge="Investigación" onChange={onChange} />
            ))}
          </ul>
          <p className="pre-hint">{includedResearch(model, edits).length === 1 ? "1 incluido." : `${includedResearch(model, edits).length} incluidos.`}</p>
        </details>
      )}

      <section className="pre-card">
        <label className="pre-field">
          <span>Observaciones del profesional</span>
          <textarea
            aria-label="Observaciones del profesional"
            data-testid="prereport-observations"
            onChange={(event) => onChange(withObservations(edits, event.target.value))}
            placeholder="Texto libre del profesional. El documento no contiene conclusiones diagnósticas generadas automáticamente."
            rows={5}
            value={edits.observations ?? ""}
          />
        </label>
      </section>

      <section className="pre-card pre-hint">
        <p>Para corregir una medición, usá el flujo de revisión del estudio (pestaña Resultados). Editar este preinforme no cambia predicciones ni correcciones.</p>
        <p>PDF: «Exportar PDF (borrador)» abre el documento; en el diálogo de impresión elegí «Guardar como PDF», tamaño A4, vertical, márgenes «Predeterminados», activá «Gráficos de fondo» y desactivá «Encabezados y pies de página».</p>
      </section>
      {selectedLevels(model, edits).length === 0 && <p className="pre-hint">No hay fichas seleccionadas: el documento tendrá el resumen y el anexo.</p>}
    </aside>
  );
}
