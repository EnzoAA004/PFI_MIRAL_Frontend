import { useState, type ReactNode } from "react";
import { X } from "lucide-react";

interface DismissibleNoticeProps {
  tone: "info" | "warning" | "error";
  children: ReactNode;
  /** Acción propia del aviso (por ejemplo «Reintentar»). */
  actions?: ReactNode;
}

/**
 * Aviso con botón para cerrarlo. Los avisos informan un estado, pero no tienen por qué quedarse
 * para siempre: quien ya lo leyó lo cierra. Si la condición desaparece y vuelve, el aviso
 * reaparece porque el componente se desmonta y se monta de nuevo.
 */
export function DismissibleNotice({ tone, children, actions }: DismissibleNoticeProps) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div className={`toast ${tone} dismissible-toast`} role={tone === "error" ? "alert" : "status"}>
      <span className="toast-message">{children}</span>
      <span className="toast-actions">
        {actions}
        <button aria-label="Cerrar aviso" className="toast-dismiss" onClick={() => setVisible(false)} title="Cerrar aviso" type="button">
          <X aria-hidden size={16} />
        </button>
      </span>
    </div>
  );
}
