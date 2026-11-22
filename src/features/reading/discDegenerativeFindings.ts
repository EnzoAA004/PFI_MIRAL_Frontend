/** Contrato de presentación pública de los hallazgos degenerativos de disco P10.7. */

export const DISC_FINDING_TYPES = [
  "disc_bulging",
  "disc_narrowing",
  "upper_endplate_change",
  "lower_endplate_change",
  "pfirrmann_grade",
  "modic_change",
  "disc_herniation",
  "spondylolisthesis",
] as const;
export type DiscFindingType = typeof DISC_FINDING_TYPES[number];

export const DISC_LEVELS = ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"] as const;
export type DiscLevel = typeof DISC_LEVELS[number];

export const DEPLOYMENT_STATUSES = ["supported_internal", "experimental", "not_product_supported"] as const;
export type DeploymentStatus = typeof DEPLOYMENT_STATUSES[number];

const PFIRRMANN_LABELS = ["I", "II", "III", "IV", "V"] as const;
const MODIC_LABELS = ["none", "I", "II", "III"] as const;
const BINARY_LABELS = ["absent", "present"] as const;

export function labelsFor(findingType: DiscFindingType): readonly string[] {
  if (findingType === "pfirrmann_grade") return PFIRRMANN_LABELS;
  if (findingType === "modic_change") return MODIC_LABELS;
  return BINARY_LABELS;
}

export const SCHEMA_VERSION = "pfi.disc-degenerative-findings.v1";

export const DISC_SERIES_ROLES = ["sagittal_t1", "sagittal_t2"] as const;
export type DiscSeriesRole = typeof DISC_SERIES_ROLES[number];

/**
 * Dónde se evaluó un nivel en una serie: el corte central, la ventana que entró al
 * modelo y el punto que se puede marcar sobre la imagen.
 *
 * `point` y `bbox` vienen en píxeles nativos de esa serie, con su espacio de
 * coordenadas al lado. Traducirlos a la base del visor sin ese espacio los pondría
 * en cualquier lado: una serie de 320x320 y una de 512x512 no comparten escala.
 *
 * No es la extensión del hallazgo. El clasificador no segmenta lesión: la ventana
 * sale de la máscara del disco, así que esto dice sobre qué se clasificó, no dónde
 * está la patología.
 */
export type DiscEvaluatedRegion = {
  /** Serie en la que caen estas coordenadas. El corte solo vale dentro de ella. */
  inputId: string;
  sliceIndex: number;
  point: { x: number; y: number };
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** Alto y ancho nativos de la serie, en píxeles. */
  height: number;
  width: number;
};

export type DiscFindingSource = {
  role: DiscSeriesRole;
  available: boolean;
  /** Los cortes que el modelo miró: la ventana 2.5D, nunca la serie entera. */
  positions: number[];
  region: DiscEvaluatedRegion | null;
};

export type DiscFinding = {
  findingId: string;
  findingType: DiscFindingType;
  level: DiscLevel;
  label: string;
  /** Probabilidad de la etiqueta reportada, 0..1. Ausente si la corrida no la informa. */
  confidence?: number;
  deploymentStatus: DeploymentStatus;
  evaluationDataset: string;
  externalValidationAvailable: boolean;
  researchOnly: true;
  localizationValidated: false;
  modelId: string;
  modelSha256: string;
  reviewRequired: true;
  reviewStatus: "pending";
  /** Una entrada por modalidad, con su propia localización: T1 y T2 no la comparten. */
  sources: DiscFindingSource[];
};

export class DiscDegenerativeContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscDegenerativeContractError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * La región evaluada de una serie, o `null` si esa serie no publica ninguna.
 *
 * Todo o nada, igual que el resto del contrato: con media geometría no se puede
 * dibujar nada, y una marca puesta con la mitad de los datos cae en un lugar
 * arbitrario del corte. Ante un dato incompleto devuelve `undefined`, que el
 * llamador convierte en finding inválido en vez de en una marca aproximada.
 */
