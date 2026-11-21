import type {
  ComparisonStudySide,
  ComparisonTrend,
  InitialComparisonExclusion,
  InitialComparisonRow,
  PatientLink,
} from "../../contracts/initialAnalysisComparisonTypes";

/**
 * Presentación pura de la comparación entre estudios (análisis inicial). Nada de acá calcula una
 * diferencia ni un porcentaje: el Backend entrega todo con precisión completa y este módulo solo redondea
 * lo que se MUESTRA. "Aumentó"/"Disminuyó" describe el valor numérico, nunca una mejoría o un empeoramiento.
 */

export const COMPARISON_SOURCE_LINE =
  "Fuente: el análisis inicial real de cada estudio, el mismo que muestran Mediciones y Hallazgos IA. No usa el análisis de demostración.";

export const DIFFERENCE_NOTE =
  "Diferencia = estudio abierto − referencia. «Aumentó» y «Disminuyó» describen el valor; no indican mejoría ni empeoramiento clínico.";

const UNIT_LABELS: Record<string, string> = { mm: "mm", mm2: "mm²", deg: "°" };

export function displayUnit(unit: string): string {
  return UNIT_LABELS[unit] ?? unit;
}

const METRIC_LABELS: Record<string, string> = {
  "disc/height": "Altura discal",
  "disc/width": "Ancho discal",
  "disc/area": "Área discal",
  "vertebra/height": "Altura del cuerpo vertebral",
  "vertebra/width": "Ancho del cuerpo vertebral",
  "vertebra/area": "Área del cuerpo vertebral",
  "canal/ap_diameter": "Diámetro AP del canal",
  "disc/segmental_angle": "Ángulo segmentario",
};

export function displayMetricName(structure: string, metric: string): string {
  return METRIC_LABELS[`${structure}/${metric}`] ?? `${structure} ${metric}`;
}

/** Redondeo solo de presentación (2 decimales); el valor que llega del Backend no se toca. */
export function formatValue(value: number): string {
  return value.toFixed(2);
}

