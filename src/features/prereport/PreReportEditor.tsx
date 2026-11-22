import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { explainStale } from "./staleExplanation";
import { useFindingDecisions } from "../reading/findingDecisions";
import { VARIANT_LABEL, buildPreReportHtml, type DocumentMeta, type ExportVariant } from "./prereportHtml";
import {
  DRAFT_BANNER,
  documentSummary,
  effectiveText,
  evidenceBlocks,
  findingIncluded,
  withFindingDecisions,
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
import { useUnsavedChanges } from "../navigation/useUnsavedChanges";
import { requestLeave } from "../navigation/unsavedChanges";
import { useModalDialog } from "../navigation/useModalDialog";

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

const DECISION_BADGE = { aceptado: "Aceptado", dudoso: "Dudoso", rechazado: "Rechazado" } as const;

function sectionBadge(finding: PreReportFinding): string | undefined {
  if (finding.decision) return `${DECISION_BADGE[finding.decision]} por el profesional`;
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
  const { model: rawModel, view, edits, setEdits, dirty, pendingEdits, busy, notice, imageStates, settleImages, save, updateSources } = state;
  const findingDecisions = useFindingDecisions(caseId, runId);
  const model = useMemo(() => (rawModel ? withFindingDecisions(rawModel, findingDecisions.decisions) : rawModel), [rawModel, findingDecisions.decisions]);
  const [previewOnly, setPreviewOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  /** Qué variante del documento se previsualiza y exporta. Excluir los anexos no borra datos ni cambia lo guardado. */
  const [variant, setVariant] = useState<ExportVariant>("full");
  /**
   * La vista previa es un iframe con `srcDoc`: cada vez que cambia el HTML (tildar una casilla, editar un texto)
   * el navegador carga un documento nuevo y vuelve arriba. Se recuerda la posición y se restaura al cargar.
   */
  const frameRef = useRef<HTMLIFrameElement>(null);
  const previewScrollRef = useRef(0);
  function restorePreviewScroll() {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    const target = previewScrollRef.current;
    win.scrollTo(0, target);
    // Si el contenido todavía no tiene su alto final (imágenes), se reintenta en el cuadro siguiente.
    win.requestAnimationFrame(() => { if (Math.abs(win.scrollY - target) > 1) win.scrollTo(0, target); });
    win.addEventListener("scroll", () => { previewScrollRef.current = win.scrollY; }, { passive: true });
  }

  const meta = useMemo<DocumentMeta | null>(() => (view ? {
    generatedAt: view.draft?.updatedAt ?? view.generatedAt,
    draftVersion: view.draft?.version ?? null,
    fingerprint: view.draft?.sourceFingerprint ?? view.fingerprint,
    stale: view.stale,
    staleNote: view.stale ? explainStale(view.changes).documentNote : undefined,
  } : null), [view]);

  const staleInfo = useMemo(() => explainStale(view?.changes ?? []), [view]);

  const html = useMemo(() => (model && meta ? buildPreReportHtml(model, edits, imageStates, meta, { variant }) : ""), [model, edits, imageStates, meta, variant]);

  /** Exportación a la espera de que se confirme que faltan imágenes (la pregunta se muestra en el editor, no en un diálogo nativo). */
  const [pendingExport, setPendingExport] = useState<{ kind: "pdf" | "html"; missing: string[]; html: string } | null>(null);

  /**
   * Prepara el documento. La advertencia por evidencia visual faltante va dentro del editor: un window.confirm se queda
   * esperando (o ni aparece) cuando la pestaña quedó en segundo plano, que es justo lo que pasa al abrir el PDF en otra pestaña.
   */
  async function prepareDocument(): Promise<{ html: string; missing: string[] } | null> {
    if (!model || !meta) return null;
    setExporting(true);
    try {
      const settled = await settleImages();
      const missing = missingEvidence(model, edits).map((item) => `${item.what}: ${item.reason}`);
      for (const [id, image] of Object.entries(settled)) {
        if (image.status === "failed") missing.push(`Imagen ${id.replace(/^img:/, "")}: ${image.error}`);
      }
      return { html: buildPreReportHtml(model, edits, settled, meta, { variant }), missing };
    } finally {
      setExporting(false);
    }
  }

  function openPdf(documentHtml: string) {
    const target = window.open("", "_blank");
    if (!target) {
      state.setNotice({ kind: "error", text: "El navegador bloqueó la ventana del documento. Habilitá las ventanas emergentes para este sitio." });
      return;
    }
    target.document.open();
    target.document.write(documentHtml);
    target.document.close();
    target.focus();
    // Dar tiempo a que el documento (con sus imágenes incrustadas) asiente antes de abrir el diálogo de impresión.
    window.setTimeout(() => target.print(), 600);
  }

  function saveHtml(documentHtml: string) {
    const blob = new Blob([documentHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `preinforme-borrador${variant === "full" ? "-con-anexos" : ""}-${(model?.study.caseId ?? "estudio").replace(/[^A-Za-z0-9._-]/g, "_")}.html`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function deliver(kind: "pdf" | "html", documentHtml: string) {
    setPendingExport(null);
    if (kind === "pdf") openPdf(documentHtml);
    else saveHtml(documentHtml);
  }

  async function startExport(kind: "pdf" | "html") {
    setPendingExport(null);
    const prepared = await prepareDocument();
    if (!prepared) return;
    if (prepared.missing.length) setPendingExport({ kind, missing: prepared.missing, html: prepared.html });
    else deliver(kind, prepared.html);
  }

  useUnsavedChanges("prereport", "Preinforme", pendingEdits ? ["Ediciones del preinforme (selección, textos u observaciones)"] : []);

  function close() {
    // Solo se pregunta por lo del preinforme: la Revisión sigue abierta debajo y conserva lo suyo.
    requestLeave(onClose, { scope: "prereport" });
  }

  // Esc equivale a «Volver al visor» (con la pregunta por cambios sin guardar); el foco vuelve a «Preparar preinforme».
  const dialogRef = useModalDialog<HTMLDivElement>(close);

  return (
    <div aria-label="Preparar preinforme" aria-modal="true" className="pre-overlay" data-testid="prereport-editor" ref={dialogRef} role="dialog">
      <header className="pre-bar">
        <button
          aria-controls="prereport-editor-column"
          aria-pressed={!previewOnly}
          className="pre-panel-toggle"
          data-testid="prereport-toggle-panel"
          disabled={!model}
          onClick={() => setPreviewOnly((value) => !value)}
          title={previewOnly ? "Mostrar el panel de edición" : "Ocultar el panel de edición y ver el documento a pantalla completa"}
          type="button"
        >
          {previewOnly ? <PanelLeftOpen aria-hidden="true" size={18} /> : <PanelLeftClose aria-hidden="true" size={18} />}
          <span>Panel de edición</span>
        </button>
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
          <label className="pre-variant">
            <span>Contenido</span>
            <select aria-label="Contenido a exportar" data-testid="prereport-variant" onChange={(event) => setVariant(event.target.value as ExportVariant)} value={variant}>
              <option value="brief">{VARIANT_LABEL.brief}</option>
              <option value="full">{VARIANT_LABEL.full}</option>
            </select>
          </label>
          <button data-testid="prereport-export-pdf" disabled={!model || exporting} onClick={() => void startExport("pdf")} type="button">
            {exporting ? "Preparando…" : "Exportar PDF (borrador)"}
          </button>
          <button data-testid="prereport-export-html" disabled={!model || exporting} onClick={() => void startExport("html")} type="button">Guardar HTML</button>
          <button data-testid="prereport-close" onClick={close} type="button">Volver al visor</button>
        </div>
      </header>

      {state.phase.kind === "loading" && <p className="pre-state" role="status">Preparando el preinforme desde la corrida del visor…</p>}
      {state.phase.kind === "error" && <p className="pre-state pre-error" data-testid="prereport-error" role="alert">No se pudo preparar el preinforme: {state.phase.message}</p>}

      {view && model && (
        <>
          {notice && <p className={`pre-notice pre-notice-${notice.kind}`} data-testid="prereport-notice" role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
          {pendingExport && (
            <section className="pre-export-confirm" data-testid="prereport-export-confirm" role="alertdialog" aria-label="Falta evidencia visual">
              <p><strong>Falta evidencia visual para estos elementos.</strong> Se conserva el resultado textual y el documento lo indica.</p>
              <ul>{pendingExport.missing.map((item) => <li key={item}>{item}</li>)}</ul>
              <div className="pre-stale-actions">
                <button className="rr-primary" data-testid="prereport-export-confirm-go" onClick={() => deliver(pendingExport.kind, pendingExport.html)} type="button">Exportar igual</button>
                <button data-testid="prereport-export-confirm-cancel" onClick={() => setPendingExport(null)} type="button">Cancelar</button>
              </div>
            </section>
          )}
          {view.stale && (
            <section className="pre-stale" data-testid="prereport-stale" role="alert">
              <p><strong>Borrador basado en datos anteriores.</strong> {staleInfo.text}</p>
              <div className="pre-stale-actions">
                {staleInfo.detailCount > 0 && <button onClick={() => setShowChanges((value) => !value)} type="button">{showChanges ? "Ocultar cambios" : `Ver cambios (${staleInfo.detailCount})`}</button>}
                <button className="rr-primary" data-testid="prereport-update-sources" disabled={busy !== null} onClick={() => void updateSources()} type="button">
                  {busy === "update" ? "Actualizando…" : "Actualizar con los datos actuales"}
                </button>
              </div>
              {showChanges && staleInfo.detailCount > 0 && (
                <ul className="pre-changes" data-testid="prereport-changes">
                  {view.changes.map((change) => (
                    <li key={`${change.key}-${change.kind}`}>
                      <strong>{change.section === "document" ? "Texto del documento" : change.kind === "added" ? "Nuevo" : change.kind === "removed" ? "Ya no está" : "Cambió"}:</strong> {change.label}
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
              <iframe className="pre-frame" data-testid="prereport-frame" onLoad={restorePreviewScroll} ref={frameRef} sandbox="allow-same-origin" srcDoc={html} title="Vista previa del preinforme" />
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const summary = documentSummary(model, edits);
  const missing = missingEvidence(model, edits);
  const research = model.findings.filter((f) => f.section === "investigacion");
  const levels = model.levels.filter((entry) => entry.lumbar || entry.evaluated);
  return (
    <aside aria-label="Contenido del preinforme" className="pre-editor" id="prereport-editor-column" data-testid="prereport-editor-column">
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
            <div className="pre-level-row">
            <label className="pre-level-head">
              <input aria-label={`Incluir la ficha de ${entry.level}`} checked={included} disabled={!entry.evaluated} onChange={(event) => onChange(withInclude(edits, levelKey(entry.level), event.target.checked))} type="checkbox" />
              <h3>{entry.level}</h3>
              {!entry.evaluated && <span className="pre-hint">Sin resultados en este nivel (no evaluado)</span>}
              {entry.evaluated && findings.some((f) => f.positive && f.section === "principal") && <span className="pre-badge">Predicción para revisar</span>}
            </label>
            {included && (
              <button
                aria-controls={`pre-level-body-${entry.level}`}
                aria-expanded={!collapsed[entry.level]}
                aria-label={`${collapsed[entry.level] ? "Expandir" : "Contraer"} la ficha de ${entry.level}`}
                className="pre-collapse"
                onClick={() => setCollapsed((current) => ({ ...current, [entry.level]: !current[entry.level] }))}
                title={collapsed[entry.level] ? "Expandir" : "Contraer"}
                type="button"
              >
                <span aria-hidden className={`pre-collapse-arrow${collapsed[entry.level] ? " is-collapsed" : ""}`}>▾</span>
              </button>
            )}
            </div>
            {included && !collapsed[entry.level] && (
              <div className="pre-level-body" id={`pre-level-body-${entry.level}`}>
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
