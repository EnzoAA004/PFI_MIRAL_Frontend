/**
 * Protección de ediciones sin guardar.
 *
 * Cada vista que tiene ediciones propias (Revisión, editor del preinforme) registra aquí la lista de lo que está
 * pendiente. Esa lista sale de comparar el estado actual con el último estado cargado o guardado: no es un
 * interruptor que se prende al tocar un campo. Si la lista está vacía no hay nada que proteger.
 *
 * Quién la consulta:
 *  - la navegación interna y el «atrás» del navegador (UnsavedChangesGuard, con el bloqueador del router);
 *  - los botones propios que cierran una vista sin cambiar de ruta (`requestLeave`);
 *  - el cierre o la recarga de la pestaña (evento nativo `beforeunload`).
 *
 * Nada de esto guarda, aprueba ni cambia estados: solo pregunta antes de descartar.
 */

export type PendingEntry = { id: string; label: string; items: string[] };

type Listener = () => void;

type DialogRequest = { proceed: () => void; cancel: () => void; opener: Element | null; scope: string | null };

const entries = new Map<string, PendingEntry>();
const listeners = new Set<Listener>();
let snapshot: { pending: PendingEntry[]; request: DialogRequest | null } = { pending: [], request: null };

function emit() {
  snapshot = { pending: [...entries.values()].filter((entry) => entry.items.length > 0), request: snapshot.request };
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getSnapshot() {
  return snapshot;
}

/** Registra (o limpia, con `items` vacío) lo pendiente de una vista. Devuelve la función que la quita. */
export function setPending(id: string, label: string, items: string[]): () => void {
  if (items.length === 0) entries.delete(id);
  else entries.set(id, { id, label, items });
  emit();
  return () => {
    if (entries.delete(id)) emit();
  };
}

/** Hay algo pendiente (de una vista concreta si se indica `scope`, o de cualquiera). */
export function hasPending(scope?: string): boolean {
  return [...entries.values()].some((entry) => entry.items.length > 0 && (!scope || entry.id === scope));
}

export function pendingItems(): string[] {
  return [...entries.values()].flatMap((entry) => entry.items);
}

/** Abre la confirmación; la acción original se ejecuta solo con «Salir sin guardar». */
export function openConfirmation(proceed: () => void, cancel: () => void = () => undefined, scope: string | null = null) {
  const opener = typeof document !== "undefined" ? document.activeElement : null;
  snapshot = { ...snapshot, request: { proceed, cancel, opener, scope } };
  listeners.forEach((listener) => listener());
}

export function resolveConfirmation(action: "stay" | "leave") {
  const request = snapshot.request;
  if (!request) return;
  snapshot = { ...snapshot, request: null };
  listeners.forEach((listener) => listener());
  if (action === "leave") {
    request.proceed();
    return;
  }
  request.cancel();
  // El foco vuelve a lo que lo tenía al abrir la confirmación.
  if (typeof HTMLElement !== "undefined" && request.opener instanceof HTMLElement && request.opener.isConnected) request.opener.focus();
}

/**
 * Ejecuta `proceed` enseguida si no hay nada pendiente; si lo hay, pide confirmación antes. Devuelve true si siguió sin preguntar.
 * Para botones propios que cierran una vista sin cambiar de ruta.
 */
export function requestLeave(proceed: () => void, options: { cancel?: () => void; scope?: string } = {}): boolean {
  if (!hasPending(options.scope)) {
    proceed();
    return true;
  }
  openConfirmation(proceed, options.cancel, options.scope ?? null);
  return false;
}

/** Solo para pruebas. */
export function resetForTests() {
  entries.clear();
  snapshot = { pending: [], request: null };
  listeners.clear();
}
