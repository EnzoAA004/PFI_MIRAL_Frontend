import { useCallback, useEffect, useState } from "react";
import { listProfessionals, updateProfessionalApproval } from "../../authClient";
import type { AuthUser } from "../../appTypes";
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

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", professionals: await listProfessionals() });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "No se pudo consultar la lista de profesionales." });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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
