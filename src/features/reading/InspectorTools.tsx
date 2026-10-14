import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  INSPECTOR_TOOL_GROUPS,
  inspectorToolById,
  inspectorToolsInGroup,
  type InspectorToolId,
} from "./inspectorToolsIndex";

type Props = {
  /** `null` = se ve el índice; un id = se ve esa herramienta. */
  activeTool: InspectorToolId | null;
  onSelectTool: (tool: InspectorToolId | null) => void;
  renderTool: (tool: InspectorToolId) => ReactNode;
};

/**
 * "Herramientas del estudio": un índice agrupado por propósito y, al elegir una, su componente en el
 * mismo panel con título y regreso al índice.
 *
 * Abrir el índice no monta ninguna herramienta. Una herramienta se monta la primera vez que se elige y
 * queda montada (oculta) al volver: no se vuelve a consultar ni se pierde lo escrito, por ejemplo una
 * conversación del asistente.
 */
export function InspectorTools({ activeTool, onSelectTool, renderTool }: Props) {
  const [visited, setVisited] = useState<InspectorToolId[]>([]);
  const lastOpened = useRef<InspectorToolId | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  if (activeTool && !visited.includes(activeTool)) setVisited([...visited, activeTool]);

  // Foco: al abrir una herramienta, en su título; al volver, en el elemento del índice que la abrió.
  useEffect(() => {
    if (activeTool) {
      lastOpened.current = activeTool;
      headingRef.current?.focus();
    } else if (lastOpened.current) {
      rootRef.current?.querySelector<HTMLButtonElement>(`[data-tool-id="${lastOpened.current}"]`)?.focus();
    }
  }, [activeTool]);

  return (
    <div className="rr-tools" ref={rootRef}>
      <div className="rr-tools-index" data-testid="tools-index" hidden={activeTool !== null}>
        {INSPECTOR_TOOL_GROUPS.map((group) => (
          <section aria-labelledby={`rr-tools-group-${group.id}`} className="rr-tools-group" data-demo={group.id === "demo" ? "true" : undefined} key={group.id}>
            <h3 className="rr-group-title" id={`rr-tools-group-${group.id}`}>{group.title}</h3>
            {group.description ? <p className="rr-note">{group.description}</p> : null}
            <ul className="rr-tools-list">
              {inspectorToolsInGroup(group.id).map((tool) => (
                <li key={tool.id}>
                  <button className="rr-tool-item" data-tool-id={tool.id} onClick={() => onSelectTool(tool.id)} type="button">
                    <span className="rr-tool-item-title">{tool.title}</span>
                    <span className="rr-tool-item-hint">{tool.hint}</span>
                    {tool.provenance ? <span className="rr-tool-item-provenance">{tool.provenance}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {visited.map((id) => {
        const tool = inspectorToolById(id);
        const open = activeTool === id;
        return (
          <section aria-label={tool.title} className="rr-tool-view" data-tool={id} hidden={!open} key={id}>
            <div className="rr-tool-view-head">
              <button className="rr-link rr-tool-back" onClick={() => onSelectTool(null)} type="button">← Herramientas del estudio</button>
              <h3 className="rr-group-title" ref={open ? headingRef : undefined} tabIndex={-1}>{tool.title}</h3>
            </div>
            {renderTool(id)}
          </section>
        );
      })}
    </div>
  );
}