function parseEvaluatedRegion(
  raw: Record<string, unknown>,
  positions: number[],
): DiscEvaluatedRegion | null | undefined {
  const keys = ["inputId", "sliceIndex", "pointYx", "bboxYx", "coordinateSpaceHeight", "coordinateSpaceWidth"];
  const present = keys.filter((key) => Object.prototype.hasOwnProperty.call(raw, key));
  if (present.length === 0) return null;
  if (present.length !== keys.length) return undefined;

  const inputId = text(raw.inputId);
  const height = finiteNumber(raw.coordinateSpaceHeight);
  const width = finiteNumber(raw.coordinateSpaceWidth);
  const sliceIndex = finiteNumber(raw.sliceIndex);
  if (!inputId || height === null || width === null || height <= 0 || width <= 0) return undefined;
  if (sliceIndex === null || !Number.isInteger(sliceIndex) || sliceIndex < 0) return undefined;
  // El centro tiene que ser uno de los cortes analizados: si no lo es, geometría y
  // predicción no vienen de la misma preparación.
  if (positions.length > 0 && !positions.includes(sliceIndex)) return undefined;

  const pointRaw = Array.isArray(raw.pointYx) ? raw.pointYx.map(finiteNumber) : [];
  const bboxRaw = Array.isArray(raw.bboxYx) ? raw.bboxYx.map(finiteNumber) : [];
  if (pointRaw.length !== 2 || pointRaw.some((value) => value === null)) return undefined;
  if (bboxRaw.length !== 4 || bboxRaw.some((value) => value === null)) return undefined;

  const [pointY, pointX] = pointRaw as number[];
  const [y0, y1, x0, x1] = bboxRaw as number[];
  if (y1 <= y0 || x1 <= x0) return undefined;
  if (y0 < 0 || x0 < 0 || y1 > height || x1 > width) return undefined;
  if (pointY < y0 || pointY > y1 || pointX < x0 || pointX > x1) return undefined;

  return {
    inputId,
    sliceIndex,
    point: { x: pointX, y: pointY },
    bbox: { x0, y0, x1, y1 },
    height,
    width,
  };
}

/**
 * Las series de origen, cuando el emisor las declara.
 *
 * Ausentes no invalidan el finding: una corrida vieja las omitía y su clasificación
 * sigue siendo la que el médico revisó. Lo que se pierde es la marca, no el
 * hallazgo. Declaradas y rotas sí invalidan: ahí hay un emisor que cree estar
 * localizando algo.
 */
function parseSources(value: unknown): DiscFindingSource[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length === 0) return null;
  const sources: DiscFindingSource[] = [];
  for (const entry of value) {
    const raw = asRecord(entry);
    const role = text(raw?.role) as DiscSeriesRole;
    if (!raw || !DISC_SERIES_ROLES.includes(role) || typeof raw.available !== "boolean") return null;
    const positionsRaw = Array.isArray(raw.positions) ? raw.positions : [];
    if (positionsRaw.some((item) => typeof item !== "number" || !Number.isInteger(item) || item < 0)) return null;
    const positions = positionsRaw as number[];
    const region = parseEvaluatedRegion(raw, positions);
    if (region === undefined) return null;
    // Una modalidad que no entró al modelo no localiza nada.
    if (region && !raw.available) return null;
    sources.push({ role, available: raw.available, positions, region });
  }
  return sources.some((source) => source.available) ? sources : null;
}

/** Cortes que el modelo miró de una serie, ordenados, para mostrarlos como rango. */
export function analysedSliceRange(source: DiscFindingSource): string {
  const positions = [...source.positions].sort((a, b) => a - b);
  if (!positions.length) return "";
  const first = positions[0];
  const last = positions[positions.length - 1];
  return first === last ? `corte ${first}` : `cortes ${first}-${last}`;
}

/**
 * Parsea un hallazgo de la proyección pública del Backend. El vector de probabilidades
 * no forma parte de ese contrato: su presencia invalida el ítem en lugar de dejar que
 * el panel reconstruya un puntaje o lea la segunda clase como una segunda opinión.
 * La confianza de la etiqueta informada sí viaja, ya reducida por el Backend.
 */
