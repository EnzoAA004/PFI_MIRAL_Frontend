import {
  FINDING_DECISION_ACTION_LABELS,
  FINDING_DECISION_STATE_LABELS,
  FINDING_DECISION_VALUES,
  type FindingDecisionValue,
} from "./findingDecisions";

type Props = {
  /** Qué se está decidiendo, para los lectores de pantalla (p. ej. «Abombamiento discal»). */
  label: string;
  value?: FindingDecisionValue;
  /** `null` quita la decisión: el elemento vuelve a «sin revisar». */
  onDecide: (decision: FindingDecisionValue | null) => void;
  busy?: boolean;
  /** La revisión está cerrada: se ve la decisión pero no se cambia. */
  locked?: boolean;
};

/**
 * Aceptar / Dudoso / Rechazar sobre un hallazgo o una medición, con su estado a la vista.
 * Es la misma decisión del profesional en el visor y en el preinforme: no toca la predicción de la IA.
 * Se frena la propagación porque vive dentro de filas que también reaccionan a clic y a teclado.
 */
export function DecisionControl({ label, value, onDecide, busy, locked }: Props) {
  return (
    // El grupo solo frena la propagación hacia la fila contenedora; no es un control por sí mismo.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      aria-label={`Decisión sobre ${label}`}
      className="rr-decision"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      role="group"
    >
      <span className={`rr-decision-state is-${value ?? "none"}`} role="status">
        {value ? FINDING_DECISION_STATE_LABELS[value] : "Sin revisar"}
      </span>
      <span className="rr-decision-actions">
        {FINDING_DECISION_VALUES.map((option) => (
          <button
            aria-pressed={value === option}
            className={`rr-decision-btn is-${option}`}
            disabled={busy || locked}
            key={option}
            onClick={() => onDecide(value === option ? null : option)}
            title={value === option ? "Volver a «sin revisar»" : undefined}
            type="button"
          >
            {FINDING_DECISION_ACTION_LABELS[option]}
          </button>
        ))}
      </span>
    </div>
  );
}
