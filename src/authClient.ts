import { API_BASE_URL, ApiError } from "./api";
import { ensureAuthSession, getCachedAuthSession, saveAuthSession } from "./authStorage";
import { coordinateRefresh } from "./security/refreshCoordinator";
import { clearAllProtectedData, notifySessionInvalidated } from "./security/sessionCleanup";
import { generateTraceId } from "./security/traceId";
import type { AuthLoginResponse, AuthPendingResponse, AuthSession, AuthSettingsRequest, AuthTokenResponse, AuthUser, RegisterRequest } from "./appTypes";

async function authRequest<T>(path: string, body?: unknown, method = "POST", includeAuth = false): Promise<T> {
  const traceId = generateTraceId("frontend-auth");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Trace-Id": traceId, ...(includeAuth ? authHeaders() : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new ApiError(`Backend respondio ${response.status}`, { path, status: response.status, traceId });
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

export async function registerDoctor(payload: RegisterRequest) {
  try {
    return await authRequest<AuthPendingResponse>("/api/auth/register", payload);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
  }

  try {
    return await loginDoctor(payload.email, payload.password);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw new Error("Ya existe una cuenta con ese correo. Usá la contraseña de esa cuenta para ingresar o continuar la verificación.");
    }
    throw error;
  }
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

/**
 * Cambia la contraseña de la cuenta autenticada. El backend revoca las demás sesiones y devuelve
 * una sesión nueva, que se guarda para que quien cambia la clave siga adentro.
 */
export async function changePassword(currentPassword: string, newPassword: string) {
  const traceId = generateTraceId("frontend-auth");
  const response = await fetch(`${API_BASE_URL}/api/auth/password`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Trace-Id": traceId, ...authHeaders() },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!response.ok) {
    let message = "";
    try {
      const body = (await response.json()) as { message?: string };
      message = typeof body.message === "string" ? body.message : "";
    } catch {
      message = "";
    }
    throw new Error(message || `No se pudo cambiar la contraseña (${response.status}).`);
  }
  return saveAuthSession((await response.json()) as AuthTokenResponse);
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
