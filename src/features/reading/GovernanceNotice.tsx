import {
  DEPLOYMENT_LABELS,
  DEPLOYMENT_NOTES,
  DEPLOYMENT_ORDER,
  DISC_FINDINGS_NOTICE,
} from "./discFindingDisplay";

type Props = {
  discLocalizationAvailable: boolean;
};

/**
 * Aviso de los resultados de IA: una línea a la vista y todo lo general (alcance del modelo, validación,
 * nomenclatura) en "Alcance y limitaciones", cerrado al inicio. Lo que depende de ESTE estudio y condiciona
 * la lectura —la localización técnica— queda visible junto a los resultados.
 */
export function GovernanceNotice({ discLocalizationAvailable }: Props) {
  return (
    <section className="rr-ai-governance" aria-label="Aviso de los resultados de IA">
      <p className="rr-ai-governance-line">Resultados generados por IA. Requieren revisión profesional.</p>
      {discLocalizationAvailable && (
        <p className="rr-note rr-study-limit" data-testid="study-limitation">
          En este estudio la localización automática se ejecutó técnicamente; no implica que su precisión esté validada.
        </p>
      )}
      <details className="rr-ai-governance-details" data-testid="scope-limitations">
        <summary>Alcance y limitaciones</summary>
        <div className="rr-ai-governance-content">
          <p>{DISC_FINDINGS_NOTICE}</p>
          <p>
            Solo se clasifican las alteraciones indicadas en cada disco: que figuren como ausentes no descarta otras.
            El modelo cuenta con validación interna del proyecto y no con validación externa.
          </p>
          <dl>
            {DEPLOYMENT_ORDER.map((status) => (
              <div key={status}>
                <dt>
                  <span className={`rr-disc-deployment is-${status}`}>{DEPLOYMENT_LABELS[status]}</span>
                </dt>
                <dd>{DEPLOYMENT_NOTES[status]}</dd>
              </div>
            ))}
          </dl>
          <p>Estos resultados se revisan junto con la corrida del análisis inicial, en la pestaña Revisión; no hay revisión por hallazgo.</p>
        </div>
      </details>
    </section>
  );
}
