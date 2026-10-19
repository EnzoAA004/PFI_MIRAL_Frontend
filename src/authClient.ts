import { API_BASE_URL } from "./api";
import { ensureAuthSession, getCachedAuthSession, saveAuthSession } from "./authStorage";
import { coordinateRefresh } from "./security/refreshCoordinator";
import { clearAllProtectedData, notifySessionInvalidated } from "./security/sessionCleanup";
import { generateTraceId } from "./security/traceId";
import type { AuthLoginResponse, AuthPendingResponse, AuthSession, AuthSettingsRequest, AuthTokenResponse, AuthUser, RegisterRequest } from "./appTypes";

/**
 * Error de una llamada de autenticación. `message` es lo que se le muestra a la persona (en español, según qué falló);
 * `status` y `detail` quedan para diagnóstico y no se exponen como explicación principal.
 */
export class AuthRequestError extends Error {
  status: number | null;
  detail: string;

  constructor(message: string, status: number | null, detail: string) {
    super(message);
    this.name = "AuthRequestError";
    this.status = status;
    this.detail = detail;
  }
}

/** Mensaje comprensible según el motivo: credenciales inválidas, sesión inválida, permisos, límite de intentos o servicio caído. */
export function authFailureMessage(status: number | null, path: string): string {
  if (status === null) return "No se pudo conectar con el servicio. Verificá tu conexión e intentá de nuevo.";
  if (path.endsWith("/login")) {
    if (status === 401 || status === 400) return "Correo o contraseña incorrectos.";
  }
  if (path.includes("/verify-")) {
    if (status === 400 || status === 401) return "El código es inválido o venció. Pedí uno nuevo e intentá de nuevo.";
  }
  if (status === 401) return "Tu sesión no es válida. Ingresá de nuevo.";
  if (status === 403) return "Tu cuenta no tiene permiso para esta acción o todavía no fue aprobada.";
  if (status === 409) return "Ya existe una cuenta con esos datos.";
  if (status === 423 || status === 429) return "Hubo demasiados intentos. Esperá unos minutos antes de volver a intentar.";
  if (status === 400 || status === 422) return "Revisá los datos ingresados e intentá de nuevo.";
  if (status >= 500) return "El servicio no respondió. Reintentá en unos minutos.";
  return "No se pudo completar la solicitud.";
}

async function authRequest<T>(path: string, body?: unknown, method = "POST", includeAuth = false): Promise<T> {
  const traceId = generateTraceId("frontend-auth");
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Trace-Id": traceId, ...(includeAuth ? authHeaders() : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AuthRequestError(authFailureMessage(null, path), null, "sin conexión");
  }
  if (!response.ok) throw new AuthRequestError(authFailureMessage(response.status, path), response.status, `HTTP ${response.status}`);
  return (await response.json()) as T;
}

function isTokenResponse(value: AuthLoginResponse): value is AuthTokenResponse {
  return typeof (value as AuthTokenResponse).accessToken === "string" && typeof (value as AuthTokenResponse).refreshToken === "string";
}

export function authHeaders(): Record<string, string> {
  const session = getCachedAuthSession();
  if (!session?.accessToken) return {};
  return { Authorization: `Bearer ${session.accessToken}` };
}

export function registerDoctor(payload: RegisterRequest) {
  return authRequest<AuthPendingResponse>("/api/auth/register", payload);
}

export async function loginDoctor(email: string, password: string) {
  const response = await authRequest<AuthLoginResponse>("/api/auth/login", { email, password });
  return isTokenResponse(response) ? saveAuthSession(response) : response;
}

export async function verifyRegistration(challengeId: string, code: string) {
  const tokens = await authRequest<AuthTokenResponse>("/api/auth/verify-registration", { challengeId, code });
  return saveAuthSession(tokens);
}

export async function verifyLogin(challengeId: string, code: string) {
  const tokens = await authRequest<AuthTokenResponse>("/api/auth/verify-login", { challengeId, code });
  return saveAuthSession(tokens);
}

export async function createDemoDoctorSession() {
  const tokens = await authRequest<AuthTokenResponse>("/api/auth/demo-doctor");
  return saveAuthSession(tokens);
}

export function refreshDoctorSession(): Promise<AuthSession> {
  return coordinateRefresh(async () => {
    // Se espera la hidratación antes de concluir que no hay sesión: durante el
    // arranque la caché todavía está vacía y darla por perdida aquí desloguea a un
    // usuario cuyo token sigue siendo válido.
    const session = getCachedAuthSession() ?? await ensureAuthSession();
    if (!session?.refreshToken) {
      notifySessionInvalidated();
      throw new Error("No hay refresh token disponible");
    }
    try {
      const tokens = await authRequest<AuthTokenResponse>("/api/auth/refresh", { refreshToken: session.refreshToken });
      return saveAuthSession(tokens);
    } catch (error) {
      // A failed refresh means the session is gone (expired/revoked refresh
      // token) — clear it here so every call site, not just the one that
      // happened to trigger the refresh, observes a logged-out state.
      notifySessionInvalidated();
      throw error;
    }
  });
}

export async function getCurrentDoctor() {
  return authRequest<AuthUser>("/api/auth/me", undefined, "GET", true);
}

export async function updateDoctorSettings(settings: AuthSettingsRequest) {
  const user = await authRequest<AuthUser>("/api/auth/settings", settings, "PATCH", true);
  const session = getCachedAuthSession();
  if (session) saveAuthSession({ ...session, user });
  return user;
}

export async function listProfessionals() {
  return authRequest<AuthUser[]>("/api/auth/admin/professionals", undefined, "GET", true);
}

export async function updateProfessionalApproval(email: string, approved: boolean) {
  return authRequest<AuthUser>("/api/auth/admin/professionals/approval", { email, approved }, "PATCH", true);
}

export async function logoutDoctor() {
  const session = getCachedAuthSession();
  if (session?.refreshToken) {
    await authRequest<{ status: string }>("/api/auth/logout", { refreshToken: session.refreshToken }).catch(() => ({ status: "local" }));
  }
  await clearAllProtectedData();
}
