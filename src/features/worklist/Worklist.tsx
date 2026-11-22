import { useEffect, useMemo, useState } from "react";
import { NewAnalysisDrawer } from "./NewAnalysisDrawer";
import { SelectedStudyPanel } from "./SelectedStudyPanel";
import { ChevronDown, ChevronUp, ChevronsUpDown, Plus, Search, SlidersHorizontal } from "lucide-react";
import type { Priority, ReviewStatus, StudyRow } from "../../appTypes";
import { displayModality, displayReviewStatus } from "../../clinicalDisplay";
import { displayOptionalSubjectRef, displayStudyDate } from "../../studyDisplay";
import {
  ANY,
  DATE_RANGES,
  EMPTY_FILTERS,
  PRIORITY_OPTIONS,
  REVIEW_STATUS_OPTIONS,
  activeFilterCount,
  countsByReviewStatus,
  filterStudies,
  modalityOptions,
  subjectOptions,
  type DateRangeId,
  type WorklistFilters,
} from "./studyFilters";
import { OperationsPageHeader } from "../../components/OperationsPageHeader";
import { PriorityBadge, ReviewBadge } from "../../components/StatusBadge";

/**
 * Worklist — el punto de entrada de la aplicación.
 *
 * Reemplaza a DashboardView + StudiesView + la cola de revisión, que eran la misma
 * tabla bajo tres rutas. Las cuatro tarjetas de métricas desaparecieron: sus números ahora
 * viven dentro del filtro de estado, donde son a la vez el conteo y la forma de
 * actuar sobre él, en lugar de ocupar el tercio superior de la pantalla.
 *
 * La densidad es deliberada. Un worklist se escanea, no se lee.
 */

const PAGE_SIZES = [10, 25, 50];
const PAGE_SIZE_STORAGE_KEY = "pfi.worklist.pageSize";

type SortKey = "caseId" | "subjectRef" | "studyDate" | "modality" | "reviewStatus" | "priority";
type SortDirection = "asc" | "desc";

const reviewWeight: Record<ReviewStatus, number> = { observado: 0, pendiente: 1, aceptado: 2, descartado: 3 };
const priorityWeight: Record<Priority, number> = { alta: 0, media: 1, baja: 2 };

function sortValue(study: StudyRow, key: SortKey): string | number {
  if (key === "reviewStatus") return reviewWeight[study.reviewStatus] ?? 99;
  if (key === "priority") return priorityWeight[study.priority] ?? 99;
  if (key === "studyDate") return Date.parse(study.studyDate ?? "") || 0;
  if (key === "subjectRef") return String(study.subjectRef ?? "").toLowerCase();
  if (key === "modality") return String(study.modality ?? "").toLowerCase();
  return String(study.caseId ?? "").toLowerCase();
}

function compareStudies(a: StudyRow, b: StudyRow, key: SortKey, direction: SortDirection) {
  const first = sortValue(a, key);
  const second = sortValue(b, key);
  const result = typeof first === "number" && typeof second === "number" ? first - second : String(first).localeCompare(String(second));
  return direction === "asc" ? result : -result;
}

function rowKey(study: StudyRow) {
  return study.latestRunId ?? study.runId ?? `${study.caseId}-${study.studyDate ?? "s/f"}-${study.primaryPlane ?? "s/p"}`;
}

function readStoredPageSize() {
  try {
    const stored = Number(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
    return PAGE_SIZES.includes(stored) ? stored : PAGE_SIZES[1];
  } catch {
    return PAGE_SIZES[1];
  }
}

/**
 * Números de página alrededor del actual, con elipsis. Una lista de 124 estudios
 * son 13 páginas y trece botones no se leen; primera y última siempre están
 * porque "el más viejo" es un destino real en una lista ordenada por fecha.
 */
function pageWindow(pageCount: number, current: number): Array<number | "gap"> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index);
  const pages = [...new Set([0, pageCount - 1, current, current - 1, current + 1])]
    .filter((page) => page >= 0 && page < pageCount)
    .sort((a, b) => a - b);
  return pages.reduce<Array<number | "gap">>((list, page, index) => {
    if (index > 0 && page - pages[index - 1] > 1) list.push("gap");
    list.push(page);
    return list;
  }, []);
}

