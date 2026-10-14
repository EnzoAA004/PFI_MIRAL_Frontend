import type { AiRunResponse, StudyArchiveSeries, StudySeries } from "../../appTypes";
import { UNKNOWN_SEQUENCE, parseSequenceInfo, type SequenceInfo } from "./sequenceInfo";
import type { PersistedPlaneWorkspace } from "../../appDataGuards";

/*
 * La serie de un plano tal como la publica la corrida persistida: cuántos cortes
 * tiene, cuál analizó la IA, de qué serie del estudio salió y cómo se llega a las
 * imágenes. La usan el visor individual y el visor de comparación, así que las dos
 * pantallas leen la misma corrida de la misma manera.
 */
function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" ? value as Record<string, any> : undefined;
}

export function planeRunRecord(run: AiRunResponse, plane: "sagittal" | "axial") {
  const planes = asRecord(run.planes);
  return asRecord(planes?.[plane]);
}

export type PersistedStudySeries = StudySeries & { sourceInputId?: string };

/**
 * Secuencia (y su procedencia) del plano que analizó la corrida: la que la corrida publicó en `input.sequence`.
 * Una corrida anterior, que no la publicó, cae al catálogo del estudio si lo conoce (ponderación detectada de un
 * zip DICOM) y si no queda desconocida. Nunca se completa con T2 ni sale del nombre del archivo.
 */
export function sequenceOfAnalyzedPlane(run: AiRunResponse, plane: "sagittal" | "axial", archiveSeries: StudyArchiveSeries[]): SequenceInfo {
  const planeRun = planeRunRecord(run, plane);
  const canonical = asRecord(asRecord(run.canonicalRun?.planes)?.[plane]);
  const input = { ...asRecord(canonical?.input), ...asRecord(planeRun?.input) };
  if (input.sequence && typeof input.sequence === "object") return parseSequenceInfo(input.sequence);
  const inputId = typeof input.inputId === "string" ? input.inputId.trim() : "";
  return (inputId ? archiveSeries.find((item) => item.inputId === inputId)?.sequence : undefined) ?? UNKNOWN_SEQUENCE;
}

export function seriesFromPlaneRun(run: AiRunResponse, workspace: PersistedPlaneWorkspace): PersistedStudySeries | null {
  const planeRun = planeRunRecord(run, workspace.plane);
  // El contrato v1 publica la metadata volumétrica bajo `metadata` y v2 bajo
  // `input`; también se consulta el plano canónico persistido, que es de donde
  // viene la corrida reabierta.
  const canonicalPlane = asRecord(asRecord(run.canonicalRun?.planes)?.[workspace.plane]);
  const metadata = { ...asRecord(canonicalPlane?.input), ...asRecord(canonicalPlane?.metadata), ...asRecord(planeRun?.input), ...asRecord(planeRun?.metadata) };
  const rawSliceCount = metadata.sliceCount;
  const rawSelectedSlice = metadata.selectedSlice ?? metadata.selectedSliceIndex;
  const sourceInputId = typeof metadata.inputId === "string" && metadata.inputId.trim() ? metadata.inputId.trim() : undefined;
  const sliceCount = typeof rawSliceCount === "number" && rawSliceCount > 0 ? rawSliceCount : 1;
  const selectedSlice = typeof rawSelectedSlice === "number" && rawSelectedSlice >= 0 ? rawSelectedSlice : 0;
  // Cantidad de previsualizaciones por corte que el AI Module realmente escribió.
  // Es lo que distingue "este corte todavía no tiene imagen" de "este corte tiene
  // imagen": sin el número habría que pedir el PNG y tratar el 404 como respuesta.
  const quality = { ...asRecord(canonicalPlane?.quality), ...asRecord(planeRun?.quality) };
  const rawSpacing = metadata.inPlaneSpacingMm ?? metadata.inPlaneSpacing;
  const inPlaneSpacingMm = Array.isArray(rawSpacing) && rawSpacing.every((value) => typeof value === "number")
    ? rawSpacing as number[]
    : undefined;
  const rawPreviewCount = quality.slicePreviewCount;
  const slicePreviewCount = typeof rawPreviewCount === "number" && rawPreviewCount > 0 ? rawPreviewCount : 0;
  const coordinateSpace = typeof planeRun?.coordinateSpace === "string"
    ? planeRun.coordinateSpace
    : typeof planeRun?.measurements?.coordinateSpace === "string"
      ? planeRun.measurements.coordinateSpace
      : undefined;
  const assets = {
    ...(workspace.inputUrl ? { "input.png": workspace.inputUrl } : {}),
    ...(workspace.overlayUrl ? { "overlay.png": workspace.overlayUrl } : {}),
    ...(workspace.maskPreviewUrl ? { "mask-preview.png": workspace.maskPreviewUrl } : {}),
  };
  return workspace.planeRunId ? {
    id: `${workspace.planeRunId}-${workspace.plane}`,
    name: workspace.plane === "sagittal" ? "Sagital" : "Axial",
    plane: workspace.plane,
    sliceCount,
    selectedSlice,
    sourceInputId,
    slicePreviewCount,
    inPlaneSpacingMm,
    imageUrl: workspace.inputUrl ?? null,
    overlayUrl: workspace.overlayUrl ?? null,
    assets,
    planeRunId: workspace.planeRunId,
    storageStatus: workspace.storageStatus,
    available: workspace.available,
    coordinateSpace,
    status: workspace.available ? "stored" : workspace.storageStatus,
  } : null;
}
