import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

/**
 * Selector de secuencia de la carga por plano, contra el stack local (8288/8280).
 *
 *   node scripts/playwright-sequence-selector-e2e.mjs
 *
 * Variables: VIEWER_URL (http://localhost:8288), SIZE (1366x768), THEME (light|dark), SEQ_E2E_FILE (un .mha sagital que
 * el modelo pueda analizar; por defecto la copia preparada del T1 de OSF-ID10, D:eson\MIRAL-ID10-preparado\...), SHOTS_DIR.
 *
 * DATOS AISLADOS: crea su propio paciente (SEQ-E2E-<marca>) y dos estudios nuevos (…-UNK y …-T1). El archivo de entrada
 * se lee sin modificarlo; no se genera ningún volumen sintético porque el modelo lo rechaza (un volumen sin anatomía no
 * devuelve el contrato real esperado). Hace exactamente DOS análisis, uno por estudio nuevo. No abre, reanaliza ni
 * modifica ningún estudio existente (se comprueba con una huella de los estudios, corridas y entradas previas, OSF-ID10
 * incluidos). Si el archivo no existe, la prueba se detiene con un mensaje y no crea nada.
 *
 * Cubre: Desconocida (predeterminada) se registra desconocida y no bloquea el análisis; T1 declarada viaja, se registra con
 * su procedencia y persiste (corrida, catálogo y visor) tras recargar; cambiar la declaración después de cargar
 * invalida esa carga hasta volver a cargar; sin POST de análisis fuera de los dos esperados.
 */

const viewerUrl = process.env.VIEWER_URL ?? "http://localhost:8288";
const [width, height] = (process.env.SIZE ?? "1366x768").split("x").map(Number);
const theme = process.env.THEME ?? "light";
const shotsDir = process.env.SHOTS_DIR;
const stamp = Date.now().toString(36).toUpperCase();
const patientCode = `SEQ-E2E-${stamp}`;
const caseUnknown = `SEQ-E2E-${stamp}-UNK`;
const caseT1 = `SEQ-E2E-${stamp}-T1`;

if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

function assertTruthy(value, message) {
  if (!value) throw new Error(`E2E assertion failed: ${message}`);
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`E2E assertion failed: ${message} (esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)})`);
}
let step = 0;
const ok = (message) => { step += 1; console.log(`ok ${step} - ${message}`); };

function sql(query) {
  return execFileSync("docker", ["exec", "lumbarai-clean-postgres", "psql", "-U", "pfi", "pfi_backend", "-tAc", query], { encoding: "utf8" }).trim();
}
/** Huella de todo lo que NO es de esta prueba: estudios, corridas y entradas. */
function fingerprintOfOthers() {
  const like = `case_id like 'SEQ-E2E-${stamp}%'`;
  return sql(
    `select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from (` +
    `select s.id, s.case_id, s.patient_id, s.study_date, s.updated_at, r.multiplanar_run_id, md5(r.metrics_snapshot::text), i.input_id, i.weighting, i.sequence_source ` +
    `from domain_studies s left join domain_study_runs r on r.study_id=s.id left join domain_input_resources i on i.study_id=s.id where not (s.${like})) x`,
  );
}
const runSequence = (caseId) => sql(
  `select coalesce(r.metrics_snapshot->'planes'->'sagittal'->'input'->'sequence'->>'value','') || '|' || coalesce(r.metrics_snapshot->'planes'->'sagittal'->'input'->'sequence'->>'source','') ` +
  `from domain_study_runs r join domain_studies s on s.id=r.study_id where s.case_id='${caseId}' order by r.created_at desc limit 1`,
);
const catalogue = (caseId) => sql(
  `select i.weighting || '|' || i.sequence_source || '|' || i.sequence_description from domain_input_resources i join domain_studies s on s.id=i.study_id where s.case_id='${caseId}' and i.plane='sagittal'`,
);
const runCount = (caseId) => Number(sql(`select count(*) from domain_study_runs r join domain_studies s on s.id=r.study_id where s.case_id='${caseId}'`));

const volume = process.env.SEQ_E2E_FILE ?? "D:/reson/MIRAL-ID10-preparado/visita-1_Siemens-Verio/sagital_T1_sin_contraste.mha";
if (!fs.existsSync(volume)) {
  console.error(`No se encuentra el archivo de entrada: ${volume}. Indicá SEQ_E2E_FILE con un .mha sagital analizable.`);
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width, height } });
await context.addInitScript((value) => { try { localStorage.setItem("pfi.theme", value); } catch { /* sin almacenamiento */ } }, theme);
const page = await context.newPage();
const posts = [];
const uploadResponses = [];
context.on("request", (request) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method())) return;
  const route = `${request.method()} ${new URL(request.url()).pathname}`;
  if (!/\/api\/auth\//.test(route)) posts.push(route);
});
context.on("response", async (response) => {
  if (response.request().method() === "POST" && new URL(response.url()).pathname === "/api/ai/inputs") {
    try { uploadResponses.push(await response.json()); } catch { /* respuesta sin cuerpo */ }
  }
});
page.on("pageerror", (error) => { throw new Error(`error de página: ${error.message}`); });
const shot = async (name) => { if (shotsDir) await page.screenshot({ path: `${shotsDir}/${theme}-${width}x${height}-${name}.png` }); };

