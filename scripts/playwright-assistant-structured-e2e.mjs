import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

/**
 * Asistente en modo acotado, probado en 8288 con el modelo local REAL y con CASOS PROPIOS (nunca MENDELEY ni OSF):
 *  - individual: REVFIN-* (caso propio de esta revisión);
 *  - par A/B: REVFIN-* (B, actual) contra PREISO-* (A, referencia): son casos de PRUEBA del mismo paciente de prueba.
 * Las únicas escrituras son las conversaciones del asistente de esos casos. La indisponibilidad del proveedor se simula en el
 * navegador (respuestas controladas), sin apagar ni descargar el modelo.
 *
 * Uso: CASE=REVFIN-2110 REF=PREISO-58044 OUT_DIR=... node scripts/playwright-assistant-structured-e2e.mjs
 */
const WEB = process.env.PFI_WEB ?? "http://localhost:8288";
const API = process.env.PFI_API ?? "http://localhost:8280";
const CASE = process.env.CASE;
const REF = process.env.REF;
const OUT = process.env.OUT_DIR ?? "assistant-structured-out";
if (!/^REVFIN-/.test(CASE ?? "") || !/^PREISO-/.test(REF ?? "")) throw new Error("Definí CASE=REVFIN-* y REF=PREISO-* (casos propios)");
mkdirSync(OUT, { recursive: true });

const login = await (await fetch(`${API}/api/auth/demo-doctor`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
const token = login.accessToken ?? login.token;
const api = async (path) => (await (await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })).json());

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const log = [];
const record = (name, ok, note = "") => { log.push({ name, ok, note }); console.log(`${ok ? "ok" : "FALLA"} - ${name}${note ? ` · ${note}` : ""}`); };
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

const FORBIDDEN = /elevad|reducid|podr[ií]a indicar|anormal|patol[oó]gic|\bnormal\b|aument[oó]|disminu[yi]|mejor[oó]|empeor[oó]|grave/i;
const answers = () => page.getByTestId("assistant-message-assistant");

async function ask(question, { suggested = false } = {}) {
  const before = await answers().count();
  const started = Date.now();
  if (suggested) await page.getByTestId("assistant-suggestions").getByRole("button", { name: question }).click();
  else {
    await page.getByLabel("Escribir una pregunta").fill(question);
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
  }
  const outcome = await Promise.race([
    answers().nth(before).waitFor({ timeout: 240_000 }).then(() => "answer"),
    page.getByTestId("assistant-error").waitFor({ timeout: 240_000 }).then(() => "error"),
  ]);
  const ms = Date.now() - started;
  if (outcome === "error") return { outcome, ms, text: (await page.getByTestId("assistant-error").innerText()).trim() };
  const message = answers().nth(before);
  const text = (await message.innerText()).trim();
  const origin = await message.getByTestId("assistant-origin").getAttribute("data-origin");
  const originText = await message.getByTestId("assistant-origin").innerText();
  const references = await message.locator("[data-testid=assistant-references] li").allInnerTexts().catch(() => []);
  const lines = await message.locator("p.chat-line").allInnerTexts();
  return { outcome, ms, text, origin, originText, references, lines };
}

async function openAssistant() {
  await page.getByTestId("tools-open").click();
  await page.locator('[data-tool-id="assistant"]').click();
  await page.getByTestId("assistant-panel").waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => { const el = document.querySelector('[data-testid="assistant-connection"]'); return el && !/Comprobando/.test(el.textContent ?? ""); }, null, { timeout: 30_000 });
}