interface WorklistProps {
  studies: StudyRow[];
  loading?: boolean;
  onOpenReview: (study: StudyRow) => void;
  /** Se invoca con el caseId cuando una corrida nueva quedó lista para leer. */
  onAnalysisReady: (caseId: string) => void;
  /** Se invoca cuando se asignó o corrigió el paciente de un estudio. */
  onStudiesChanged?: () => void;
}

export function Worklist({ studies, loading = false, onOpenReview, onAnalysisReady, onStudiesChanged }: WorklistProps) {
  /*
   * Cargar un estudio es un panel sobre la lista, no un destino aparte: el
   * asistente de cuatro pasos sacaba al médico de su lista de trabajo para
   * volver a dejarlo ahí cinco pantallas después.
   */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filters, setFilters] = useState<WorklistFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("studyDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(readStoredPageSize);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    try { window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(pageSize)); } catch { /* storage disabled */ }
  }, [pageSize]);

  const statusCounts = useMemo(() => countsByReviewStatus(studies, filters, query), [studies, filters, query]);
  const patients = useMemo(() => subjectOptions(studies), [studies]);
  const modalities = useMemo(() => modalityOptions(studies), [studies]);
  const rows = useMemo(
    () => filterStudies(studies, filters, query).sort((a, b) => compareStudies(a, b, sortKey, sortDirection)),
    [studies, filters, query, sortKey, sortDirection],
  );

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const firstIndex = safePage * pageSize;
  const visible = rows.slice(firstIndex, firstIndex + pageSize);
  const activeCount = activeFilterCount(filters);
  const selectedStudy = selectedKey ? rows.find((study) => rowKey(study) === selectedKey) ?? null : null;

  function updateFilter<K extends keyof WorklistFilters>(key: K, value: WorklistFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(0);
  }

  /*
   * Seleccionar y abrir son dos actos distintos. El clic elige el estudio y
   * abre su panel —la pregunta más frecuente sobre una fila es "¿es éste?", no
   * "abrilo"—; Enter, la barra espaciadora y el doble clic abren la sala de
   * lectura, igual que antes.
   *
   * Abrir un estudio es avisar quién se eligió, nada más. Antes la fila además
   * escribía el detalle en sessionStorage y disparaba su propio fetchStudyDetail
   * en paralelo al de App: las dos respuestas competían por la misma clave y la
   * sala de lectura leía la que llegara última, por eso a veces hacía falta
   * hacer clic dos veces. El detalle lo carga y lo posee App.
   */
  function openStudy(study: StudyRow) {
    onOpenReview(study);
  }

  function changeSort(key: SortKey) {
    if (key === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "studyDate" || key === "priority" || key === "reviewStatus" ? "desc" : "asc");
    }
    setPage(0);
  }

  function SortHeader({ column, children, align }: { column: SortKey; children: React.ReactNode; align?: "end" }) {
    const active = sortKey === column;
    const Icon = !active ? ChevronsUpDown : sortDirection === "asc" ? ChevronUp : ChevronDown;
    return (
      <th aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"} data-align={align}>
        <button className={`wl-sort${active ? " is-active" : ""}`} onClick={() => changeSort(column)} type="button">
          <span>{children}</span>
          <Icon aria-hidden size={13} />
        </button>
      </th>
    );
  }

  /* Cargar un estudio reemplaza el contenido de la lista (la navegación lateral
     queda): el formulario no se apila debajo de la tabla. Los filtros y la página
     viven en este componente, así que al volver la lista está como se dejó. */
  if (drawerOpen) {
    return (
      <NewAnalysisDrawer
        onAnalysisReady={(caseId) => { setDrawerOpen(false); onAnalysisReady(caseId); }}
        onClose={() => setDrawerOpen(false)}
        dedicated
      />
    );
  }

  return (
    <div className="wl">
      <OperationsPageHeader
        title="Estudios"
        meta={<span className="wl-total">{rows.length} de {studies.length}</span>}
        actions={(
          <div className="wl-actions">
            <label className="wl-search">
              <Search aria-hidden size={14} />
              <input
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(0); }}
                placeholder="Buscar por paciente, ID de estudio, fecha o descripción…"
                type="search"
                aria-label="Buscar estudios"
              />
            </label>
            <label className="wl-status-filter">
              <span>Estado</span>
              <select value={filters.reviewStatus} onChange={(event) => updateFilter("reviewStatus", event.target.value)} aria-label="Filtrar por estado">
                <option value={ANY}>Todos los estados</option>
                {REVIEW_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>{displayReviewStatus(status)} ({statusCounts[status]})</option>
                ))}
              </select>
            </label>
            <button
              className={`wl-filters-toggle${filtersOpen ? " is-open" : ""}`}
              onClick={() => setFiltersOpen((open) => !open)}
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="wl-filterbar"
            >
              <SlidersHorizontal aria-hidden size={15} />
              Más filtros
              {activeCount ? <em>{activeCount}</em> : null}
            </button>
            <button className="wl-primary" onClick={() => setDrawerOpen(true)} type="button"><Plus aria-hidden size={15} />Cargar estudio</button>
          </div>
        )}
      />

      {filtersOpen ? (
        <div className="wl-filterbar" id="wl-filterbar">
          <label className="wl-filter">
            <span>Paciente</span>
            <select value={filters.subjectRef} onChange={(event) => updateFilter("subjectRef", event.target.value)} disabled={!patients.length}>
              <option value={ANY}>Todos</option>
              {patients.map((patient) => <option key={patient} value={patient}>{patient}</option>)}
            </select>
          </label>
          <label className="wl-filter">
            <span>Fecha</span>
            <select value={filters.dateRange} onChange={(event) => updateFilter("dateRange", event.target.value as DateRangeId)}>
              {DATE_RANGES.map((range) => <option key={range.id} value={range.id}>{range.label}</option>)}
            </select>
          </label>
          <label className="wl-filter">
            <span>Prioridad</span>
            <select value={filters.priority} onChange={(event) => updateFilter("priority", event.target.value)}>
              <option value={ANY}>Todas</option>
              {PRIORITY_OPTIONS.map((priority) => (
                <option key={priority} value={priority}>{priority[0].toUpperCase()}{priority.slice(1)}</option>
              ))}
            </select>
          </label>
          <label className="wl-filter">
            <span>Modalidad</span>
            <select value={filters.modality} onChange={(event) => updateFilter("modality", event.target.value)} disabled={!modalities.length}>
              <option value={ANY}>Todas</option>
              {modalities.map((modality) => <option key={modality} value={modality}>{displayModality(modality)}</option>)}
            </select>
          </label>
          <button
            className="wl-filters-clear"
            onClick={() => { setFilters(EMPTY_FILTERS); setPage(0); }}
            type="button"
            disabled={!activeCount}
          >
            Limpiar filtros
          </button>
        </div>
      ) : null}

      <div className={`wl-body${selectedStudy ? " has-panel" : ""}`}>
        <div className="wl-main">
          {/*
            El tabIndex es deliberado y no sobra: la tabla scrollea en horizontal, y una
            region scrolleable que no recibe foco no se puede recorrer sin mouse (WCAG 2.1.1).
            La regla lo marca porque el div no es interactivo, pero sacarlo rompe el acceso.
          */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
          <div className="wl-table-wrap" role="region" aria-label="Estudios" tabIndex={0}>
            <table className="wl-table">
              <thead>
                <tr>
                  <SortHeader column="subjectRef">Paciente</SortHeader>
                  <SortHeader column="caseId">ID estudio</SortHeader>
                  <SortHeader column="studyDate">Fecha</SortHeader>
                  <SortHeader column="modality">Modalidad</SortHeader>
                  <SortHeader column="priority">Prioridad</SortHeader>
                  <SortHeader column="reviewStatus">Estado</SortHeader>
                  <th data-align="end">Series</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((study) => {
                  const key = rowKey(study);
                  return (
                    <tr
                      key={key}
                      className={`wl-row${key === selectedKey ? " is-selected" : ""}`}
                      tabIndex={0}
                      aria-selected={key === selectedKey}
                      onClick={() => setSelectedKey(key)}
                      onDoubleClick={() => openStudy(study)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedKey(key); openStudy(study); }
                      }}
                      aria-label={`Abrir estudio ${study.caseId}`}
                    >
                      <td className="wl-num" data-label="Paciente">{study.patientName || displayOptionalSubjectRef(study.patientCode || study.subjectRef)}{study.patientName && study.patientCode ? <small className="wl-secondary-line">{study.patientCode}</small> : null}</td>
                      <td className="wl-case" data-label="ID estudio">
                        <span className="wl-case-id">{study.caseId}</span>
                        {study.description ? <span className="wl-case-desc">{study.description}</span> : null}
                      </td>
                      <td className="wl-num" data-label="Fecha">{displayStudyDate(study.studyDate)}</td>
                      <td data-label="Modalidad">{study.modality ? displayModality(study.modality) : <span className="wl-empty-cell">—</span>}</td>
                      <td data-label="Prioridad"><PriorityBadge priority={study.priority} /></td>
                      <td data-label="Estado"><ReviewBadge status={study.reviewStatus} /></td>
                      <td className="wl-align-end" data-label="Series">
                        <span className="wl-planes">
                          {study.planes.length
                            ? study.planes.map((plane) => <em key={plane} className="wl-plane">{plane === "sagittal" ? "SAG" : "AX"}</em>)
                            : <span className="wl-empty-cell">—</span>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {loading ? <p className="wl-state" role="status" aria-live="polite">Cargando estudios…</p> : null}
            {!loading && !rows.length ? (
              <p className="wl-state" role="status">
                {query.trim()
                  ? "No hay estudios para esta búsqueda."
                  : activeCount
                    ? "No hay estudios para estos filtros."
                    : "No hay estudios en el repositorio."}
              </p>
            ) : null}
          </div>

          <footer className="wl-pagination">
            <span>
              {rows.length
                ? `Mostrando ${firstIndex + 1} a ${Math.min(rows.length, firstIndex + pageSize)} de ${rows.length} estudios`
                : "Sin estudios para mostrar"}
            </span>
            <div className="wl-pages">
              <button disabled={safePage === 0} onClick={() => setPage(0)} type="button" aria-label="Primera página">«</button>
              <button disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} type="button" aria-label="Página anterior">‹</button>
              {pageWindow(pageCount, safePage).map((entry, index) => (
                entry === "gap"
                  ? <span key={`gap-${index}`} className="wl-page-gap" aria-hidden="true">…</span>
                  : (
                    <button
                      key={entry}
                      className={entry === safePage ? "is-current" : ""}
                      onClick={() => setPage(entry)}
                      type="button"
                      aria-label={`Página ${entry + 1}`}
                      aria-current={entry === safePage ? "page" : undefined}
                    >
                      {entry + 1}
                    </button>
                  )
              ))}
              <button disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} type="button" aria-label="Página siguiente">›</button>
              <button disabled={safePage >= pageCount - 1} onClick={() => setPage(pageCount - 1)} type="button" aria-label="Última página">»</button>
            </div>
            <label className="wl-page-size">
              <span>Por página</span>
              <select
                value={pageSize}
                onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }}
                aria-label="Estudios por página"
              >
                {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
          </footer>
        </div>

        {selectedStudy ? (
          <SelectedStudyPanel study={selectedStudy} onClose={() => setSelectedKey(null)} onOpen={openStudy} onPatientChanged={onStudiesChanged} />
        ) : null}
      </div>

    </div>
  );
}
