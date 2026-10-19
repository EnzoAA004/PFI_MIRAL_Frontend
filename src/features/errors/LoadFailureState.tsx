import type { LoadFailure } from "./loadFailure";

type Props = {
  failure: LoadFailure;
  backLabel: string;
  onBack: () => void;
  onRetry?: () => void;
};

/**
 * Pantalla de fallo de carga: título según la causa, qué hacer (volver, reintentar) y, plegado, el detalle técnico.
 * Un recurso inexistente no se presenta como «respuesta incompatible» ni se ofrece reintentarlo.
 */
export function LoadFailureState({ failure, backLabel, onBack, onRetry }: Props) {
  return (
    <section className="panel-card clinical-empty-state" data-failure={failure.kind} data-testid="load-failure" role="alert">
      <h2>{failure.title}</h2>
      <p>{failure.message}</p>
      <div className="clinical-empty-actions">
        <button className="button secondary" onClick={onBack} type="button">{backLabel}</button>
        {failure.retryable && onRetry && <button className="button" onClick={onRetry} type="button">Reintentar</button>}
      </div>
      {failure.detail && (
        <details className="load-failure-detail">
          <summary>Detalle técnico</summary>
          <p>{failure.detail}</p>
        </details>
      )}
    </section>
  );
}
