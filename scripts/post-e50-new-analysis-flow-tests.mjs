import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * "Nuevo estudio": flujo de tres pasos con paciente, edad y contexto clínico.
 *
 * Reemplaza a los chequeos de Stage 86, que fijaban un diseño sin entidad Patient (el
 * paciente era sólo un `subjectRef`). Ahora el paciente es una entidad con código, nombre,
 * apellido y fecha de nacimiento opcionales (`patientApi.ts`), se asocia por `patientId` y el
 * backend deriva `subjectRef` de su código, de modo que el historial por referencia y los
 * estudios históricos siguen funcionando.
 *
 * Los componentes son hooks de React sin DOM disponible acá, así que su comportamiento
 * observable se verifica contra su propio código fuente; la lógica pura (pasos, edad, bloqueos,
 * confirmación) se prueba ejecutándola en new-study-form-tests.mjs y study-age-tests.mjs, y el
 * recorrido real en los playwright-new-study-*.mjs y playwright-post-e50-*.mjs.
 */
const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const drawerSource = read("src/features/worklist/NewAnalysisDrawer.tsx");
const selectorSource = read("src/features/worklist/PatientSelector.tsx");
const dialogSource = read("src/features/worklist/CreatePatientDialog.tsx");
const stepperSource = read("src/features/worklist/NewStudyStepper.tsx");
const summarySource = read("src/features/worklist/NewStudySummary.tsx");
const patientApiSource = read("src/patientApi.ts");
const studyMetadataSource = read("src/studyMetadata.ts");
const css = read("src/features/worklist/worklist.css");
const stepsCss = css.slice(css.indexOf("Nuevo estudio — flujo en tres pasos"));

let count = 0;
function test(name, fn) {
  fn();
  count += 1;
  console.log(`ok ${count} - ${name}`);
}

/* ---------------------------------------------------------------- paciente */

test("1 la vista usa PatientSelector y ya no el selector de subjectRef", () => {
  assert.match(drawerSource, /<PatientSelector/);
  assert.doesNotMatch(drawerSource, /<SubjectSelector/);
  assert.ok(!existsSync(join(root, "src/features/worklist/SubjectSelector.tsx")));
});

test("2 el paciente se busca por código o nombre y muestra su estado de búsqueda", () => {
  assert.match(selectorSource, /Buscar paciente por código o nombre/);
  assert.match(selectorSource, /searchPatients\(trimmed, RESULT_LIMIT\)/);
  assert.match(selectorSource, /Buscando pacientes…/);
  assert.match(selectorSource, /No se encontraron pacientes/);
  assert.match(patientApiSource, /\/api\/patients\?query=/);
});

test("3 una búsqueda vieja que llega tarde no pisa a la última (cancelled)", () => {
  assert.match(selectorSource, /let cancelled = false;/);
  assert.match(selectorSource, /if \(!cancelled\) setSearch/);
  assert.match(selectorSource, /window\.clearTimeout\(timer\)/);
});

test("4 el error de búsqueda ofrece reintentar", () => {
  assert.match(selectorSource, /No se pudo buscar pacientes/);
  assert.match(selectorSource, /setRetryToken\(\(token\) => token \+ 1\)/);
});

test("5 crear un paciente es una acción aparte que abre un diálogo, no un formulario embebido", () => {
  assert.match(selectorSource, /<CreatePatientDialog/);
  assert.match(selectorSource, /Crear paciente/);
  assert.match(selectorSource, /setDialogOpen\(true\)/);
  for (const text of ["Código visible", "Nombre <i>(opcional)</i>", "Apellido <i>(opcional)</i>", "Fecha de nacimiento <i>(opcional)</i>", "No ingreses DNI, domicilio"]) {
    assert.ok(dialogSource.includes(text), `el diálogo debe tener «${text}»`);
  }
  assert.match(dialogSource, /createPatient\(draft\)/);
  assert.match(patientApiSource, /method: "POST", body/);
});