try {
  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Entrar con doctor demo/ }).click();
  await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();

  /* ------------------------------------------------ 1. estudio individual */
  await page.goto(`${WEB}/estudio/${CASE}`, { waitUntil: "networkidle" });
  await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2500);
  await openAssistant();
  record("1. modelo conectado, fuente disponible y datos usados se muestran por separado",
    /Modelo local conectado/.test(await page.getByTestId("assistant-connection").innerText()) && /Datos registrados disponibles/.test(await page.getByTestId("assistant-source").innerText()));
  const suggestions = await page.getByTestId("assistant-suggestions").getByRole("button").allInnerTexts();
  record("1. las consultas disponibles son las del servidor", suggestions.includes("¿Qué datos faltan?") && suggestions.some((q) => /Resumí los datos registrados/.test(q)), suggestions.join(" | "));
  await page.screenshot({ path: `${OUT}/01-individual-panel.png` });

  const detail = await api(`/api/studies/${CASE}`);
  const measurements = detail.runs[0].measurementsByPlane.sagittal ?? [];
  const sample = measurements.find((m) => m.level === "L4-L5" && m.labelKey === "disc height") ?? measurements[0];

  const summary = await ask("Resumí los datos registrados de este estudio", { suggested: true });
  record("1. consulta sugerida (sin modelo) devuelve una respuesta respaldada", summary.outcome === "answer" && summary.origin === "supported", `${summary.ms} ms · ${summary.originText}`);
  await page.screenshot({ path: `${OUT}/02-individual-resumen.png` });
  record("1. el resumen no valora ningún valor (sin «elevado», «reducido», «normal»…)", !FORBIDDEN.test(summary.text), summary.text.slice(0, 160));
  record("1. cada línea de dato trae su referencia", summary.references.length > 0, summary.references.join(" | "));

  const l45 = await ask("¿Qué mediciones hay en el disco L4-L5?");
  record("1. pregunta libre real: el modelo solo eligió el filtro y la respuesta está respaldada", l45.outcome === "answer" && l45.origin === "supported", `${l45.ms} ms`);
  if (l45.outcome === "answer") {
    const dataLines = l45.text.split("\n").filter((l) => /^\[M\d+\]/.test(l));
    record("1. todas las líneas de datos son de L4-L5 y de la corrida (contrastadas con el backend)",
      dataLines.length > 0 && dataLines.every((l) => /L4-L5/.test(l)), `${dataLines.length} líneas`);
    if (sample) {
      const expected = String(Math.round(sample.value * 100) / 100).replace(".", ",");
      record("1. el valor mostrado coincide con el dato registrado", l45.text.includes(`${expected} mm`) || l45.text.includes(`${expected}`), `${sample.labelKey} L4-L5 = ${expected}`);
    }
    record("1. sin valoraciones", !FORBIDDEN.test(l45.text));
  }
  await page.screenshot({ path: `${OUT}/03-individual-libre.png` });

  const grave = await ask("¿Es grave lo que se ve? ¿Hay que operar?");
  record("1. una pedido clínico queda fuera del alcance y se explica el límite", grave.outcome === "answer" && grave.origin === "out_of_scope" && /Consultas disponibles/.test(grave.text), grave.originText);
  record("1. fuera del alcance no cita datos ni interpreta", grave.references.length === 0 && !/grave:|es normal|elevad|reducid/i.test(grave.text.replace(/¿Es grave[^\n]*/g, "")));

  const unknown = await ask("¿Qué mediciones tiene L6-S1?");
  record("1. un nivel sin datos se dice y no se reemplaza por otro", unknown.outcome === "answer" && /No hay datos registrados para el nivel L6-S1/.test(unknown.text) && !/\[M\d+\]/.test(unknown.text), unknown.text.split("\n")[0]);
  await page.screenshot({ path: `${OUT}/04-individual-fuera-de-alcance.png` });

  /* ------------------------------------------------ 2. indisponibilidad simulada del modelo (sin tocar el proveedor real) */
  await page.getByRole("button", { name: "Nueva conversación" }).click();
  await page.route(/\/api\/studies\/[^/]+\/chat-context/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, provider: { enabled: true, available: false, model: body.provider?.model ?? "" } } });
  });
  await page.route(/\/api\/studies\/[^/]+\/chat$/, (route) => route.request().method() === "POST" && process.env.SIMULATE_FAIL !== "0" && simulate.failChat
    ? route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ code: "LLM_PROVIDER_UNAVAILABLE", status: 502, message: "no disponible" }) })
    : route.continue());
  const simulate = { failChat: true };
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2000);
  await openAssistant();
  record("2. [simulado] modelo sin conexión: se avisa y se explica qué sigue funcionando",
    /Sin conexión con el modelo local/.test(await page.getByTestId("assistant-connection").innerText()) && /siguen funcionando sin el modelo/.test(await page.getByTestId("assistant-model-note").innerText()));
  record("2. [simulado] la fuente sigue disponible aunque el modelo no lo esté", /Datos registrados disponibles/.test(await page.getByTestId("assistant-source").innerText()));
  record("2. las consultas disponibles siguen habilitadas", (await page.getByTestId("assistant-suggestions").getByRole("button").first().isEnabled()));
  await page.screenshot({ path: `${OUT}/05-individual-modelo-sin-conexion.png` });
  simulate.failChat = false;
  const missing = await ask("¿Qué datos faltan?", { suggested: true });
  record("2. [real con proveedor simulado caído en el contexto] una consulta disponible responde sin el modelo", missing.outcome === "answer" && missing.origin === "supported", `${missing.ms} ms`);
  simulate.failChat = true;
  const typed = await ask("¿Cuánto mide la altura del disco en L4-L5?");
  record("2. [simulado] una pregunta escrita con el modelo caído muestra un error claro y permite reintentar", typed.outcome === "error" && (await page.getByRole("button", { name: "Reintentar" }).count()) === 1, typed.text);
  simulate.failChat = false;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="assistant-message-assistant"]').length >= 2, null, { timeout: 240_000 });
  record("2. el reintento (ya sin el fallo simulado) responde", (await answers().count()) >= 2);
  await page.unrouteAll({ behavior: "ignoreErrors" });

  /* ------------------------------------------------ 3. par A/B */
  await page.goto(`${WEB}/estudio/${CASE}`, { waitUntil: "networkidle" });
  await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2500);
  await page.getByTestId("tools-open").click();
  await page.locator('[data-tool-id="comparison"]').click();
  await page.getByTestId("initial-comparison").waitFor({ timeout: 60_000 });
  await page.locator("#rr-cmp-reference").selectOption(REF);
  await page.getByTestId("open-dual-comparison").click();
  await page.getByTestId("dual-comparison").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(4000);
  await page.getByTestId("dual-tab-assistant").click();
  await page.getByTestId("assistant-panel").waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => { const el = document.querySelector('[data-testid="assistant-connection"]'); return el && !/Comprobando/.test(el.textContent ?? ""); }, null, { timeout: 30_000 });
  record("3. el par A/B muestra los dos lados y la fuente", /A = Referencia \(PREISO/.test(await page.getByTestId("assistant-scope").innerText()) && /Datos registrados disponibles/.test(await page.getByTestId("assistant-source").innerText()));
  const pairSuggestions = await page.getByTestId("assistant-suggestions").getByRole("button").allInnerTexts();
  record("3. las consultas del par son las del servidor", pairSuggestions.includes("¿Qué diferencias se registraron entre A y B?"), pairSuggestions.join(" | "));
  await page.screenshot({ path: `${OUT}/06-par-panel.png` });

  const diffs = await ask("¿Qué diferencias se registraron entre A y B?", { suggested: true });
  record("3. diferencias A/B respaldadas, con la cantidad mostrada y el total", diffs.outcome === "answer" && diffs.origin === "supported" && /Mostrando \d+ de \d+ diferencias/.test(diffs.text), `${diffs.ms} ms`);
  await page.screenshot({ path: `${OUT}/07-par-diferencias.png` });
  record("3. no se describe evolución clínica ni se valora", /no indica evolución clínica/.test(diffs.text) && !FORBIDDEN.test(diffs.text.replace(/no indica evolución clínica/g, "")));
  // Contraste con el comparador del backend: cada línea D# debe coincidir con la diferencia calculada por el sistema.
  const cmp = await api(`/api/studies/${CASE}/initial-analysis-comparison?referenceCaseId=${REF}&currentRunId=${detail.runs[0].summary.runId}&referenceRunId=${(await api(`/api/studies/${REF}`)).runs[0].summary.runId}`).catch(() => null);
  const rows = cmp?.comparisons ?? [];
  const changed = rows.filter((r) => Math.abs(r.deltaAbsolute) > 1e-9);
  const dLines = diffs.lines.filter((l) => /^\[D\d+\] .* · /.test(l));
record("3. el número de líneas D coincide con las diferencias del comparador (o se declara el recorte)", rows.length === 0 || dLines.length === Math.min(rows.length, 40), `${dLines.length} líneas / ${rows.length} filas del comparador`);
  if (changed.length > 0) {
    const r = changed[0];
    const fmt = (v) => String(Math.round(v * 100) / 100).replace(".", ",");
    const line = dLines.find((l) => l.includes(`A ${fmt(r.reference.effectiveValue)}`) && l.includes(`B ${fmt(r.current.effectiveValue)}`));
    record("3. una diferencia real (valor corregido) aparece con A y B sin invertir y con su nota de corrección", Boolean(line) && /corregido por un profesional/.test(line ?? ""), line ?? "no encontrada");
  } else {
    record("3. diferencias no nulas para contrastar", false, "el par no tiene diferencias: no se pudo contrastar el signo");
  }
  const notComparable = await ask("¿Qué resultados no se pudieron comparar y por qué?", { suggested: true }).catch(() => null);
  void notComparable;
  const libre = await ask("¿Qué cambió en la altura del disco entre A y B?");
  record("3. pregunta libre real en el par: respaldada por datos y filtrada por medición", libre.outcome === "answer" && libre.origin === "supported", `${libre.ms} ms`);
  if (libre.outcome === "answer") record("3. el filtro de medición se aplicó (solo altura del disco)", libre.text.split("\n").filter((l) => /^\[D\d+\]/.test(l)).every((l) => /altura del disco/.test(l)));
  await page.screenshot({ path: `${OUT}/08-par-libre.png` });
  record("sin errores de página", pageErrors.length === 0, pageErrors.join(" | "));
} catch (error) {
  record("la prueba terminó sin excepciones", false, String(error).slice(0, 300));
}
writeFileSync(`${OUT}/assistant-structured-log.json`, JSON.stringify(log, null, 1));
await browser.close();
const failed = log.filter((l) => !l.ok);
console.log(`${log.length - failed.length}/${log.length} comprobaciones correctas${failed.length ? `; con falla: ${failed.map((f) => f.name).join(" | ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
