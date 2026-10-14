import { useMemo } from "react";
import { API_BASE_URL } from "../../api";
import type { StudyArchiveSeries } from "../../appTypes";
import { sequenceOfAnalyzedPlane } from "./planeSeries";
import { UNKNOWN_SEQUENCE, sequenceFromComparisonSide, sequenceProvenanceHint, sequenceText } from "./sequenceInfo";
import { studyRunToMriViewerModel } from "../../viewModels/mriViewerViewModel";
import type { SliceNavigation } from "../../components/MriSliceViewer";
import type { ComparisonStudySide } from "../../contracts/initialAnalysisComparisonTypes";
import { PlaneViewport } from "./PlaneViewport";
import type { MeasurementFigure } from "./MeasurementLayer";
import { resolveAnalyzedSliceSource } from "./analyzedSliceSource";
import { parseSegmentation } from "./segmentation";
import { parseSlicePixelsMeta } from "./pixels";
import type { ComparisonSideState } from "./useComparisonSide";
import { describeAnalysis, formatStudyDate } from "./initialComparisonDisplay";
import { clamp, paneViewOf, planeLabel, type PaneState, type Side, type SideOverlay } from "./dualComparisonLogic";

/**
 * Un lado del visor de comparación: cabecera con la identidad del estudio y de la corrida, y el visor de lectura
 * de siempre (`PlaneViewport`) en modo solo lectura.
 *
 * Es controlado: el estado de serie y corte vive en el padre, uno por lado, y no se comparte ni se sincroniza.
 * El zoom, el desplazamiento y la ventana (W/L) son del propio visor y tampoco se tocan desde afuera.
 */

export const SIDE_TITLE: Record<Side, string> = { reference: "Referencia", current: "Actual" };

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" ? value as Record<string, any> : undefined;
}

function seriesSliceUrl(inputId: string, index: number) {
  return `${API_BASE_URL}/api/ai/series/${encodeURIComponent(inputId)}/slices/${index}`;
}

function seriesLabel(series: StudyArchiveSeries) {
  const weighting = series.weighting === "t1" || series.weighting === "t2" ? series.weighting.toUpperCase() : "";
  const description = series.description.trim();
  if (description && weighting) return `${description} · ${weighting}`;
  return description || weighting || "Serie sin descripción";
}

type Props = {
  side: Side;
  summary: ComparisonStudySide;
  sideState: ComparisonSideState;
  state: PaneState;
  onChange: (next: PaneState) => void;
  /** Lo que hay que dibujar para la diferencia seleccionada en este lado. */
  overlay: SideOverlay;
  /** Texto del valor que lleva la marca sobre la imagen (valor efectivo y unidad). */
  figureLabel: string;
  /** Mediciones de este corte para mostrar atenuadas, si el usuario lo pide. Vacío por defecto. */
  context: MeasurementFigure[];
  onReturn: () => void;
};

