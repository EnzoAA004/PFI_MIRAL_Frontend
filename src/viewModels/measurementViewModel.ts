import type { Measurement, Plane } from "../appTypes";
import type { CanonicalMeasurement } from "../contracts/canonicalMultiplanarRun";

/**
 * CanonicalMeasurement -> Measurement (view model visual). labelKey es la identidad
 * estable y sin traducir de la medición; `label` la replica
 * sin cambios (acá no ocurre ninguna traducción al español — eso pertenece exclusivamente
 * a clinicalDisplay.ts / displayMeasurementLabel() al renderizar).
 */
export function canonicalMeasurementToViewMeasurement(measurement: CanonicalMeasurement, plane: Plane, index: number): Measurement {
  const id = measurement.id || `${plane}-measurement-${index}`;
  const labelKey = measurement.labelKey || undefined;
  return {
    id,
    label: labelKey ?? `Medición ${index + 1}`,
    labelKey,
    level: measurement.level ?? undefined,
    value: measurement.value ?? "",
    aiValue: measurement.value ?? "",
    reviewerValue: measurement.reviewerValue ?? undefined,
    unit: measurement.unit ?? "",
    confidence: measurement.confidence,
    plane,
    source: "AI",
    status: "pendiente",
    outlier: false,
    placeholder: Boolean(measurement.placeholder),
  };
}
