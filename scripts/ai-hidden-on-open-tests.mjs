import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regresión: primera lectura sin IA visible.
 *
 * Al abrir o recargar un estudio la imagen se ve original: sin máscaras de segmentación, trazos automáticos ni
 * regiones de hallazgos, y sin resultados en el panel hasta pedirlos. El estado del interruptor vive por encima de las
 * pestañas (cambiar de pestaña lo conserva), va atado al estudio y la corrida, y NO se recupera de ningún almacenamiento.
 * En la comparación cada lado arranca apagado y es independiente, y los resultados comparados se abren a pedido.
 *
 * Son pruebas de contrato sobre el fuente (como el resto de la cadena `npm test`); el comportamiento en el navegador lo
 * cubre `scripts/playwright-ai-hidden-e2e.mjs` contra el stack.
 */
const root = process.cwd();
const read = (file) => readFileSync(join(root, file), "utf8");
const viewer = read("src/components/MriSliceViewer.tsx");
const plane = read("src/features/reading/PlaneViewport.tsx");
const study = read("src/components/StudyReviewView.tsx");
const dual = read("src/features/reading/DualComparisonView.tsx");
const pane = read("src/features/reading/ComparisonPane.tsx");

let n = 0;
function test(name, fn) {
  fn();
  n += 1;
  console.log(`ok ${n} - ${name}`);
}

test("el estudio individual arranca con la IA apagada y los resultados cerrados", () => {
  assert.match(study, /useState\(\{ key: aiStudyKey, overlays: false, results: false \}\)/);
});

test("el estado va atado al estudio y a la corrida: otro estudio o una recarga empiezan apagados", () => {
  assert.match(study, /const aiStudyKey = `\$\{displayRun\.caseId\}\|\$\{displayRun\.runId \?\? ""\}`/);
  assert.match(study, /const aiVisible = aiState\.key === aiStudyKey && aiState\.overlays/);
  assert.match(study, /const aiResultsOpen = aiState\.key === aiStudyKey && aiState\.results/);
});

test("no se lee ni se guarda ninguna preferencia de IA en el navegador", () => {
  for (const [name, source] of [["StudyReviewView", study], ["DualComparisonView", dual], ["ComparisonPane", pane], ["PlaneViewport", plane], ["MriSliceViewer", viewer]]) {
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/, `${name} no debe usar almacenamiento del navegador`);
  }
});

test("el visor dibuja la segmentación, los trazos de la IA, las derivadas y los puntos solo con la IA visible", () => {
  assert.match(viewer, /aiVisible && overlayVisible && segmentation && onAiSlice/);
  assert.match(viewer, /aiVisible && overlayVisible && onAiSlice && overlayLoaded/);
  assert.match(viewer, /aiVisible \? \(aiMeasuresVisible \? aiMeasurements : \[\]\) : evidenceFigures/);
  assert.match(viewer, /aiVisible && derivedVisible \? derivedMeasurements/);
  assert.match(viewer, /aiVisible && landmarksVisible && landmarks\.map/);
});

test("las anotaciones del profesional no dependen del interruptor de la IA", () => {
  assert.match(viewer, /\.\.\.\(myMeasuresVisible \? annotations : \[\]\)/);
});

test("con la IA apagada solo se dibuja la evidencia que el usuario eligió, con su estado y la posibilidad de ocultarla", () => {
  assert.match(viewer, /evidenceMeasurementIds\.includes\(figure\.id\)/);
  assert.match(viewer, /"evidence-visible-note" : "evidence-hidden-note"/);
  assert.match(viewer, /Ocultar evidencia/);
});

test("el interruptor es un botón accesible con estado, fuera de la imagen, y dice «Mostrar IA» / «Ocultar IA»", () => {
  assert.match(plane, /aria-pressed=\{aiVisible\}/);
  assert.match(plane, /data-testid="ai-toggle"/);
  assert.match(plane, /aiVisible \? "Ocultar IA" : "Mostrar IA"/);
  assert.match(plane, /type="button"/);
});

test("la leyenda y la lista de estructuras no aparecen con la IA apagada", () => {
  assert.match(plane, /\{aiVisible && segmentation && segmentation\.instances\.length > 0/);
  assert.match(viewer, /\{aiVisible && \(\s*<details className="segmentation-legend-panel">/);
});

test("el panel de resultados empieza compacto y se abre con una acción explícita; seguir montado conserva selección y borradores", () => {
  assert.match(study, /data-testid="ai-results-gate"/);
  assert.match(study, /data-testid="ai-results-open"/);
  assert.match(study, /<div hidden=\{!aiResultsOpen\}>/);
});

test("el interruptor no toca corte, zoom, ventana ni corrida: solo alterna el estado de IA", () => {
  const toggle = study.match(/const toggleAiOverlays = [\s\S]*?\)\);/)?.[0] ?? "";
  assert.ok(toggle.length > 0);
  assert.doesNotMatch(toggle, /setSliceByPlane|setZoom|setWindow|setBrightness|setViewedSeries|runId|Corrections|setMeasure/);
});

test("el visor dual arranca con ambos lados apagados, cada uno con su control, y los resultados comparados cerrados", () => {
  assert.match(dual, /useState<Record<Side, boolean>>\(\{ reference: false, current: false \}\)/);
  assert.match(dual, /const \[resultsOpen, setResultsOpen\] = useState\(false\)/);
  assert.match(dual, /aiVisible=\{aiBySide\[side\]\}/);
  assert.match(dual, /\[side\]: !current\[side\]/);
  assert.match(pane, /aiVisible=\{aiVisible\}/);
  assert.match(dual, /data-testid="dual-results-gate"/);
  assert.match(dual, /data-testid="dual-results-open"/);
});

test("en la comparación, cambiar de referencia vuelve a empezar sin IA y sin resultados abiertos", () => {
  assert.match(dual, /setAiBySide\(\(current\) => \(\{ \.\.\.current, reference: false \}\)\)/);
  assert.match(dual, /setResultsOpen\(false\)/);
});

console.log(`Primera lectura sin IA: ${n} pruebas pasaron`);
