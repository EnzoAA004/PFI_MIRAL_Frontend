/**
 * Edad al momento del estudio.
 *
 * Dos procedencias, siempre explícitas:
 * - "calculated": sale de la fecha de nacimiento del paciente y la fecha del estudio;
 * - "reported": la declaró quien carga el estudio (cuando no se puede calcular, o cuando
 *   sabe algo distinto).
 *
 * Nada se inventa ni se resuelve en silencio: si no hay con qué calcular y nadie declaró
 * una edad, no hay edad; y si la declarada difiere de la calculada, se conserva la declarada
 * pero la diferencia queda a la vista (`discrepancy`).
 */

export type AgeProvenance = "calculated" | "reported";

export type ResolvedAge = {
  /** Edad que se guardaría con el estudio, o null si no hay. */
  value: number | null;
  provenance: AgeProvenance | null;
  /** Edad calculada con las fechas, aunque se haya declarado otra. */
  calculated: number | null;
  /** Se declaró una edad y difiere de la calculada. */
  discrepancy: boolean;
  /** Qué falta para poder calcularla (vacío si se puede). */
  missingForCalculation: string;
  /** Error de entrada que impide guardar. Vacío si no hay. */
  issue: string;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(value: string | null | undefined): { y: number; m: number; d: number } | null {
  const match = value ? ISO_DATE.exec(value) : null;
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  // Rechaza fechas que el calendario corrige (31/02, 29/02 en año no bisiesto).
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** Años cumplidos a la fecha del estudio, o null si falta una fecha o el orden es imposible. */
export function calculateAgeOn(dateOfBirth: string | null | undefined, studyDate: string | null | undefined): number | null {
  const birth = parseIsoDate(dateOfBirth);
  const study = parseIsoDate(studyDate);
  if (!birth || !study) return null;
  let age = study.y - birth.y;
  if (study.m < birth.m || (study.m === birth.m && study.d < birth.d)) age -= 1;
  return age < 0 ? null : age;
}

export function resolveStudyAge(input: {
  dateOfBirth?: string | null;
  studyDate?: string | null;
  /** Texto tal como lo escribió el usuario; vacío = no declaró. */
  declared: string;
}): ResolvedAge {
  const calculated = calculateAgeOn(input.dateOfBirth, input.studyDate);
  const birth = parseIsoDate(input.dateOfBirth);
  const study = parseIsoDate(input.studyDate);
  const missing = !birth
    ? "la fecha de nacimiento del paciente"
    : !study
      ? "la fecha del estudio"
      : calculated === null
        ? "una fecha de estudio posterior al nacimiento"
        : "";

  const declaredText = input.declared.trim();
  if (declaredText) {
    if (!/^\d{1,3}$/.test(declaredText) || Number(declaredText) > 130) {
      return { value: null, provenance: null, calculated, discrepancy: false, missingForCalculation: missing, issue: "La edad declarada debe ser un número entero entre 0 y 130." };
    }
    const declared = Number(declaredText);
    return { value: declared, provenance: "reported", calculated, discrepancy: calculated !== null && calculated !== declared, missingForCalculation: missing, issue: "" };
  }
  if (calculated !== null) {
    return { value: calculated, provenance: "calculated", calculated, discrepancy: false, missingForCalculation: "", issue: "" };
  }
  return { value: null, provenance: null, calculated: null, discrepancy: false, missingForCalculation: missing, issue: "" };
}

export function ageProvenanceLabel(provenance: string | null | undefined): string {
  if (provenance === "calculated") return "Calculada con la fecha de nacimiento";
  if (provenance === "reported") return "Declarada al cargar el estudio";
  return "Procedencia no informada";
}
