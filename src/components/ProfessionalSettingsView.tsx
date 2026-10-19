import { useMemo, useState } from "react";
import { updateDoctorSettings } from "../authClient";
import type { AuthUser } from "../appTypes";
import { ToggleSwitch } from "./ToggleSwitch";

interface ProfessionalSettingsViewProps {
  user: AuthUser;
  onUserUpdated: (user: AuthUser) => void;
  onLogout: () => void;
}

/**
 * Ajustes de la cuenta. Solo muestra lo que funciona: los datos de la cuenta (lectura), la doble verificación (el backend la
 * guarda y la exige al ingresar) y el cierre de sesión. El tema claro/oscuro se cambia desde la barra lateral.
 *
 * Las preferencias de idioma, densidad visual y notificaciones, y el cambio de contraseña, no tienen funcionamiento detrás y
 * no se ofrecen. Si el backend no confirma un cambio, el interruptor vuelve a su valor anterior: no se muestra un cambio que
 * no se guardó.
 */
export function ProfessionalSettingsView({ user, onUserUpdated, onLogout }: ProfessionalSettingsViewProps) {
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(Boolean(user.twoFactorEnabled));
  const [savingTwoFactor, setSavingTwoFactor] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const roles = useMemo(() => (user.roles.length ? user.roles.join(", ") : "sin rol informado"), [user.roles]);

  async function toggleTwoFactor() {
    const previous = twoFactorEnabled;
    setSavingTwoFactor(true);
    setMessage(null);
    try {
      const updated = await updateDoctorSettings({ twoFactorEnabled: !previous });
      setTwoFactorEnabled(Boolean(updated.twoFactorEnabled));
      onUserUpdated(updated);
      setMessage({ kind: "ok", text: updated.twoFactorEnabled ? "Doble verificación activada: se pedirá un código al ingresar." : "Doble verificación desactivada." });
    } catch {
      setTwoFactorEnabled(previous);
      setMessage({ kind: "error", text: "No se pudo guardar el cambio. La doble verificación sigue como estaba." });
    } finally {
      setSavingTwoFactor(false);
    }
  }

  return (
    <div className="professional-settings-view">
      {message && <div className={`toast ${message.kind === "ok" ? "info" : "error"}`} role="status">{message.text}</div>}

      <section className="settings-grid">
        <article className="panel-card compact-card settings-section">
          <div className="section-title"><h2>Mi perfil</h2><span>Solo lectura</span></div>
          <dl className="settings-details">
            <div><dt>Nombre</dt><dd>{user.fullName || "No informado"}</dd></div>
            <div><dt>Rol</dt><dd>{roles}</dd></div>
            <div><dt>Matrícula / credencial</dt><dd>{user.licenseNumber || "No informada"}</dd></div>
            <div><dt>Centro / institución</dt><dd>{user.institution || "No informado"}</dd></div>
            <div><dt>Correo</dt><dd>{user.email}</dd></div>
          </dl>
          <p className="settings-persistence-note">Estos datos son los de tu cuenta autenticada. Para corregirlos, avisá al equipo responsable.</p>
        </article>

        <article className="panel-card compact-card settings-section">
          <div className="section-title"><h2>Seguridad de la cuenta</h2></div>
          <ToggleSwitch checked={twoFactorEnabled} disabled={savingTwoFactor} label="Doble verificación" description="Pide un código además de la contraseña al ingresar." onChange={() => void toggleTwoFactor()} />
          <div className="account-actions">
            <button className="ghost-button" onClick={onLogout} type="button">Cerrar sesión</button>
          </div>
        </article>
      </section>
    </div>
  );
}
