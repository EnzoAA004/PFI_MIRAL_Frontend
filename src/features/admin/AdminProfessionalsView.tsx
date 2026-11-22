import { useCallback, useEffect, useState } from "react";
import { authorizeProfileChange, decideProfileChange, listProfessionals, listProfileChanges, listRegistrationRejections, rejectProfessionalRegistration, updateProfessionalApproval } from "../../authClient";
import type { AdminProfileChange, AuthUser } from "../../appTypes";
import { OperationsPageHeader } from "../../components/OperationsPageHeader";

/**
 * Aprobación institucional de profesionales (solo ADMIN).
 *
 * El backend deja toda cuenta nueva en PENDING_APPROVAL hasta que un administrador la habilita;
 * esta pantalla usa los endpoints de administración existentes, sin guiones ni consola.
 */
type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; professionals: AuthUser[] };

function isPending(user: AuthUser) {
  return user.approved === false || user.roles.includes("PENDING_APPROVAL");
}

export function AdminProfessionalsView({ currentEmail }: { currentEmail: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [changes, setChanges] = useState<AdminProfileChange[]>([]);
  const [changeNotice, setChangeNotice] = useState("");
  /** Cuenta pendiente a la que se le está escribiendo el motivo del rechazo, y el texto. */
  const [rejectingEmail, setRejectingEmail] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejections, setRejections] = useState<Record<string, string>>({});
  const [rejectNotice, setRejectNotice] = useState("");

  const loadRejections = useCallback(async () => {
    try {
      const items = await listRegistrationRejections();
      setRejections(Object.fromEntries(items.map((item) => [item.email.toLowerCase(), item.reason])));
    } catch {
      setRejections({});
    }
  }, []);

  async function sendRejection(user: AuthUser) {
    setBusyEmail(user.email);
    setActionError("");
    setRejectNotice("");
    try {
      const result = await rejectProfessionalRegistration(user.email, rejectReason.trim());
      setRejectNotice(result.emailSent
        ? `Rechazo enviado por correo a ${user.email}. El motivo también le aparece al ingresar.`
        : `Motivo guardado. Este entorno no envía correos: ${user.email} lo ve al ingresar.`);
      setRejectingEmail(null);
      setRejectReason("");
      await loadRejections();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "No se pudo registrar el rechazo.");
    } finally {
      setBusyEmail(null);
    }
  }

  const loadChanges = useCallback(async () => {
    try {
      setChanges(await listProfileChanges());
    } catch {
      setChanges([]);
    }
  }, []);

  async function runChangeAction(email: string, action: () => Promise<string>) {
    setBusyEmail(email);
    setActionError("");
    setChangeNotice("");
    try {
      setChangeNotice(await action());
      await loadChanges();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "No se pudo completar la acción.");
    } finally {
      setBusyEmail(null);
    }
  }

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", professionals: await listProfessionals() });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "No se pudo consultar la lista de profesionales." });
    }
  }, []);

  useEffect(() => { void load(); void loadChanges(); void loadRejections(); }, [load, loadChanges, loadRejections]);

  async function setApproval(user: AuthUser, approved: boolean) {
    setBusyEmail(user.email);
    setActionError("");
    try {
      const updated = await updateProfessionalApproval(user.email, approved);
      if (approved) void loadRejections();
      setState((current) => current.status === "ready"
        ? { status: "ready", professionals: current.professionals.map((item) => item.email === user.email ? updated : item) }
        : current);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "No se pudo actualizar la cuenta.");
    } finally {
      setBusyEmail(null);
    }
  }

  const professionals = state.status === "ready"
    ? [...state.professionals].sort((a, b) => Number(isPending(b)) - Number(isPending(a)) || a.fullName.localeCompare(b.fullName))
    : [];
  const pendingCount = professionals.filter(isPending).length;

  return (
    <div className="view-stack patient-directory-view">
      <OperationsPageHeader
        title="Profesionales"
        description="Aprobá o revocá el acceso de los profesionales registrados. Una cuenta pendiente no puede ver estudios."
        meta={<span className="patient-directory-total" aria-live="polite">{state.status === "ready" ? `${pendingCount} pendientes` : "—"}</span>}
        actions={<button className="ghost-button" onClick={() => void load()} type="button" disabled={state.status === "loading"}>Actualizar</button>}
      />
      {changes.length > 0 && (
        <section className="panel-card patient-directory-panel" aria-labelledby="profile-changes-title">
          <div className="section-title"><h2 id="profile-changes-title">Cambios de perfil ({changes.length})</h2></div>
          <p className="muted">Un profesional que quiere corregir su nombre, matrícula o institución pide el cambio acá. Al autorizarlo recibe un código por correo (si el entorno envía correos); al guardar, su cuenta queda en solo lectura hasta que apruebes o rechaces los cambios.</p>
          {changeNotice && <p className="registered-patients-ok" role="status">{changeNotice}</p>}
          <ul className="patient-directory-list" aria-label="Cambios de perfil">
            {changes.map((change) => {
              const busy = busyEmail === change.email;
              return (
                <li key={change.email}>
                  <div>
                    <strong>{change.fullName}</strong>
                    <span>{change.email}</span>
                    {change.note ? <span>Motivo: {change.note}</span> : null}
                    {change.status === "REQUESTED" && <span>Esperando tu autorización</span>}
                    {change.status === "AUTHORIZED" && <span>Autorizado: el profesional tiene que ingresar el código que recibió</span>}
                    {change.status === "UNLOCKED" && <span>Edición habilitada: esperando que el profesional guarde los cambios</span>}
                    {change.status === "PENDING_REVIEW" && (
                      <>
                        <span>Nombre: {change.previousFullName ?? "—"} → <strong>{change.fullName}</strong></span>
                        <span>Matrícula: {change.previousLicenseNumber || "—"} → <strong>{change.licenseNumber || "—"}</strong></span>
                        <span>Institución: {change.previousInstitution || "—"} → <strong>{change.institution || "—"}</strong></span>
                      </>
                    )}
                  </div>
                  <div className="registered-patient-actions">
                    {(change.status === "REQUESTED" || change.status === "AUTHORIZED") && (
                      <button className="primary-button" disabled={busy} onClick={() => void runChangeAction(change.email, async () => {
                        const result = await authorizeProfileChange(change.email);
                        return result.status === "UNLOCKED" ? "Edición habilitada directamente (este entorno no envía correos)." : "Código enviado al correo del profesional.";
                      })} type="button">{change.status === "AUTHORIZED" ? "Reenviar código" : "Autorizar"}</button>
                    )}
                    {change.status === "PENDING_REVIEW" && (
                      <button className="primary-button" disabled={busy} onClick={() => void runChangeAction(change.email, async () => { await decideProfileChange(change.email, true); return "Cambios aprobados: la cuenta recuperó el acceso completo."; })} type="button">Aprobar cambios</button>
                    )}
                    <button className="ghost-button" disabled={busy} onClick={() => void runChangeAction(change.email, async () => { await decideProfileChange(change.email, false); return change.status === "PENDING_REVIEW" ? "Cambios rechazados: se restauraron los datos anteriores." : "Solicitud rechazada."; })} type="button">
                      {change.status === "PENDING_REVIEW" ? "Rechazar y revertir" : "Rechazar"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section className="panel-card patient-directory-panel">
        {state.status === "loading" && <div className="panel-hidden-placeholder">Consultando profesionales…</div>}
        {state.status === "error" && (
          <div className="clinical-empty-state" role="alert">
            <h2>No se pudo cargar la lista</h2>
            <p>{state.message}</p>
            <button className="ghost-button" onClick={() => void load()} type="button">Reintentar</button>
          </div>
        )}
        {actionError && <div className="toast error" role="alert">{actionError}</div>}
        {rejectNotice && <p className="registered-patients-ok" role="status">{rejectNotice}</p>}
        {state.status === "ready" && (
          <ul className="patient-directory-list" aria-label="Profesionales registrados">
            {professionals.map((user) => {
              const pending = isPending(user);
              const isAdminAccount = user.roles.includes("ADMIN");
              const isSelf = user.email.toLowerCase() === currentEmail.toLowerCase();
              return (
                <li key={user.email}>
                  <div>
                    <strong>{user.fullName}</strong>
                    <span>{user.email}{user.licenseNumber ? ` · Matrícula ${user.licenseNumber}` : ""}{user.specialty ? ` · ${user.specialty}` : ""}</span>
                    <span>
                      {pending ? "Pendiente de aprobación" : "Aprobado"}
                      {isAdminAccount ? " · Administrador" : ""}
                      {user.verified ? "" : " · Correo sin verificar (se puede activar manualmente)"}
                    </span>
                    {pending && rejections[user.email.toLowerCase()] && (
                      <span className="rejection-note">Rechazada · motivo enviado: {rejections[user.email.toLowerCase()]}</span>
                    )}
                    {pending && rejectingEmail === user.email && (
                      <div className="rejection-form">
                        <label>
                          <span>Motivo del rechazo (se le informa al profesional)</span>
                          <textarea maxLength={1000} onChange={(event) => setRejectReason(event.target.value)} placeholder="Ej.: la matrícula no coincide con el registro del colegio profesional." rows={3} value={rejectReason} />
                        </label>
                        <div className="registered-patient-actions">
                          <button className="primary-button" disabled={busyEmail === user.email || rejectReason.trim().length < 10} onClick={() => void sendRejection(user)} type="button">Enviar rechazo</button>
                          <button className="ghost-button" disabled={busyEmail === user.email} onClick={() => { setRejectingEmail(null); setRejectReason(""); }} type="button">Cancelar</button>
                        </div>
                        {rejectReason.trim().length < 10 && <small className="auth-hint">Escribí al menos 10 caracteres para poder enviarlo.</small>}
                      </div>
                    )}
                  </div>
                  {isAdminAccount || isSelf ? null : pending ? (
                    <div className="registered-patient-actions">
                      <button className="primary-button" disabled={busyEmail === user.email} onClick={() => void setApproval(user, true)} type="button" title={user.verified ? undefined : "Habilita la cuenta sin verificación por correo (activación institucional manual)"}>
                        {user.verified ? "Aprobar" : "Activar manualmente"}
                      </button>
                      <button className="ghost-button" disabled={busyEmail === user.email} onClick={() => { setRejectingEmail(user.email); setRejectReason(""); setRejectNotice(""); }} type="button">Rechazar…</button>
                    </div>
                  ) : (
                    <button className="ghost-button" disabled={busyEmail === user.email} onClick={() => void setApproval(user, false)} type="button">
                      Revocar acceso
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
