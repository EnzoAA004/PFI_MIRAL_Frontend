import type { WorklistFilters } from "./studyFilters";

export type SortKey = "caseId" | "subjectRef" | "studyDate" | "modality" | "reviewStatus" | "priority";
export type SortDirection = "asc" | "desc";

/**
 * Lo último que se vio en la lista de trabajo (filtros, búsqueda, orden, página y estudio elegido), para volver del visor a la
 * misma vista. Vive en memoria de la sesión de la aplicación: no se guarda en disco y se descarta al cerrar sesión (la
 * búsqueda puede contener referencias de pacientes).
 */
export type WorklistViewState = {
  filters: WorklistFilters;
  filtersOpen: boolean;
  query: string;
  sortKey: SortKey;
  sortDirection: SortDirection;
  page: number;
  selectedKey: string | null;
};

let remembered: WorklistViewState | null = null;

export function rememberWorklistView(state: WorklistViewState) {
  remembered = state;
}

export function recalledWorklistView(): WorklistViewState | null {
  return remembered;
}

export function forgetWorklistView() {
  remembered = null;
}
