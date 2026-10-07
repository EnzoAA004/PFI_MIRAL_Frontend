import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { BackendApiError, runMultiplanarAnalysis, uploadAiInput, uploadStudyArchive } from "../../multiplanarApi";
import type { Plane } from "../../appTypes";
import type { InputResponse, StudyIngestionResponse } from "../../contracts/inputApiTypes";
import type { MultiplanarRunPayload } from "../../contracts/multiplanarHttpTypes";
import { evaluateRealInferenceReadiness } from "../../inferenceReadiness";
import {
  emptyStudyMetadataDraft,
  normalizeStudyMetadataInput,
  subjectRefErrorMessage,
  validateSubjectRef,
  type StudyMetadataDraft,
} from "../../studyMetadata";
import {
  initialProductAnalysisState,
  retryDiscFindingsFromPreparedSources,
  runP109ProductFlow,
  runSingleProductRetry,
  type ProductAnalysisState,
  type ProductFlowPhase,
} from "./productAnalysisFlow";
import { SubjectSelector } from "./SubjectSelector";
import {
  analyzeBlockerMessage,
  caseIdError,
  createRequestGate,
  hasUnsavedWork,
  uploadBlockerMessage,
} from "./newStudyForm";

/**
 * Vista "Nuevo estudio": carga de un estudio, procesamiento y apertura en la sala de lectura.
 *
 * Es una pantalla dentro de la aplicación, no un diálogo: reemplaza a la lista en el área
 * central (la navegación principal se conserva) y se vuelve a ella con "Volver a estudios".
 * Por eso no atrapa el foco: lleva el foco a su encabezado al abrirse y es la lista quien
 * lo devuelve al control de origen al volver.
 *
 * El flujo es el que describieron los médicos: se carga el estudio, se procesa, y aparece
 * en la lista para leerlo.
 */

