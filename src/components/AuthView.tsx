import { useState } from "react";
import { ApiError, LOCAL_EVALUATION } from "../api";
import { createDemoDoctorSession, loginDoctor, registerDoctor, requestPasswordReset, resetPassword, verifyLogin, verifyRegistration } from "../authClient";
import type { AuthPendingResponse, AuthSession, RegisterRequest } from "../appTypes";
import { emailProblem, PASSWORD_RULES_TEXT, passwordProblem } from "../features/auth/passwordPolicy";

interface AuthViewProps {
  onAuthenticated: (session: AuthSession) => void;
}

type Mode = "login" | "register" | "forgot";

type ChallengeState = {
  mode: Mode;
  challenge: AuthPendingResponse;
  email: string;
};

// El acceso demo es un opt-in explícito en tiempo de build. Los builds públicos/de evaluación local
// mantienen el endpoint y las credenciales demo fuera de la pantalla de login por defecto.
const authDemoEnabled = import.meta.env.VITE_DEMO_LOGIN_ENABLED === "true";

function isSession(value: AuthPendingResponse | AuthSession): value is AuthSession {
  return typeof (value as AuthSession).accessToken === "string";
}

export function AuthView({ onAuthenticated }: AuthViewProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [form, setForm] = useState<RegisterRequest>({
    fullName: authDemoEnabled ? "Dra. Demo Revisora" : "",
    email: authDemoEnabled ? "doctor.demo@pfi.local" : "",
    password: authDemoEnabled ? "Demo1234!" : "",
    licenseNumber: authDemoEnabled ? "MN-DEMO-2026" : "",
    specialty: authDemoEnabled ? "Radiologia / Columna lumbar" : "",
    institution: authDemoEnabled ? "PFI Academic Lab" : "",
  });
  const [challengeState, setChallengeState] = useState<ChallengeState | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  /** Mientras se envía el correo con el código, y los segundos en que se muestra la confirmación antes de pasar a la pantalla del código. */
  const [sendingCode, setSendingCode] = useState(false);
  /** Solo versión local: correo recién registrado, a la espera de que el administrador lo apruebe. */
  const [registeredEmail, setRegisteredEmail] = useState("");
  /** «Olvidé mi contraseña»: el desafío del código pedido, la contraseña nueva y su repetición. */
  const [resetChallengeId, setResetChallengeId] = useState<string | null>(null);
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");

  function goTo(next: Mode) {
    setMode(next);
    setChallengeState(null);
    setResetChallengeId(null);
    setResetCode("");
    setNewPassword("");
    setNewPassword2("");
    setError("");
    setMessage("");
  }

  async function askResetCode() {
    if (!form.email.trim()) { setError("Ingresá tu correo profesional."); return; }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await requestPasswordReset(form.email.trim());
      setResetChallengeId(response.challengeId ?? null);
      setMessage(LOCAL_EVALUATION
        ? "Pedido registrado. En esta versión local no se envía correo: el código se lee en el registro del backend (pasos abajo)."
        : "Si el correo corresponde a una cuenta verificada, te enviamos un código. Revisá tu bandeja de entrada (y el spam).");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "No se pudo pedir el código");
    } finally {
      setLoading(false);
    }
  }

  async function confirmReset() {
    if (!resetChallengeId) return;
    const problem = passwordProblem(newPassword) ?? (newPassword !== newPassword2 ? "Las dos contraseñas nuevas no coinciden." : null);
    if (problem) { setError(problem); return; }
    setLoading(true);
    setError("");
    try {
      await resetPassword(resetChallengeId, resetCode.trim(), newPassword);
      goTo("login");
      setForm((current) => ({ ...current, password: "" }));
      setMessage("Contraseña actualizada. Ingresá con la contraseña nueva.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "No se pudo restablecer la contraseña");
    } finally {
      setLoading(false);
    }
  }

  function updateField(key: keyof RegisterRequest, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    if (mode === "register") {
      const problem = emailProblem(form.email) ?? passwordProblem(form.password);
      if (problem) { setError(problem); setMessage(""); return; }
    }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      if (mode === "register") setSendingCode(true);
      const response = mode === "register"
        ? await registerDoctor(form)
        : await loginDoctor(form.email, form.password);
      if (isSession(response)) {
        onAuthenticated(response);
        return;
      }
      if (!response.challengeId) {
        setMessage(response.message ?? "Solicitud recibida. Revisá el estado de la cuenta profesional.");
        return;
      }
      if (LOCAL_EVALUATION && mode === "register" && response.channel === "email-demo" && !response.devVerificationCode) {
        // Versión local: no hay código por correo. La cuenta queda creada y la aprueba el administrador.
        setRegisteredEmail(form.email);
        setForm((current) => ({ ...current, password: "" }));
        setMode("login");
        setError("");
        return;
      }
      if (response.channel === "email") {
        // El correo salió: se confirma unos segundos y después se pasa a ingresar el código.
        setSendingCode(false);
        setMessage(`Código enviado a ${form.email}. Revisá tu bandeja de entrada (y el spam).`);
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
      }
      setChallengeState({ mode, challenge: response, email: form.email });
      setCode(response.devVerificationCode ?? "");
      setMessage(response.channel === "email-demo" && !response.devVerificationCode
        ? "El envío de correo no está habilitado en este entorno. Si todavía no activaron tu cuenta, contactá al administrador."
        : response.message ?? "Código de verificación generado.");
    } catch (submitError) {
      setError(mode === "register" && submitError instanceof ApiError && submitError.status === 503
        ? "Falló el envío del código. Verificá tus datos, preferentemente el correo electrónico, e intentá nuevamente."
        : submitError instanceof Error ? submitError.message : "No se pudo completar la solicitud");
    } finally {
      setSendingCode(false);
      setLoading(false);
    }
  }

  async function verify() {
    if (!challengeState?.challenge.challengeId) return;
    setLoading(true);
    setError("");
    try {
      const session = challengeState.mode === "register"
        ? await verifyRegistration(challengeState.challenge.challengeId, code)
        : await verifyLogin(challengeState.challenge.challengeId, code);
      onAuthenticated(session as AuthSession);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Codigo invalido o expirado");
    } finally {
      setLoading(false);
    }
  }

  async function startDemo() {
    setLoading(true);
    setError("");
    try {
      const session = await createDemoDoctorSession();
      onAuthenticated(session as AuthSession);
    } catch (demoError) {
      setError(demoError instanceof Error ? demoError.message : "No se pudo iniciar la sesión demo");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark" aria-hidden="true"><img alt="" src="/logo.svg" /></div>
          <div>
            <strong>MIRA·L</strong>
            <span>Mapeo Integrado y Revisión Anatómica Lumbar</span>
          </div>
        </div>
        <div className="auth-copy">
          <p>Secure doctor access</p>
          <h1>{mode === "register" ? "Registrar profesional" : mode === "forgot" ? "Restablecer contraseña" : "Ingresar como profesional"}</h1>
          <span>El acceso protege el flujo de revision, historial y endpoints del pipeline asistivo.</span>
        </div>
        <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => goTo("login")} type="button">Ingresar</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => goTo("register")} type="button">Registro</button>
        </div>
        {LOCAL_EVALUATION && registeredEmail && mode === "login" && !challengeState && (
          <div className="verification-panel local-guide" role="status">
            <strong>Cuenta creada: {registeredEmail}</strong>
            <p>En esta versión local no hay verificación por correo. Un administrador tiene que habilitar tu cuenta:</p>
            <ol>
              <li>Abrí otra ventana del navegador en modo incógnito, en esta misma dirección.</li>
              <li>Ahí ingresá como <b>administrador</b> con las credenciales que mostró <code>iniciar.ps1</code>.</li>
              <li>En el menú <b>Profesionales</b>, buscá <b>{registeredEmail}</b> y tocá <b>Activar manualmente</b>.</li>
              <li>Volvé a esta ventana, ingresá con tu correo y contraseña: ya vas a ver <b>Pacientes</b>.</li>
            </ol>
            <p>Si al ingresar te dice que la cuenta no está habilitada, el administrador todavía no la aprobó.</p>
          </div>
        )}
        {LOCAL_EVALUATION && !registeredEmail && !challengeState && (
          <div className="verification-panel local-guide" role="note">
            <strong>Versión local de evaluación</strong>
            {mode === "register"
              ? <p>Completá tus datos y creá la cuenta. No se envía ningún código por correo: después un administrador la aprueba (te vamos a indicar cómo).</p>
              : <p>Si ya tenés una cuenta aprobada, ingresá. Si sos el administrador, usá las credenciales que mostró <code>iniciar.ps1</code>. Para registrar un médico nuevo, usá la pestaña <b>Registro</b>.</p>}
          </div>
        )}
        {mode === "forgot" ? (
          <div className="auth-form">
            {LOCAL_EVALUATION && (
              <div className="verification-panel local-guide" role="note">
                <strong>Contraseña olvidada · versión local</strong>
                <p>Esta versión no envía correos. Pedí el código acá y leelo del registro del backend:</p>
                <ol>
                  <li>Ingresá tu correo y tocá <b>Pedir código</b>.</li>
                  <li>En PowerShell, dentro de la carpeta del paquete, ejecutá <code>.\codigo-restablecer.ps1</code>: muestra el código de 6 dígitos.</li>
                  <li>Escribilo acá, elegí la contraseña nueva y tocá <b>Cambiar contraseña</b>.</li>
                </ol>
                <p>El código vence a los 10 minutos y se puede probar hasta 5 veces. Si olvidaste la contraseña del <b>administrador</b>, está en el mensaje que mostró <code>iniciar.ps1</code>.</p>
              </div>
            )}
            <label>Correo profesional<input autoComplete="email" disabled={!!resetChallengeId} value={form.email} onChange={(event) => updateField("email", event.target.value)} /></label>
            {!resetChallengeId ? (
              <button className="primary-button" disabled={loading} onClick={() => void askResetCode()} type="button">{loading ? "Procesando..." : "Pedir código"}</button>
            ) : (
              <>
                <label>Código de 6 dígitos<input inputMode="numeric" maxLength={6} value={resetCode} onChange={(event) => setResetCode(event.target.value)} /></label>
                <label>Contraseña nueva<input autoComplete="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
                <label>Repetir contraseña nueva<input autoComplete="new-password" type="password" value={newPassword2} onChange={(event) => setNewPassword2(event.target.value)} /></label>
                <small className="auth-hint">{PASSWORD_RULES_TEXT}</small>
                <button className="primary-button" disabled={loading || resetCode.trim().length !== 6} onClick={() => void confirmReset()} type="button">{loading ? "Procesando..." : "Cambiar contraseña"}</button>
                <button className="ghost-button" disabled={loading} onClick={() => { setResetChallengeId(null); setResetCode(""); setMessage(""); setError(""); }} type="button">Pedir otro código</button>
              </>
            )}
            <button className="ghost-button" onClick={() => goTo("login")} type="button">Volver a ingresar</button>
          </div>
        ) : !challengeState ? (
          <div className="auth-form">
            {mode === "register" && (
              <>
                <label>Nombre completo<input value={form.fullName} onChange={(event) => updateField("fullName", event.target.value)} /></label>
                <label>Matricula<input value={form.licenseNumber ?? ""} onChange={(event) => updateField("licenseNumber", event.target.value)} /></label>
                <label>Especialidad<input value={form.specialty ?? ""} onChange={(event) => updateField("specialty", event.target.value)} /></label>
                <label>Institucion<input value={form.institution ?? ""} onChange={(event) => updateField("institution", event.target.value)} /></label>
              </>
            )}
            <label>Correo profesional<input value={form.email} onChange={(event) => updateField("email", event.target.value)} /></label>
            <label>Contraseña<input autoComplete={mode === "register" ? "new-password" : "current-password"} type="password" value={form.password} onChange={(event) => updateField("password", event.target.value)} /></label>
            {mode === "register" && <small className="auth-hint">{PASSWORD_RULES_TEXT}</small>}
            <button className="primary-button" disabled={loading} onClick={() => void submit()} type="button">{sendingCode ? "Enviando código…" : loading ? "Procesando..." : mode === "register" ? (LOCAL_EVALUATION ? "Crear cuenta" : "Crear cuenta y verificar") : "Ingresar"}</button>
            <button className="auth-link" onClick={() => goTo("forgot")} type="button">¿Olvidaste tu contraseña?</button>
            {authDemoEnabled && <button className="ghost-button" disabled={loading} onClick={() => void startDemo()} type="button">Entrar con doctor demo</button>}
          </div>
        ) : (
          <div className="auth-form">
            <div className="verification-panel">
              <strong>{challengeState.mode === "register" ? "Verificación de registro" : "Doble verificación"}</strong>
              <p>{message}</p>
              {challengeState.challenge.devVerificationCode && <span>Codigo demo: {challengeState.challenge.devVerificationCode}</span>}
            </div>
            <label>Codigo de 6 digitos<input value={code} onChange={(event) => setCode(event.target.value)} maxLength={6} /></label>
            <button className="primary-button" disabled={loading} onClick={() => void verify()} type="button">Verificar</button>
            <button className="ghost-button" onClick={() => setChallengeState(null)} type="button">Volver</button>
          </div>
        )}
        {sendingCode && <div className="toast info" role="status">Enviando el código de verificación a tu correo…</div>}
        {message && !challengeState && !sendingCode && <div className="toast info" role="status">{message}</div>}
        {error && <div className="toast error">{error}</div>}
      </section>
    </main>
  );
}
