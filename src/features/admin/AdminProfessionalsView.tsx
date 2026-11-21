import { useCallback, useEffect, useState } from "react";
import { authorizeProfileChange, decideProfileChange, listProfessionals, listProfileChanges, updateProfessionalApproval } from "../../authClient";
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

  useEffect(() => { void load(); void loadChanges(); }, [load, loadChanges]);

  async function setApproval(user: AuthUser, approved: boolean) {
    setBusyEmail(user.email);
    setActionError("");
    try {
      const updated = await updateProfessionalApproval(user.email, approved);
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
                  </div>
                  {isAdminAccount || isSelf ? null : pending ? (
                    <button className="primary-button" disabled={busyEmail === user.email} onClick={() => void setApproval(user, true)} type="button" title={user.verified ? undefined : "Habilita la cuenta sin verificación por correo (activación institucional manual)"}>
                      {user.verified ? "Aprobar" : "Activar manualmente"}
                    </button>
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
