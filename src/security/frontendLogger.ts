/** Wrapper de consola mínimo y sanitizante (P10-C.1 §7/§8). */

const isProd = Boolean(import.meta.env.PROD);

function sanitize(data: unknown): unknown {
  if (data === undefined) return undefined;
  if (data instanceof Error) return { name: data.name, message: data.message };
  if (data && typeof data === "object") {
    try {
      return JSON.parse(JSON.stringify(data));
    } catch {
      return "[unserializable]";
    }
  }
  return data;
}

export const frontendLogger = {
  /** Solo para diagnóstico; deshabilitado por completo en los builds de producción. */
  debug(message: string, data?: unknown) {
    if (isProd) return;
    console.debug(message, sanitize(data));
  },
  warn(message: string, data?: unknown) {
    console.warn(message, sanitize(data));
  },
  error(message: string, data?: unknown) {
    console.error(message, sanitize(data));
  },
};
