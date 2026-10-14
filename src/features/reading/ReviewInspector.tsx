import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  inspectorWidthForKey,
  inspectorWidthForPointer,
  inspectorWidthLimits,
} from "./inspectorLayout";

/**
 * Las tres tareas del panel derecho: leer los resultados, revisar y firmar, y consultar
 * el contexto (paciente, seguimiento, informe y herramientas).
 */
export type ReviewInspectorTab = "results" | "review" | "context";

export const REVIEW_INSPECTOR_TABS: readonly { id: ReviewInspectorTab; label: string }[] = [
  { id: "results", label: "Resultados" },
  { id: "review", label: "Revisión" },
  { id: "context", label: "Contexto" },
];

type Props = {
  activeTab: ReviewInspectorTab;
  onTabChange: (tab: ReviewInspectorTab) => void;
  width: number;
  viewportWidth: number;
  onWidthChange: (width: number) => void;
  /** Cuando cambia, el contenido vuelve al comienzo (p. ej. al cambiar de vista dentro de Resultados). */
  scrollKey?: string;
  children: ReactNode;
};

export function ReviewInspector({ activeTab, onTabChange, width, viewportWidth, onWidthChange, scrollKey, children }: Props) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const asideRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Hay un único scroll: al cambiar de pestaña se vuelve al comienzo de la nueva, en vez de heredar
  // la posición de la anterior (que dejaba la pestaña abierta a mitad de camino).
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [activeTab, scrollKey]);
  const { min, max } = inspectorWidthLimits(viewportWidth);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % REVIEW_INSPECTOR_TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + REVIEW_INSPECTOR_TABS.length) % REVIEW_INSPECTOR_TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = REVIEW_INSPECTOR_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = REVIEW_INSPECTOR_TABS[nextIndex];
    onTabChange(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  };

  const onHandleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = inspectorWidthForKey(event.key, width, viewportWidth, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    onWidthChange(next);
  };

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = asideRef.current?.parentElement;
    if (!container) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const right = container.getBoundingClientRect().right;
    const move = (moveEvent: PointerEvent) => onWidthChange(inspectorWidthForPointer(moveEvent.clientX, right, viewportWidth));
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };

  return (
    <aside aria-label="Inspector clínico" className="rr-panel" ref={asideRef}>
      {/* Separador enfocable del patrón "window splitter" de ARIA: tiene valor, límites y teclado. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        aria-label="Ancho del panel"
        aria-orientation="vertical"
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={width}
        aria-valuetext={`${width} píxeles`}
        className="rr-resize-handle"
        onKeyDown={onHandleKeyDown}
        onPointerDown={onHandlePointerDown}
        role="separator"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        title="Arrastrá o usá las flechas ← → para cambiar el ancho (Mayús: pasos grandes)"
      />
      <div aria-label="Secciones del inspector" className="rr-tabs" role="tablist">
        {REVIEW_INSPECTOR_TABS.map((tab, index) => (
          <button
            aria-controls={`review-inspector-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "is-active" : ""}
            id={`review-inspector-tab-${tab.id}`}
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
            ref={(node) => { tabRefs.current[index] = node; }}
            role="tab"
            tabIndex={activeTab === tab.id ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rr-panel-body" ref={bodyRef}>{children}</div>
    </aside>
  );
}

type PanelProps = {
  activeTab: ReviewInspectorTab;
  tab: ReviewInspectorTab;
  /**
   * Con `lazy`, el contenido se monta la primera vez que se abre la pestaña: reorganizar el panel
   * no consulta datos que nadie pidió. Una vez montado, queda montado.
   */
  lazy?: boolean;
  children: ReactNode;
};

/** Se mantiene montado y sólo cambia su visibilidad para preservar drafts y selección. */
export function ReviewInspectorPanel({ activeTab, tab, lazy = false, children }: PanelProps) {
  const [visited, setVisited] = useState(activeTab === tab);
  if (!visited && activeTab === tab) setVisited(true);
  return (
    <div
      aria-labelledby={`review-inspector-tab-${tab}`}
      hidden={activeTab !== tab}
      id={`review-inspector-panel-${tab}`}
      role="tabpanel"
      tabIndex={0}
    >
      {lazy && !visited ? null : children}
    </div>
  );
}
