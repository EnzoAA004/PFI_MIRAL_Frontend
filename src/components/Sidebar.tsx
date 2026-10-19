import type { ViewKey } from "../appTypes";
import { Fragment, type ComponentType, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ListChecks, Moon, Settings, ShieldCheck, Sun, Users } from "lucide-react";
import { setTheme, useTheme, type OperationsTheme } from "../design/theme";

/**
 * Navigation follows the reading workflow, not the module structure.
 *
 * "Inicio", "Estudios" and "Cola de revisión" were three routes rendering the
 * same table with a different filter; they collapse into a single worklist whose
 * filter chips carry the counts. The pending badge moves onto that entry.
 */
const navItems: Array<{ key: ViewKey; label: string; icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>; badge?: "reviewQueue" }> = [
  { key: "dashboard", label: "Lista de trabajo", icon: ListChecks, badge: "reviewQueue" },
  { key: "patients", label: "Pacientes", icon: Users },
  { key: "settings", label: "Configuración", icon: Settings },
];

interface SidebarProps {
  activeView: ViewKey;
  activeNavView?: ViewKey;
  onChangeView: (view: ViewKey) => void;
  reviewQueueCount: number;
  /** `true`/`false` solo cuando hay una comprobación real del módulo de IA; `null` = sin dato (se muestra solo la versión). */
  systemOnline?: boolean | null;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Identidad de quien firma la revisión. Vive al pie del nav, no en una
   *  barra propia sobre el contenido: es parte del marco, no de la pantalla. */
  identity?: ReactNode;
}

/**
 * Alternador de tema. La preferencia es una sola para todo el producto: la sala
 * de lectura la sigue con su propia escala (`data-theme="reading"` /
 * `reading-light`, que gana por anidamiento) y tiene su propio botón en la
 * barra del visor, porque acá la barra de navegación no se monta.
 */
function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const theme = useTheme();

  const next: OperationsTheme = theme === "dark" ? "light" : "dark";
  const label = next === "light" ? "Cambiar a tema claro" : "Cambiar a tema oscuro";

  return (
    <button
      className="sidebar-collapse"
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={collapsed ? label : undefined}
    >
      {next === "light" ? <Sun aria-hidden size={16} /> : <Moon aria-hidden size={16} />}
      <span className="side-nav-label">{next === "light" ? "Tema claro" : "Tema oscuro"}</span>
    </button>
  );
}

export function Sidebar({ activeView, activeNavView = activeView, onChangeView, reviewQueueCount, systemOnline = null, collapsed = false, onToggleCollapsed, identity }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <img alt="" src="/logo.svg" />
        </div>
        <div title="MIRA·L — Mapeo Integrado y Revisión Anatómica Lumbar">
          <strong>MIRA·L</strong>
          <span>Revisión anatómica lumbar</span>
        </div>
      </div>
      <nav className="side-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const selected = activeNavView === item.key;
          return (
            <Fragment key={item.key}>
              {item.key === "settings" ? <span className="side-nav-separator" aria-hidden="true" /> : null}
              <button className={selected ? "active" : ""} onClick={() => onChangeView(item.key)} type="button" aria-current={selected ? "page" : undefined} title={collapsed ? item.label : undefined}>
                <span className="side-nav-label"><Icon aria-hidden size={18} />{item.label}</span>
                {item.badge && <em aria-label={`${reviewQueueCount} estudios pendientes`}>{reviewQueueCount}</em>}
              </button>
            </Fragment>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        {identity}
        {/* El pie dice dos cosas distintas y las dos importan al reportar un problema:
            si el módulo de IA está respondiendo, y qué versión de la aplicación se está
            usando. Antes sólo se veía la versión, con el color del ícono como única
            señal del estado, que es la señal que nadie mira. */}
        <span className={systemOnline === null ? "system-status" : systemOnline ? "system-status is-online" : "system-status is-degraded"}>
          <ShieldCheck aria-hidden size={16} />
          <span className="side-nav-label">{systemOnline === null ? "" : systemOnline ? "Sincronizado · " : "Modo degradado · "}v1.3.2</span>
        </span>
        <ThemeToggle collapsed={collapsed} />
        {onToggleCollapsed && (
          <button
            className="sidebar-collapse"
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
            title={collapsed ? "Expandir menú" : "Contraer menú"}
          >
            {collapsed ? <ChevronRight aria-hidden size={16} /> : <ChevronLeft aria-hidden size={16} />}
            <span className="side-nav-label">Contraer</span>
          </button>
        )}
      </div>
    </aside>
  );
}