async function login() {
  await page.goto(`${viewerUrl}/`, { waitUntil: "networkidle" });
  const demo = page.getByRole("button", { name: /Entrar con doctor demo/ });
  if (await demo.count()) await demo.click();
  await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
}

async function openNewStudy() {
  await page.getByRole("button", { name: "Nuevo estudio" }).click();
  await page.getByRole("heading", { name: "Nuevo estudio", level: 1 }).waitFor();
}

async function createPatientAndStudy(caseId, createPatient) {
  await openNewStudy();
  if (createPatient) {
    await page.getByRole("button", { name: "Crear paciente" }).click();
    await page.locator("#new-patient-reference").fill(patientCode);
    await page.locator("form, section, div").filter({ has: page.locator("#new-patient-reference") }).last().getByRole("button", { name: "Crear paciente" }).last().click();
  } else {
    await page.getByLabel("Buscar paciente por código o nombre").fill(patientCode);
    await page.getByRole("list", { name: "Resultados de pacientes" }).getByRole("button").first().click();
  }
  await page.locator('[aria-label="Paciente seleccionado"]').waitFor({ timeout: 15000 });
  await page.getByPlaceholder("CASE-XXXX").fill(caseId);
  await page.getByPlaceholder("RM lumbar sagital T2").fill("Prueba E2E del selector de secuencia con una copia de un T1 sagital de un dataset público (no es un caso clínico).");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: /Cargar archivos por plano/ }).click();
  await page.getByTestId("ns-sequence-select-sagittal").waitFor();
}

const selector = () => page.getByTestId("ns-sequence-select-sagittal");
const registered = () => page.getByTestId("ns-sequence-registered-sagittal");
const analyzeButton = () => page.getByRole("button", { name: "Analizar estudio", exact: true });
const sequenceLines = () => page.getByTestId("viewport-sequence").allInnerTexts().then((items) => items.map((text) => text.replace(/\s+/g, " ").trim()));

async function analyzeFromContext(caseId) {
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("heading", { name: "Contexto y revisión", level: 2 }).waitFor({ timeout: 15000 });
  assertTruthy(await analyzeButton().isEnabled(), "el análisis está habilitado");
  await analyzeButton().click();
  // Se espera el estudio o un error visible: un fallo del análisis se informa tal cual, no como un timeout.
  const failure = page.locator('[role="alert"]').first();
  const outcome = await Promise.race([
    page.waitForURL(new RegExp(`/estudio/${caseId}`), { timeout: 300000 }).then(() => "opened"),
    failure.waitFor({ timeout: 300000 }).then(() => "error"),
  ]);
  if (outcome === "error") throw new Error(`el análisis de ${caseId} falló: ${(await failure.innerText()).replace(/\s+/g, " ")}`);
  await page.locator("aside.rr-panel").waitFor({ timeout: 60000 });
  await page.waitForTimeout(3000);
}

async function openStudyFromWorklist(caseId) {
  await page.getByText(caseId, { exact: true }).first().click();
  await page.getByRole("button", { name: "Abrir estudio" }).click();
  await page.locator("aside.rr-panel").waitFor();
  await page.waitForTimeout(3000);
}

const before = fingerprintOfOthers();
await login();

/* ---------------------------------------------------------------- A. Desconocida (predeterminada) */
await createPatientAndStudy(caseUnknown, true);
assertEqual(await selector().inputValue(), "unknown", "el selector arranca en «Desconocida»");
const uploadsBeforeA = uploadResponses.length;
await page.locator('input[type="file"]').nth(1).setInputFiles(volume);
await registered().waitFor({ timeout: 90000 });
assertTruthy(/Sin informar/.test(await registered().innerText()), "se registra «Sin informar»");
// Chromium no expone el cuerpo multipart con archivo: se comprueba lo que el servidor registró de esa carga.
const responseA = uploadResponses[uploadsBeforeA];
assertTruthy(responseA && responseA.inputId, "el servidor registró la carga");
assertEqual(responseA.sequence?.value, "unknown", "sin declaración el servidor registra la secuencia como desconocida");
assertEqual(responseA.sequence?.source, "unknown", "sin declaración no hay procedencia");
ok("Desconocida (predeterminada): el servidor la registra desconocida y sin procedencia");

