/**
 * Textos legibles para el resultado de cargar un estudio completo (ZIP).
 *
 * El módulo de IA devuelve advertencias en un texto técnico; acá se reformulan las conocidas
 * sin cambiar lo que dicen, y el texto original siempre se conserva para "Detalles técnicos".
 * Una advertencia que no se reconoce se muestra tal cual: no se interpreta lo que no se sabe.
 *
 * "P10.7" es el clasificador de hallazgos degenerativos discales (ver `PFI_P10_7_*` en el
 * módulo de IA): usa una serie sagital T1 y otra T2, y con una sola corre con una sola
 * modalidad.
 */

export type StudyLimitation = {
  /** Lo que se le muestra al usuario. */
  text: string;
  /** El mensaje original del módulo, intacto. */
  technical: string;
};

const KNOWN: Array<{ pattern: RegExp; text: (match: RegExpMatchArray) => string }> = [
  {
    pattern: /^no se encontro serie sagital en el estudio$/i,
    text: () => "El estudio no incluye una serie sagital. Sin ella no se puede analizar.",
  },
  {
    pattern: /^sagital sin t2 disponible; se usa (\w+)/i,
    text: (match) => `No hay sagital T2: se analiza la sagital ${match[1].toUpperCase()}.`,
  },
  {
    pattern: /^no se encontro serie sagital t1 ni t2 utilizable para p10\.7/i,
    text: () => "No hay una serie sagital T1 ni T2 utilizable: no se generarán hallazgos degenerativos discales.",
  },
  {
    pattern: /^solo una ponderacion sagital \(t1 o t2\) esta disponible para p10\.7/i,
    text: () => "Hay una sola ponderación sagital (T1 o T2): los hallazgos degenerativos discales se generarán con una sola modalidad.",
  },
  {
    pattern: /^no se encontro serie axial en el estudio/i,
    text: () => "El estudio no incluye serie axial: no se hará el análisis axial (es opcional).",
  },
  {
    pattern: /^axial sin t2 real; el modelo axial espera t2 \(encontrado (\w+)\)/i,
    text: (match) => `La serie axial es ${match[1].toUpperCase()} y el modelo axial espera T2.`,
  },
];

export function describeStudyWarning(raw: string): StudyLimitation {
  const trimmed = raw.trim();
  for (const entry of KNOWN) {
    const match = entry.pattern.exec(trimmed);
    if (match) return { text: entry.text(match), technical: raw };
  }
  return { text: raw, technical: raw };
}

export function seriesPlaneLabel(plane: string): string {
  if (plane === "sagittal") return "Sagital";
  if (plane === "axial") return "Axial";
  if (plane === "coronal") return "Coronal";
  return "Plano no informado";
}

export function seriesSequenceLabel(weighting: string): string {
  if (weighting === "t1" || weighting === "t2") return weighting.toUpperCase();
  return "Secuencia no informada";
}

export type SeriesRole = "sagittal" | "axial" | "findings-t1" | "findings-t2";

const ROLE_LABEL: Record<SeriesRole, string> = {
  sagittal: "análisis sagital",
  axial: "análisis axial (experimental)",
  "findings-t1": "hallazgos discales T1",
  "findings-t2": "hallazgos discales T2",
};

/** Para qué se usará una serie, o por qué no se usa. */
export function describeSeriesUse(
  roles: SeriesRole[],
  series: { multiplanar: boolean; derived: boolean },
): { used: boolean; text: string } {
  if (roles.length) return { used: true, text: `Se usará en: ${roles.map((role) => ROLE_LABEL[role]).join(" · ")}` };
  if (series.multiplanar) return { used: false, text: "No se usa: es un localizador." };
  if (series.derived) return { used: false, text: "No se usa: es una imagen derivada." };
  return { used: false, text: "No se usa en este análisis." };
}
