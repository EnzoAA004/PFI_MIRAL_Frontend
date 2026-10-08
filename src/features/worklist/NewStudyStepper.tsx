import { Check } from "lucide-react";
import type { StepId, StepStatus } from "./newStudyForm";

type Props = {
  steps: StepStatus[];
  /** Durante un análisis no se cambia de paso. */
  locked: boolean;
  onSelect: (id: StepId) => void;
};

const STATE_TEXT: Record<StepStatus["state"], string> = {
  current: "Paso actual",
  complete: "Completado",
  pending: "Pendiente",
};

/** Navegación de los tres pasos. Ir hacia atrás siempre se puede; ir adelante, solo a lo ya habilitado. */
export function NewStudyStepper({ steps, locked, onSelect }: Props) {
  return (
    <nav aria-label="Pasos de Nuevo estudio" className="ns-stepper">
      <ol>
        {steps.map((step, index) => (
          <li className={`is-${step.state}`} key={step.id}>
            <button
              aria-current={step.state === "current" ? "step" : undefined}
              disabled={locked || !step.reachable}
              onClick={() => onSelect(step.id)}
              type="button"
            >
              <span aria-hidden="true" className="ns-step-index">{step.state === "complete" ? <Check size={14} strokeWidth={3} /> : index + 1}</span>
              <span className="ns-step-text">
                <span className="ns-step-label">{step.label}</span>
                <span className="ns-step-state">{step.note || STATE_TEXT[step.state]}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