test("6 el diálogo es accesible y distingue crear el paciente de continuar el estudio", () => {
  assert.match(dialogSource, /<dialog/);
  assert.match(dialogSource, /dialog\.showModal\(\)/);
  assert.match(dialogSource, /aria-labelledby="ns-patient-dialog-title"/);
  assert.match(dialogSource, /aria-describedby="ns-patient-dialog-help"/);
  assert.match(dialogSource, /No crea ni continúa el estudio/);
  assert.match(dialogSource, /"Crear paciente"/);
  assert.match(dialogSource, /onCancel=\{\(event\) => \{/);
  assert.doesNotMatch(dialogSource, /onContinue|goNext|setStep/, "el diálogo no avanza el flujo");
});

test("7 al crearlo el paciente se selecciona y se muestra su resumen, sin avanzar de paso", () => {
  assert.match(selectorSource, /onCreated=\{\(patient\) => \{[\s\S]*?onSelect\(patient\);[\s\S]*?\}\}/);
  assert.match(selectorSource, /aria-label="Paciente seleccionado"/);
  assert.match(selectorSource, /Paciente creado y seleccionado\. Falta continuar con el estudio/);
});

test("8 el paciente elegido se puede cambiar", () => {
  assert.match(selectorSource, /onSelect\(null\); \}\} type="button">Cambiar</);
});

test("9 se puede continuar explícitamente sin asociar paciente, y volver atrás", () => {
  assert.match(selectorSource, /Continuar sin asociar paciente/);
  assert.match(selectorSource, /Asociar paciente/);
  assert.match(drawerSource, /onWithoutPatient=\{setWithoutPatient\}/);
});

test("10 el estudio se envía con patientId, sin subjectRef armado en el cliente", () => {
  assert.match(drawerSource, /studyMetadata: normalizedStudyMetadata/);
  assert.match(drawerSource, /normalizeStudyMetadataInput\(metadata, age\)/);
  assert.match(drawerSource, /patientId: patient\?\.id \?\? ""/);
  assert.match(studyMetadataSource, /patientId: textOrNull\(draft\.patientId\)/);
});

test("11 el contexto clínico y la edad viajan solo si hay algo (payload histórico intacto)", () => {
  assert.match(studyMetadataSource, /if \(value !== null && value !== undefined\)/);
  for (const key of ["ageAtStudy", "ageProvenance", "clinicalReason", "symptoms", "symptomDuration", "relevantHistory"]) {
    assert.match(studyMetadataSource, new RegExp(`${key}:`));
  }
});

