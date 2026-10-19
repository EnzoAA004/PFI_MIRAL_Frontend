import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";

/**
 * Estados de error y navegación: cada causa tiene su título y su salida; el detalle técnico no es la explicación principal;
 * un paciente existente sin estudios no se confunde con uno inexistente; la lista recuerda lo que se dejó al volver del visor.
 */
const root = process.cwd();
function load(path, names, extra = {}) {
  const source = readFileSync(join(root, path), "utf8").replace(/^import .*$/gm, "").replace(/export /g, "");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { exports: {}, console, Error, ...extra };
  vm.runInNewContext(`${js}\n${names.map((n) => `exports.${n} = ${n};`).join("\n")}`, sandbox);
  return sandbox.exports;
}
const failures = load("src/features/errors/loadFailure.ts", ["classifyLoadFailure", "noRunsFailure", "contractIssueFailure", "patientWithoutStudiesState"]);
const auth = load("src/authClient.ts", ["authFailureMessage"], {
  API_BASE_URL: "", ensureAuthSession: async () => null, getCachedAuthSession: () => null, saveAuthSession: (x) => x, coordinateRefresh: (f) => f(),
  clearAllProtectedData: () => undefined, notifySessionInvalidated: () => undefined, generateTraceId: () => "t",
});
const memory = load("src/features/worklist/worklistViewMemory.ts", ["rememberWorklistView", "recalledWorklistView", "forgetWorklistView"]);

let n = 0;
function test(name, fn) {
  fn();
  n += 1;
  console.log(`ok ${n} - ${name}`);
}
const api = (status, extra = {}) => ({ name: "ApiError", status, path: "/api/studies/X", traceId: "trace-1", message: "x", ...extra });

test("un estudio inexistente dice «no encontrado», no se reintenta y no habla de contrato", () => {
  const f = failures.classifyLoadFailure(api(404), "estudio", "NO-EXISTE-999");
  assert.equal(f.kind, "not_found");
  assert.equal(f.title, "Estudio no encontrado");
  assert.match(f.message, /NO-EXISTE-999/);
  assert.equal(f.retryable, false);
  assert.doesNotMatch(`${f.title} ${f.message}`, /contrato|incompatible|Backend|HTTP/i);
  assert.match(f.detail, /HTTP 404/, "el código queda como detalle técnico");
});

test("un paciente inexistente tiene su propio título", () => {
  assert.equal(failures.classifyLoadFailure(api(404), "paciente", "X").title, "Paciente no encontrado");
});

test("cada causa se distingue: permisos, sesión, servicio caído y datos con formato inesperado", () => {
  assert.equal(failures.classifyLoadFailure(api(403), "estudio", "X").kind, "forbidden");
  assert.equal(failures.classifyLoadFailure(api(401), "estudio", "X").kind, "session");
  const down = failures.classifyLoadFailure(api(503), "estudio", "X");
  assert.equal(down.kind, "service");
  assert.equal(down.retryable, true);
  assert.equal(failures.classifyLoadFailure(new TypeError("Failed to fetch"), "estudio", "X").kind, "service", "sin respuesta del servidor = servicio");
  const contract = failures.classifyLoadFailure({ name: "ContractError", message: "falta runId", path: "/api/x" }, "estudio", "X");
  assert.equal(contract.kind, "contract");
  assert.match(contract.title, /formato esperado/);
  assert.equal(contract.retryable, true);
});

test("el detalle técnico no incluye secretos y el título nunca es técnico", () => {
  const f = failures.classifyLoadFailure(api(500, { message: "Bearer abc.def.ghi", token: "secreto" }), "estudio", "X");
  assert.doesNotMatch(JSON.stringify(f), /Bearer|secreto|abc\.def/);
  for (const status of [401, 403, 404, 500]) assert.doesNotMatch(failures.classifyLoadFailure(api(status), "estudio", "X").title, /Backend|respondió|contrato/i);
});

test("un estudio sin corridas se explica como tal, y los datos con formato inesperado traen su detalle", () => {
  const f = failures.noRunsFailure("CASO-1");
  assert.equal(f.kind, "no_runs");
  assert.match(f.title, /todavía no tiene análisis/);
  const c = failures.contractIssueFailure("falta runId (/api/x) · traza t-1");
  assert.equal(c.kind, "contract");
  assert.match(c.detail, /falta runId/);
});

test("un paciente existente sin estudios no se confunde con uno inexistente", () => {
  assert.equal(failures.patientWithoutStudiesState("VIS-006857", ["VIS-006857", "OTRO"]), "exists_without_studies");
  assert.equal(failures.patientWithoutStudiesState("vis-006857", ["VIS-006857"]), "exists_without_studies");
  assert.equal(failures.patientWithoutStudiesState("NO-EXISTE", ["VIS-006857"]), "not_found");
  assert.equal(failures.patientWithoutStudiesState("VIS-0068", ["VIS-006857"]), "not_found", "la búsqueda es por prefijo pero la referencia debe coincidir exacta");
});