export function parseDiscFinding(value: unknown): DiscFinding | null {
  const raw = asRecord(value);
  if (!raw) return null;

  const findingId = text(raw.findingId);
  const findingType = text(raw.findingType) as DiscFindingType;
  if (!findingId || !DISC_FINDING_TYPES.includes(findingType)) return null;

  const anatomy = asRecord(raw.anatomy);
  const level = text(anatomy?.level) as DiscLevel;
  if (!DISC_LEVELS.includes(level)) return null;

  const classification = asRecord(raw.classification);
  const label = text(classification?.label);
  if (!classification || !labelsFor(findingType).includes(label)) return null;
  const expectedKind = findingType === "pfirrmann_grade" || findingType === "modic_change"
    ? "categorical"
    : "binary";
  if (classification.kind !== expectedKind) return null;
  /*
   * La distribución completa sigue sin poder llegar: su presencia invalida el
   * hallazgo. Lo que sí viaja es `confidence`, la probabilidad de la etiqueta que
   * el modelo reporta —el backend la deriva en su proyección pública—, porque un
   * hallazgo categórico sin idea de cuán seguro está el modelo no se puede pesar
   * contra la imagen. Fuera de [0,1] no se muestra en vez de recortarse: un valor
   * así significa que el productor cambió de escala, no que la confianza sea 1.
   */
  if (Object.prototype.hasOwnProperty.call(classification, "probabilities")) return null;
  const rawConfidence = classification.confidence;
  const confidence = typeof rawConfidence === "number"
    && Number.isFinite(rawConfidence)
    && rawConfidence >= 0
    && rawConfidence <= 1
    ? rawConfidence
    : undefined;

  const evidence = asRecord(raw.evidence);
  const deploymentStatus = text(evidence?.deploymentStatus) as DeploymentStatus;
  if (!evidence
    || !DEPLOYMENT_STATUSES.includes(deploymentStatus)
    || typeof evidence.externalValidationAvailable !== "boolean") return null;

  const localization = asRecord(raw.localization);
  if (!localization
    || localization.source !== "segmentation_derived_disc_level"
    || localization.researchOnly !== true
    || localization.automaticAnatomicalLocalizationValidated !== false) return null;

  const model = asRecord(raw.model);
  const modelId = text(model?.modelId);
  const modelSha256 = text(model?.modelSha256);
  if (!modelId || !/^[a-f0-9]{64}$/i.test(modelSha256)) return null;

  const review = asRecord(raw.review);
  if (!review || review.required !== true || review.status !== "pending" || raw.notClinicalDiagnosis !== true) return null;

  const sources = parseSources(raw.sourceSeries);
  if (!sources) return null;

  return {
    findingId,
    findingType,
    level,
    label,
    confidence,
    deploymentStatus,
    evaluationDataset: text(evidence.evaluationDataset),
    externalValidationAvailable: evidence.externalValidationAvailable,
    researchOnly: true,
    localizationValidated: false,
    modelId,
    modelSha256,
    reviewRequired: true,
    reviewStatus: "pending",
    sources,
  };
}

/**
 * La región, llevada a la base 0..256 en la que dibuja el visor.
 *
 * Es el inverso exacto de `viewerPointToImagePixels`: la base cubre el corte entero,
 * así que la escala sale del propio espacio de coordenadas de la serie. Sin él, un
 * punto de una serie de 512 px dibujado sobre una de 320 se corre casi un centímetro.
 */
export function regionToViewerBase(region: DiscEvaluatedRegion) {
  const baseX = (value: number) => value / region.width * 256;
  const baseY = (value: number) => value / region.height * 256;
  return {
    point: { x: baseX(region.point.x), y: baseY(region.point.y) },
    box: {
      x0: baseX(region.bbox.x0),
      y0: baseY(region.bbox.y0),
      x1: baseX(region.bbox.x1),
      y1: baseY(region.bbox.y1),
    },
  };
}

/**
 * La serie en la que conviene mostrar este nivel.
 *
 * Se prefiere la que el visor ya está mostrando: mover el stack es menos invasivo
 * que cambiarle la serie al médico. Si esa no evaluó el nivel, T2 antes que T1
 * —es la secuencia en la que se lee un disco— y solo entonces se cambia de serie.
 */
export function preferredRegion(
  finding: DiscFinding,
  viewedInputId?: string | null,
): { role: DiscSeriesRole; region: DiscEvaluatedRegion } | null {
  const located = finding.sources.flatMap((source) => (source.region ? [{ role: source.role, region: source.region }] : []));
  if (!located.length) return null;
  const viewed = viewedInputId ? located.find((item) => item.region.inputId === viewedInputId) : undefined;
  return viewed ?? located.find((item) => item.role === "sagittal_t2") ?? located[0];
}

