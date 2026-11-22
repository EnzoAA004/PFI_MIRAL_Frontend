import { API_BASE_URL } from "../api";

/**
 * Política de origen común para cada llamada autenticada al backend (P10-C.1 §2).
 * Replica la validación más estricta ya probada para el asset durable de la malla 3D
 * en adapters/multiplanarRunAdapter.ts (isDurableMeshAssetUrl): solo un path `/api/...`
 * relativo al backend, o una URL absoluta cuyo origen coincida exactamente con
 * API_BASE_URL, está autorizado a recibir Authorization/credenciales.
 * multiplanarRunAdapter.ts mantiene su propia copia (su test en sandbox transpila
 * ese archivo de forma aislada con los imports eliminados), así que este módulo es la
 * política canónica para todo otro módulo HTTP de la app.
 */

const BLOCKED_URL_PATTERNS: RegExp[] = [
  /^[a-zA-Z]:\\/, // path de unidad de Windows
  /^\/tmp\//,
  /^\/app\//,
  /\.internal(\/|$)/i,
  /trycloudflare\.com/i,
];

/**
 * Hosts que solo se aceptan cuando son exactamente el backend configurado.
 *
 * Bloquearlos por patrón impedía que el token viajara a un servicio local ajeno,
 * pero también rechazaba el propio backend en desarrollo, donde API_BASE_URL es
 * http://localhost:8080: los assets de la corrida nunca se pedían y el visor
 * quedaba en "imagen no disponible" con el estudio correctamente persistido.
 *
 * La comparación por origen exacto contra API_BASE_URL, que ya se hace más abajo,
 * es una garantía más fuerte que la coincidencia por substring: "localhost" dentro
 * de la URL no implica que el origen sea el backend (por ejemplo
 * https://localhost.evil.com), y esa distinción la resuelve `parsed.origin`.
 */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const UNSAFE_SCHEMES = /^(file|data|blob|javascript|ftp):/i;

function backendOrigin(): string | undefined {
  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return undefined;
  }
}

/**
 * Devuelve la URL/path sanitizado si está autorizado a recibir el
 * header Authorization del médico, de lo contrario undefined. Rechaza antes de que se intente cualquier
 * `fetch()` — quienes llaman nunca deben hacer fetch primero y validar
 * después.
 */
export function isAuthorizedBackendUrl(value: unknown): string | undefined {
  const url = typeof value === "string" ? value.trim() : undefined;
  if (!url) return undefined;
  if (UNSAFE_SCHEMES.test(url)) return undefined;
  if (url.startsWith("//")) return undefined; // relativa al protocolo
  if (url.includes("..")) return undefined; // path traversal
  if (BLOCKED_URL_PATTERNS.some((pattern) => pattern.test(url))) return undefined;
  if (url.startsWith("/api/")) return url;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return undefined; // credenciales embebidas
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    const origin = backendOrigin();
    const backendIsHttps = origin?.startsWith("https:");
    if (backendIsHttps && parsed.protocol !== "https:") return undefined;
    // Un host local solo se acepta si ES el backend configurado, nunca por el mero
    // hecho de llamarse localhost.
    if (LOCAL_HOSTNAMES.has(parsed.hostname) && parsed.origin !== origin) return undefined;
    if (origin && parsed.origin === origin && parsed.pathname.startsWith("/api/")) return url;
  } catch {
    return undefined;
  }
  return undefined;
}

/** Arma una URL absoluta del backend a partir de un path relativo `/api/...`, validándolo primero. */
export function buildBackendUrl(path: string): string {
  const sanitized = isAuthorizedBackendUrl(path);
  if (!sanitized) throw new Error("Ruta de backend no autorizada.");
  return sanitized.startsWith("/api/") ? `${API_BASE_URL}${sanitized}` : sanitized;
}
