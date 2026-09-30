/**
 * Tema del producto. Hay dos valores y una sola preferencia guardada, que
 * gobierna las dos superficies:
 *
 *   superficie operativa    lista de trabajo, pacientes, cargador,
 *                           configuración y acceso. El atributo vive en <html>:
 *                           `data-theme="clinical"` para oscuro, sin atributo
 *                           para claro (que es la paleta base de :root).
 *
 *   sala de lectura (PACS)  declara el tema sobre sí misma y, al estar anidada,
 *                           gana siempre: `data-theme="reading"` para oscuro y
 *                           `data-theme="reading-light"` para claro.
 *
 * Antes la sala de lectura era oscura y punto: una sala de lectura es una sala
 * oscura, y sobre un fondo claro el ojo se adapta a la interfaz en vez de a la
 * imagen. Eso sigue siendo cierto y por eso el oscuro es el que se elige sin
 * preferencia guardada, pero el visor **no** puede ser la única pantalla que
 * ignora la elección de quien lo usa. El compromiso: el marco acompaña el tema,
 * el viewport se queda negro en los dos. La imagen nunca se lee sobre blanco.
 *
 * El atributo de <html> se escribe antes del primer pintado desde un script en
 * línea en index.html; este módulo comparte con él la clave y la lógica de
 * resolución para que no puedan divergir.
 */
import { useEffect, useState } from "react";

export type OperationsTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "pfi.theme";

/** Preferencia guardada, o `null` si quien usa el sistema nunca eligió. */
export function storedTheme(): OperationsTheme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    // El almacenamiento puede estar deshabilitado; se cae a la preferencia del sistema.
    return null;
  }
}

/**
 * Sin elección explícita se sigue al sistema operativo. El fallback es oscuro
 * porque es el que comparte lenguaje con el visor, que es donde transcurre el
 * trabajo real.
 */
export function resolveTheme(): OperationsTheme {
  const stored = storedTheme();
  if (stored) return stored;
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: OperationsTheme) {
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute("data-theme", "clinical");
  else root.removeAttribute("data-theme");
}

export function persistTheme(theme: OperationsTheme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Sin almacenamiento la elección dura lo que dure la pestaña.
  }
}

/**
 * El valor del token de la sala de lectura para un tema dado. La sala no usa
 * `clinical`/sin-atributo: tiene su propia escala, un paso más profunda en
 * oscuro y un paso más neutra en claro.
 */
export function readingThemeAttribute(theme: OperationsTheme): "reading" | "reading-light" {
  return theme === "light" ? "reading-light" : "reading";
}

/*
 * La preferencia la pueden cambiar dos controles en pantallas distintas —el pie
 * de la barra de navegación y la barra del visor—, así que no puede vivir en el
 * estado local de ninguno de los dos: el que no recibió el clic se quedaría
 * mostrando el ícono del tema anterior. Un registro de suscriptores a nivel de
 * módulo alcanza; no amerita un contexto de React para un enum de dos valores.
 */
const listeners = new Set<(theme: OperationsTheme) => void>();

/** Guarda la elección, la aplica a <html> y despierta a todos los controles. */
export function setTheme(theme: OperationsTheme) {
  persistTheme(theme);
  applyTheme(theme);
  for (const listener of listeners) listener(theme);
}

/** Tema vigente, sincronizado entre todos los componentes que lo lean. */
export function useTheme(): OperationsTheme {
  const [theme, setThemeState] = useState<OperationsTheme>(() => resolveTheme());

  useEffect(() => {
    listeners.add(setThemeState);
    // Otra pestaña del mismo profesional pudo haber cambiado la preferencia.
    setThemeState(resolveTheme());
    return () => { listeners.delete(setThemeState); };
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return theme;
}
