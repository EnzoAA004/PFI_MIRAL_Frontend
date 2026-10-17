import React, { useCallback, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "../../src/design/tokens.css";
import "../../src/design/base.css";
import "../../src/design/components.css";
import "../../src/design/shell.css";
import "../../src/features/reading/reading.css";
import "../../src/design/utilities.css";
import { normalizeRun } from "../../src/api";
import type { AiRunResponse, StudyArchiveSeries } from "../../src/appTypes";
import { normalizeSelectedRunForReview, selectReviewableRunFromDetail } from "../../src/appDataGuards";
import { DualComparisonView } from "../../src/features/reading/DualComparisonView";
import { fetchStudyDetail } from "../../src/studyApi";

/**
 * Demostración interactiva de la comparación de hallazgos A/B. Monta el visor dual REAL sobre datos simulados que sirve
 * `server.mjs`. No es parte de la aplicación: solo existe en el modo de compilación `demo-dual-findings`.
 */
if (import.meta.env.MODE !== "demo-dual-findings") {
  throw new Error("Esta página solo existe en la demostración (modo demo-dual-findings).");
}

const BANNER = "DEMOSTRACIÓN · DATOS SIMULADOS · NO REPRESENTA EVOLUCIÓN DE UN PACIENTE";
const CURRENT_CASE = "DEMO-B";
const REFERENCE_CASE = "DEMO-A";

type Loaded = { run: AiRunResponse; archiveSeries: StudyArchiveSeries[] };
type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: Loaded };

function setTheme(theme: "light" | "dark") {
  try { window.localStorage.setItem("pfi.theme", theme); } catch { /* sin almacenamiento */ }
  if (theme === "dark") document.documentElement.setAttribute("data-theme", "clinical");
  else document.documentElement.removeAttribute("data-theme");
}

function Demo() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [open, setOpen] = useState(true);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchStudyDetail({ caseId: CURRENT_CASE })
      .then((detail) => {
        if (cancelled) return;
        const reviewable = selectReviewableRunFromDetail(detail);
        const { safeRun } = normalizeSelectedRunForReview(reviewable, false, normalizeRun);
        if (!safeRun) throw new Error("El estudio simulado no tiene una corrida revisable.");
        setState({ status: "ready", data: { run: safeRun, archiveSeries: detail.archiveSeries ?? [] } });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "No se pudo cargar la demostración." });
      });
    return () => { cancelled = true; };
  }, []);

  const close = useCallback(() => setOpen(false), []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-app)", color: "var(--text)" }}>
      {/* Esta demostración no trae mediciones numéricas: el aviso de «sin mediciones» solo le quitaría espacio a las imágenes. */}
      <style>{'[data-testid="dual-empty-state"] { display: none !important; }'}</style>
      <header
        data-testid="demo-banner"
        role="note"
        style={{ background: "#e9b949", color: "#1b1405", padding: "6px 12px", fontWeight: 700, letterSpacing: ".02em", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}
      >
        <span>{BANNER}</span>
        <span data-testid="demo-banner-note" style={{ flexBasis: "100%", order: 3, fontWeight: 500, fontSize: 12, letterSpacing: 0 }}>
          Los resultados, las regiones marcadas y las imágenes son inventados y no son predicciones reales ni evidencia clínica. Donde la pantalla
          dice «real» o «análisis inicial» habla de la aplicación, no de estos datos. La comparación numérica de mediciones no forma parte de esta demostración.
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button data-testid="demo-help-toggle" onClick={() => setHelp((value) => !value)} type="button">{help ? "Ocultar ayuda" : "Cómo probarla"}</button>
          <button onClick={() => setTheme("light")} type="button">Claro</button>
          <button onClick={() => setTheme("dark")} type="button">Oscuro</button>
        </span>
      </header>
      {help && (
        <section data-testid="demo-help" style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--surface)", fontSize: "var(--fs-small)" }}>
          <p style={{ margin: "0 0 4px" }}>
            Los resultados, las regiones marcadas y las imágenes de esta página son <strong>simulados</strong>: no son predicciones reales ni evidencia clínica.
            A es la «Referencia» y B el «Seguimiento» de un estudio inventado; no representan la evolución de ningún paciente.
          </p>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>Con «Hallazgos IA» abierto, elegí la fila <strong>L4-L5 · Abombamiento discal</strong> (Ausente → Presente): cada visor abre su propia serie y corte y resalta su región.</li>
            <li>Probá «Anterior/Siguiente», los filtros (Cambios / Todos / No comparables) y «Distribución por clase de cada lado».</li>
            <li>Cambiá de corte con la rueda o las flechas en un visor y volvé con «Volver a la región seleccionada».</li>
            <li>L5-S1 · Placa terminal superior: B guarda la clasificación pero no su región («Región no disponible»). L1-L2 · Estrechamiento: sin resultado en B (no comparable).</li>
          </ol>
        </section>
      )}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {state.status === "loading" && <p style={{ padding: 16 }}>Cargando la demostración…</p>}
        {state.status === "error" && <p role="alert" style={{ padding: 16 }}>No se pudo cargar la demostración: {state.message}</p>}
        {state.status === "ready" && !open && (
          <div style={{ padding: 16 }}>
            <button data-testid="demo-reopen" onClick={() => setOpen(true)} type="button">Abrir la comparación A/B</button>
          </div>
        )}
        {state.status === "ready" && open && (
          <DualComparisonView
            archiveSeries={state.data.archiveSeries}
            caseId={CURRENT_CASE}
            currentRunId={state.data.run.runId ?? null}
            initialReferenceCaseId={REFERENCE_CASE}
            initialRightTab="findings"
            onClose={close}
            run={state.data.run}
          />
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Demo />
  </React.StrictMode>,
);
