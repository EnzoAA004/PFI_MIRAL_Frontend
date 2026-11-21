import { useEffect, useMemo, useState, type FormEvent } from "react";
import { changePassword, updateDoctorSettings } from "../authClient";
import type { AuthUser } from "../appTypes";
import { ToggleSwitch } from "./ToggleSwitch";

type PreferenceState = {
  language: string;
  density: string;
  notifications: boolean;
};

const LOCAL_SETTINGS_KEY = "lumbar-mri-professional-settings-v1";

interface ProfessionalSettingsViewProps {
  user: AuthUser;
  onUserUpdated: (user: AuthUser) => void;
  onLogout: () => void;
}

function loadLocalPreferences(): PreferenceState {
  try {
    const raw = window.localStorage.getItem(LOCAL_SETTINGS_KEY);
    if (!raw) return { language: "es", density: "comfortable", notifications: false };
    return { language: "es", density: "comfortable", notifications: false, ...JSON.parse(raw) } as PreferenceState;
  } catch {
    return { language: "es", density: "comfortable", notifications: false };
  }
}

export function ProfessionalSettingsView({ user, onUserUpdated, onLogout }: ProfessionalSettingsViewProps) {
  const [preferences, setPreferences] = useState<PreferenceState>(() => loadLocalPreferences());
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(Boolean(user.twoFactorEnabled));
  const [savingTwoFactor, setSavingTwoFactor] = useState(false);
  const [message, setMessage] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", repeat: "" });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const roles = useMemo(() => user.roles.length ? user.roles.join(", ") : "sin rol informado", [user.roles]);

  useEffect(() => {
    window.localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(preferences));
  }, [preferences]);

  async function toggleTwoFactor() {
    const next = !twoFactorEnabled;
    setSavingTwoFactor(true);
    setMessage("");
    try {
      const updated = await updateDoctorSettings({ twoFactorEnabled: next });
      setTwoFactorEnabled(Boolean(updated.twoFactorEnabled));
      onUserUpdated(updated);
      setMessage("Seguridad actualizada en backend.");
    } catch {
      setTwoFactorEnabled(next);
      setMessage("No se pudo confirmar en backend; cambio visible localmente hasta la próxima sesión.");
    } finally {
      setSavingTwoFactor(false);
    }
  }

  function closePasswordForm() {
    setPasswordOpen(false);
    setPasswordForm({ current: "", next: "", repeat: "" });
    setPasswordError("");
  }

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    if (passwordForm.next !== passwordForm.repeat) {
      setPasswordError("La confirmación no coincide con la nueva contraseña.");
      return;
    }
    setPasswordBusy(true);
    try {
      const session = await changePassword(passwordForm.current, passwordForm.next);
      onUserUpdated(session.user);
      closePasswordForm();
      setMessage("Contraseña actualizada. Las demás sesiones abiertas se cerraron.");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "No se pudo cambiar la contraseña.");
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <div className="professional-settings-view">

      {message && <div className="toast info" role="status">{message}</div>}

      <section className="settings-grid">
        <article className="panel-card compact-card settings-section">
          <div className="section-title"><h2>Perfil</h2><span>Lectura de sesión</span></div>
          <dl className="settings-details">
            <div><dt>Nombre</dt><dd>{user.fullName || "sin datos"}</dd></div>
            <div><dt>Rol</dt><dd>{roles}</dd></div>
            <div><dt>Matrícula / credencial</dt><dd>{user.licenseNumber || "sin datos"}</dd></div>
            <div><dt>Centro / institución</dt><dd>{user.institution || "sin datos"}</dd></div>
            <div><dt>Correo</dt><dd>{user.email}</dd></div>
          </dl>
          <p className="settings-persistence-note">Edición de perfil pendiente de endpoint backend. Los datos visibles vienen de la sesión autenticada.</p>
        </article>

        <article className="panel-card compact-card settings-section">
          <div className="section-title"><h2>Preferencias</h2><span>Guardado local</span></div>
          <div className="settings-form-grid">
            <label>
              <span>Idioma</span>
              <select value={preferences.language} onChange={(event) => setPreferences((current) => ({ ...current, language: event.target.value }))}>
                <option value="es">Español</option>
                <option value="en">Inglés</option>
              </select>
            </label>
            <label>
              <span>Densidad visual</span>
              <select value={preferences.density} onChange={(event) => setPreferences((current) => ({ ...current, density: event.target.value }))}>
                <option value="comfortable">Cómoda</option>
                <option value="compact">Compacta</option>
              </select>
            </label>
          </div>
          <ToggleSwitch checked={preferences.notifications} label="Notificaciones" description="Preferencia local. El envío de notificaciones todavía no está disponible." onChange={() => setPreferences((current) => ({ ...current, notifications: !current.notifications }))} />
          <p className="settings-persistence-note">Preferencias guardadas en este navegador; persistencia backend pendiente.</p>
        </article>

        <article className="panel-card compact-card settings-section">
          <div className="section-title"><h2>Cuenta / sesión</h2><span>Seguridad</span></div>
          <ToggleSwitch checked={twoFactorEnabled} disabled={savingTwoFactor} label="Doble verificación" description="Este campo usa el endpoint existente de settings cuando el backend responde." onChange={() => void toggleTwoFactor()} />
          <div className="account-actions">
            <button className="ghost-button" aria-expanded={passwordOpen} onClick={() => (passwordOpen ? closePasswordForm() : setPasswordOpen(true))} type="button">Cambiar contraseña</button>
            <button className="ghost-button" onClick={onLogout} type="button">Cerrar sesión</button>
          </div>
          {passwordOpen && (
            <form className="password-change-form" onSubmit={(event) => void submitPasswordChange(event)}>
              <label>
                <span>Contraseña actual</span>
                <input autoComplete="current-password" onChange={(event) => setPasswordForm((current) => ({ ...current, current: event.target.value }))} required type="password" value={passwordForm.current} />
              </label>
              <label>
                <span>Nueva contraseña</span>
                <input autoComplete="new-password" minLength={10} onChange={(event) => setPasswordForm((current) => ({ ...current, next: event.target.value }))} required type="password" value={passwordForm.next} />
              </label>
              <label>
                <span>Repetir nueva contraseña</span>
                <input autoComplete="new-password" minLength={10} onChange={(event) => setPasswordForm((current) => ({ ...current, repeat: event.target.value }))} required type="password" value={passwordForm.repeat} />
              </label>
              <p className="settings-persistence-note">Mínimo 10 caracteres, con letras y números. Al cambiarla se cierran las demás sesiones abiertas.</p>
              {passwordError && <div className="toast error" role="alert">{passwordError}</div>}
              <div className="account-actions">
                <button className="primary-button" disabled={passwordBusy} type="submit">{passwordBusy ? "Guardando…" : "Guardar contraseña"}</button>
                <button className="ghost-button" disabled={passwordBusy} onClick={closePasswordForm} type="button">Cancelar</button>
              </div>
            </form>
          )}
        </article>
      </section>
    </div>
  );
}
