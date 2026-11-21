import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { PatientContextSelector } from "./PatientContextSelector";
import type { Patient } from "../../patientApi";
import { BackendApiError, runMultiplanarAnalysis, uploadAiInput, uploadStudyArchive } from "../../multiplanarApi";
import type { Plane } from "../../appTypes";
import type { InputResponse, StudyIngestionResponse } from "../../contracts/inputApiTypes";
import type { MultiplanarRunPayload } from "../../contracts/multiplanarHttpTypes";
import { evaluateRealInferenceReadiness } from "../../inferenceReadiness";
import { displayIngestionWarnings } from "./ingestionWarnings";
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

/**
 * Carga de un estudio nuevo, como panel sobre la lista de trabajo.
 *
 * Reemplaza al asistente de cuatro pasos: cargar → procesar → evaluar → aprobar.
 * Los dos últimos pasos duplicaban la sala de lectura con otro contrato de
 * revisión, y el patrón de asistente numerado es de alta de SaaS, no de lectura
 * radiológica. Acá el flujo es el que describieron los médicos: se carga el
 * estudio, se procesa, y aparece en la lista para leerlo.
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
  dedicated?: boolean;
};

function planeLabel(plane: Plane) {
  return plane === "sagittal" ? "Sagital" : "Axial";
}

function hasAllowedExtension(fileName: string) {
  const lowered = fileName.toLowerCase();
  return allowedInputExtensions.some((extension) => lowered.endsWith(extension));
}

function ageOn(dateOfBirth: string | null, studyDate: string | null) {
  if (!dateOfBirth || !studyDate) return null;
  const birth = new Date(`${dateOfBirth}T00:00:00`);
  const study = new Date(`${studyDate}T00:00:00`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(study.getTime()) || study < birth) return null;
  let age = study.getFullYear() - birth.getFullYear();
  const beforeBirthday = study.getMonth() < birth.getMonth()
    || (study.getMonth() === birth.getMonth() && study.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * Misma regla que aplica el backend al identificador de caso.
 *
 * Se repite acá a propósito: el backend la valida porque es quien no puede confiar en
 * el cliente, y la pantalla la valida porque el médico tiene que enterarse mientras
 * escribe y no después de elegir el archivo. Un error que aparece recién al subir
 * obliga a rehacer el paso entero sin decir qué carácter sobraba.
 */
const CASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

