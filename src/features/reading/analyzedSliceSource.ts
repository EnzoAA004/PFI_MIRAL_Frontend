export type AnalyzedSliceSourceParams = {
  apiBaseUrl: string;
  sourceInputId?: string;
  index: number;
  aiIndex: number;
  inputUrl?: string | null;
  previewCount?: number;
};

function runSlicePreviewUrl(inputUrl: string | null | undefined, index: number) {
  if (!inputUrl) return undefined;
  const name = `slice-${String(index).padStart(3, "0")}.png`;
  const separator = inputUrl.lastIndexOf("/");
  return separator < 0 ? undefined : `${inputUrl.slice(0, separator + 1)}${name}`;
}

/**
 * Resuelve la imagen de un corte de la misma serie que alimentó la corrida.
 *
 * El corte inferido conserva `input.png`: es el recurso canónico al que están
 * alineados overlay y mediciones. Para los demás cortes, se prefieren las
 * imágenes persistidas de la corrida cuando ésta las declara. La ruta de la
 * serie puede dejar de estar disponible al renovarse la instancia de IA.
 */
export function resolveAnalyzedSliceSource({
  apiBaseUrl,
  sourceInputId,
  index,
  aiIndex,
  inputUrl,
  previewCount = 0,
}: AnalyzedSliceSourceParams) {
  if (index === aiIndex) return undefined;
  const previewUrl = index < previewCount ? runSlicePreviewUrl(inputUrl, index) : undefined;
  if (previewUrl) return previewUrl;
  if (sourceInputId) {
    return `${apiBaseUrl}/api/ai/series/${encodeURIComponent(sourceInputId)}/slices/${index}`;
  }
  return undefined;
}
