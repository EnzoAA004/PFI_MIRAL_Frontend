/**
 * Qué cambios de la vista de Revisión están sin guardar, comparando con el último estado cargado o guardado.
 * Devuelve una lista vacía cuando no hay nada que perder.
 */
export type ReviewPendingInput = {
  notes: string;
  savedNotes: string;
  status: string;
  savedStatus: string;
  annotationsUnsaved: boolean;
  annotationTextDraft: string;
  measurementDraftCount: number;
  contourDraftCount: number;
};

export function pendingReviewItems(input: ReviewPendingInput): string[] {
  const items: string[] = [];
  if (input.notes.trim() !== input.savedNotes.trim()) items.push("Notas de la revisión");
  if (input.status !== input.savedStatus) items.push("Estado de revisión elegido, sin confirmar");
  if (input.annotationsUnsaved) items.push("Anotaciones y marcas sin guardar");
  if (input.annotationTextDraft.trim()) items.push("Texto de una anotación sin agregar");
  if (input.measurementDraftCount > 0) {
    items.push(`${input.measurementDraftCount} ${input.measurementDraftCount === 1 ? "corrección de medición" : "correcciones de mediciones"} sin guardar`);
  }
  if (input.contourDraftCount > 0) items.push(`${input.contourDraftCount} ${input.contourDraftCount === 1 ? "contorno" : "contornos"} en borrador`);
  return items;
}
