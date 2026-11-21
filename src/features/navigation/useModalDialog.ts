import { useEffect, useRef } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Comportamiento de un diálogo modal real: al abrirse el foco entra al diálogo, Tab circula solo dentro de él, Esc lo cierra y,
 * al cerrarse, el foco vuelve al control que lo abrió. Se usa solo en diálogos modales (no en vistas dedicadas como
 * «Nuevo estudio»).
 *
 * `onEscape` decide qué significa cerrar (puede preguntar antes, p. ej. por cambios sin guardar). Si `escapeEnabled` es false
 * (guardando, por ejemplo) Esc no hace nada.
 */
export function useModalDialog<T extends HTMLElement>(onEscape: () => void, escapeEnabled = true) {
  const ref = useRef<T>(null);
  const onEscapeRef = useRef(onEscape);
  const enabledRef = useRef(escapeEnabled);
  onEscapeRef.current = onEscape;
  enabledRef.current = escapeEnabled;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = ref.current;
    if (container) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? container).focus({ preventScroll: true });
    }
    function onKeyDown(event: KeyboardEvent) {
      const current = ref.current;
      if (!current) return;
      if (event.key === "Escape") {
        // Otro diálogo encima (por ejemplo la confirmación de cambios sin guardar) maneja su propio Esc.
        if (document.querySelector('[data-testid="unsaved-dialog"]')) return;
        if (!enabledRef.current) return;
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!current.contains(active)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // El foco vuelve a donde estaba, si ese control sigue en pantalla.
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return ref;
}