test("acceso: credenciales inválidas, sesión inválida, permisos, límite de intentos y servicio caído tienen su mensaje", () => {
  assert.equal(auth.authFailureMessage(401, "/api/auth/login"), "Correo o contraseña incorrectos.");
  assert.match(auth.authFailureMessage(400, "/api/auth/verify-login"), /código es inválido o venció/);
  assert.match(auth.authFailureMessage(401, "/api/auth/me"), /sesión no es válida/);
  assert.match(auth.authFailureMessage(403, "/api/auth/x"), /no tiene permiso|no fue aprobada/);
  assert.match(auth.authFailureMessage(429, "/api/auth/login"), /demasiados intentos/);
  assert.match(auth.authFailureMessage(503, "/api/auth/login"), /no respondió/);
  assert.match(auth.authFailureMessage(null, "/api/auth/login"), /No se pudo conectar/);
  for (const status of [400, 401, 403, 409, 429, 500, 503, null]) assert.doesNotMatch(auth.authFailureMessage(status, "/api/auth/login"), /Backend respondio|respondio \d+/);
});

test("la lista recuerda filtros, búsqueda, orden y página para volver del visor, y se descarta al cerrar sesión", () => {
  assert.equal(memory.recalledWorklistView(), null);
  memory.rememberWorklistView({ filters: { reviewStatus: "aceptado" }, filtersOpen: true, query: "OSF", sortKey: "caseId", sortDirection: "asc", page: 2, selectedKey: "OSF-ID10-V2-T1" });
  const recalled = memory.recalledWorklistView();
  assert.equal(recalled.query, "OSF");
  assert.equal(recalled.page, 2);
  assert.equal(recalled.sortKey, "caseId");
  memory.forgetWorklistView();
  assert.equal(memory.recalledWorklistView(), null);
});

test("la lista corrige una página que ya no existe y no depende del almacenamiento del navegador", () => {
  const src = readFileSync(join(root, "src/features/worklist/Worklist.tsx"), "utf8");
  assert.match(src, /const safePage = Math\.min\(page, pageCount - 1\)/, "la página guardada se acota a una válida");
  assert.match(src, /page: safePage/, "se recuerda la página ya corregida");
  const memorySrc = readFileSync(join(root, "src/features/worklist/worklistViewMemory.ts"), "utf8");
  assert.doesNotMatch(memorySrc, /localStorage|sessionStorage/, "la búsqueda puede contener referencias de pacientes: no se guarda en disco");
  assert.match(readFileSync(join(root, "src/App.tsx"), "utf8"), /forgetWorklistView\(\)/, "se descarta al cerrar sesión");
});

test("sin una corrida abierta el menú lateral no afirma «sincronizado» ni «modo degradado»", () => {
  const side = readFileSync(join(root, "src/components/Sidebar.tsx"), "utf8");
  assert.match(side, /systemOnline === null \? "" :/);
  const shell = readFileSync(join(root, "src/components/AppShell.tsx"), "utf8");
  assert.match(shell, /aiModuleAvailable === undefined \? null/);
  assert.match(readFileSync(join(root, "src/App.tsx"), "utf8"), /aiModuleAvailable=\{safeRun\?\.aiModuleAvailable\}/, "ya no se fuerza false cuando no hay corrida");
});

test("accesos retirados: Review Analytics, controles sin función y exportación JSON del historial", () => {
  const header = readFileSync(join(root, "src/components/Header.tsx"), "utf8");
  assert.doesNotMatch(header, /Review Analytics/);
  const settings = readFileSync(join(root, "src/components/ProfessionalSettingsView.tsx"), "utf8");
  assert.doesNotMatch(settings, /Cambiar contraseña|Notificaciones|Idioma|Densidad visual/);
  assert.match(settings, /Doble verificación/, "la doble verificación tiene backend y se conserva");
  const history = readFileSync(join(root, "src/components/PatientHistoryView.tsx"), "utf8");
  assert.doesNotMatch(history, /Exportar resumen|Agregar estudio/);
  const help = readFileSync(join(root, "src/components/HelpSupportView.tsx"), "utf8");
  assert.doesNotMatch(help, /Nuevo análisis/);
  assert.match(help, /Nuevo estudio/);
  assert.match(help, /Preparar preinforme/);
  assert.match(help, /borrador pendiente de revisión profesional/);
  assert.doesNotMatch(help, /datos de-identificados|PAT-xxxx|HIPAA/);
});

console.log(`Errores, navegación y limpieza: ${n} pruebas pasaron`);
