/**
 * Ancho del panel derecho de la sala de lectura.
 *
 * Es una lógica pura para poder probarla sin navegador: el panel se puede ensanchar o
 * angostar (con el mouse o con el teclado), pero siempre entre límites que dejan espacio
 * útil para las imágenes. El valor elegido se recuerda por visor, nunca por estudio.
 */

export const INSPECTOR_MIN_WIDTH = 320;
export const INSPECTOR_ABSOLUTE_MAX_WIDTH = 640;
/** Parte de la ventana que el panel no puede superar: el resto es para las imágenes. */
export const INSPECTOR_MAX_VIEWPORT_SHARE = 0.5;
export const INSPECTOR_KEY_STEP = 24;
export const INSPECTOR_KEY_STEP_LARGE = 96;
export const INSPECTOR_STORAGE_KEY = "pfi.reading.inspector-width";

export type InspectorWidthLimits = { min: number; max: number };

export function inspectorWidthLimits(viewportWidth: number): InspectorWidthLimits {
  const share = Math.floor(viewportWidth * INSPECTOR_MAX_VIEWPORT_SHARE);
  const max = Math.min(INSPECTOR_ABSOLUTE_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH + 40, share));
  return { min: INSPECTOR_MIN_WIDTH, max };
}

export function clampInspectorWidth(width: number, viewportWidth: number): number {
  const { min, max } = inspectorWidthLimits(viewportWidth);
  if (!Number.isFinite(width)) return min;
  return Math.min(max, Math.max(min, Math.round(width)));
}

/** 1366×768 → 383 px (quedan 983 para la imagen); 1920×1080 → 480 px (quedan 1440). */
export function defaultInspectorWidth(viewportWidth: number): number {
  return clampInspectorWidth(Math.min(480, Math.max(360, Math.round(viewportWidth * 0.28))), viewportWidth);
}

/**
 * Tecla → ancho nuevo, o `null` si la tecla no mueve el separador.
 * La flecha izquierda ensancha el panel porque el separador está en su borde izquierdo:
 * mover el borde a la izquierda agranda el panel, igual que arrastrarlo con el mouse.
 */
export function inspectorWidthForKey(
  key: string,
  current: number,
  viewportWidth: number,
  largeStep = false,
): number | null {
  const step = largeStep ? INSPECTOR_KEY_STEP_LARGE : INSPECTOR_KEY_STEP;
  const { min, max } = inspectorWidthLimits(viewportWidth);
  switch (key) {
    case "ArrowLeft": return clampInspectorWidth(current + step, viewportWidth);
    case "ArrowRight": return clampInspectorWidth(current - step, viewportWidth);
    case "Home": return min;
    case "End": return max;
    default: return null;
  }
}

/** Ancho nuevo al arrastrar: el panel termina donde está el puntero, medido desde el borde derecho. */
export function inspectorWidthForPointer(pointerX: number, containerRight: number, viewportWidth: number): number {
  return clampInspectorWidth(containerRight - pointerX, viewportWidth);
}

export function parseStoredInspectorWidth(raw: string | null | undefined, viewportWidth: number): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return clampInspectorWidth(value, viewportWidth);
}