export function ComparisonPane({ side, summary, sideState, state, onChange, overlay, figureLabel, context, onReturn }: Props) {
  const ready = sideState.status === "ready" ? sideState.data : null;
  const view = useMemo(() => paneViewOf(state, sideState), [state, sideState]);
  const archive = ready && state.viewedSeriesId ? ready.archiveSeries.find((item) => item.inputId === state.viewedSeriesId) ?? null : null;
  const analyzed = ready ? ready.analyzed[state.plane] : null;
  const workspace = ready ? ready.workspaces[state.plane] : null;

  /* Identidad estable por corrida: el visor usa estos objetos como dependencia y reiniciaría la ventana (W/L). */
  const canonicalPlane = ready ? asRecord(asRecord(ready.run.canonicalRun?.planes)?.[state.plane]) : undefined;
  const segmentation = useMemo(() => parseSegmentation(canonicalPlane?.segmentation), [canonicalPlane]);
  const slicePixels = useMemo(() => parseSlicePixelsMeta(asRecord(canonicalPlane?.quality)?.slicePixels), [canonicalPlane]);

  const model = useMemo(() => {
    if (!ready || !workspace) return null;
    const series = archive
      ? { id: archive.inputId, name: seriesLabel(archive), plane: state.plane, sliceCount: Math.max(archive.sliceCount, 1), selectedSlice: 0, imageUrl: null }
      : analyzed;
    if (!series) return null;
    return studyRunToMriViewerModel({
      plane: state.plane,
      planeRunId: archive ? undefined : workspace.planeRunId ?? undefined,
      series: series as never,
      masks: [],
      landmarks: [],
    });
  }, [analyzed, archive, ready, state.plane, workspace]);

  const nav = useMemo<SliceNavigation | undefined>(() => {
    if (!view || !ready) return undefined;
    if (archive) {
      const total = Math.max(archive.sliceCount, 1);
      if (total < 2) return undefined;
      return {
        current: view.slice,
        total,
        aiIndex: -1,
        hasImage: true,
        previewUrl: seriesSliceUrl(archive.inputId, view.slice),
        previewUrlFor: (index: number) => seriesSliceUrl(archive.inputId, index),
        onChange: (index: number) => onChange({ ...state, slice: clamp(index, total) }),
        onStep: (delta: number) => onChange({ ...state, slice: clamp(view.slice + delta, total) }),
      };
    }
    if (!analyzed) return undefined;
    const total = Math.max(analyzed.sliceCount ?? 1, 1);
    if (total < 2) return undefined;
    const aiIndex = clamp(analyzed.selectedSlice ?? 0, total);
    const previewUrlFor = (index: number) => resolveAnalyzedSliceSource({
      apiBaseUrl: API_BASE_URL,
      sourceInputId: analyzed.sourceInputId,
      index,
      aiIndex,
      legacyInputUrl: analyzed.imageUrl,
      legacyPreviewCount: analyzed.slicePreviewCount,
    });
    return {
      current: view.slice,
      total,
      aiIndex,
      hasImage: view.slice === aiIndex || Boolean(previewUrlFor(view.slice)),
      previewUrl: previewUrlFor(view.slice),
      previewUrlFor,
      onChange: (index: number) => onChange({ ...state, slice: clamp(index, total) }),
      onStep: (delta: number) => onChange({ ...state, slice: clamp(view.slice + delta, total) }),
    };
  }, [analyzed, archive, onChange, ready, state, view]);

  const figures = useMemo<MeasurementFigure[]>(() => {
    const drawn: MeasurementFigure[] = overlay.state === "draw"
      ? [{
        id: "selected-difference",
        kind: overlay.figure.kind === "angle" ? "angle" : "distance",
        points: overlay.figure.points,
        label: figureLabel,
        source: overlay.figure.geometry === "reviewer" ? "reviewer" : "ai",
        measurementId: "selected-difference",
      }]
      : [];
    return [...context, ...drawn];
  }, [context, figureLabel, overlay]);

  const choices = ready ? ready.archiveSeries.filter((item) => item.plane === state.plane || item.multiplanar) : [];
  const planesAvailable = ready
    ? (["sagittal", "axial"] as const).filter((plane) => ready.analyzed[plane] || ready.archiveSeries.some((item) => item.plane === plane))
    : [];
  const spacing = analyzed?.inPlaneSpacingMm;
  /* La secuencia de la serie que se mira. Si se mira otra del estudio, la de esa serie; si no, la que publicó la corrida. */
  const viewedSequence = ready
    ? (archive ? archive.sequence ?? UNKNOWN_SEQUENCE : sequenceOfAnalyzedPlane(ready.run, state.plane, ready.archiveSeries))
    : UNKNOWN_SEQUENCE;
  /* La de la comparación (lo que usó el comparador): la del plano sagital de la corrida comparada. */
  const comparedSequence = sequenceFromComparisonSide(summary);

  return (
    <section
      aria-label={`${SIDE_TITLE[side]}: estudio ${summary.caseId}`}
      className={`rr-dual-pane rr-dual-${side}${overlay.state === "draw" ? " has-selection" : ""}`}
      data-overlay-state={overlay.state}
      data-side={side}
      data-testid={`dual-pane-${side}`}
    >
      <header className="rr-dual-head">
        <span className="rr-dual-badge">{SIDE_TITLE[side]}</span>
        <strong data-testid={`dual-id-${side}`}>{summary.caseId}</strong>
        <span className="rr-dual-sub">{formatStudyDate(summary.studyDate)}</span>
        <span className="rr-dual-sub" data-testid={`dual-run-${side}`}>{describeAnalysis(summary)}</span>
        <span
          className={`rr-dual-sub rr-dual-seq${comparedSequence.value === "unknown" ? " is-unknown" : ""}`}
          data-testid={`dual-sequence-${side}`}
          title={sequenceProvenanceHint(comparedSequence)}
        >
          Secuencia sagital: {sequenceText(comparedSequence)}
        </span>
        {planesAvailable.length > 1 && (
          <span aria-label={`Plano del lado ${SIDE_TITLE[side].toLowerCase()}`} className="rr-dual-planes" role="group">
            {planesAvailable.map((plane) => (
              <button
                aria-pressed={state.plane === plane}
                className={state.plane === plane ? "is-on" : ""}
                key={plane}
                onClick={() => onChange({ plane, viewedSeriesId: null, slice: null })}
                type="button"
              >
                {planeLabel(plane)}
              </button>
            ))}
          </span>
        )}
      </header>

      <div className="rr-dual-body">
        {sideState.status === "loading" && <p className="rr-dual-state" role="status">Cargando el estudio {sideState.caseId}…</p>}
        {sideState.status === "error" && <p className="rr-dual-state rr-dual-error" data-testid={`dual-error-${side}`} role="alert">{sideState.message}</p>}
        {sideState.status === "idle" && <p className="rr-dual-state">Elegí una referencia para abrir su estudio.</p>}
        {ready && !model && (
          <p className="rr-dual-state" data-testid={`dual-noseries-${side}`}>
            Este estudio no tiene una serie {planeLabel(state.plane)} para mostrar.
          </p>
        )}
        {ready && model && (
          <PlaneViewport
            active={false}
            addMode={false}
            aiMeasurableCount={figures.length}
            aiMeasurements={figures}
            analyzedSeriesName={analyzed ? "Serie analizada" : null}
            annotations={[]}
            caseLabel={summary.caseId}
            derivedMeasurableCount={0}
            derivedMeasurements={[]}
            hiddenInstances={[]}
            highlightedMeasurementId={null}
            key={`${side}-${summary.caseId}-${state.plane}`}
            measureDraft={[]}
            measureTool={null}
            measurementsReadonly
            model={model}
            onActivate={() => undefined}
            onAddLandmark={() => undefined}
            onLandmarkAddComplete={() => undefined}
            onMeasureFreehand={() => undefined}
            onMeasurePoint={() => undefined}
            onMoveLandmark={() => undefined}
            onMoveMaskPoint={() => undefined}
            onMoveMeasurePoint={() => undefined}
            onOverlayAvailableChange={() => undefined}
            onSelectLandmark={() => undefined}
            onSelectMeasurement={() => undefined}
            onSelectSeries={(inputId) => onChange({ ...state, viewedSeriesId: inputId, slice: null })}
            onToggleInstance={() => undefined}
            pixelSpacingMm={spacing && spacing.length === 2 ? [spacing[0], spacing[1]] : null}
            pixelsBaseUrl={archive ? undefined : analyzed?.imageUrl ?? undefined}
            plane={state.plane}
            readonly
            referenceLine={null}
            referenceLineReason=""
            segmentation={archive ? undefined : segmentation}
            selectedLandmarkId=""
            selectedMeasurementId={overlay.state === "draw" ? "selected-difference" : null}
            seriesChoices={choices}
            sequence={viewedSequence}
            seriesName={archive ? seriesLabel(archive) : analyzed?.name ?? planeLabel(state.plane)}
            seriesRoleLabel={archive ? "Referencia" : "Analizada IA"}
            slice={nav}
            slicePixels={archive ? undefined : slicePixels}
            spacingLabel={spacing && spacing.length === 2 ? `${spacing[0].toFixed(3)} x ${spacing[1].toFixed(3)} mm/px` : "escala no informada"}
            unsegmentedReason={archive ? "La IA no corrió sobre esta serie; se muestra como imagen." : ""}
            viewedSeriesId={state.viewedSeriesId}
          />
        )}
      </div>

      {/* Estado de la diferencia seleccionada en este lado: siempre dice qué pasa, nunca queda en blanco. */}
      {overlay.state !== "draw" && (
        <p className={`rr-dual-note rr-dual-note-${overlay.state}`} data-testid={`dual-location-${side}`} role="status">
          {overlay.state === "elsewhere" ? (
            <>
              {overlay.reason}{" "}
              {overlay.canReturn && (
                <button className="rr-link" data-testid={`dual-return-${side}`} onClick={onReturn} type="button">
                  Volver a la medición seleccionada
                </button>
              )}
            </>
          ) : overlay.code === "no_location" && overlay.reason === "No hay una diferencia seleccionada."
            ? null
            : <>No se puede ubicar en este estudio: {overlay.reason}</>}
        </p>
      )}
      {overlay.state === "draw" && (
        <p className="rr-dual-note rr-dual-note-draw" data-testid={`dual-location-${side}`}>
          {overlay.figure.geometry === "reviewer"
            ? "Trazo guardado por el revisor."
            : "Trazo de la IA. Un valor corregido no modifica el trazo."}
        </p>
      )}
    </section>
  );
}
