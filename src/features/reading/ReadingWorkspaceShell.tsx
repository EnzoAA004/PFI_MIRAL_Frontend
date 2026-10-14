import type { CSSProperties, ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { readingThemeAttribute, setTheme, useTheme } from "../../design/theme";

/**
 * La sala declara el tema sobre sí misma y, al estar anidada, gana sobre el de
 * <html>. Sigue la misma preferencia que la superficie operativa: es una sola
 * elección para todo el producto, no dos.
 *
 * El viewport queda negro en los dos temas —ver el comentario del bloque
 * [data-theme="reading-light"] en tokens.css—, así que lo que cambia acá es el
 * marco: barras, paneles, inspector y diálogos.
 */
export function ReadingWorkspaceShell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <div className="rr" data-theme={readingThemeAttribute(theme)}>{children}</div>;
}

/**
 * El alternador de la barra de navegación no está disponible acá: la sala es
 * inmersiva y esa barra no se monta. Sin este botón, entrar a un estudio sería
 * entrar a la única pantalla donde la preferencia no se puede cambiar.
 */
export function ReadingThemeToggle() {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const label = next === "light" ? "Cambiar a tema claro" : "Cambiar a tema oscuro";

  return (
    <button
      aria-label={label}
      className="rr-ghost rr-theme-toggle"
      onClick={() => setTheme(next)}
      title={label}
      type="button"
    >
      {next === "light" ? <Sun aria-hidden size={14} /> : <Moon aria-hidden size={14} />}
    </button>
  );
}

export function ReadingWorkspaceHeader({ children }: { children: ReactNode }) {
  return <header className="rr-topbar">{children}</header>;
}

export function ReadingWorkspaceBody({
  children,
  inspectorCollapsed,
  inspectorWidth,
}: {
  children: ReactNode;
  inspectorCollapsed: boolean;
  /** Ancho del panel derecho en píxeles; sin él, el CSS usa su ancho por defecto. */
  inspectorWidth?: number;
}) {
  const style = inspectorWidth ? ({ "--rr-inspector-width": `${inspectorWidth}px` } as CSSProperties) : undefined;
  return <div className="rr-body" data-inspector={inspectorCollapsed ? "collapsed" : "visible"} style={style}>{children}</div>;
}

export function ReadingWorkspaceToolbar({ children }: { children: ReactNode }) {
  return <div className="rr-toolbar" role="toolbar" aria-label="Herramientas de lectura">{children}</div>;
}