const allowedInputExtensions = [".npy", ".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".mha", ".mhd", ".dcm", ".zip"];
const uploadAccept = allowedInputExtensions.join(",");

type UploadState = {
  fileName?: string;
  status: "idle" | "uploading" | "uploaded" | "error";
  input?: InputResponse;
  error?: string;
};

const emptyUploads: Record<Plane, UploadState> = {
  sagittal: { status: "idle" },
  axial: { status: "idle" },
};

/**
 * Carga de un estudio entero en un solo archivo.
 *
 * Es el camino normal: un estudio de resonancia sale del PACS como un archivo con
 * todas sus series adentro. Partirlo a mano en dos zips —uno sagital y otro axial— es
 * pedirle al médico que haga la clasificación que la metadata DICOM ya trae resuelta,
 * y que se equivoque cuando el nombre de la serie no coincide con su orientación.
 */
type StudyUploadState = {
  fileName?: string;
  status: "idle" | "uploading" | "uploaded" | "error";
  study?: StudyIngestionResponse;
  error?: string;
};

type AnalysisStage = "idle" | "processing" | "completing" | "opening";

const analysisSteps: { id: Exclude<AnalysisStage, "idle">; label: string }[] = [
  { id: "processing", label: "Procesando imágenes" },
  { id: "completing", label: "Completando resultados" },
  { id: "opening", label: "Abriendo estudio" },
];

const analysisStageCopy: Record<Exclude<AnalysisStage, "idle">, string> = {
  processing: "El estudio está siendo analizado. El tiempo depende del tamaño y la cantidad de imágenes.",
  completing: "La corrida principal está lista. Se están guardando los resultados complementarios disponibles.",
  opening: "Todo quedó guardado correctamente. Abriendo la sala de lectura.",
};

function seriesLabel(series: { plane: string; weighting: string; description: string; sliceCount: number }) {
  const plane = series.plane === "sagittal" ? "Sagital" : series.plane === "axial" ? "Axial" : series.plane === "coronal" ? "Coronal" : series.plane;
  const weighting = series.weighting === "t1" || series.weighting === "t2" ? series.weighting.toUpperCase() : series.weighting;
  return `${plane} ${weighting} · ${series.sliceCount} cortes${series.description ? ` · ${series.description}` : ""}`;
}

type Props = {
  onClose: () => void;
  /** Se invoca con el caseId cuando la corrida terminó y el estudio ya es legible. */
  onAnalysisReady: (caseId: string) => void;
};

function planeLabel(plane: Plane) {
  return plane === "sagittal" ? "Sagital" : "Axial";
}

function hasAllowedExtension(fileName: string) {
  const lowered = fileName.toLowerCase();
  return allowedInputExtensions.some((extension) => lowered.endsWith(extension));
}

function apiErrorMessage(error: unknown, action: string) {
  if (error instanceof BackendApiError) {
    return `No se pudo ${action}: ${error.message}`;
  }
  return error instanceof Error ? `No se pudo ${action}: ${error.message}` : `No se pudo ${action}.`;
}

const productPhaseLabel: Record<ProductFlowPhase, string> = {
  preparing_series: "Preparando series",
  segmenting_t1: "Segmentando T1",
  segmenting_t2: "Segmentando T2",
  analyzing_findings: "Analizando hallazgos",
  completed: "Completado",
  degraded: "Completado con capacidad reducida",
  error: "Error recuperable",
};

function productSeriesLabel(status: ProductAnalysisState["series"]["sagittal_t1"]["status"]) {
  if (status === "unavailable") return "No disponible";
  if (status === "pending") return "Preparada";
  if (status === "segmenting") return "Segmentando…";
  if (status === "completed") return "Segmentación completa";
  return "Error";
}

/**
 * Botón de carga accesible. El control real es el input de archivo (conserva teclado,
 * foco y nombre accesible); la etiqueta es lo que se ve como botón, en lugar del input
 * nativo "Seleccionar archivo / Ningún archivo seleccionado".
 */
function FileButton({ label, accept, disabled, describedBy, onFile }: {
  label: string;
  accept: string;
  disabled: boolean;
  describedBy?: string;
  onFile: (file?: File) => void;
}) {
  return (
    <label className={`ns-file-button${disabled ? " is-disabled" : ""}`}>
      <input
        accept={accept}
        aria-describedby={describedBy}
        className="ns-file-input"
        disabled={disabled}
        onChange={(event) => { onFile(event.target.files?.[0]); event.target.value = ""; }}
        type="file"
      />
      <span>{label}</span>
    </label>
  );
}

export function NewAnalysisDrawer({ onClose, onAnalysisReady }: Props) {
  const [caseId, setCaseId] = useState("");
  const [metadata, setMetadata] = useState<StudyMetadataDraft>(() => emptyStudyMetadataDraft());
  const [metadataError, setMetadataError] = useState("");
  const [uploads, setUploads] = useState<Record<Plane, UploadState>>(emptyUploads);
  const [studyUpload, setStudyUpload] = useState<StudyUploadState>({ status: "idle" });
  /* La carga por plano queda plegada: es la salida para un archivo suelto de dataset. */
  const [byPlaneOpen, setByPlaneOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [productState, setProductState] = useState<ProductAnalysisState | null>(null);
  const [persistedRun, setPersistedRun] = useState<{ caseId: string; runId: string; study?: StudyIngestionResponse } | null>(null);
  const [analysisStage, setAnalysisStage] = useState<AnalysisStage>("idle");
  const [confirmingExit, setConfirmingExit] = useState(false);
  const runInFlightRef = useRef(false);
  const progressRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const keepEditingRef = useRef<HTMLButtonElement | null>(null);
  /* Cargas en vuelo: ver createRequestGate. */
  const [requestGate] = useState(createRequestGate);
  const interactionLocked = running || analysisStage === "opening";
  const productRetryLock = useRef(false);

  /* Al abrir la vista el foco va al encabezado: es una pantalla nueva, y quien navega
     con teclado o lector tiene que enterarse de dónde está. */
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  /* Al salir, ninguna respuesta pendiente puede volver a tocar el estado. */
  useEffect(() => () => requestGate.invalidateAll(), [requestGate]);

  useEffect(() => {
    if (analysisStage === "idle") return;
    const frame = window.requestAnimationFrame(() => progressRef.current?.scrollIntoView({ block: "nearest" }));
    return () => window.cancelAnimationFrame(frame);
  }, [analysisStage]);

  useEffect(() => {
    if (confirmingExit) keepEditingRef.current?.focus();
  }, [confirmingExit]);

  const normalizedCaseId = caseId.trim();
  const caseIdIssue = caseIdError(normalizedCaseId);
  /* Sin un identificador válido no se habilita la carga: el archivo se subiría para
     ser rechazado, y el médico tendría que volver a elegirlo. */
  const caseIdReady = Boolean(normalizedCaseId) && !caseIdIssue;
  /*
   * 86-N: el paciente/subjectRef es opcional -- ya lo era antes de esta etapa, como
   * "Referencia interna del estudio (opcional)". Un Study sin subjectRef es válido en
   * el dominio; simplemente no tendrá historial longitudinal.
   */
  const studyIdentityReady = caseIdReady;
  /*
   * El identificador de entrada puede venir de las dos vías. La del estudio completo
   * tiene prioridad porque el plano lo decidió la metadata; la de plano suelto es lo
   * que el médico declaró a mano.
   */
  const sagittalInputId = studyUpload.study?.sagittal?.inputId ?? uploads.sagittal.input?.inputId;
  const axialInputId = studyUpload.study?.axial?.inputId ?? uploads.axial.input?.inputId;
  /* Un ID inválido invalida lo cargado aunque el archivo siga ahí: no se analiza. */
  const sagittalReady = Boolean(caseIdReady && sagittalInputId);
  const axialReady = Boolean(axialInputId);
  const uploading = studyUpload.status === "uploading" || uploads.sagittal.status === "uploading" || uploads.axial.status === "uploading";
  const activeAnalysisStep = analysisStage === "idle" ? -1 : analysisSteps.findIndex((step) => step.id === analysisStage);
  /* Mientras corre un análisis la vista no se edita ni se cierra: lo que se ve tiene que
     ser lo que se envió, y salir haría perder el seguimiento de la corrida. */
  const uploadLocked = !studyIdentityReady || interactionLocked;
  const uploadBlocker = uploadBlockerMessage(normalizedCaseId, caseIdIssue);
  const analyzeBlocker = analyzeBlockerMessage({
    running: interactionLocked,
    normalizedCaseId,
    caseIdIssue,
    uploading,
    zipLoaded: studyUpload.status === "uploaded",
    sagittalInputId,
  });
  const footerHint = interactionLocked
    ? "El análisis está en curso. Podés salir cuando termine."
    : persistedRun ? "" : analyzeBlocker;
  const sagittalSource = studyUpload.study?.sagittal ? "el ZIP del estudio" : uploads.sagittal.input ? "el archivo por plano" : null;
  const axialSource = studyUpload.study?.axial ? "el ZIP del estudio" : uploads.axial.input ? "el archivo por plano" : null;
  const unsavedWork = hasUnsavedWork({
    caseId,
    description: metadata.description,
    studyDate: metadata.studyDate,
    reviewPriority: metadata.reviewPriority,
    subjectRef: metadata.subjectRef,
    hasLoadedFiles: Boolean(studyUpload.fileName || uploads.sagittal.fileName || uploads.axial.fileName),
    analysisPersisted: Boolean(persistedRun),
  });

  /* El aviso del navegador cubre cerrar la pestaña o recargar; la confirmación propia, "Volver" y "Cancelar". */
  useEffect(() => {
    if (!unsavedWork) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsavedWork]);

  function requestExit() {
    if (interactionLocked) return;
    if (unsavedWork) {
      setConfirmingExit(true);
      return;
    }
    onClose();
  }

  function openCompletedStudy(caseIdToOpen: string) {
    setAnalysisStage("opening");
    setMessage("Análisis completado. Abriendo el estudio.");
    onAnalysisReady(caseIdToOpen);
  }

  async function uploadStudy(file?: File) {
    if (!file) return;
    /* Elegir un archivo reemplaza al anterior aunque este se rechace: su respuesta, si
       llega tarde, ya no vale. */
    const token = requestGate.begin("study");
    if (!studyIdentityReady) {
      setMessage(caseIdIssue || "Ingresá un ID de estudio válido antes de cargar el estudio.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setStudyUpload({ fileName: file.name, status: "error", error: "El estudio completo se carga como .zip. Para un archivo suelto usá la carga por plano." });
      return;
    }
    setPersistedRun(null);
    setProductState(null);
    setAnalysisStage("idle");
    setStudyUpload({ fileName: file.name, status: "uploading" });
    try {
      const study = await uploadStudyArchive(file, normalizedCaseId);
      if (!requestGate.isCurrent(token)) return;
      setStudyUpload({ fileName: file.name, status: "uploaded", study });
      setMessage("");
    } catch (error) {
      if (!requestGate.isCurrent(token)) return;
      setStudyUpload({ fileName: file.name, status: "error", error: apiErrorMessage(error, "cargar el estudio") });
    }
  }

  async function upload(plane: Plane, file?: File) {
    if (!file) return;
    const token = requestGate.begin(plane);
    if (!studyIdentityReady) {
      setMessage(caseIdIssue || "Ingresá un ID de estudio válido antes de cargar archivos.");
      return;
    }
    if (!hasAllowedExtension(file.name)) {
      setUploads((current) => ({
        ...current,
        [plane]: { fileName: file.name, status: "error", error: `Extensión no permitida. Usar: ${allowedInputExtensions.join(", ")}` },
      }));
      return;
    }
    setUploads((current) => ({ ...current, [plane]: { fileName: file.name, status: "uploading" } }));
    try {
      const input = await uploadAiInput(file, normalizedCaseId, plane);
      if (!requestGate.isCurrent(token)) return;
      setUploads((current) => ({ ...current, [plane]: { fileName: file.name, status: "uploaded", input } }));
      setMessage("");
    } catch (error) {
      if (!requestGate.isCurrent(token)) return;
      setUploads((current) => ({
        ...current,
        [plane]: { fileName: file.name, status: "error", error: apiErrorMessage(error, "cargar archivo") },
      }));
    }
  }

  async function runProductExtensions(context: { caseId: string; runId: string; study?: StudyIngestionResponse }) {
    setProductState(initialProductAnalysisState(context.study));
    return runP109ProductFlow({
      caseId: context.caseId,
      multiplanarRunId: context.runId,
      study: context.study,
      onState: (state) => {
        setProductState(state);
        setMessage(state.message);
      },
    });
  }

  async function retryProductExtensions() {
    if (!persistedRun || !productState || running) return;
    await runSingleProductRetry(productRetryLock, async () => {
      setRunning(true);
      setAnalysisStage("completing");
      try {
        if (productState.failureStage === "disc_findings") {
          await retryDiscFindingsFromPreparedSources({
            caseId: persistedRun.caseId,
            multiplanarRunId: persistedRun.runId,
            study: persistedRun.study,
            state: productState,
            onState: (state) => {
              setProductState(state);
              setMessage(state.message);
            },
          });
          setAnalysisStage("idle");
        } else {
          const nextProductState = await runProductExtensions(persistedRun);
          if (["completed", "degraded"].includes(nextProductState.phase)) {
            openCompletedStudy(persistedRun.caseId);
          } else {
            setAnalysisStage("idle");
          }
        }
      } finally {
        setRunning(false);
      }
    });
  }

  async function run() {
    if (!sagittalReady || uploading || running || runInFlightRef.current) return;
    const subjectError = validateSubjectRef(metadata.subjectRef);
    if (subjectError) {
      setMetadataError(subjectError);
      setMessage(subjectRefErrorMessage);
      return;
    }
    setMetadataError("");
    runInFlightRef.current = true;
    setRunning(true);
    setAnalysisStage("processing");
    setMessage("Procesando el estudio. Podés seguir el estado en esta pantalla.");
    try {
      const normalizedStudyMetadata = normalizeStudyMetadataInput(metadata);
      const payload: MultiplanarRunPayload = {
        caseId: normalizedCaseId,
        studyMetadata: normalizedStudyMetadata,
        sagittalInputId: sagittalInputId ?? "",
        sagittalModelKey: "sagittal_spider",
        allowContractFallback: false,
        metadata: {
          source: "frontend-worklist-drawer",
          uiFlow: "worklist-new-analysis",
          inferenceMode: "real_baseline",
          requestedInferenceMode: "real_baseline",
          allowContractFallback: false,
          axialMode: axialReady ? "experimental_requested" : "optional_not_provided",
          // Queda registrado si los planos los separo la metadata del estudio o los
          // declaro el medico: son dos procedencias distintas del mismo dato.
          planeSource: studyUpload.study ? "study_archive_metadata" : "manual_per_plane",
        },
        /*
         * Todas las series del estudio viajan con la corrida, no solo las dos que se
         * infieren. Es lo que después le permite a la sala de lectura ofrecerlas: sin
         * esto el backend guarda los dos planos y las otras cinco quedan registradas
         * en el módulo de IA sin que nada las vincule a este estudio.
         *
         * Va vacío cuando el análisis se armó con dos archivos sueltos en vez de un
         * estudio completo, que es el caso donde no hay catálogo que llevar.
         */
        ...(studyUpload.study?.seriesFound?.length ? { studySeries: studyUpload.study.seriesFound } : {}),
        ...(axialReady ? { axialInputId, axialModelKey: "axial_t2_alkafri" } : {}),
      };
      const result = await runMultiplanarAnalysis(payload);
      const readiness = evaluateRealInferenceReadiness(result);
      if (readiness.ready) {
        const context = { caseId: normalizedCaseId, runId: result.runId, study: studyUpload.study };
        setPersistedRun(context);
        setAnalysisStage("completing");
        const nextProductState = await runProductExtensions(context);
        if (["completed", "degraded"].includes(nextProductState.phase)) {
          openCompletedStudy(context.caseId);
        } else {
          setAnalysisStage("idle");
        }
        return;
      }
      // La corrida existe pero no dejó un sagital evaluable: se queda acá con el
      // motivo, en vez de abrir una sala de lectura sin nada que leer.
      setMessage(`La corrida terminó sin sagital evaluable. ${readiness.reasons.join(" ")}`);
      setAnalysisStage("idle");
    } catch (error) {
      setMessage(apiErrorMessage(error, "ejecutar el análisis"));
      setAnalysisStage("idle");
    } finally {
      runInFlightRef.current = false;
      setRunning(false);
    }
  }

  return (
    <div className="wl-new-study-page">
      <section aria-labelledby="new-study-title" className="wl-new-study">
        <header className="ns-head">
          <button className="ns-back" disabled={interactionLocked} onClick={requestExit} type="button">
            <ArrowLeft aria-hidden size={15} />Volver a estudios
          </button>
          <h1 id="new-study-title" ref={headingRef} tabIndex={-1}>Nuevo estudio</h1>
          <p className="ns-head-desc">Cargá las imágenes del estudio, completá sus datos y, si corresponde, asociá un paciente existente.</p>
          {confirmingExit && (
            <div className="ns-confirm" role="alert">
              <p><strong>¿Salir sin analizar?</strong> Se van a perder los datos y los archivos cargados en esta pantalla.</p>
              <div className="ns-confirm-actions">
                <button ref={keepEditingRef} className="wl-drawer-run" onClick={() => setConfirmingExit(false)} type="button">Seguir editando</button>
                <button className="wl-drawer-cancel" onClick={onClose} type="button">Salir sin guardar</button>
              </div>
            </div>
          )}
        </header>

        <div className="ns-layout">
          <div className="ns-main">
            <section aria-labelledby="new-study-data-title" className="ns-card">
              <div className="ns-card-head">
                <h2 id="new-study-data-title">Datos del estudio</h2>
                <span><b aria-hidden="true">*</b> obligatorio</span>
              </div>

              <label className="wl-field">
                <span>ID del estudio <b aria-hidden="true" className="ns-req">*</b></span>
                <input
                  aria-required="true"
                  disabled={interactionLocked}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    const hadLoadedInput = Boolean(studyUpload.fileName || Object.values(uploads).some((uploadState) => uploadState.fileName));
                    /* Lo que está en vuelo se subió con el ID anterior: su respuesta ya no vale. */
                    requestGate.invalidateAll();
                    setCaseId(nextValue);
                    setUploads(emptyUploads);
                    setStudyUpload({ status: "idle" });
                    setPersistedRun(null);
                    setProductState(null);
                    setAnalysisStage("idle");
                    if (hadLoadedInput) setMessage("Cambiaste el ID del estudio. Volvé a cargar las imágenes para asociarlas al nuevo ID.");
                  }}
                  placeholder="CASE-XXXX"
                  value={caseId}
                />
                {caseIdIssue
                  ? <em className="wl-field-error">{caseIdIssue}</em>
                  : <em>Letras, números, punto, guion, guion bajo o dos puntos.</em>}
              </label>

              <div className="wl-field-row">
                <label className="wl-field">
                  <span>Fecha del estudio <i>(opcional)</i></span>
                  <input
                    disabled={interactionLocked}
                    onChange={(event) => setMetadata((current) => ({ ...current, studyDate: event.target.value }))}
                    type="date"
                    value={metadata.studyDate}
                  />
                </label>
                <label className="wl-field">
                  <span>Prioridad</span>
                  <select
                    disabled={interactionLocked}
                    onChange={(event) => setMetadata((current) => ({ ...current, reviewPriority: event.target.value as StudyMetadataDraft["reviewPriority"] }))}
                    value={metadata.reviewPriority}
                  >
                    <option value="low">Baja</option>
                    <option value="medium">Media</option>
                    <option value="high">Alta</option>
                  </select>
                </label>
              </div>

              <label className="wl-field">
                <span>Descripción <i>(opcional)</i></span>
                <input
                  disabled={interactionLocked}
                  maxLength={200}
                  onChange={(event) => setMetadata((current) => ({ ...current, description: event.target.value }))}
                  placeholder="RM lumbar sagital T2"
                  value={metadata.description}
                />
              </label>

              {metadataError && <p className="wl-drawer-error">{metadataError}</p>}
            </section>

            <section aria-labelledby="new-study-images-title" className="ns-card">
              <div className="ns-card-head">
                <h2 id="new-study-images-title">Imágenes</h2>
                <span><b aria-hidden="true">*</b> sagital obligatorio</span>
              </div>

              <div className="wl-upload ns-zip">
                <div className="wl-upload-head">
                  <strong>Estudio completo (.zip)</strong>
                  <span>las series se separan solas</span>
                </div>
                <div className="ns-file-row">
                  <FileButton
                    accept=".zip"
                    describedBy={uploadBlocker ? "ns-upload-blocker" : undefined}
                    disabled={uploadLocked}
                    label={studyUpload.fileName ? "Cambiar ZIP" : "Seleccionar ZIP"}
                    onFile={(file) => { void uploadStudy(file); }}
                  />
                  <span className="ns-file-name">{studyUpload.fileName ?? "Ningún archivo seleccionado"}</span>
                </div>
                {uploadBlocker && <p className="ns-blocker" id="ns-upload-blocker">{uploadBlocker}</p>}
                {studyUpload.status === "uploading" && <p className="wl-upload-state" role="status">Leyendo {studyUpload.fileName}…</p>}
                {studyUpload.status === "error" && <p className="wl-drawer-error">{studyUpload.error}</p>}
                {studyUpload.status === "uploaded" && studyUpload.study && (
                  <div className="wl-study-result">
                    {/*
                      Se listan todas las series que traía el estudio y no solo las dos
                      elegidas. El médico necesita ver qué había para entender por qué se
                      eligió lo que se eligió, y sobre todo para notar cuando falta una
                      serie que esperaba encontrar.
                    */}
                    <p className="wl-upload-state is-ok">
                      {studyUpload.fileName}: {studyUpload.study.seriesFound.length} series encontradas.
                    </p>
                    <ul className="wl-series-list">
                      {studyUpload.study.seriesFound.map((series, index) => {
                        // Se empareja por posición: el identificador de la serie no sale
                        // del backend, porque llevaría de vuelta al estudio de origen.
                        const roles = [
                          studyUpload.study?.sagittal?.seriesIndex === index ? "multiplanar sagital" : null,
                          studyUpload.study?.axial?.seriesIndex === index ? "multiplanar axial" : null,
                          studyUpload.study?.sagittalT1?.seriesIndex === index ? "fuente de hallazgos T1" : null,
                          studyUpload.study?.sagittalT2?.seriesIndex === index ? "fuente de hallazgos T2" : null,
                        ].filter((role): role is string => Boolean(role));
                        const usedFor = roles.length ? roles.join(" · ") : null;
                        return (
                          <li className={usedFor ? "is-selected" : ""} key={`${series.plane}-${series.description}-${index}`}>
                            <span>{seriesLabel(series)}</span>
                            {usedFor && <em>se analiza como {usedFor}</em>}
                          </li>
                        );
                      })}
                    </ul>
                    {/*
                      Las advertencias del módulo llegan tal cual: que no haya sagital, o
                      que el axial no sea T2 cuando el modelo axial fue entrenado sobre T2,
                      cambia lo que se puede concluir de la corrida.
                    */}
                    {studyUpload.study.warnings.map((warning) => (
                      <p className="wl-drawer-warning" key={warning}>{warning}</p>
                    ))}
                  </div>
                )}
              </div>

              {/*
                Camino secundario y plegado: acepta lo que el de estudio completo no puede
                recibir —un .mha o un .npy sueltos de un dataset—, donde el plano no viene
                en la metadata y lo tiene que declarar el médico.
              */}
              <div className="wl-upload">
                <button
                  aria-controls="ns-by-plane"
                  aria-expanded={byPlaneOpen}
                  className="ns-disclosure"
                  onClick={() => setByPlaneOpen((value) => !value)}
                  type="button"
                >
                  {byPlaneOpen ? <ChevronDown aria-hidden size={16} /> : <ChevronRight aria-hidden size={16} />}
                  Cargar archivos por plano
                </button>
                {byPlaneOpen && (
                  <div id="ns-by-plane">
                    {(["sagittal", "axial"] as Plane[]).map((plane) => (
                      <div className="wl-upload-plane" key={plane}>
                        <div className="wl-upload-head">
                          <strong>{planeLabel(plane)}</strong>
                          <span>{plane === "sagittal" ? "obligatorio si no hay ZIP" : "opcional · experimental"}</span>
                        </div>
                        <div className="ns-file-row">
                          <FileButton
                            accept={uploadAccept}
                            describedBy={uploadBlocker ? "ns-upload-blocker" : undefined}
                            disabled={uploadLocked}
                            label={uploads[plane].fileName ? "Cambiar archivo" : "Seleccionar archivo"}
                            onFile={(file) => { void upload(plane, file); }}
                          />
                          <span className="ns-file-name">{uploads[plane].fileName ?? "Ningún archivo seleccionado"}</span>
                        </div>
                        {uploads[plane].status === "uploading" && <p className="wl-upload-state" role="status">Cargando {uploads[plane].fileName}…</p>}
                        {uploads[plane].status === "uploaded" && <p className="wl-upload-state is-ok">{uploads[plane].fileName} cargado.</p>}
                        {uploads[plane].status === "error" && <p className="wl-drawer-error">{uploads[plane].error}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {sagittalInputId && (
                <p className="ns-source">
                  Se analizará: sagital desde {sagittalSource}; axial {axialSource ? `desde ${axialSource}` : "no cargado (opcional)"}.
                </p>
              )}
            </section>

            {analysisStage !== "idle" && (
              <section ref={progressRef} className="wl-analysis-progress" aria-live="polite" aria-label="Progreso del análisis" role="status">
                <div className="wl-analysis-progress-head">
                  <LoaderCircle aria-hidden className="wl-analysis-spinner" size={20} />
                  <div>
                    <strong>{analysisSteps[activeAnalysisStep]?.label}</strong>
                    <p>{analysisStageCopy[analysisStage]}</p>
                  </div>
                </div>
                <ol>
                  {analysisSteps.map((step, index) => (
                    <li
                      className={index < activeAnalysisStep ? "is-complete" : index === activeAnalysisStep ? "is-active" : ""}
                      key={step.id}
                    >
                      <span aria-hidden="true">{index < activeAnalysisStep ? "✓" : index + 1}</span>
                      {step.label}
                    </li>
                  ))}
                </ol>
                <small>El sistema no informa porcentajes; los estados cambian sólo cuando cada etapa termina.</small>
              </section>
            )}

            {productState && (
              <section className={`wl-product-progress is-${productState.phase}`} aria-live="polite">
                <strong>{productPhaseLabel[productState.phase]}</strong>
                <ul>
                  {(["sagittal_t1", "sagittal_t2"] as const).map((role) => {
                    const item = productState.series[role];
                    return (
                      <li key={role}>
                        <span>{role === "sagittal_t1" ? "Sagittal T1" : "Sagittal T2"}</span>
                        <em>{productSeriesLabel(item.status)}</em>
                        {item.segmentationRunId && <small>run {item.segmentationRunId}</small>}
                        {item.status === "completed" && <small>{item.discLocalizations.length} localizaciones discales</small>}
                        {item.error && <small className="wl-field-error">{item.error}</small>}
                      </li>
                    );
                  })}
                </ul>
                {productState.failureStage === "disc_findings" && (
                  <p className="wl-upload-state">
                    <strong>Clasificación discal</strong> · No se pudo completar
                  </p>
                )}
              </section>
            )}

            {message && <p className="wl-drawer-message" role="status">{message}</p>}
          </div>

          <div className="ns-side">
            <SubjectSelector
              disabled={interactionLocked || Boolean(persistedRun)}
              onChange={(subjectRef) => {
                setMetadata((current) => ({ ...current, subjectRef }));
                setMetadataError("");
              }}
              value={metadata.subjectRef}
            />
          </div>
        </div>

        <footer className="ns-foot">
          <p className="ns-foot-hint" id="ns-run-hint" role="status">{footerHint}</p>
          <div className="ns-foot-actions">
            <button className="wl-drawer-cancel" disabled={interactionLocked} onClick={requestExit} type="button">Cancelar</button>
            {persistedRun && productState?.phase === "error" ? (
              <>
                <button className="wl-drawer-cancel" disabled={running} onClick={() => onAnalysisReady(persistedRun.caseId)} type="button">
                  Abrir sin hallazgos discales
                </button>
                <button className="wl-drawer-run" disabled={running || !productState.retryable} onClick={() => void retryProductExtensions()} type="button">
                  {running ? "Reintentando…" : productState.retryable ? "Reintentar hallazgos discales" : "Hallazgos discales no disponibles"}
                </button>
              </>
            ) : persistedRun && productState && ["completed", "degraded"].includes(productState.phase) ? (
              <button className="wl-drawer-run" disabled={running} onClick={() => onAnalysisReady(persistedRun.caseId)} type="button">
                Abrir sala de lectura
              </button>
            ) : (
              <button
                aria-describedby="ns-run-hint"
                className="wl-drawer-run"
                disabled={!sagittalReady || uploading || running}
                onClick={() => void run()}
                type="button"
              >
                {running ? <><LoaderCircle aria-hidden className="wl-button-spinner" size={15} />Procesando…</> : "Analizar estudio"}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