/** El parseo todo-o-nada evita que un ítem roto se convierta en un resultado clínico parcial. */
export function parseDiscDegenerativeFindings(value: unknown): DiscFinding[] {
  const raw = asRecord(value);
  if (!raw || text(raw.schemaVersion) !== SCHEMA_VERSION) {
    throw new DiscDegenerativeContractError("Contrato P10.7 inválido: schemaVersion inesperado.");
  }
  if (!Array.isArray(raw.findings) || raw.findings.length === 0) {
    throw new DiscDegenerativeContractError("Contrato P10.7 inválido: findings ausente o vacío.");
  }
  const findings = raw.findings.map(parseDiscFinding);
  if (findings.some((finding) => finding === null)) {
    throw new DiscDegenerativeContractError("Contrato P10.7 inválido: contiene findings incompletos.");
  }
  return findings as DiscFinding[];
}

function requireSafetyFlags(raw: Record<string, unknown>, context: string) {
  if (raw.humanReviewRequired !== true
    || raw.notClinicalDiagnosis !== true
    || raw.autonomousDiagnosis !== false) {
    throw new DiscDegenerativeContractError(`${context}: faltan flags de seguridad obligatorios.`);
  }
}

/** Respuesta POST en vivo, incluida la confirmación de que el snapshot inmutable se persistió. */
export function parseDiscDegenerativeFindingsResponse(value: unknown, multiplanarRunId: string): DiscFinding[] {
  const raw = asRecord(value);
  if (!raw) throw new DiscDegenerativeContractError("Contrato P10.7 inválido: respuesta vacía.");
  requireSafetyFlags(raw, "Contrato P10.7 inválido");
  const persistence = asRecord(raw.persistence);
  if (!persistence
    || persistence.status !== "persisted_immutable"
    || persistence.multiplanarRunId !== multiplanarRunId
    || persistence.reviewStoredSeparately !== true) {
    throw new DiscDegenerativeContractError("Contrato P10.7 inválido: persistencia no confirmada.");
  }
  return parseDiscDegenerativeFindings(raw.discDegenerativeFindings);
}

/** Proyección durable devuelta en el metricsSnapshot de una corrida persistida. */
export function parsePersistedDiscDegenerativeFindings(value: unknown): DiscFinding[] {
  const snapshot = asRecord(value);
  if (!snapshot) throw new DiscDegenerativeContractError("Snapshot P10.7 inválido.");
  const governance = asRecord(snapshot.discDegenerativeGovernance);
  if (!governance) throw new DiscDegenerativeContractError("Snapshot P10.7 sin governance.");
  requireSafetyFlags(governance, "Snapshot P10.7 inválido");
  if (governance.predictionImmutable !== true || governance.reviewStoredSeparately !== true) {
    throw new DiscDegenerativeContractError("Snapshot P10.7 no separa predicción y revisión.");
  }
  return parseDiscDegenerativeFindings(snapshot.discDegenerativeFindings);
}

export function sortDiscFindings(findings: DiscFinding[]): DiscFinding[] {
  return [...findings].sort((a, b) => {
    const byLevel = DISC_LEVELS.indexOf(a.level) - DISC_LEVELS.indexOf(b.level);
    if (byLevel !== 0) return byLevel;
    return DISC_FINDING_TYPES.indexOf(a.findingType) - DISC_FINDING_TYPES.indexOf(b.findingType);
  });
}

export function groupDiscFindingsByLevel(findings: DiscFinding[]): { level: DiscLevel; findings: DiscFinding[] }[] {
  const byLevel = new Map<DiscLevel, DiscFinding[]>();
  for (const finding of sortDiscFindings(findings)) {
    const bucket = byLevel.get(finding.level);
    if (bucket) bucket.push(finding);
    else byLevel.set(finding.level, [finding]);
  }
  return DISC_LEVELS
    .filter((level) => byLevel.has(level))
    .map((level) => ({ level, findings: byLevel.get(level) as DiscFinding[] }));
}