function caseIdError(value: string): string {
  if (!value) return "";
  if (!/^[A-Za-z0-9]/.test(value)) return "Tiene que empezar con una letra o un número.";
  if (value.length > 80) return "Máximo 80 caracteres.";
  const invalid = [...value].find((character) => !/[A-Za-z0-9._:-]/.test(character));
  if (invalid) {
    // Se nombra el carácter que sobra: "caracteres inválidos" obliga a adivinar cuál.
    return invalid === " "
      ? "No puede llevar espacios. Usá guion o guion bajo."
      : `El carácter «${invalid}» no está permitido. Usá letras, números, punto, guion, guion bajo o dos puntos.`;
  }
  return CASE_ID_PATTERN.test(value) ? "" : "Formato no permitido.";
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

export function NewAnalysisDrawer({ onClose, onAnalysisReady, dedicated = false }: Props) {
  const [caseId, setCaseId] = useState("");
  const [metadata, setMetadata] = useState<StudyMetadataDraft>(() => emptyStudyMetadataDraft());
  const [metadataError, setMetadataError] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [uploads, setUploads] = useState<Record<Plane, UploadState>>(emptyUploads);
  const [studyUpload, setStudyUpload] = useState<StudyUploadState>({ status: "idle" });
  /* La carga por plano queda plegada: es la salida para un archivo suelto de dataset. */
  const [byPlaneOpen, setByPlaneOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [productState, setProductState] = useState<ProductAnalysisState | null>(null);
  const [persistedRun, setPersistedRun] = useState<{ caseId: string; runId: string; study?: StudyIngestionResponse } | null>(null);
  const [analysisStage, setAnalysisStage] = useState<AnalysisStage>("idle");
  const runInFlightRef = useRef(false);
  const progressRef = useRef<HTMLElement | null>(null);
  const interactionLocked = running || analysisStage === "opening";
  const productRetryLock = useRef(false);
  const caseIdGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const studyUploadRequestRef = useRef(0);
  const planeUploadRequestRef = useRef<Record<Plane, number>>({ sagittal: 0, axial: 0 });
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  /*
   * Escape cierra el drawer. Es el equivalente por teclado del clic en el fondo, y lo
   * que cualquiera espera de un modal. No cierra durante una corrida: perder de vista
   * un análisis en curso por apoyar una tecla es peor que tener que apuntar al botón.
   */
  useEffect(() => {
    if (interactionLocked) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [interactionLocked, onClose]);

  useEffect(() => {
    previousActiveElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => backButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      previousActiveElementRef.current?.focus();
    };
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
    caseIdGenerationRef.current += 1;
    studyUploadRequestRef.current += 1;
    planeUploadRequestRef.current.sagittal += 1;
    planeUploadRequestRef.current.axial += 1;
  }, []);

  useEffect(() => {
    if (analysisStage === "idle") return;
    const frame = window.requestAnimationFrame(() => progressRef.current?.scrollIntoView({ block: "nearest" }));
    return () => window.cancelAnimationFrame(frame);
  }, [analysisStage]);

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
  const sagittalReady = Boolean(caseIdReady && sagittalInputId);
  const axialReady = Boolean(axialInputId);
  const uploading = studyUpload.status === "uploading" || uploads.sagittal.status === "uploading" || uploads.axial.status === "uploading";
  const uploadLocked = !studyIdentityReady || running;
  /* Lo que bloquea la carga se dice junto a la carga, no solo en el campo de arriba. */
  const uploadBlocker = !normalizedCaseId
    ? "Para cargar las imágenes, primero ingresá el ID de caso en «Datos del estudio»."
    : caseIdIssue
      ? "Corregí el ID de caso para poder cargar las imágenes."
      : "";
  /* Y el botón principal explica qué falta mientras está deshabilitado. */
  const analyzeBlocker = running
    ? ""
    : !normalizedCaseId
      ? "Falta el ID de caso."
      : caseIdIssue
        ? "El ID de caso no es válido."
        : uploading
          ? "Esperá a que termine la carga de las imágenes."
          : studyUpload.status === "uploaded" && !sagittalInputId
            ? "El ZIP cargado no incluye una serie sagital."
            : !sagittalInputId
              ? "Falta cargar el ZIP del estudio (o un archivo sagital)."
              : "";
  const clinicalTextFilled = [metadata.clinicalReason, metadata.symptoms, metadata.symptomDuration, metadata.relevantHistory]
    .some((value) => Boolean(value?.trim()));
  const ageMismatch = Boolean(
    selectedPatient?.dateOfBirth
    && metadata.ageAtStudy !== null && metadata.ageAtStudy !== undefined && metadata.ageAtStudy !== ""
    && ageOn(selectedPatient.dateOfBirth, metadata.studyDate) !== null
    && Number(metadata.ageAtStudy) !== ageOn(selectedPatient.dateOfBirth, metadata.studyDate),
  );
  const activeAnalysisStep = analysisStage === "idle" ? -1 : analysisSteps.findIndex((step) => step.id === analysisStage);

  function openCompletedStudy(caseIdToOpen: string) {
    setAnalysisStage("opening");
    setMessage("Análisis completado. Abriendo el estudio.");
    onAnalysisReady(caseIdToOpen);
  }

  async function uploadStudy(file?: File) {
    if (!file) return;
    if (!studyIdentityReady) {
      setMessage(caseIdIssue || "Ingresá un identificador de caso de-identificado antes de cargar el estudio.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setStudyUpload({ fileName: file.name, status: "error", error: "El estudio completo se carga como .zip. Para un archivo suelto usá la carga por plano." });
      return;
    }
    const generation = caseIdGenerationRef.current;
    const requestId = studyUploadRequestRef.current + 1;
    studyUploadRequestRef.current = requestId;
    setPersistedRun(null);
    setProductState(null);
    setAnalysisStage("idle");
    setStudyUpload({ fileName: file.name, status: "uploading" });
    try {
      const study = await uploadStudyArchive(file, normalizedCaseId);
      if (!mountedRef.current || generation !== caseIdGenerationRef.current || requestId !== studyUploadRequestRef.current) return;
      setStudyUpload({ fileName: file.name, status: "uploaded", study });
      setMessage("");
    } catch (error) {
      if (!mountedRef.current || generation !== caseIdGenerationRef.current || requestId !== studyUploadRequestRef.current) return;
      setStudyUpload({ fileName: file.name, status: "error", error: apiErrorMessage(error, "cargar el estudio") });
    }
  }

  async function upload(plane: Plane, file?: File) {
    if (!file) return;
    if (!studyIdentityReady) {
      setMessage(caseIdIssue || "Ingresá un identificador de caso de-identificado antes de cargar archivos.");
      return;
    }
    if (!hasAllowedExtension(file.name)) {
      setUploads((current) => ({
        ...current,
        [plane]: { fileName: file.name, status: "error", error: `Extensión no permitida. Usar: ${allowedInputExtensions.join(", ")}` },
      }));
      return;
    }
    const generation = caseIdGenerationRef.current;
    const requestId = planeUploadRequestRef.current[plane] + 1;
    planeUploadRequestRef.current[plane] = requestId;
    setUploads((current) => ({ ...current, [plane]: { fileName: file.name, status: "uploading" } }));
    try {
      const input = await uploadAiInput(file, normalizedCaseId, plane);
      if (!mountedRef.current || generation !== caseIdGenerationRef.current || requestId !== planeUploadRequestRef.current[plane]) return;
      setUploads((current) => ({ ...current, [plane]: { fileName: file.name, status: "uploaded", input } }));
      setMessage("");
    } catch (error) {
      if (!mountedRef.current || generation !== caseIdGenerationRef.current || requestId !== planeUploadRequestRef.current[plane]) return;
      setUploads((current) => ({
        ...current,
        [plane]: { fileName: file.name, status: "error", error: apiErrorMessage(error, "cargar archivo") },
      }));
    }
  }

  function onFileChange(plane: Plane, event: ChangeEvent<HTMLInputElement>) {
    void upload(plane, event.target.files?.[0]);
    event.target.value = "";
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
    setMessage("Procesando el estudio. Podés seguir el estado en este panel.");
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
    // El fondo cierra el drawer al hacerle clic. Es una comodidad de mouse: el
    // equivalente por teclado es Escape, que se maneja arriba, mas el boton de cerrar.
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events */
    <div className={dedicated ? "wl-new-study-page" : "wl-drawer-backdrop"} role={dedicated ? undefined : "presentation"} onClick={() => { if (!dedicated && !interactionLocked) onClose(); }}>
      {/*
        El onClick del panel no hace nada propio: solo frena la propagacion para que un
        clic adentro no llegue al fondo y cierre el drawer. Es una preocupacion de mouse
        y no tiene equivalente de teclado, porque por teclado nunca se dispara el fondo.
      */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <aside
        aria-labelledby="new-analysis-title"
        className={`wl-drawer${dedicated ? " wl-new-study" : ""}`}
        onClick={(event) => event.stopPropagation()}
        role={dedicated ? undefined : "dialog"}
        aria-modal={dedicated ? undefined : "true"}
      >
        <header className="wl-drawer-head ns-head">
          <button ref={backButtonRef} className="ns-back" disabled={interactionLocked} onClick={onClose} type="button">← Volver a estudios</button>
          <h2 id="new-analysis-title">{dedicated ? "Nuevo estudio" : "Cargar y analizar estudio"}</h2>
          <p className="ns-head-desc">Ingresá el ID del estudio, cargá las imágenes y, si corresponde, asociá un paciente para el seguimiento.</p>
        </header>

        <div className="wl-drawer-body">
          <div className="ns-layout">
          <div className="ns-col">
          <PatientContextSelector disabled={running || Boolean(persistedRun)} selected={selectedPatient} onSelect={(patient) => { setSelectedPatient(patient); setMetadata((current) => ({ ...current, patientId: patient?.id ?? "", subjectRef: patient?.patientReference ?? "" })); }} onContinueDeidentified={() => { setSelectedPatient(null); setMetadata((current) => ({ ...current, patientId: "", subjectRef: "" })); }} />
          <section className="ns-card ns-clinical-context" aria-labelledby="new-study-context-title">
            <div className="ns-section-heading">
              <h2 id="new-study-context-title">Contexto clínico</h2>
              <p>Opcional. Ayuda a interpretar el estudio y se usa solo como contexto, nunca como hallazgo. Puede enviarse al asistente de IA que redacta las respuestas y el informe.</p>
            </div>
            <div className="ns-two-fields">
              <label className="wl-field"><span>Edad al estudio</span><input disabled={running} type="number" min="0" max="130" placeholder="No informada" value={metadata.ageAtStudy ?? ""} onChange={(event) => setMetadata((current) => ({ ...current, ageAtStudy: event.target.value }))} /></label>
              <label className="wl-field"><span>Procedencia de la edad</span><select disabled={running} value={metadata.ageProvenance ?? "unknown"} onChange={(event) => setMetadata((current) => ({ ...current, ageProvenance: event.target.value as StudyMetadataDraft["ageProvenance"] }))}><option value="unknown">No informada</option><option value="reported">Informada al cargar</option><option value="calculated">Calculada por fecha</option><option value="imported">Importada</option></select></label>
            </div>
            {ageMismatch ? <p className="ns-context-warning" role="alert">La edad informada no coincide con la calculada a partir de la fecha de nacimiento del paciente. Se conservará la edad informada y su procedencia.</p> : null}
            <details className="ns-clinical-details">
              <summary>
                <span>Detalles clínicos</span>
                <em className={clinicalTextFilled ? "is-filled" : ""}>{clinicalTextFilled ? "Con información" : "Sin completar"}</em>
              </summary>
              <div className="ns-clinical-fields">
                <label className="wl-field"><span>Motivo del estudio</span><textarea disabled={running} value={metadata.clinicalReason ?? ""} onChange={(event) => setMetadata((current) => ({ ...current, clinicalReason: event.target.value }))} placeholder="Opcional" /></label>
                <label className="wl-field"><span>Síntomas</span><textarea disabled={running} value={metadata.symptoms ?? ""} onChange={(event) => setMetadata((current) => ({ ...current, symptoms: event.target.value }))} placeholder="Opcional" /></label>
                <label className="wl-field"><span>Tiempo de evolución</span><input disabled={running} value={metadata.symptomDuration ?? ""} onChange={(event) => setMetadata((current) => ({ ...current, symptomDuration: event.target.value }))} placeholder="Opcional" /></label>
                <label className="wl-field"><span>Antecedentes relevantes</span><textarea disabled={running} value={metadata.relevantHistory ?? ""} onChange={(event) => setMetadata((current) => ({ ...current, relevantHistory: event.target.value }))} placeholder="Opcional" /></label>
              </div>
            </details>
          </section>
          </div>

          <div className="ns-col">
          <section className="ns-card ns-study-data" aria-labelledby="new-study-data-title">
            <h2 className="ns-card-title" id="new-study-data-title">Datos del estudio</h2>

            <label className="wl-field">
              <span>ID de caso de-identificado</span>
              <input
                disabled={running}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  const hadLoadedInput = Boolean(studyUpload.fileName || Object.values(uploads).some((uploadState) => uploadState.fileName));
                  caseIdGenerationRef.current += 1;
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

            <div className="ns-two-fields">
              <label className="wl-field">
                <span>Fecha del estudio</span>
                <input
                  disabled={running}
                  onChange={(event) => setMetadata((current) => ({ ...current, studyDate: event.target.value }))}
                  type="date"
                  value={metadata.studyDate}
                />
              </label>
              <label className="wl-field">
                <span>Prioridad</span>
                <select
                  disabled={running}
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
              <span>Descripción</span>
              <input
                disabled={running}
                maxLength={200}
                onChange={(event) => setMetadata((current) => ({ ...current, description: event.target.value }))}
                placeholder="RM lumbar sagital T2"
                value={metadata.description}
              />
            </label>

            {metadataError && <p className="wl-drawer-error">{metadataError}</p>}
          </section>

          <section className="ns-card ns-images" aria-labelledby="new-study-images-title">
          <h2 className="ns-card-title" id="new-study-images-title">Imágenes</h2>

          <div className="wl-upload ns-zip">
            <div className="wl-upload-head">
              <strong>Estudio completo (.zip)</strong>
              <span>las series se separan solas</span>
            </div>
            <label className={`ns-file-button${uploadLocked ? " is-disabled" : ""}`}>
              <input
                accept=".zip"
                aria-describedby={uploadBlocker ? "ns-upload-blocker" : undefined}
                className="ns-file-input"
                disabled={uploadLocked}
                onChange={(event) => { void uploadStudy(event.target.files?.[0]); event.target.value = ""; }}
                type="file"
              />
              <span>{studyUpload.fileName ? "Cambiar ZIP" : "Seleccionar ZIP"}</span>
            </label>
            {uploadBlocker && <p className="ns-blocker" id="ns-upload-blocker">{uploadBlocker}</p>}
            {studyUpload.status === "uploading" && <p className="wl-upload-state">Leyendo {studyUpload.fileName}…</p>}
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
                {displayIngestionWarnings(studyUpload.study).map((warning) => (
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
            <button className="wl-upload-toggle" onClick={() => setByPlaneOpen((value) => !value)} type="button">
              {byPlaneOpen ? "▾" : "▸"} Cargar un archivo por plano
            </button>
            {byPlaneOpen && (["sagittal", "axial"] as Plane[]).map((plane) => (
              <div className="wl-upload-plane" key={plane}>
                <div className="wl-upload-head">
                  <strong>{planeLabel(plane)}</strong>
                  <span>{plane === "sagittal" ? "obligatorio" : "opcional · experimental"}</span>
                </div>
                <input
                  accept={uploadAccept}
                  disabled={!studyIdentityReady}
                  onChange={(event) => onFileChange(plane, event)}
                  type="file"
                />
                {uploads[plane].status === "uploading" && <p className="wl-upload-state">Cargando {uploads[plane].fileName}…</p>}
                {uploads[plane].status === "uploaded" && <p className="wl-upload-state is-ok">{uploads[plane].fileName} cargado.</p>}
                {uploads[plane].status === "error" && <p className="wl-drawer-error">{uploads[plane].error}</p>}
              </div>
            ))}
          </div>
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
          </div>
        </div>

        <footer className="wl-drawer-foot ns-foot">
          {!persistedRun && analyzeBlocker ? <p className="ns-foot-hint" id="ns-run-hint">{analyzeBlocker}</p> : <span />}
          <div className="ns-foot-actions">
            <button className="wl-drawer-cancel" disabled={interactionLocked} onClick={onClose} type="button">Cancelar</button>
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
                aria-describedby={analyzeBlocker ? "ns-run-hint" : undefined}
                className="wl-drawer-run"
                disabled={Boolean(analyzeBlocker) || running}
                onClick={() => void run()}
                type="button"
              >
                {running ? <><LoaderCircle aria-hidden className="wl-button-spinner" size={15} />Procesando…</> : "Analizar estudio"}
              </button>
            )}
          </div>
        </footer>
      </aside>
    </div>
  );
}