function signed(value: number, digits: number): string {
  const rounded = Number(value.toFixed(digits));
  // Un valor que redondea a cero se muestra sin signo para no sugerir un cambio que no se ve.
  if (rounded === 0) return (0).toFixed(digits);
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(digits)}`;
}

export function formatDelta(deltaAbsolute: number): string {
  return signed(deltaAbsolute, 2);
}

/** 1 decimal; «No calculable» cuando la referencia vale cero. */
export function formatPercent(row: Pick<InitialComparisonRow, "deltaPercent" | "percentStatus">): string {
  if (row.percentStatus !== "ok" || row.deltaPercent === null) return "No calculable";
  return `${signed(row.deltaPercent, 1)} %`;
}

const TREND_TEXT: Record<ComparisonTrend, string> = {
  increased: "Aumentó",
  decreased: "Disminuyó",
  unchanged: "Sin cambio",
};
const TREND_ARROW: Record<ComparisonTrend, string> = { increased: "↑", decreased: "↓", unchanged: "" };

export function trendText(trend: ComparisonTrend): string {
  return TREND_TEXT[trend];
}

export function trendArrow(trend: ComparisonTrend): string {
  return TREND_ARROW[trend];
}

/** Agrupa las filas por nivel conservando el orden anatómico que entrega el Backend. */
export function groupRowsByLevel(rows: readonly InitialComparisonRow[]): { level: string; rows: InitialComparisonRow[] }[] {
  const groups: { level: string; rows: InitialComparisonRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.level === row.level) last.rows.push(row);
    else groups.push({ level: row.level, rows: [row] });
  }
  return groups;
}

/** Fecha dd/mm/aaaa a partir de un ISO, sin construir un Date (sin corrimiento de zona horaria). */
export function formatStudyDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "Fecha no informada";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : isoDate;
}

export function formatRunMoment(iso: string | null | undefined): string {
  if (!iso) return "fecha no informada";
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : iso;
}

/** Identificador corto de la corrida, suficiente para reconocerla y nunca el único dato: va con su fecha. */
export function shortRunId(runId: string | null | undefined): string {
  if (!runId) return "sin análisis";
  return runId.length > 14 ? `${runId.slice(0, 6)}…${runId.slice(-6)}` : runId;
}

export function describeSide(side: ComparisonStudySide): string {
  return `${side.caseId} · ${formatStudyDate(side.studyDate)}`;
}

export function describeAnalysis(side: ComparisonStudySide): string {
  if (!side.runId) return "Sin análisis inicial";
  return `análisis ${shortRunId(side.runId)} del ${formatRunMoment(side.runCreatedAt)}`;
}

const PATIENT_LINK_TEXT: Record<PatientLink, string> = {
  patient_id: "Mismo paciente (identificador de paciente).",
  subject_ref_historical: "Mismo paciente por referencia del estudio (asociación histórica, sin identificador de paciente en uno de los dos).",
  none: "",
};

export function patientLinkText(link: PatientLink): string {
  return PATIENT_LINK_TEXT[link];
}

const SIDE_TEXT: Record<InitialComparisonExclusion["side"], string> = {
  current: "Estudio abierto",
  reference: "Referencia",
  both: "Ambos estudios",
};

export function exclusionSideText(side: InitialComparisonExclusion["side"]): string {
  return SIDE_TEXT[side];
}

export type ExclusionGroup = { reasonCode: string; title: string; items: InitialComparisonExclusion[] };

const REASON_TITLES: Record<string, string> = {
  missing_in_other: "Sin equivalente en el otro estudio",
  ambiguous_duplicate: "Correspondencia ambigua (mediciones duplicadas)",
  unit_mismatch: "Unidades incompatibles",
  method_mismatch: "Método, modelo o secuencia distintos",
  no_level: "Sin nivel anatómico",
  axial_unmapped: "Plano axial sin estructura asignada",
  no_equivalent_definition: "Sin definición equivalente demostrada",
  invalid_value: "Valor ausente o ilegible",
  pixel_space: "Medida en píxeles",
  unsupported_basis: "Base de medición no reconocida",
  unit_unexpected: "Unidad inesperada",
};

export function exclusionReasonTitle(code: string): string {
  return REASON_TITLES[code] ?? code;
}

/** Las exclusiones agrupadas por motivo, para leer pocas categorías en vez de decenas de renglones. */
export function groupExclusions(excluded: readonly InitialComparisonExclusion[]): ExclusionGroup[] {
  const groups = new Map<string, ExclusionGroup>();
  for (const item of excluded) {
    const group = groups.get(item.reasonCode) ?? { reasonCode: item.reasonCode, title: exclusionReasonTitle(item.reasonCode), items: [] };
    group.items.push(item);
    groups.set(item.reasonCode, group);
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
}

export const EMPTY_TEXT = {
  current_without_measurements: {
    title: "Este estudio no tiene mediciones utilizables.",
    detail: "Su análisis inicial más reciente no trae mediciones que se puedan comparar. No hace falta ejecutar otro análisis si ya existen datos: se compara lo que está guardado.",
  },
  no_other_studies: {
    title: "Este paciente no tiene otros estudios.",
    detail: "La comparación necesita al menos otro estudio del mismo paciente.",
  },
  no_usable_candidates: {
    title: "Los otros estudios del paciente no tienen mediciones utilizables.",
    detail: "Existen otros estudios, pero su análisis inicial más reciente no trae mediciones que se puedan comparar.",
  },
  no_comparable_matches: {
    title: "No hay coincidencias comparables entre estos estudios.",
    detail: "Ambos tienen mediciones, pero ninguna pudo emparejarse con certeza. El detalle de lo excluido explica cada motivo.",
  },
} as const;
