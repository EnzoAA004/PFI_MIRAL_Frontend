/**
 * Marca un E2E como suspendido porque ejercita herramientas retiradas de «Herramientas del estudio»
 * (`RETIRED_INSPECTOR_TOOLS` en src/features/reading/inspectorToolsIndex.ts).
 *
 * Solo se retiró el acceso desde la interfaz: las implementaciones, los endpoints y los datos siguen. La prueba se
 * reactiva cuando la herramienta vuelva a tener entrada (quitando su id de la lista de retiradas y esta llamada).
 */
export function suspendedForRetiredTools(script, toolIds) {
  console.log(`SUSPENDIDA ${script}: ejercita herramientas retiradas de la interfaz (${toolIds.join(", ")}). Se reactiva al reintegrar su acceso.`);
  process.exit(0);
}
