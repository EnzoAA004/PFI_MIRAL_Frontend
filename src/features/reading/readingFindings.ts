import { ALWAYS_SHOWN_LEVELS, SPINE_LEVELS, normalizeLevel, type SpineLevel } from "../../clinicalDisplay";

/**
 * Agrupa los hallazgos por nivel vertebral — el eje sobre el que un radiólogo realmente lee e
 * informa una RM lumbar, craneocaudal y alternando cuerpo con espacio discal.
 *
 * Los diez niveles lumbares siempre se renderizan, con o sin hallazgo: "nada en
 * L3-L4" es una afirmación clínica, y un nivel que falta en silencio en el panel es
 * indistinguible de un nivel que nunca se miró. Los niveles fuera de ese rango
 * aparecen solo cuando el estudio llega hasta ellos, que es la misma regla leída del otro
 * lado: una fila T9-T10 siempre presente y vacía afirmaría que se examinó un nivel que
 * nunca estuvo en el campo de visión.
 *
 * Un hallazgo sin nivel cae en uno de dos lugares, y esa distinción es
 * el punto: el área del canal describe el estudio entero porque su máscara recorre el largo
 * de la columna, mientras que una medición cuyo nivel la IA no pudo determinar es una brecha.
 * Archivar ambas bajo "sin nivel asignado" acusaba al modelo de una falla que no
 * tuvo. Ninguna se reparte nunca entre niveles por conjetura.
 */

export type LevelFinding = {
  id: string;
  label: string;
  value: number | string | null | undefined;
  unit?: string;
  confidence?: number;
  outlier?: boolean;
};

export type LevelGroupKind = "level" | "study" | "unassigned";

export type LevelGroup = {
  /** Nivel canónico, o null para los grupos que no son un nivel. */
  level: SpineLevel | null;
  kind: LevelGroupKind;
  /** Identidad estable para la selección — dos grupos pueden compartir un nivel null. */
  key: string;
  label: string;
  findings: LevelFinding[];
};

export type LevelledInput = {
  id: string;
  label: string;
  level?: string | null;
  /** "study" cuando la medición no describe un nivel. Por defecto "level". */
  levelScope?: string | null;
  value?: number | string | null;
  unit?: string;
  confidence?: number;
  outlier?: boolean;
};

const GENERAL_KEY = "__general__";
const UNASSIGNED_KEY = "__unassigned__";

/**
 * Recupera el nivel a partir de un id de medición, para corridas persistidas antes de que el backend
 * dejara de descartar los niveles fuera de L1-L2…L5-S1.
 *
 * Esto relee lo que escribió el módulo de IA en lugar de inferir nada: el id se
 * arma con el nivel que asignó (`sagittal-disc-t11-t12-width`), y un disco que no
 * pudo nombrar recibe un slug posicional (`sagittal-disc-d1-width`) que ningún nivel
 * coincide. Así que un nivel solo vuelve cuando había uno desde el principio.
 *
 * Sin esto, un estudio cuya leyenda dice "Disco T11-T12" listaba ese mismo disco
 * bajo "sin nivel asignado" dos paneles más a la derecha.
 */
export function levelFromMeasurementId(id: string): SpineLevel | null {
  const parts = id.split("-");
  // El ultimo segmento es la magnitud (area/width/height); antes viene el nivel, que
  // puede ocupar uno o dos segmentos segun sea un cuerpo ("l4") o un espacio ("l4-l5").
  for (const candidate of [parts.slice(-3, -1).join("-"), parts.slice(-2, -1).join("-")]) {
    const level = normalizeLevel(candidate);
    if (level) return level;
  }
  return null;
}

export function groupFindingsByLevel(items: LevelledInput[]): LevelGroup[] {
  const byLevel = new Map<string, LevelFinding[]>();
  for (const level of SPINE_LEVELS) byLevel.set(level, []);
  byLevel.set(GENERAL_KEY, []);
  byLevel.set(UNASSIGNED_KEY, []);

  for (const item of items) {
    const level = normalizeLevel(item.level) ?? levelFromMeasurementId(item.id);
    const fallback = item.levelScope === "study" ? GENERAL_KEY : UNASSIGNED_KEY;
    const bucket = byLevel.get(level ?? fallback) ?? byLevel.get(UNASSIGNED_KEY)!;
    bucket.push({
      id: item.id,
      label: item.label,
      value: item.value,
      unit: item.unit,
      confidence: item.confidence,
      outlier: item.outlier,
    });
  }

  const groups: LevelGroup[] = SPINE_LEVELS.filter(
    (level) => ALWAYS_SHOWN_LEVELS.includes(level) || (byLevel.get(level) ?? []).length,
  ).map((level) => ({
    level,
    kind: "level" as const,
    key: level,
    label: level,
    findings: byLevel.get(level) ?? [],
  }));

  const general = byLevel.get(GENERAL_KEY) ?? [];
  if (general.length) {
    groups.push({ level: null, kind: "study", key: GENERAL_KEY, label: "Medición general", findings: general });
  }
  const unassigned = byLevel.get(UNASSIGNED_KEY) ?? [];
  if (unassigned.length) {
    groups.push({ level: null, kind: "unassigned", key: UNASSIGNED_KEY, label: "Sin nivel asignado", findings: unassigned });
  }
  return groups;
}

/** True cuando ningún hallazgo llegó a un nivel — maneja el aviso del panel. */
export function allFindingsUnassigned(groups: LevelGroup[]) {
  const assigned = groups.filter((g) => g.kind === "level").reduce((total, g) => total + g.findings.length, 0);
  const unassigned = groups.find((g) => g.kind === "unassigned")?.findings.length ?? 0;
  return assigned === 0 && unassigned > 0;
}
