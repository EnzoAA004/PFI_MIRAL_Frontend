import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPatient, type Patient } from "../../patientApi";

type Props = {
  /** Se creó el paciente. Quien llama lo selecciona y cierra el diálogo. */
  onCreated: (patient: Patient) => void;
  onCancel: () => void;
};

/**
 * Diálogo para crear un paciente.
 *
 * Es un `<dialog>` nativo abierto con `showModal()`: el navegador resuelve el foco atrapado,
 * Escape, el fondo inerte y la devolución del foco al botón que lo abrió. Solo crea el paciente:
 * no avanza ni crea el estudio, y lo dice en el propio diálogo.
 */
export function CreatePatientDialog({ onCreated, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [draft, setDraft] = useState({ patientReference: "", firstName: "", lastName: "", dateOfBirth: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (creating) return;
    if (!draft.patientReference.trim()) {
      setError("Ingresá un código visible para el paciente.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const patient = await createPatient(draft);
      onCreated(patient);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No se pudo crear el paciente.");
      setCreating(false);
    }
  }

  return (
    <dialog
      aria-describedby="ns-patient-dialog-help"
      aria-labelledby="ns-patient-dialog-title"
      className="ns-dialog"
      onCancel={(event) => {
        // Escape cierra el diálogo, salvo mientras se está creando el paciente.
        event.preventDefault();
        if (!creating) onCancel();
      }}
      ref={dialogRef}
    >
      <form className="ns-dialog-form" onSubmit={(event) => { void submit(event); }}>
        <header className="ns-dialog-head">
          <h2 id="ns-patient-dialog-title">Crear paciente</h2>
          <p id="ns-patient-dialog-help">Esto guarda un paciente nuevo. No crea ni continúa el estudio.</p>
        </header>

        <label className="wl-field" htmlFor="new-patient-reference">
          <span>Código visible <b aria-hidden="true" className="ns-req">*</b></span>
          <input
            aria-required="true"
            autoComplete="off"
            disabled={creating}
            id="new-patient-reference"
            maxLength={64}
            onChange={(event) => { setDraft({ ...draft, patientReference: event.target.value }); setError(""); }}
            placeholder="PAC-001"
            value={draft.patientReference}
          />
        </label>
        <div className="ns-field-pair">
          <label className="wl-field" htmlFor="new-patient-first-name">
            <span>Nombre <i>(opcional)</i></span>
            <input autoComplete="off" disabled={creating} id="new-patient-first-name" maxLength={80} onChange={(event) => setDraft({ ...draft, firstName: event.target.value })} value={draft.firstName} />
          </label>
          <label className="wl-field" htmlFor="new-patient-last-name">
            <span>Apellido <i>(opcional)</i></span>
            <input autoComplete="off" disabled={creating} id="new-patient-last-name" maxLength={80} onChange={(event) => setDraft({ ...draft, lastName: event.target.value })} value={draft.lastName} />
          </label>
        </div>
        <label className="wl-field" htmlFor="new-patient-birth-date">
          <span>Fecha de nacimiento <i>(opcional)</i></span>
          <input disabled={creating} id="new-patient-birth-date" onChange={(event) => setDraft({ ...draft, dateOfBirth: event.target.value })} type="date" value={draft.dateOfBirth} />
          <em>Permite calcular la edad al momento de cada estudio.</em>
        </label>
        <p className="ns-muted">No ingreses DNI, domicilio ni otros datos administrativos.</p>
        {error && <p className="wl-drawer-error" role="alert">{error}</p>}

        <footer className="ns-dialog-actions">
          <button className="ns-btn" disabled={creating} onClick={onCancel} type="button">Cancelar</button>
          <button className="ns-btn is-primary" disabled={creating} type="submit">{creating ? "Creando…" : "Crear paciente"}</button>
        </footer>
      </form>
    </dialog>
  );
}