test("12 no existe ningún paso de asociación posterior a la corrida", () => {
  assert.doesNotMatch(drawerSource, /associationState|attemptPatientAssociation|retryPatientAssociation|patientStudyAssociation|Asociando al paciente/);
  assert.doesNotMatch(drawerSource, /\/patient["'`]|associateStudyPatient/);
});

test("13 un estudio puede crearse sin paciente ni contexto", () => {
  assert.match(drawerSource, /const studyIdentityReady = caseIdReady;/);
  assert.doesNotMatch(drawerSource, /disabled=\{[^}]*selectedPatient/);
});

/* ---------------------------------------------------------------- pasos */

test("14 son tres pasos con navegación, y los datos viven por encima de ellos", () => {
  assert.match(drawerSource, /<NewStudyStepper locked=\{interactionLocked\} onSelect=\{goToStep\} steps=\{steps\} \/>/);
  assert.match(drawerSource, /useState<StepId>\("study"\)/);
  const firstStep = drawerSource.indexOf('step === "study" && (');
  for (const state of ["metadata", "uploads", "studyUpload", "selectedPatient", "withoutPatient"]) {
    const declaration = drawerSource.indexOf(`const [${state},`);
    assert.ok(declaration > 0 && declaration < firstStep, `${state} se declara en el componente, no dentro de un paso`);
  }
  assert.match(drawerSource, /step === "images" && \(/);
  assert.match(drawerSource, /step === "context" && !showProcessing && \(/);
  assert.match(drawerSource, /step === "context" && showProcessing && \(/);
});

test("15 la navegación de pasos tiene estados actual / completado / pendiente", () => {
  assert.match(stepperSource, /aria-current=\{step\.state === "current" \? "step" : undefined\}/);
  assert.match(stepperSource, /current: "Paso actual"/);
  assert.match(stepperSource, /complete: "Completado"/);
  assert.match(stepperSource, /pending: "Pendiente"/);
  assert.match(stepperSource, /disabled=\{locked \|\| !step\.reachable\}/);
});

test("16 cambiar de paso solo mueve la vista: no analiza, no crea pacientes, no toca las cargas", () => {
  const start = drawerSource.indexOf("function goToStep(");
  const end = drawerSource.indexOf("function openCompletedStudy(");
  const navigation = drawerSource.slice(start, end);
  assert.match(navigation, /setStep\(/);
  assert.doesNotMatch(navigation, /run\(|createPatient|upload\(|uploadStudy|setUploads|setStudyUpload|requestGate|runMultiplanarAnalysis/);
});

test("17 Atrás y Continuar fuera del último paso, y Analizar estudio solo en el último", () => {
  assert.match(drawerSource, /onClick=\{goBack\} type="button">Atrás</);
  assert.match(drawerSource, /onClick=\{goNext\}/);
  assert.match(drawerSource, /\{step !== "context" \? \(/);
  const analyzeButton = /Procesando…<\/> : "Analizar estudio"/g;
  assert.equal((drawerSource.match(analyzeButton) ?? []).length, 1, "un solo botón Analizar estudio");
  assert.ok(drawerSource.search(analyzeButton) > drawerSource.indexOf('step !== "context" ?'), "Analizar estudio vive en la rama del último paso");
});

test("18 una modificación que invalida las imágenes lo refleja y explica qué rehacer", () => {
  assert.match(drawerSource, /setImagesInvalidated\(true\)/);
  assert.match(drawerSource, /setImagesInvalidated\(false\)/);
  assert.match(drawerSource, /Cambiaste el ID del estudio: volvé a cargar las imágenes para asociarlas al nuevo ID/);
  assert.match(drawerSource, /requestGate\.invalidateAll\(\);\s+setCaseId\(nextValue\)/);
});

test("19 el resumen lateral es de solo lectura y muestra únicamente datos disponibles", () => {
  assert.doesNotMatch(summarySource, /<input|<button|<select|<textarea|onClick/);
  assert.match(summarySource, /Sin asociación/);
  assert.match(summarySource, /\{patientName && /);
  assert.match(summarySource, /\{caseId\.trim\(\) && /);
  assert.match(summarySource, /\{studyDate && /);
});

test("20 la selección local no se presenta como carga completada", () => {
  assert.match(drawerSource, /studyUpload\.status === "uploading" && /);
  assert.match(drawerSource, /studyUpload\.status === "uploaded" && <span className="ns-chip is-loaded">Cargado<\/span>/);
  assert.match(drawerSource, /<span className="ns-chip is-error">No se cargó<\/span>/);
});

/* ---------------------------------------------------------------- edad y contexto */

test("21 la edad se resuelve en un módulo puro, con procedencia explícita", () => {
  assert.match(drawerSource, /resolveStudyAge\(/);
  assert.match(drawerSource, /Calculada/);
  assert.match(drawerSource, /Declarada/);
  assert.match(drawerSource, /Declarar otra edad/);
  assert.match(drawerSource, /Usar la edad calculada/);
});

test("22 una discrepancia entre edad declarada y calculada se muestra, no se resuelve en silencio", () => {
  assert.match(drawerSource, /difiere de la calculada/);
  assert.match(drawerSource, /age\.discrepancy/);
});

test("23 lo declarado nunca se descarta al cambiar de paciente", () => {
  assert.match(drawerSource, /metadata\.ageDeclared\.trim\(\) !== ""/);
});

test("24 los textos clínicos tienen su espacio en el área principal, no en una columna estrecha", () => {
  const context = drawerSource.slice(drawerSource.indexOf('step === "context" && !showProcessing && ('));
  for (const label of ["Motivo del estudio", "Síntomas", "Tiempo de evolución", "Antecedentes relevantes"]) {
    assert.ok(context.includes(label), `falta «${label}» en el último paso`);
  }
  assert.match(drawerSource, /className="ns-clinical-grid"/);
  assert.doesNotMatch(drawerSource, /ns-clinical-details|<details className="ns-clinical/);
  assert.match(stepsCss, /\.ns-clinical-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("25 el contexto es opcional: ningún texto es obligatorio para analizar", () => {
  assert.doesNotMatch(drawerSource, /clinicalReason\.trim\(\) *===|!metadata\.clinicalReason|!metadata\.symptoms/);
  assert.match(drawerSource, /<span>opcional<\/span>/);
});

test("26 el contexto dice una sola línea y deja la explicación en una ayuda accesible", () => {
  assert.match(drawerSource, /Describe la situación del paciente al momento de este estudio/);
  assert.match(drawerSource, /aria-controls="ns-context-help"/);
  assert.match(drawerSource, /aria-expanded=\{contextHelpOpen\}/);
});

test("27 el motivo por el que no se calcula la edad sale de lo que falta, y con edad declarada no se repite la instrucción", () => {
  assert.match(drawerSource, /ageUnavailableReason\(age\.missing, Boolean\(selectedPatient\)\)/);
  assert.match(drawerSource, /Se guardará como edad declarada\. No se calculó:/);
});

test("28 Calculada y Declarada usan el mismo estilo neutro; solo la discrepancia advierte", () => {
  assert.match(drawerSource, /className="ns-badge"/);
  assert.doesNotMatch(drawerSource, /ns-badge is-/);
  assert.match(drawerSource, /className="ns-warning"/);
});

test("29 la revisión antes de analizar resume paciente, estudio e imágenes y permite editar cada uno", () => {
  assert.match(drawerSource, /Revisión antes de analizar/);
  for (const text of ["Editar paciente", "Editar estudio", "Editar imágenes"]) assert.ok(drawerSource.includes(text), text);
  assert.match(drawerSource, /goToStep\("images"\)/);
});

/* ---------------------------------------------------------------- imágenes */

test("30 el resultado del ZIP ordena archivo, series, uso, limitaciones y detalles técnicos", () => {
  assert.match(drawerSource, /"Cambiar ZIP"/);
  assert.match(drawerSource, /serie detectada" : "series detectadas"/);
  assert.match(drawerSource, /seriesPlaneLabel\(series\.plane\)/);
  assert.match(drawerSource, /seriesSequenceLabel\(series\.weighting\)/);
  assert.match(drawerSource, /series\.sliceCount\} cortes/);
  assert.match(drawerSource, /describeSeriesUse\(roles, series\)/);
  assert.match(drawerSource, /<strong>Limitaciones<\/strong>/);
  assert.match(drawerSource, /<summary>Detalles técnicos<\/summary>/);
  const visible = drawerSource.slice(drawerSource.indexOf('className="ns-study-result"'), drawerSource.indexOf('<details className="ns-tech">'));
  assert.doesNotMatch(visible, /\{series\.description \|\||\{series\.inputId\}|P10\.7/, "identificadores y jerga técnica solo en los detalles");
});

test("31 la alternativa por plano sigue plegada y accesible", () => {
  assert.match(drawerSource, /aria-expanded=\{byPlaneOpen\}/);
  assert.match(drawerSource, /Cargar archivos por plano/);
  assert.match(drawerSource, /uploadAiInput\(file, normalizedCaseId, plane, declaration\)/);
  assert.match(drawerSource, /uploadStudyArchive\(file, normalizedCaseId\)/);
});

test("32 una advertencia desconocida del ZIP se muestra tal cual en Limitaciones", () => {
  assert.match(drawerSource, /describeStudyWarning\(warning\)\.text/);
  const limitations = drawerSource.slice(drawerSource.indexOf('className="ns-limitations"'), drawerSource.indexOf('<details className="ns-tech">'));
  assert.doesNotMatch(limitations, /\.filter\(|known/i, "no se filtran advertencias");
});

/* ---------------------------------------------------------------- análisis y salida */

test("33 el botón de analizar se deshabilita mientras corre", () => {
  assert.match(drawerSource, /disabled=\{!sagittalReady \|\| uploading \|\| running\}/);
});

test("34 doble submit queda bloqueado por una referencia sincrónica", () => {
  assert.match(drawerSource, /runInFlightRef\.current/);
  assert.match(drawerSource, /if \(!sagittalReady \|\| uploading \|\| running \|\| runInFlightRef\.current\) return/);
});

test("35 un error de creación muestra mensaje y no rompe el flujo", () => {
  assert.match(drawerSource, /setRunError\(apiErrorMessage\(error, "ejecutar el análisis"\)\)/);
});

test("36 éxito completo navega al Study creado", () => {
  assert.match(drawerSource, /function openCompletedStudy\(caseIdToOpen: string\)/);
  assert.match(drawerSource, /onAnalysisReady\(caseIdToOpen\)/);
});

test("37 un error de análisis conserva paciente y contexto (no se resetea metadata)", () => {
  const runStart = drawerSource.indexOf("async function run()");
  const catchStart = drawerSource.indexOf("catch (error)", runStart);
  const errorBlock = drawerSource.slice(catchStart, drawerSource.indexOf("finally", catchStart));
  assert.doesNotMatch(errorBlock, /setMetadata\(|setSelectedPatient\(/);
});

test("38 salir de la vista pasa por una sola puerta que se bloquea al analizar y confirma si hay datos", () => {
  assert.match(drawerSource, /function requestExit\(\) \{\s+if \(interactionLocked\) return;/);
  assert.match(drawerSource, /className="ns-back" disabled=\{interactionLocked\} onClick=\{requestExit\}/);
  assert.match(drawerSource, /<button className="ns-btn is-quiet" disabled=\{interactionLocked\} onClick=\{requestExit\}/);
  assert.doesNotMatch(drawerSource, /key === "Escape"/, "es una pantalla, no un diálogo");
});

test("39 la confirmación de salida se cierra al iniciar el análisis y su botón queda protegido", () => {
  assert.match(drawerSource, /if \(interactionLocked\) setConfirmingExit\(false\);/);
  assert.match(drawerSource, /disabled=\{interactionLocked\} onClick=\{\(\) => \{ if \(!interactionLocked\) onClose\(\); \}\} type="button">Salir sin guardar</);
});

test("40 durante el análisis no se cambia de paso", () => {
  assert.match(drawerSource, /function goToStep\(target: StepId\) \{\s+if \(interactionLocked\) return;/);
  assert.match(drawerSource, /function goBack\(\) \{[\s\S]*?!interactionLocked/);
});

test("41 el chat y el LLM no se tocan: nada de esta vista los importa", () => {
  for (const source of [drawerSource, selectorSource, dialogSource, stepperSource, summarySource]) {
    assert.doesNotMatch(source, /chatApi|chatTypes|llm/i);
  }
});

test("42 los datos personales no se imprimen en logs del cliente", () => {
  for (const source of [drawerSource, selectorSource, dialogSource]) {
    assert.doesNotMatch(source, /console\.(log|info|warn|error)/);
  }
});

/* ---------------------------------------------------------------- estilo */

test("43 una única tipografía sans en la vista, en controles y en el diálogo", () => {
  assert.match(stepsCss, /\.wl-new-study :is\(input, select, textarea, button, summary, dialog\) \{ font-family: var\(--font-sans\); \}/);
  assert.match(stepsCss, /\.ns-dialog \{[^}]*font-family: var\(--font-sans\)/);
  assert.doesNotMatch(stepsCss, /--font-mono/);
});

test("44 los controles nativos (calendario) siguen el tema claro y oscuro", () => {
  assert.match(stepsCss, /\.wl-new-study \{[^}]*color-scheme: light;/);
  assert.match(stepsCss, /:root\[data-theme="clinical"\] \.wl-new-study \{ color-scheme: dark; \}/);
});

test("45 un único contenedor de scroll y ninguna sección con scroll ni altura máxima propios", () => {
  const scrollers = stepsCss.match(/[^\n]*(overflow-y|overflow: *(auto|scroll))[^\n]*/g) ?? [];
  assert.equal(scrollers.length, 1, `solo .ns-scroll debe scrollear: ${scrollers.join(" / ")}`);
  assert.match(scrollers[0], /\.ns-scroll/);
  assert.doesNotMatch(stepsCss, /max-height/);
});

test("46 sin animaciones decorativas ni gradientes en la vista", () => {
  assert.doesNotMatch(stepsCss, /@keyframes|animation:|linear-gradient|radial-gradient|transition:/);
});

/* ---------------------------------------------------------------- pie, edad sin fecha y procesamiento */

test("47 el pie está fuera del scroll, ocupa todo el ancho del área de trabajo y no se superpone", () => {
  const footerRule = stepsCss.match(/\.ns-foot \{[^}]*\}/)?.[0] ?? "";
  assert.doesNotMatch(footerRule, /position: *(sticky|fixed|absolute)/, "el pie ya no flota sobre el contenido");
  assert.match(footerRule, /flex: none/);
  assert.match(footerRule, /border-top/);
  assert.match(stepsCss, /\.wl-new-study-page \{ display: flex; flex: 1; flex-direction: column; min-height: 0; \}/);
  assert.match(stepsCss, /\.app-layout:has\(\.wl-new-study-page\) \{ height: 100vh; height: 100dvh;/);
  assert.match(stepsCss, /\.ns-scroll \{ flex: 1; min-height: 0; overflow-y: auto;/);
  const jsxFooter = drawerSource.indexOf('<footer className="ns-foot">');
  const jsxScrollEnd = drawerSource.indexOf("</div>\n      </section>\n      </div>") >= 0 ? drawerSource.indexOf("</div>\n      </section>\n      </div>") : drawerSource.search(/<\/section>\s*<\/div>\s*<footer className="ns-foot">/);
  assert.ok(jsxFooter > 0 && jsxScrollEnd > 0 && jsxScrollEnd < jsxFooter, "el pie va después de cerrar el contenedor de scroll");
});

test("48 el contenido del pie se alinea con el formulario (mismo ancho máximo y compensación de la barra)", () => {
  assert.match(stepsCss, /\.ns-foot-inner \{[^}]*width: min\(1120px, 100%\); margin: 0 auto;/);
  assert.match(stepsCss, /var\(--ns-scrollbar, 0px\)/);
  assert.match(drawerSource, /setProperty\("--ns-scrollbar"/);
});

test("49 con nacimiento conocido y sin fecha del estudio se pide la fecha, sin asumir la actual", () => {
  assert.match(drawerSource, /const ageNeedsStudyDate = age\.calculated === null && !age\.missing\.birthDate && age\.missing\.studyDate;/);
  assert.match(drawerSource, /Completá la fecha del estudio para calcular la edad\./);
  assert.match(drawerSource, /Completar la fecha del estudio/);
  assert.match(drawerSource, /pendingFocusRef\.current = "ns-study-date"/);
  assert.match(drawerSource, /id="ns-study-date"/);
  assert.doesNotMatch(drawerSource, /new Date\(\)|Date\.now\(\)|toISOString/, "no se usa la fecha actual para calcular edades");
});

test("50 la edad manual es una alternativa explícita: el campo no aparece de entrada", () => {
  assert.match(drawerSource, /Declarar edad manualmente/);
  assert.match(drawerSource, /const showAgeInput = ageOverrideOpen \|\| metadata\.ageDeclared\.trim\(\) !== "";/);
  assert.match(drawerSource, /Quitar la edad declarada/);
});

test("51 al analizar, el formulario es reemplazado por la vista de procesamiento dentro de la misma estructura", () => {
  assert.match(drawerSource, /const showProcessing = analysisStage !== "idle" \|\| Boolean\(persistedRun && productState\);/);
  assert.match(drawerSource, /\{message && !showProcessing &&/);
  assert.match(drawerSource, /<summary>Detalles del procesamiento<\/summary>/);
  const form = drawerSource.slice(drawerSource.indexOf('step === "context" && !showProcessing && ('));
  assert.doesNotMatch(form, /ns-stages|Etapas del procesamiento|wl-analysis-progress|wl-product-progress/, "el cargador no se agrega debajo del formulario");
});

test("52 un único estado principal: una sola lista de etapas, sin segundo indicador por el subpaso", () => {
  assert.equal((drawerSource.match(/aria-label="Etapas del procesamiento"/g) ?? []).length, 1);
  assert.doesNotMatch(drawerSource, /wl-analysis-progress|wl-product-progress/);
  assert.match(drawerSource, /stage\.id === "completing" && productState\?\.message/);
});

test("53 la vista de procesamiento no usa mensajes de implementación ni progreso inventado", () => {
  const processing = drawerSource.slice(drawerSource.indexOf('step === "context" && showProcessing && ('), drawerSource.indexOf('step === "context" && !showProcessing && ('));
  assert.doesNotMatch(processing, /porcentaje|restante|minutos|segundos|%|El sistema no informa/i);
  assert.doesNotMatch(drawerSource, /analysisStageCopy/);
});

test("54 una falla antes de guardar conserva el formulario y muestra la recuperación real", () => {
  assert.match(drawerSource, /setRunError\(apiErrorMessage\(error, "ejecutar el análisis"\)\)/);
  assert.match(drawerSource, /Tus datos y las imágenes siguen cargados\. Podés reintentar con «Analizar estudio» o volver a un paso anterior\./);
  const runStart = drawerSource.indexOf("async function run()");
  const catchBlock = drawerSource.slice(drawerSource.indexOf("catch (error)", runStart), drawerSource.indexOf("finally", runStart));
  assert.doesNotMatch(catchBlock, /setMetadata\(|setSelectedPatient\(|setUploads\(|setStudyUpload\(/);
});

test("55 la falla de hallazgos discales ofrece solo las acciones que existen", () => {
  assert.match(drawerSource, /El análisis principal quedó guardado\./);
  assert.match(drawerSource, /productState\.retryable[\s\S]*?Podés abrir el estudio sin hallazgos discales o reintentar solo esa parte\./);
  assert.match(drawerSource, /Abrir sin hallazgos discales/);
  assert.match(drawerSource, /Reintentar hallazgos discales/);
});

test("56 el contexto de un estudio no se copia de otro: el formulario nace vacío y no lee estudios previos", () => {
  assert.match(studyMetadataSource, /clinicalReason: "", symptoms: "", symptomDuration: "", relevantHistory: ""/);
  assert.doesNotMatch(drawerSource, /fetchStudyContext|studyContextApi|findStudiesByPatient/);
});

console.log(`Post-E50 new study (3 steps, patient + context) tests passed: ${count}`);
