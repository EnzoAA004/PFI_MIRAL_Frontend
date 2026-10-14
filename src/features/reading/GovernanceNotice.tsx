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
 * Un solo punto de entrada para el alcance de los resultados IA del inspector.
 * `details` conserva la explicación completa sin repetirla por nivel y es operable
 * con click, mouse y teclado sin depender de hover.
 */
export function GovernanceNotice({ discLocalizationAvailable }: Props) {
  return (
    <section className="rr-ai-governance" aria-labelledby="rr-ai-governance-title">
      <p id="rr-ai-governance-title">Los resultados requieren revisión profesional.</p>
      {/* Las limitaciones que condicionan la lectura van a la vista; la explicación del modelo y su
          nomenclatura quedan como detalle secundario. */}
      <ul className="rr-limits" aria-label="Limitaciones de estos resultados">
        <li>{DISC_FINDINGS_NOTICE}</li>
        <li>Solo se clasifican las alteraciones indicadas en cada disco: que figuren como ausentes no descarta otras.</li>
        <li>Validación interna del proyecto; no cuenta con validación externa.</li>
        {discLocalizationAvailable && (
          <li>La localización automática se ejecutó técnicamente sobre este estudio real; esto no implica que su precisión clínica o general esté validada.</li>
        )}
      </ul>

      <details className="rr-ai-governance-details">
        <summary>ⓘ Cómo interpretar el alcance del modelo</summary>
        <div className="rr-ai-governance-content">
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
        </div>
      </details>
    </section>
  );
}
