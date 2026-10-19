import { useEffect, useRef, useSyncExternalStore } from "react";
import { useBlocker } from "react-router-dom";
import { getSnapshot, hasPending, openConfirmation, resolveConfirmation, subscribe } from "./unsavedChanges";

/**
 * Pregunta antes de descartar ediciones sin guardar: navegación interna y «atrás» del navegador (bloqueador del
 * router), botones propios (`requestLeave`) y cierre/recarga de la pestaña (protección nativa del navegador).
 * Ofrece «Seguir editando» y «Salir sin guardar». No guarda, no aprueba el estudio ni cambia su estado.
 */
export function UnsavedChangesGuard() {
  const { pending, request } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    hasPending() && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));

  // El router detuvo una navegación: se abre la confirmación; «Salir sin guardar» la deja seguir y «Seguir editando» la cancela.
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (getSnapshot().request) return;
    openConfirmation(() => blocker.proceed(), () => blocker.reset());
  }, [blocker]);

  // Cerrar o recargar la pestaña: protección nativa del navegador.
  useEffect(() => {
    if (pending.length === 0) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pending.length]);

  if (!request) return null;
  const scoped = request.scope ? pending.filter((entry) => entry.id === request.scope) : pending;
  return <UnsavedChangesDialog items={scoped.flatMap((entry) => entry.items)} />;
}

function UnsavedChangesDialog({ items }: { items: string[] }) {
  const stayRef = useRef<HTMLButtonElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    stayRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        resolveConfirmation("stay");
        return;
      }
      if (event.key === "Tab") {
        // Diálogo modal: el foco circula solo entre sus dos botones.
        const first = stayRef.current;
        const last = leaveRef.current;
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        else if (document.activeElement !== first && document.activeElement !== last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div className="unsaved-overlay">
      <div aria-describedby="unsaved-body" aria-labelledby="unsaved-title" aria-modal="true" className="unsaved-dialog" data-testid="unsaved-dialog" role="alertdialog">
        <h2 id="unsaved-title">Hay cambios sin guardar</h2>
        <div id="unsaved-body">
          {items.length > 0 && (
            <>
              <p>Si salís ahora se pierden:</p>
              <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
            </>
          )}
          <p className="unsaved-note">No se guarda nada automáticamente ni se cambia el estado del estudio.</p>
        </div>
        <div className="unsaved-actions">
          <button className="primary-button" data-testid="unsaved-stay" onClick={() => resolveConfirmation("stay")} ref={stayRef} type="button">Seguir editando</button>
          <button className="ghost-button" data-testid="unsaved-leave" onClick={() => resolveConfirmation("leave")} ref={leaveRef} type="button">Salir sin guardar</button>
        </div>
      </div>
    </div>
  );
}
