import type { StudyMask } from "../../appTypes";

/**
 * Máscaras (clase, etiqueta, color y contorno) de un plano de una corrida persistida.
 *
 * Viven en el plano canónico, no en el nivel legacy de `run`. Es la única lectura: el visor individual y cada lado del visor de
 * comparación la usan, así la leyenda de segmentación corresponde a lo que cada corrida realmente publicó. No se deduce nada por
 * el color ni se completan etiquetas: lo que la corrida no declara queda sin declarar.
 */
function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" ? value as Record<string, any> : undefined;
}

export function canonicalMasksForPlane(canonicalRun: unknown, plane: "sagittal" | "axial"): StudyMask[] {
  const canonicalPlane = asRecord(asRecord(asRecord(canonicalRun)?.planes)?.[plane]);
  const value = canonicalPlane?.masks;
  if (!Array.isArray(value)) return [];
  // El plano canónico identifica la clase con `classKey`, no con `label` ni `className`, que es lo que busca el view model.
  return value.flatMap((raw) => {
    const mask = asRecord(raw);
    const classKey = typeof mask?.classKey === "string" ? mask.classKey : undefined;
    if (!mask || !classKey) return [];
    // El contorno viaja en `geometry.points`, en la base del coordinateSpace.
    const geometry = asRecord(mask.geometry);
    const rawPoints = Array.isArray(geometry?.points) ? geometry.points : [];
    const points = rawPoints.flatMap((entry) => {
      const point = asRecord(entry);
      return typeof point?.x === "number" && typeof point?.y === "number" ? [{ x: point.x, y: point.y }] : [];
    });
    return [{
      id: String(mask.id ?? classKey),
      label: classKey,
      className: classKey,
      color: typeof mask.color === "string" ? mask.color : "",
      level: typeof mask.level === "string" ? mask.level : undefined,
      confidence: typeof mask.confidence === "number" ? mask.confidence : undefined,
      enabled: mask.enabled !== false,
      contours: points.length >= 3
        ? [{ seriesId: String(mask.id ?? classKey), sliceIndex: Number(geometry?.sliceIndex ?? 0), points }]
        : undefined,
    } satisfies StudyMask];
  });
}
