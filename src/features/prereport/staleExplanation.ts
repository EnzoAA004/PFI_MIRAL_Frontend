/**
 * Por qué un borrador figura como desactualizado, dicho según lo que realmente cambió.
 *
 * La huella del borrador cubre todo el documento generado: los datos del estudio (correcciones, contexto, resultados) y también
 * el texto con que el sistema lo genera. Atribuir siempre el aviso a «correcciones o contexto» era falso cuando solo cambió ese texto.
 */
export type StaleChange = { section: string };

export type StaleExplanation = {
  kind: "data" | "document" | "mixed" | "unidentified";
  text: string;
  /** El botón «Ver cambios (N)» solo existe si hay un detalle que mostrar. */
  detailCount: number;
  /** Versión breve para la nota dentro del documento exportado. */
  documentNote: string;
};

export function explainStale(changes: StaleChange[]): StaleExplanation {
  const document = changes.filter((change) => change.section === "document").length;
  const data = changes.length - document;
  if (!changes.length) {
    return {
      kind: "unidentified",
      detailCount: 0,
      documentNote: "las fuentes cambiaron después de generar este borrador, sin que se pueda identificar qué. El contenido no se actualizó.",
      text: "Las fuentes tienen una huella distinta de la del borrador, pero no se pudo identificar qué cambió. Tu contenido no se modificó ni se actualizó solo.",
    };
  }
  if (data === 0) {
    return {
      kind: "document",
      detailCount: changes.length,
      documentNote: "cambió el texto con que el sistema genera el preinforme (por ejemplo, las limitaciones); los resultados del estudio no cambiaron. El contenido no se actualizó.",
      text: "Cambió el texto con que el sistema genera el preinforme (por ejemplo, las limitaciones). Las correcciones, el contexto y los resultados del estudio no cambiaron. Tu contenido no se modificó ni se actualizó solo.",
    };
  }
  if (document === 0) {
    return {
      kind: "data",
      detailCount: changes.length,
      documentNote: "las correcciones o el contexto del estudio cambiaron después de generar este borrador. El contenido no se actualizó.",
      text: "Las correcciones o el contexto del estudio cambiaron después de crearlo. Tu contenido no se modificó ni se actualizó solo.",
    };
  }
  return {
    kind: "mixed",
    detailCount: changes.length,
    documentNote: "cambiaron datos del estudio (correcciones, contexto o resultados) y también el texto con que se genera el preinforme. El contenido no se actualizó.",
    text: "Cambiaron datos del estudio (correcciones, contexto o resultados) y también el texto con que el sistema genera el preinforme. Tu contenido no se modificó ni se actualizó solo.",
  };
}
