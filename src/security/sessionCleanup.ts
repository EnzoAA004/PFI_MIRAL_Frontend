import { clearAuthSession } from "../authStorage";
import { asyncRemoveItem } from "../browserStorage";

/** Se dispara cada vez que la sesión se invalida por un refresh fallido/ausente, para que App.tsx pueda descartar el estado en memoria y redirigir al login. */
export const SESSION_INVALIDATED_EVENT = "pfi:session-invalidated";

const REVIEW_HISTORY_KEY = "lumbar-mri-review-history-v1";
/*
 * El estudio seleccionado ya no se persiste: viaja por props desde App. La clave se
 * sigue borrando en el logout para limpiar el residuo que dejaron las versiones que
 * sí lo escribían en sessionStorage, en un navegador que todavía no lo tenga limpio.
 */
const SELECTED_STUDY_KEY = "pfi.selectedStudyDetail";
const CROSS_TAB_CHANNEL = "pfi-session-sync";

// IndexedDB (donde vive la sesión, ver authStorage.ts) no dispara el evento
// nativo `storage` entre pestañas como lo hace localStorage, así que
// BroadcastChannel propaga la invalidación de sesión entre las pestañas abiertas.
function crossTabChannel(): BroadcastChannel | undefined {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return undefined;
  try {
    return new BroadcastChannel(CROSS_TAB_CHANNEL);
  } catch {
    return undefined;
  }
}

/** Se llama cuando un intento de refresh falla de forma definitiva: limpia la sesión y notifica a los listeners (P10-C.1 §3). */
export function notifySessionInvalidated() {
  clearAuthSession();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_INVALIDATED_EVENT));
  crossTabChannel()?.postMessage({ type: "session-invalidated" });
}

/**
 * Limpia cada almacén de datos protegido al hacer logout (manual o forzado), según
 * P10-C.1 §4. Deliberadamente deja intactas las preferencias visuales no sensibles
 * (lumbar-mri-professional-settings-v1: idioma/densidad/notificaciones)
 * sin tocar.
 */
export async function clearAllProtectedData(options: { broadcast?: boolean } = {}): Promise<void> {
  clearAuthSession();
  await asyncRemoveItem(REVIEW_HISTORY_KEY);
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(SELECTED_STUDY_KEY);
    } catch {
      // sessionStorage no disponible (modo privado, etc.) — limpieza best-effort.
    }
  }
  if (options.broadcast !== false) crossTabChannel()?.postMessage({ type: "logout" });
}

/** Se suscribe al logout/invalidación de sesión entre pestañas; devuelve una función para cancelar la suscripción. */
export function onCrossTabSessionSync(onSync: () => void): () => void {
  const channel = crossTabChannel();
  if (!channel) return () => undefined;
  const handler = (event: MessageEvent) => {
    const type = (event.data as { type?: string } | undefined)?.type;
    if (type === "logout" || type === "session-invalidated") onSync();
  };
  channel.addEventListener("message", handler);
  return () => {
    channel.removeEventListener("message", handler);
    channel.close();
  };
}
