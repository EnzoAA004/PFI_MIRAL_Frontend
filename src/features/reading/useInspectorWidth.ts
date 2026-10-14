import { useCallback, useEffect, useState } from "react";
import {
  INSPECTOR_STORAGE_KEY,
  clampInspectorWidth,
  defaultInspectorWidth,
  parseStoredInspectorWidth,
} from "./inspectorLayout";

function readViewportWidth() {
  return typeof window === "undefined" ? 1366 : window.innerWidth;
}

function readStored(viewportWidth: number): number | null {
  try {
    return parseStoredInspectorWidth(window.localStorage.getItem(INSPECTOR_STORAGE_KEY), viewportWidth);
  } catch {
    return null;
  }
}

/**
 * Ancho del panel derecho. Preferencia del visor (no del estudio): se recuerda si el
 * navegador lo permite y siempre se vuelve a ajustar a los límites si cambia la ventana.
 * Cambiarlo no toca imágenes, notas ni análisis: solo una variable de CSS.
 */
export function useInspectorWidth() {
  const [viewportWidth, setViewportWidth] = useState(readViewportWidth);
  const [width, setWidthState] = useState(() => readStored(readViewportWidth()) ?? defaultInspectorWidth(readViewportWidth()));

  useEffect(() => {
    const onResize = () => {
      const next = window.innerWidth;
      setViewportWidth(next);
      setWidthState((current) => clampInspectorWidth(current, next));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const setWidth = useCallback((next: number) => {
    const clamped = clampInspectorWidth(next, window.innerWidth);
    setWidthState(clamped);
    try {
      window.localStorage.setItem(INSPECTOR_STORAGE_KEY, String(clamped));
    } catch {
      /* sin almacenamiento: el ancho vale para esta sesión */
    }
  }, []);

  return { width, viewportWidth, setWidth };
}
