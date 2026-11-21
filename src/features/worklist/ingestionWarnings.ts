import type { StudyIngestionResponse } from "../../contracts/inputApiTypes";

const ONE_WEIGHTING = "solo una ponderacion sagital (T1 o T2)";
const NO_WEIGHTING = "no se encontro serie sagital T1 ni T2";

/**
 * El módulo de IA informa en texto técnico que la resonancia no trae las dos ponderaciones sagitales que usa el
 * análisis de hallazgos (T1 y T2). Se reemplaza por una frase que dice qué se detectó y qué no.
 * El resto de las advertencias se muestra tal cual.
 */
export function displayIngestionWarnings(study: Pick<StudyIngestionResponse, "warnings" | "sagittalT1" | "sagittalT2">): string[] {
  const out: string[] = [];
  for (const warning of study.warnings) {
    if (warning.startsWith(NO_WEIGHTING)) {
      out.push("No se detectaron series sagitales T1 ni T2 en esta resonancia.");
    } else if (warning.startsWith(ONE_WEIGHTING)) {
      if (study.sagittalT2 && !study.sagittalT1) out.push("No se detectó una serie sagital T1 en esta resonancia (sí se detectó T2).");
      else if (study.sagittalT1 && !study.sagittalT2) out.push("No se detectó una serie sagital T2 en esta resonancia (sí se detectó T1).");
      else out.push("No se detectaron las series sagitales T1 y T2 en esta resonancia.");
    } else {
      out.push(warning);
    }
  }
  return out;
}
