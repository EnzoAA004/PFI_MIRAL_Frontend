import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { BackendApiError, runMultiplanarAnalysis, uploadAiInput, uploadStudyArchive } from "../../multiplanarApi";
import type { Plane } from "../../appTypes";
import type { InputResponse, StudyIngestionResponse } from "../../contracts/inputApiTypes";
import type { MultiplanarRunPayload } from "../../contracts/multiplanarHttpTypes";
import { evaluateRealInferenceReadiness } from "../../inferenceReadiness";
import {
  emptyNewStudyDraft,
  normalizeStudyMetadataInput,
  subjectRefErrorMessage,
  validateSubjectRef,
  type NewStudyDraft,
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
import { PatientSelector } from "./PatientSelector";
import { patientDisplayName, type Patient } from "../../patientApi";
import { NewStudyStepper } from "./NewStudyStepper";
import { NewStudySummary } from "./NewStudySummary";
import { ageUnavailableReason, formatIsoDateDMY, resolveStudyAge } from "../../studyAge";
import { describeSeriesUse, describeStudyWarning, seriesPlaneLabel, seriesSequenceLabel, type SeriesRole } from "../../studyWarnings";
import {
  analyzeBlockerMessage,
  caseIdError,
  computeSteps,
  continueBlockerMessage,
  createRequestGate,
  describeImagesStatus,
  hasUnsavedWork,
  nextStep,
  previousStep,
  uploadBlockerMessage,
  type StepId,
} from "./newStudyForm";

/**
 * Vista "Nuevo estudio": carga de un estudio, procesamiento y apertura en la sala de lectura.
 *
 * Es una pantalla dentro de la aplicación, no un diálogo: reemplaza a la lista en el área
 * central (la navegación principal se conserva) y se vuelve a ella con "Volver a estudios".
 * Por eso no atrapa el foco: lleva el foco a su encabezado al abrirse y es la lista quien
 * lo devuelve al control de origen al volver.
 *
 * Se recorre en tres pasos (Paciente y estudio, Imágenes, Contexto y revisión). Los datos y las
 * cargas viven en este componente, por encima de los pasos: ir y volver no pierde nada, no
 * reinicia cargas y nunca dispara un análisis ni crea pacientes. Solo "Analizar estudio", en el
 * último paso, envía la corrida.
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
function FileButton({ label, accept, disabled, describedBy, onFile, primary = false }: {
  label: string;
  accept: string;
  disabled: boolean;
  describedBy?: string;
  onFile: (file?: File) => void;
  /** Acción dominante del paso: solo mientras todavía no hay nada cargado. */
  primary?: boolean;
}) {
  return (
    <label className={`ns-file-button${primary ? " is-primary" : ""}${disabled ? " is-disabled" : ""}`}>
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

const priorityText: Record<StudyMetadataDraft["reviewPriority"], string> = { low: "Baja", medium: "Media", high: "Alta" };

export function NewAnalysisDrawer({ onClose, onAnalysisReady }: Props) {
  const [caseId, setCaseId] = useState("");
  const [metadata, setMetadata] = useState<NewStudyDraft>(() => emptyNewStudyDraft());
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
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [withoutPatient, setWithoutPatient] = useState(false);
  const [ageOverrideOpen, setAgeOverrideOpen] = useState(false);
  const [contextHelpOpen, setContextHelpOpen] = useState(false);
  const [step, setStep] = useState<StepId>("study");
  /* Una modificación (el ID) descartó imágenes ya cargadas: hay que volver a cargarlas. */
  const [imagesInvalidated, setImagesInvalidated] = useState(false);
  const runInFlightRef = useRef(false);
  const progressRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const keepEditingRef = useRef<HTMLButtonElement | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const firstStepRender = useRef(true);
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

  /* Al cambiar de paso el foco va al título del paso y la vista vuelve arriba: es contenido nuevo. */
  useEffect(() => {
    if (firstStepRender.current) {
      firstStepRender.current = false;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      stepHeadingRef.current?.focus();
      window.scrollTo({ top: 0 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  useEffect(() => {
    if (analysisStage === "idle") return;
    const frame = window.requestAnimationFrame(() => progressRef.current?.scrollIntoView({ block: "nearest" }));
    return () => window.cancelAnimationFrame(frame);
  }, [analysisStage]);

  useEffect(() => {
    if (confirmingExit) keepEditingRef.current?.focus();
  }, [confirmingExit]);

  /* Si la confirmacion de salida estaba abierta cuando arranco el analisis, se cierra: durante
     la corrida no hay salida, ni siquiera confirmada. */
  useEffect(() => {
    if (interactionLocked) setConfirmingExit(false);
  }, [interactionLocked]);

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
  /* Edad al estudio: se calcula con la fecha de nacimiento del paciente y la fecha del estudio;
     si no se puede, o el usuario sabe otra, la declara. Lo declarado nunca se descarta en silencio. */
  const calculatedAge = resolveStudyAge({ dateOfBirth: selectedPatient?.dateOfBirth, studyDate: metadata.studyDate, declared: "" }).calculated;
  const showAgeInput = calculatedAge === null || ageOverrideOpen || metadata.ageDeclared.trim() !== "";
  const age = resolveStudyAge({
    dateOfBirth: selectedPatient?.dateOfBirth,
    studyDate: metadata.studyDate,
    declared: showAgeInput ? metadata.ageDeclared : "",
  });
  const unavailableReason = ageUnavailableReason(age.missing, Boolean(selectedPatient));
  /* Con la edad ya declarada no se repite una instrucción como si el dato faltara. */
  const ageHelp = age.calculated !== null
    ? `Calculada con las fechas: ${age.calculated} años. Lo que declares acá se guarda como declarado.`
    : age.provenance === "reported"
      ? `Se guardará como edad declarada. No se calculó: ${unavailableReason.charAt(0).toLowerCase()}${unavailableReason.slice(1)}`
      : `${unavailableReason} Si la conocés, podés declarar la edad.`;
  const clinicalTextFilled = [metadata.clinicalReason, metadata.symptoms, metadata.symptomDuration, metadata.relevantHistory]
    .some((value) => value.trim() !== "");
  const analyzeBlocker = analyzeBlockerMessage({
    running: interactionLocked,
    normalizedCaseId,
    caseIdIssue,
    uploading,
    zipLoaded: studyUpload.status === "uploaded",
    sagittalInputId,
    ageIssue: age.issue,
  });
  const steps = computeSteps({
    active: step,
    studyReady: caseIdReady,
    imagesReady: sagittalReady && !uploading,
    imagesInvalidated,
    uploading,
  });
  const imagesStatus = describeImagesStatus({
    uploading,
    zipStatus: studyUpload.status,
    planeErrors: uploads.sagittal.status === "error" || uploads.axial.status === "error",
    sagittalInputId: sagittalReady ? sagittalInputId : undefined,
    seriesCount: studyUpload.study?.seriesFound.length,
    invalidated: imagesInvalidated,
  });
  /* Qué falta para pasar al paso siguiente (en el último paso, qué falta para analizar). */
  const stepBlocker = step === "context"
    ? ""
    : continueBlockerMessage(step, {
      running: false,
      normalizedCaseId,
      caseIdIssue,
      uploading,
      zipLoaded: studyUpload.status === "uploaded",
      sagittalInputId,
    });
  const footerHint = interactionLocked
    ? "El análisis está en curso. Podés salir cuando termine."
    : persistedRun ? "" : step === "context" ? analyzeBlocker : stepBlocker;
  const sagittalSource = studyUpload.study?.sagittal ? "el ZIP del estudio" : uploads.sagittal.input ? "el archivo por plano" : null;
  const axialSource = studyUpload.study?.axial ? "el ZIP del estudio" : uploads.axial.input ? "el archivo por plano" : null;
  const unsavedWork = hasUnsavedWork({
    caseId,
    description: metadata.description,
    studyDate: metadata.studyDate,
    reviewPriority: metadata.reviewPriority,
    patientSelected: Boolean(selectedPatient) || withoutPatient,
    contextFilled: metadata.ageDeclared.trim() !== "" || clinicalTextFilled,
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

  /* Cambiar de paso solo mueve la vista: ni analiza, ni crea pacientes, ni toca las cargas. */
  function goToStep(target: StepId) {
    if (interactionLocked) return;
    if (!steps.find((entry) => entry.id === target)?.reachable) return;
    setStep(target);
  }

  function goNext() {
    const target = nextStep(step);
    if (!target || stepBlocker || interactionLocked) return;
    setStep(target);
  }

  function goBack() {
    const target = previousStep(step);
    if (target && !interactionLocked) setStep(target);
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
      setImagesInvalidated(false);
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
      setImagesInvalidated(false);
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
    if (age.issue) {
      setMessage(age.issue);
      return;
    }
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
      const normalizedStudyMetadata = normalizeStudyMetadataInput(metadata, age);
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
          <p className="ns-head-desc">Datos del estudio, imágenes y contexto clínico, en tres pasos.</p>
          {confirmingExit && (
            <div className="ns-confirm" role="alert">
              <p><strong>¿Salir sin analizar?</strong> Se van a perder los datos y los archivos cargados en esta pantalla.</p>
              <div className="ns-confirm-actions">
                <button ref={keepEditingRef} className="ns-btn is-primary" onClick={() => setConfirmingExit(false)} type="button">Seguir editando</button>
                <button className="ns-btn" disabled={interactionLocked} onClick={() => { if (!interactionLocked) onClose(); }} type="button">Salir sin guardar</button>
              </div>
            </div>
          )}
        </header>

        <NewStudyStepper locked={interactionLocked} onSelect={goToStep} steps={steps} />

        <div className="ns-body">
          <NewStudySummary
            caseId={caseId}
            images={imagesStatus}
            patient={selectedPatient}
            studyDate={metadata.studyDate}
            withoutPatient={withoutPatient}
          />

          <div className="ns-main">
            {step === "study" && (
              <section aria-labelledby="ns-step-title" className="ns-step">
                <h2 id="ns-step-title" ref={stepHeadingRef} tabIndex={-1}>Paciente y estudio</h2>

                <div className="ns-block">
                  <div className="ns-block-head">
                    <h3>Paciente</h3>
                    <span>opcional</span>
                  </div>
                  <PatientSelector
                    disabled={interactionLocked || Boolean(persistedRun)}
                    onSelect={(patient) => {
                      setSelectedPatient(patient);
                      setWithoutPatient(false);
                      setMetadata((current) => ({ ...current, patientId: patient?.id ?? "" }));
                      setMetadataError("");
                    }}
                    onWithoutPatient={setWithoutPatient}
                    selected={selectedPatient}
                    withoutPatient={withoutPatient}
                  />
                </div>

                <div className="ns-block">
                  <div className="ns-block-head">
                    <h3>Datos del estudio</h3>
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
                        if (hadLoadedInput) {
                          setImagesInvalidated(true);
                          setMessage("Cambiaste el ID del estudio. Volvé a cargar las imágenes para asociarlas al nuevo ID.");
                        }
                      }}
                      placeholder="CASE-XXXX"
                      value={caseId}
                    />
                    {caseIdIssue
                      ? <em className="wl-field-error">{caseIdIssue}</em>
                      : <em>Letras, números, punto, guion, guion bajo o dos puntos.</em>}
                  </label>

                  <div className="ns-field-pair">
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
                </div>
              </section>
            )}

            {step === "images" && (
              <section aria-labelledby="ns-step-title" className="ns-step">
                <h2 id="ns-step-title" ref={stepHeadingRef} tabIndex={-1}>Imágenes</h2>
                <p className="ns-step-lead">Cargá el ZIP con el estudio completo: las series se separan solas. <b aria-hidden="true" className="ns-req">*</b> Hace falta una serie sagital.</p>

                {imagesStatus.state === "invalidated" && (
                  <p className="ns-notice" role="status">Cambiaste el ID del estudio: volvé a cargar las imágenes para asociarlas al nuevo ID.</p>
                )}

                <div className="ns-zip">
                  <div className="ns-zip-row">
                    <FileButton
                      accept=".zip"
                      describedBy={uploadBlocker ? "ns-upload-blocker" : undefined}
                      disabled={uploadLocked}
                      label={studyUpload.fileName ? "Cambiar ZIP" : "Seleccionar ZIP"}
                      onFile={(file) => { void uploadStudy(file); }}
                      primary={studyUpload.status !== "uploaded"}
                    />
                    <div className="ns-file-status">
                      <span className="ns-file-name">{studyUpload.fileName ?? "Ningún archivo seleccionado"}</span>
                      {studyUpload.status === "uploading" && <span className="ns-chip is-uploading" role="status"><LoaderCircle aria-hidden className="wl-button-spinner" size={13} />Cargando…</span>}
                      {studyUpload.status === "uploaded" && <span className="ns-chip is-loaded">Cargado</span>}
                      {studyUpload.status === "error" && <span className="ns-chip is-error">No se cargó</span>}
                    </div>
                  </div>
                  {uploadBlocker && <p className="ns-blocker" id="ns-upload-blocker">{uploadBlocker}</p>}
                  {studyUpload.status === "error" && <p className="wl-drawer-error" role="alert">{studyUpload.error}</p>}
                </div>

                {studyUpload.status === "uploaded" && studyUpload.study && (
                  <div className="ns-study-result">
                    {/*
                      Se listan todas las series que traía el estudio y no solo las usadas. El
                      médico necesita ver qué había para entender por qué se eligió lo que se
                      eligió, y sobre todo para notar cuando falta una serie que esperaba.
                    */}
                    <p className="ns-series-count">
                      {studyUpload.study.seriesFound.length} {studyUpload.study.seriesFound.length === 1 ? "serie detectada" : "series detectadas"}
                    </p>
                    <ul className="ns-series">
                      {studyUpload.study.seriesFound.map((series, index) => {
                        // Se empareja por posición: el identificador de la serie no sale
                        // del backend, porque llevaría de vuelta al estudio de origen.
                        const roles: SeriesRole[] = [
                          studyUpload.study?.sagittal?.seriesIndex === index ? "sagittal" : null,
                          studyUpload.study?.axial?.seriesIndex === index ? "axial" : null,
                          studyUpload.study?.sagittalT1?.seriesIndex === index ? "findings-t1" : null,
                          studyUpload.study?.sagittalT2?.seriesIndex === index ? "findings-t2" : null,
                        ].filter((role): role is SeriesRole => role !== null);
                        const use = describeSeriesUse(roles, series);
                        return (
                          <li className={use.used ? "is-used" : "is-unused"} key={`${series.plane}-${series.description}-${index}`}>
                            <div className="ns-series-main">
                              <strong>{seriesPlaneLabel(series.plane)}</strong>
                              <span>{seriesSequenceLabel(series.weighting)}</span>
                              <span>{series.sliceCount} cortes</span>
                            </div>
                            <p className="ns-series-use">{use.text}</p>
                          </li>
                        );
                      })}
                    </ul>
                    {/*
                      Las advertencias del módulo se reformulan pero no se descartan: que no haya
                      sagital, o que el axial no sea T2 cuando el modelo axial espera T2, cambia
                      lo que se puede concluir de la corrida. El texto original va en los
                      detalles técnicos.
                    */}
                    {studyUpload.study.warnings.length > 0 && (
                      <div className="ns-limitations" role="status">
                        <strong>Limitaciones</strong>
                        <ul>
                          {studyUpload.study.warnings.map((warning) => (
                            <li key={warning}>{describeStudyWarning(warning).text}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <details className="ns-tech">
                      <summary>Detalles técnicos</summary>
                      <div className="ns-tech-body">
                        <p>Archivo: {studyUpload.fileName}</p>
                        <ol>
                          {studyUpload.study.seriesFound.map((series, index) => (
                            <li key={`${series.inputId}-${index}`}>
                              {series.description || "Sin descripción"} · {series.inputId}
                              {series.multiplanar ? " · localizador" : ""}{series.derived ? " · derivada" : ""}
                            </li>
                          ))}
                        </ol>
                        {studyUpload.study.warnings.length > 0 && (
                          <>
                            <p>Mensajes originales del módulo de IA:</p>
                            <ul>
                              {studyUpload.study.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                            </ul>
                          </>
                        )}
                      </div>
                    </details>
                  </div>
                )}

                {/*
                  Camino secundario y plegado: acepta lo que el de estudio completo no puede
                  recibir —un .mha o un .npy sueltos de un dataset—, donde el plano no viene
                  en la metadata y lo tiene que declarar el médico.
                */}
                <div className="ns-alt">
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
                    <div className="ns-alt-body" id="ns-by-plane">
                      {(["sagittal", "axial"] as Plane[]).map((plane) => (
                        <div className="ns-plane" key={plane}>
                          <div className="ns-plane-head">
                            <strong>{planeLabel(plane)}</strong>
                            <span>{plane === "sagittal" ? "obligatorio si no hay ZIP" : "opcional · experimental"}</span>
                          </div>
                          <div className="ns-zip-row">
                            <FileButton
                              accept={uploadAccept}
                              describedBy={uploadBlocker ? "ns-upload-blocker" : undefined}
                              disabled={uploadLocked}
                              label={uploads[plane].fileName ? "Cambiar archivo" : "Seleccionar archivo"}
                              onFile={(file) => { void upload(plane, file); }}
                            />
                            <div className="ns-file-status">
                              <span className="ns-file-name">{uploads[plane].fileName ?? "Ningún archivo seleccionado"}</span>
                              {uploads[plane].status === "uploading" && <span className="ns-chip is-uploading" role="status"><LoaderCircle aria-hidden className="wl-button-spinner" size={13} />Cargando…</span>}
                              {uploads[plane].status === "uploaded" && <span className="ns-chip is-loaded">Cargado</span>}
                              {uploads[plane].status === "error" && <span className="ns-chip is-error">No se cargó</span>}
                            </div>
                          </div>
                          {uploads[plane].status === "uploaded" && <p className="ns-muted">{uploads[plane].fileName} cargado.</p>}
                          {uploads[plane].status === "error" && <p className="wl-drawer-error" role="alert">{uploads[plane].error}</p>}
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
            )}

            {step === "context" && (
              <section aria-labelledby="ns-step-title" className="ns-step">
                <h2 id="ns-step-title" ref={stepHeadingRef} tabIndex={-1}>Contexto y revisión</h2>

                <div className="ns-block ns-age" aria-label="Edad al estudio" role="group">
                  <div className="ns-block-head">
                    <h3>Edad al estudio</h3>
                    {age.value !== null && (
                      <span className="ns-badge">{age.provenance === "calculated" ? "Calculada" : "Declarada"}</span>
                    )}
                  </div>
                  {!showAgeInput && age.calculated !== null && (
                    <div className="ns-age-line">
                      <p className="ns-age-value"><strong>{age.calculated} años</strong></p>
                      <button className="ns-link-button" disabled={interactionLocked} onClick={() => setAgeOverrideOpen(true)} type="button">Declarar otra edad</button>
                    </div>
                  )}
                  {!showAgeInput && age.calculated !== null && (
                    <p className="ns-muted">Según la fecha de nacimiento del paciente y la fecha del estudio.</p>
                  )}
                  {showAgeInput && (
                    <>
                      <div className="ns-age-line">
                        <label className="wl-field ns-age-field">
                          <span className="ns-sr-only">Edad declarada en años</span>
                          <input
                            aria-describedby="ns-age-help"
                            disabled={interactionLocked}
                            inputMode="numeric"
                            maxLength={3}
                            onChange={(event) => setMetadata((current) => ({ ...current, ageDeclared: event.target.value }))}
                            placeholder="Años"
                            value={metadata.ageDeclared}
                          />
                        </label>
                        {age.calculated !== null && (
                          <button
                            className="ns-link-button"
                            disabled={interactionLocked}
                            onClick={() => { setAgeOverrideOpen(false); setMetadata((current) => ({ ...current, ageDeclared: "" })); }}
                            type="button"
                          >
                            Usar la edad calculada
                          </button>
                        )}
                      </div>
                      <p className="ns-muted" id="ns-age-help">{ageHelp}</p>
                    </>
                  )}
                  {age.issue && <p className="wl-field-error" role="alert">{age.issue}</p>}
                  {age.discrepancy && (
                    <p className="ns-warning" role="alert">
                      La edad declarada ({age.value}) difiere de la calculada ({age.calculated}). Se guardará la declarada, marcada como declarada.
                    </p>
                  )}
                </div>

                <div className="ns-block">
                  <div className="ns-block-head">
                    <h3>Contexto clínico</h3>
                    <span>opcional</span>
                  </div>
                  <p className="ns-muted">
                    Información clínica registrada para este estudio.{" "}
                    <button
                      aria-controls="ns-context-help"
                      aria-expanded={contextHelpOpen}
                      className="ns-link-button"
                      onClick={() => setContextHelpOpen((open) => !open)}
                      type="button"
                    >
                      Cómo se conserva
                    </button>
                  </p>
                  {contextHelpOpen && (
                    <p className="ns-muted ns-help-text" id="ns-context-help">
                      Se guarda con este estudio como contexto, nunca como hallazgo. Si después se edita el paciente, lo registrado acá no cambia.
                    </p>
                  )}
                  <div className="ns-clinical-grid">
                    <label className="wl-field is-wide">
                      <span>Motivo del estudio</span>
                      <textarea disabled={interactionLocked} maxLength={1000} onChange={(event) => setMetadata((current) => ({ ...current, clinicalReason: event.target.value }))} placeholder="Opcional" value={metadata.clinicalReason} />
                    </label>
                    <label className="wl-field">
                      <span>Síntomas</span>
                      <textarea disabled={interactionLocked} maxLength={1000} onChange={(event) => setMetadata((current) => ({ ...current, symptoms: event.target.value }))} placeholder="Opcional" value={metadata.symptoms} />
                    </label>
                    <label className="wl-field">
                      <span>Antecedentes relevantes</span>
                      <textarea disabled={interactionLocked} maxLength={2000} onChange={(event) => setMetadata((current) => ({ ...current, relevantHistory: event.target.value }))} placeholder="Opcional" value={metadata.relevantHistory} />
                    </label>
                    <label className="wl-field">
                      <span>Tiempo de evolución</span>
                      <input disabled={interactionLocked} maxLength={120} onChange={(event) => setMetadata((current) => ({ ...current, symptomDuration: event.target.value }))} placeholder="Opcional" value={metadata.symptomDuration} />
                    </label>
                  </div>
                </div>

                <div className="ns-block">
                  <div className="ns-block-head">
                    <h3>Revisión antes de analizar</h3>
                  </div>
                  <dl className="ns-review">
                    <div>
                      <dt>Paciente</dt>
                      <dd>{selectedPatient ? `${patientDisplayName(selectedPatient) || "Sin nombre"} · ${selectedPatient.patientReference}` : withoutPatient ? "Sin asociación" : "Sin elegir (se guarda sin paciente)"}</dd>
                      <button className="ns-link-button" disabled={interactionLocked} onClick={() => goToStep("study")} type="button">Editar paciente</button>
                    </div>
                    <div>
                      <dt>Estudio</dt>
                      <dd>
                        {normalizedCaseId}
                        {metadata.studyDate ? ` · ${formatIsoDateDMY(metadata.studyDate)}` : ""}
                        {` · Prioridad ${priorityText[metadata.reviewPriority]}`}
                        {metadata.description.trim() ? ` · ${metadata.description.trim()}` : ""}
                      </dd>
                      <button className="ns-link-button" disabled={interactionLocked} onClick={() => goToStep("study")} type="button">Editar estudio</button>
                    </div>
                    <div>
                      <dt>Imágenes</dt>
                      <dd>
                        {studyUpload.status === "uploaded" && studyUpload.study
                          ? `${studyUpload.fileName} · ${studyUpload.study.seriesFound.length} series detectadas`
                          : [uploads.sagittal.input ? `Sagital: ${uploads.sagittal.fileName}` : null, uploads.axial.input ? `Axial: ${uploads.axial.fileName}` : null].filter(Boolean).join(" · ") || "Sin cargar"}
                        {studyUpload.study?.warnings.length ? ` · ${studyUpload.study.warnings.length} ${studyUpload.study.warnings.length === 1 ? "limitación" : "limitaciones"}` : ""}
                      </dd>
                      <button className="ns-link-button" disabled={interactionLocked} onClick={() => goToStep("images")} type="button">Editar imágenes</button>
                    </div>
                  </dl>
                </div>

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
                      {analysisSteps.map((analysisStep, index) => (
                        <li
                          className={index < activeAnalysisStep ? "is-complete" : index === activeAnalysisStep ? "is-active" : ""}
                          key={analysisStep.id}
                        >
                          <span aria-hidden="true">{index < activeAnalysisStep ? "✓" : index + 1}</span>
                          {analysisStep.label}
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
              </section>
            )}

            {message && <p className="wl-drawer-message" role="status">{message}</p>}
          </div>
        </div>

        <footer className="ns-foot">
          <button className="ns-btn is-quiet" disabled={interactionLocked} onClick={requestExit} type="button">Cancelar</button>
          <p className="ns-foot-hint" id="ns-run-hint" role="status">{footerHint}</p>
          <div className="ns-foot-actions">
            {previousStep(step) && (
              <button className="ns-btn" disabled={interactionLocked} onClick={goBack} type="button">Atrás</button>
            )}
            {step !== "context" ? (
              <button
                aria-describedby="ns-run-hint"
                className="ns-btn is-primary"
                disabled={Boolean(stepBlocker)}
                onClick={goNext}
                type="button"
              >
                Continuar
              </button>
            ) : persistedRun && productState?.phase === "error" ? (
              <>
                <button className="ns-btn" disabled={running} onClick={() => onAnalysisReady(persistedRun.caseId)} type="button">
                  Abrir sin hallazgos discales
                </button>
                <button className="ns-btn is-primary" disabled={running || !productState.retryable} onClick={() => void retryProductExtensions()} type="button">
                  {running ? "Reintentando…" : productState.retryable ? "Reintentar hallazgos discales" : "Hallazgos discales no disponibles"}
                </button>
              </>
            ) : persistedRun && productState && ["completed", "degraded"].includes(productState.phase) ? (
              <button className="ns-btn is-primary" disabled={running} onClick={() => onAnalysisReady(persistedRun.caseId)} type="button">
                Abrir sala de lectura
              </button>
            ) : (
              <button
                aria-describedby="ns-run-hint"
                className="ns-btn is-primary"
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
