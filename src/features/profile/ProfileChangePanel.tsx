import { useCallback, useEffect, useState } from "react";
import { cancelProfileChange, getCurrentDoctor, getProfileChange, requestProfileChange, submitProfileChange, unlockProfileChange } from "../../authClient";
import type { AuthUser, ProfileChangeInfo } from "../../appTypes";

interface Props {
  user: AuthUser;
  onUserUpdated: (user: AuthUser) => void;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Cambio de datos del perfil. Los datos del profesional los respalda la aprobación institucional, por eso no se
 * editan libremente: se pide el cambio, un administrador lo autoriza (y, si hay correo, se recibe un código), se
 * editan nombre, matrícula e institución y los cambios quedan en revisión. Mientras tanto la cuenta es de solo lectura.
 */
export function ProfileChangePanel({ user, onUserUpdated }: Props) {
  const [info, setInfo] = useState<ProfileChangeInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [note, setNote] = useState("");
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState({ fullName: user.fullName, licenseNumber: user.licenseNumber ?? "", institution: user.institution ?? "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const isAdmin = user.roles.includes("ADMIN");
  const readOnly = user.roles.includes("READ_ONLY");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const next = await getProfileChange();
      setInfo(next);
      // La revisión la resuelve un administrador desde otra sesión: se sincronizan los permisos de esta cuenta.
      const shouldBeReadOnly = next.status === "PENDING_REVIEW";
      if (shouldBeReadOnly !== user.roles.includes("READ_ONLY")) onUserUpdated(await getCurrentDoctor());
    } catch (error) {
      setLoadError(errorText(error, "No se pudo consultar el estado del cambio de perfil."));
    }
  }, [onUserUpdated, user.roles]);

  useEffect(() => { if (!isAdmin) void load(); }, [isAdmin, load]);

  useEffect(() => {
    setDraft({ fullName: user.fullName, licenseNumber: user.licenseNumber ?? "", institution: user.institution ?? "" });
  }, [user.fullName, user.licenseNumber, user.institution]);

  if (isAdmin) return <p className="settings-persistence-note">Los datos de una cuenta de administración los modifica otro administrador.</p>;

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error, failure) });
    } finally {
      setBusy(false);
    }
  }

  const status = info?.status ?? "NONE";

  return (
    <div className="profile-change-panel" aria-live="polite">
      {loadError && <p className="registered-patients-error" role="alert">{loadError} <button className="pre-link" onClick={() => void load()} type="button">Reintentar</button></p>}

      {status === "NONE" && info && (
        <>
          <p className="settings-persistence-note">Si algún dato está mal (nombre, matrícula o institución), pedí el cambio: un administrador tiene que autorizarlo. El correo no se modifica desde acá.</p>
          <label className="profile-change-field">
            <span>Motivo del cambio</span>
            <textarea disabled={busy} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Por ejemplo: error de tipeo en la matrícula" rows={2} value={note} />
          </label>
          <button className="ghost-button" disabled={busy} onClick={() => void run(async () => { setInfo(await requestProfileChange(note)); setNote(""); setMessage({ tone: "ok", text: "Solicitud enviada. Un administrador va a revisarla." }); }, "No se pudo enviar la solicitud.")} type="button">
            {busy ? "Enviando…" : "Pedir cambio de datos"}
          </button>
        </>
      )}

      {status === "REQUESTED" && (
        <>
          <p>Tu solicitud está esperando que un administrador la autorice.</p>
          <div className="registered-patient-actions">
            <button className="ghost-button" disabled={busy} onClick={() => void load()} type="button">Actualizar estado</button>
            <button className="ghost-button" disabled={busy} onClick={() => void run(async () => { setInfo(await cancelProfileChange()); }, "No se pudo cancelar.")} type="button">Cancelar solicitud</button>
          </div>
        </>
      )}

      {status === "AUTHORIZED" && (
        <>
          <p>Un administrador autorizó el cambio. Te enviamos un código a tu correo: ingresalo para habilitar la edición.</p>
          <label className="profile-change-field">
            <span>Código recibido por correo</span>
            <input autoComplete="off" disabled={busy} maxLength={12} onChange={(event) => setToken(event.target.value)} value={token} />
          </label>
          <div className="registered-patient-actions">
            <button className="ghost-button" disabled={busy || !token.trim()} onClick={() => void run(async () => { setInfo(await unlockProfileChange(token)); setToken(""); }, "No se pudo validar el código.")} type="button">{busy ? "Validando…" : "Habilitar edición"}</button>
            <button className="ghost-button" disabled={busy} onClick={() => void run(async () => { setInfo(await cancelProfileChange()); }, "No se pudo cancelar.")} type="button">Cancelar solicitud</button>
          </div>
        </>
      )}

      {status === "UNLOCKED" && (
        <>
          <p>Edición habilitada. Al guardar, los cambios quedan <strong>en revisión</strong> y tu cuenta pasa a <strong>solo lectura</strong> (podés consultar, pero no crear ni modificar nada) hasta que un administrador los apruebe.</p>
          <div className="registered-patient-form">
            <label>Nombre completo<input disabled={busy} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} value={draft.fullName} /></label>
            <label>Matrícula / credencial<input disabled={busy} onChange={(event) => setDraft({ ...draft, licenseNumber: event.target.value })} value={draft.licenseNumber} /></label>
            <label>Centro / institución<input disabled={busy} onChange={(event) => setDraft({ ...draft, institution: event.target.value })} value={draft.institution} /></label>
          </div>
          <div className="registered-patient-actions">
            <button className="ghost-button" disabled={busy} onClick={() => void run(async () => { const session = await submitProfileChange(draft); onUserUpdated(session.user); setInfo(await getProfileChange()); setMessage({ tone: "ok", text: "Cambios enviados a revisión." }); }, "No se pudieron guardar los cambios.")} type="button">{busy ? "Guardando…" : "Enviar cambios a revisión"}</button>
            <button className="ghost-button" disabled={busy} onClick={() => void run(async () => { setInfo(await cancelProfileChange()); }, "No se pudo cancelar.")} type="button">Cancelar</button>
          </div>
        </>
      )}

      {(status === "PENDING_REVIEW" || (readOnly && status === "NONE" && !info)) && (
        <>
          <p><strong>Tus cambios están en revisión.</strong> Mientras un administrador los revisa, tu cuenta está en modo solo lectura.</p>
          <button className="ghost-button" disabled={busy} onClick={() => void load()} type="button">Actualizar estado</button>
        </>
      )}

      {message && <p className={message.tone === "ok" ? "registered-patients-ok" : "registered-patients-error"} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p>}
    </div>
  );
}