await shot("01-desconocida-cargada");
await analyzeFromContext(caseUnknown);
assertEqual(runCount(caseUnknown), 1, "una sola corrida del estudio sin secuencia");
assertEqual(runSequence(caseUnknown), "unknown|unknown", "la corrida publica la secuencia como desconocida (no T2)");
assertEqual(catalogue(caseUnknown), "||", "el catálogo no tiene ponderación ni procedencia");
assertTruthy((await sequenceLines()).every((line) => /Sin informar/.test(line)) && (await sequenceLines()).length > 0, "el visor dice «Sin informar»");
ok("Desconocida no bloquea el análisis; la corrida y el visor la dejan desconocida (sin asumir T2)");

/* ---------------------------------------------------------------- B. T1 declarada */
await page.getByRole("button", { name: /Estudios/ }).first().click();
await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
await createPatientAndStudy(caseT1, false);
await selector().selectOption("t1");
const uploadsBeforeB = uploadResponses.length;
await page.locator('input[type="file"]').nth(1).setInputFiles(volume);
await registered().waitFor({ timeout: 90000 });
assertTruthy(/T1 · declarada por el usuario/.test(await registered().innerText()), "se registra «T1 · declarada por el usuario»");
const responseB = uploadResponses[uploadsBeforeB];
assertTruthy(responseB && responseB.inputId, "el servidor registró la carga");
assertEqual(responseB.sequence?.value, "t1", "el servidor registró T1");
assertEqual(responseB.sequence?.source, "user_declared", "el servidor registró la procedencia «declarada por el usuario»");
ok("T1 declarada: viaja en la carga y se registra con su procedencia");

// Cambiar la declaración invalida lo cargado hasta volver a cargarlo.
await selector().selectOption("t2");
await page.getByTestId("ns-sequence-stale-sagittal").waitFor();
await page.getByRole("button", { name: "Continuar", exact: true }).click().catch(() => undefined);
assertTruthy(await page.getByTestId("ns-sequence-stale-sagittal").isVisible(), "el aviso de carga desactualizada sigue visible");
assertEqual(await page.getByRole("heading", { name: "Contexto y revisión", level: 2 }).count(), 0, "no se avanza con una carga hecha con otra secuencia");
await selector().selectOption("t1");
assertEqual(await page.getByTestId("ns-sequence-stale-sagittal").count(), 0, "volver a la secuencia cargada quita el aviso");
await shot("02-t1-declarada");
ok("cambiar la declaración después de cargar bloquea el avance hasta que coincide con lo cargado");

await analyzeFromContext(caseT1);
assertEqual(runCount(caseT1), 1, "una sola corrida del estudio con T1 declarada");
assertEqual(runSequence(caseT1), "t1|user_declared", "la corrida publica T1 declarada por el usuario");
assertEqual(catalogue(caseT1), "t1|user_declared|", "el catálogo guarda T1 con su procedencia");
assertTruthy((await sequenceLines()).some((line) => /T1 · declarada por el usuario/.test(line)), "el visor dice «T1 · declarada por el usuario»");
await shot("03-visor-t1-declarada");
ok("T1 declarada: persiste en la corrida y en el catálogo, y el visor muestra valor y procedencia");

/* ---------------------------------------------------------------- C. Persistencia tras recargar */
await page.reload({ waitUntil: "networkidle" });
await login();
await openStudyFromWorklist(caseT1);
assertTruthy((await sequenceLines()).some((line) => /T1 · declarada por el usuario/.test(line)), "tras recargar el visor conserva T1 declarada");
await page.getByRole("button", { name: /Estudios/ }).first().click();
await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
await openStudyFromWorklist(caseUnknown);
assertTruthy((await sequenceLines()).every((line) => /Sin informar/.test(line)), "tras recargar el estudio sin secuencia sigue «Sin informar»");
ok("tras recargar se conservan la secuencia y su procedencia en ambos estudios");

/* ---------------------------------------------------------------- D. Aislamiento */
const analysisPosts = posts.filter((item) => item === "POST /api/ai/multiplanar/run");
assertEqual(analysisPosts.length, 2, "exactamente dos análisis (uno por estudio nuevo)");
assertEqual(fingerprintOfOthers(), before, "ningún estudio, corrida ni entrada preexistente cambió");
ok("datos aislados: dos análisis nuevos y ningún estudio previo (OSF-ID10 incluidos) modificado");

await browser.close();
console.log(`\nE2E del selector de secuencia: ${step} verificaciones correctas (paciente ${patientCode}).`);
