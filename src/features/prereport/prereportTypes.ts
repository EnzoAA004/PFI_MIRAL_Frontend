/**
 * Contrato del preinforme visual (`GET/PUT /api/studies/{caseId}/prereport`, `POST .../update-sources`).
 *
 * `generated` es lo que el Backend arma por código desde la corrida exacta; `edits` es lo que decidió y escribió el
 * profesional. Se guardan y se manejan por separado: el texto efectivo es `edits.text[key] ?? item.text`.
 */

export type PreReportTrace = {
  status: "located" | "slice_only" | "not_located";
  reason: string | null;
  kind: "segment" | "angle" | "none" | string;
  /** En el espacio de coordenadas `space` (base 0..256 en la corrida actual). Vacío si no hay trazo ubicable. */
  points: number[][];
  origin: "ia" | "profesional" | null;
  space: { name: string | null; width: number | null; height: number | null };
};

export type PreReportMeasurement = {
  key: string;
  id: string;
  plane: string;
  labelKey: string | null;
  label: string;
  level: string | null;
  levelScope: string | null;
  unit: string;
  original: number | null;
  corrected: number | null;
  effective: number | null;
  origin: "ia" | "profesional";
  experimental: boolean;
  sliceIndex: number | null;
  invalidReason: string | null;
  text: string;
  trace: PreReportTrace;
  /** Imagen del plano de la corrida a la que están alineadas las coordenadas del trazo. `null` si no hay trazo ubicable. */
  imagePath: string | null;
  defaultInclude: boolean;
};

export type PreReportRegion = {
  inputId: string;
  sliceIndex: number;
  point: { x: number; y: number };
  bbox: { x0: number; y0: number; x1: number; y1: number };
  width: number;
  height: number;
};

export type PreReportFindingSource = {
  role: string;
  roleLabel: string;
  available: boolean;
  regionIssue: string | null;
  region: PreReportRegion | null;
  imagePath: string | null;
};

export type PreReportFinding = {
  key: string;
  findingId: string;
  level: string;
  type: string;
  typeLabel: string;
  label: string;
  className: string;
  confidence: number | null;
  classProbabilities: Record<string, number> | null;
  deploymentStatus: string;
  section: "principal" | "experimental" | "investigacion";
  positive: boolean;
  evaluationDataset: string;
  externalValidation: boolean;
  modalities: string[];
  text: string;
  defaultInclude: boolean;
  sources: PreReportFindingSource[];
  /** Decisión del profesional en el visor (se agrega en el cliente; no viene del servidor). */
  decision?: "aceptado" | "rechazado" | "dudoso";
};

export type PreReportAnnotation = {
  key: string;
  kind: string;
  scope: string;
  plane: string | null;
  seriesId: string | null;
  sliceIndex: number | null;
  level: string | null;
  text: string;
  author: string;
  value: number | null;
  unit: string | null;
};

export type PreReportLevel = {
  level: string;
  lumbar: boolean;
  evaluated: boolean;
  measurementKeys: string[];
  findingKeys: string[];
  defaultCard: boolean;
};

export type PreReportSeries = {
  inputId: string;
  plane: string;
  sequence: string | null;
  sequenceSource: string | null;
  sliceCount: number | null;
  analyzed: boolean;
  description: string | null;
  label: string;
};

export type PreReportGenerated = {
  schema: string;
  study: {
    caseId: string;
    subjectRef: string | null;
    studyDate: string | null;
    modality: string | null;
    clinical: {
      ageAtStudy: number | null;
      ageProvenance: string | null;
      reason: string | null;
      symptoms: string | null;
      symptomDuration: string | null;
      relevantHistory: string | null;
    };
  };
  run: { runId: string; status: string; modelKey: string; inferenceMode: string; reviewStatus: string };
  measurements: PreReportMeasurement[];
  findings: PreReportFinding[];
  findingsStatus: "available" | "none" | "invalid";
  findingsStatusReason?: string;
  annotations: PreReportAnnotation[];
  levels: PreReportLevel[];
  series: PreReportSeries[];
  coverage: {
    measurementsTotal: number;
    measurementsUsable: number;
    measurementsWithTrace: number;
    measurementsCorrected: number;
    findingsTotal: number;
    findingsPositiveMain: number;
    findingsRejected: number;
  };
  omitted: { kind: string; what: string; reason: string }[];
  limitations: string[];
};

/** Parámetros con que se compuso cada imagen, para poder reproducirla. */
export type RenderParams = {
  imagePath: string;
  imageSize: [number, number];
  fullCrop: { x: number; y: number; w: number; h: number };
  zoomCrop: { x: number; y: number; w: number; h: number };
  outputWidth: { full: number; zoom: number };
  overlays: { kind: "trace" | "region"; ref: string }[];
};

export type PreReportEdits = {
  include?: Record<string, boolean>;
  text?: Record<string, string>;
  levelNotes?: Record<string, string>;
  observations?: string;
  renderParams?: Record<string, RenderParams>;
};

export type PreReportDraft = {
  id: string;
  version: number;
  sourceFingerprint: string;
  generated: PreReportGenerated;
  edits: PreReportEdits;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type PreReportChange = {
  kind: "added" | "removed" | "changed";
  section: string;
  key: string;
  label: string;
  before: string | null;
  after: string | null;
};

export type PreReportView = {
  generated: PreReportGenerated;
  fingerprint: string;
  generatedAt: string;
  usable: boolean;
  draft: PreReportDraft | null;
  stale: boolean;
  changes: PreReportChange[];
  orphanedEdits: string[];
};
