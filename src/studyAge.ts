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
  /** Por qué no se pudo calcular (todo false si se pudo). */
  missing: { birthDate: boolean; studyDate: boolean; studyBeforeBirth: boolean };
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
  const missing = {
    birthDate: !birth,
    studyDate: !study,
    studyBeforeBirth: Boolean(birth && study && calculated === null),
  };

  const declaredText = input.declared.trim();
  if (declaredText) {
    if (!/^\d{1,3}$/.test(declaredText) || Number(declaredText) > 130) {
      return { value: null, provenance: null, calculated, discrepancy: false, missing, issue: "La edad declarada debe ser un número entero entre 0 y 130." };
    }
    const declared = Number(declaredText);
    return { value: declared, provenance: "reported", calculated, discrepancy: calculated !== null && calculated !== declared, missing, issue: "" };
  }
  if (calculated !== null) {
    return { value: calculated, provenance: "calculated", calculated, discrepancy: false, missing, issue: "" };
  }
  return { value: null, provenance: null, calculated: null, discrepancy: false, missing, issue: "" };
}

/** Motivo real por el que la edad no se puede calcular con las fechas ("" si se puede). */
export function ageUnavailableReason(missing: ResolvedAge["missing"], hasPatient: boolean): string {
  if (missing.studyBeforeBirth) return "La fecha del estudio es anterior al nacimiento.";
  if (missing.birthDate && missing.studyDate) {
    return hasPatient
      ? "Faltan la fecha de nacimiento del paciente y la fecha del estudio."
      : "No hay paciente con fecha de nacimiento y falta la fecha del estudio.";
  }
  if (missing.birthDate) {
    return hasPatient ? "El paciente no tiene fecha de nacimiento cargada." : "No hay paciente asociado con fecha de nacimiento.";
  }
  if (missing.studyDate) return "Falta la fecha del estudio.";
  return "";
}

export function ageProvenanceLabel(provenance: string | null | undefined): string {
  if (provenance === "calculated") return "Calculada con la fecha de nacimiento";
  if (provenance === "reported") return "Declarada al cargar el estudio";
  return "Procedencia no informada";
}

/**
 * Fecha de lectura dd/mm/aaaa a partir de un YYYY-MM-DD, solo con texto: no se construye un
 * Date, así que no hay conversión de zona horaria ni corrimiento de un día. Lo que no es una
 * fecha ISO se devuelve tal cual.
 */
export function formatIsoDateDMY(value: string | null | undefined): string {
  const match = value ? ISO_DATE.exec(value.trim()) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (value ?? "");
}
