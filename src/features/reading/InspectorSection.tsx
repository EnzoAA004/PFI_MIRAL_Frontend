import { useState, type ReactNode, type SyntheticEvent } from "react";

type DisclosureProps = {
  title: string;
  /** Una línea que dice qué hay adentro o de dónde salen los datos. */
  hint?: string;
  defaultOpen?: boolean;
  /**
   * Con `lazy`, el contenido no se monta hasta la primera apertura: abrir el panel o
   * reorganizarlo no consulta nada. Una vez abierto queda montado, así que cerrar la
   * sección o cambiar de pestaña no pierde lo escrito ni vuelve a pedir datos.
   */
  lazy?: boolean;
  /** Se llama cada vez que la persona abre la sección (nunca por montarla). */
  onOpen?: () => void;
  testId?: string;
  children: ReactNode;
};

export function InspectorDisclosure({ title, hint, defaultOpen = false, lazy = true, onOpen, testId, children }: DisclosureProps) {
  const [opened, setOpened] = useState(defaultOpen || !lazy);
  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open) return;
    setOpened(true);
    onOpen?.();
  };
  return (
    <details className="rr-disclosure" data-testid={testId} onToggle={onToggle} open={defaultOpen || undefined}>
      <summary>
        <span className="rr-disclosure-title">{title}</span>
        {hint ? <span className="rr-disclosure-hint">{hint}</span> : null}
      </summary>
      <div className="rr-disclosure-body">{opened ? children : null}</div>
    </details>
  );
}

type GroupProps = {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
};

/** Un grupo con nombre propio dentro de una pestaña: título y, a lo sumo, una frase. */
export function InspectorGroup({ id, title, description, children }: GroupProps) {
  return (
    <section aria-labelledby={`rr-group-${id}`} className="rr-group" data-group={id}>
      <h3 className="rr-group-title" id={`rr-group-${id}`}>{title}</h3>
      {description ? <p className="rr-note">{description}</p> : null}
      {children}
    </section>
  );
}
