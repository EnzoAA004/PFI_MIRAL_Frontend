import { useEffect, useState } from "react";
import { getMyRegistrationRejection } from "../authClient";
import type { AuthSession } from "../appTypes";

interface PendingApprovalViewProps {
  session: AuthSession;
  onLogout: () => void;
}

export function PendingApprovalView({ session, onLogout }: PendingApprovalViewProps) {
  /** Si un administrador no aprobó el registro, el motivo que escribió; `null` mientras la cuenta solo espera. */
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getMyRegistrationRejection()
      .then((result) => { if (active) setRejectionReason(result.rejected ? result.reason ?? "" : null); })
      .catch(() => { if (active) setRejectionReason(null); });
    return () => { active = false; };
  }, [session.user.email]);

  return (
    <main className="auth-page">
      <section className="auth-card approval-card">
        <div className="auth-brand">
          <div className="brand-mark" aria-hidden="true"><img alt="" src="/logo.svg" /></div>
          <div>
            <strong>Registro profesional pendiente</strong>
            <span>Validación institucional requerida antes de acceder a estudios.</span>
          </div>
        </div>
        <div className="auth-copy">
          <p>Professional approval</p>
          <h1>Tu cuenta está en revisión</h1>
          <span>
            El email ya fue verificado, pero un administrador debe aprobar la matrícula/especialidad antes de habilitar el acceso a worklist, estudios e historial.
          </span>
        </div>
        <dl className="info-list compact-info">
          <div><dt>Profesional</dt><dd>{session.user.fullName}</dd></div>
          <div><dt>Correo</dt><dd>{session.user.email}</dd></div>
          <div><dt>Matrícula</dt><dd>{session.user.licenseNumber ?? "pendiente"}</dd></div>
          <div><dt>Estado</dt><dd>pending approval</dd></div>
        </dl>
        {rejectionReason !== null && (
          <div className="verification-panel rejection-panel" role="alert">
            <strong>Tu registro no fue aprobado</strong>
            <p>Motivo indicado por el administrador:</p>
            <blockquote>{rejectionReason}</blockquote>
            <p>Corregí lo que corresponda y escribile al administrador, o registrate de nuevo con los datos correctos.</p>
          </div>
        )}
        <div className="verification-panel">
          <strong>Acceso restringido</strong>
          <p>Mientras la cuenta esté pendiente, el backend bloquea endpoints clínico-académicos protegidos y solo permite consultar/configurar la cuenta profesional.</p>
        </div>
        <button className="ghost-button" onClick={onLogout} type="button">Salir</button>
      </section>
    </main>
  );
}
