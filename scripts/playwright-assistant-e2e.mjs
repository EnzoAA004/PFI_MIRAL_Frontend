import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { chromium } from "playwright";

/**
 * Asistente sobre los resultados reales, probado desde la interfaz de la aplicación (8288) con el modelo local REAL.
 * No usa respuestas simuladas: depende de que el stack y el modelo estén encendidos. No ejecuta análisis nuevos ni
 * modifica resultados, revisiones ni datos clínicos; solo se escriben las conversaciones del asistente (identificadas por
 * su ámbito).
 *
 * Variables: PFI_WEB (8288), OUT_DIR (capturas y respuestas), SKIP_PROVIDER_OFF=1 para no apagar el modelo.
 */
const exec = promisify(execFile);
const WEB = process.env.PFI_WEB ?? "http://localhost:8288";
const OUT = process.env.OUT_DIR ?? "assistant-e2e-out";
const MODEL = process.env.LLM_MODEL_KEY ?? "qwen3-4b-instruct-2507";
const MENDELEY = "MENDELEY-0015-MVBLQ5XS";
const OSF_CURRENT = "OSF-ID10-V2-T1";
const OSF_REFERENCE = "OSF-ID10-V1-T1";
const ANSWER_TIMEOUT = 240_000;
mkdirSync(OUT, { recursive: true });

const log = [];
const record = (name, value) => {
  log.push({ name, ...value });
  console.log(`${value.ok === false ? "FALLA" : "ok"} - ${name}${value.note ? ` · ${value.note}` : ""}`);
};
const check = (name, condition, note) => record(name, { ok: Boolean(condition), note });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("dialog", (dialog) => dialog.accept());
const failures = [];
page.on("pageerror", (error) => failures.push(String(error)));

async function login() {
  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  const demo = page.getByRole("button", { name: /Entrar con doctor demo/ });
  if (await demo.count()) await demo.click();
  await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
}

async function openStudy(caseId) {
  await page.goto(`${WEB}/estudio/${caseId}`, { waitUntil: "networkidle" });
  await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2500);
}

async function openAssistantFromTools() {
  await page.getByTestId("tools-open").click();
  await page.locator('[data-tool-id="assistant"]').click();
  await page.getByTestId("assistant-panel").waitFor({ timeout: 30_000 });
}

async function connectionText() {
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="assistant-connection"]');
    return el && !/Comprobando/.test(el.textContent ?? "");
  }, null, { timeout: 30_000 });
  return (await page.getByTestId("assistant-connection").innerText()).trim();
}

/** Envía una pregunta (sugerida o escrita) y espera la respuesta o el error. Devuelve texto, tiempos y referencias. */
async function ask(question, { suggested = false } = {}) {
  const before = await page.getByTestId("assistant-message-assistant").count();
  const started = Date.now();
  if (suggested) await page.getByTestId("assistant-suggestions").getByRole("button", { name: question }).click();
  else {
    await page.getByLabel("Escribir una pregunta").fill(question);
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
  }
  const outcome = await Promise.race([
    page.getByTestId("assistant-message-assistant").nth(before).waitFor({ timeout: ANSWER_TIMEOUT }).then(() => "answer"),
    page.getByTestId("assistant-error").waitFor({ timeout: ANSWER_TIMEOUT }).then(() => "error"),
  ]);
  const ms = Date.now() - started;
  if (outcome === "error") return { outcome, ms, text: (await page.getByTestId("assistant-error").innerText()).trim() };
  const message = page.getByTestId("assistant-message-assistant").nth(before);
  const references = await message.locator("[data-testid=assistant-references] li").allInnerTexts().catch(() => []);
  return { outcome, ms, text: (await message.locator("p").first().innerText()).trim(), references };
}

try {
  await login();

  /* ------------------------------------------------------------------ 1. MENDELEY: estudio individual */
  await openStudy(MENDELEY);
  await openAssistantFromTools();
  const connection = await connectionText();
  check("1. el panel muestra el estudio y el modelo conectado", /Modelo local conectado/.test(connection), connection);
  const scopeText = await page.getByTestId("assistant-scope").innerText();
  check("1. el panel dice qué estudio usa", scopeText.includes(MENDELEY), scopeText.replace(/\s+/g, " "));
  check("1. aviso de revisión profesional y de que no ve imágenes", /no ve las imágenes/.test(await page.getByTestId("assistant-disclaimer").innerText()));
  check("1. datos ausentes visibles (edad y contexto)", /Edad al estudio/.test(await page.getByTestId("assistant-missing").innerText()));
  const suggestions = await page.getByTestId("assistant-suggestions").getByRole("button").allInnerTexts();
  check("1. preguntas sugeridas del estudio", suggestions.includes("Resumí los resultados de este estudio") && suggestions.includes("¿Qué resultados faltan o requieren especial revisión?"), suggestions.join(" | "));
  await page.screenshot({ path: `${OUT}/01-estudio-panel.png` });

  const summary = await ask("Resumí los resultados de este estudio", { suggested: true });
  record("1. resumen del estudio (modelo real)", { ok: summary.outcome === "answer", ms: summary.ms, text: summary.text, references: summary.references });
  await page.screenshot({ path: `${OUT}/02-estudio-resumen.png` });
  if (summary.outcome === "answer") {
    check("1. el resumen menciona el abombamiento predicho en L5-S1", /L5-S1/.test(summary.text) && /abombamiento/i.test(summary.text), summary.text.slice(0, 200));
    check("1. la respuesta trae referencias verificadas", summary.references.length > 0, summary.references.join(" | "));
  }
  check("1. el aviso de revisión profesional sigue visible con la respuesta", /Requiere revisión profesional|revisión profesional/.test(await page.getByTestId("assistant-disclaimer").innerText()));

  const missing = await ask("¿Qué edad tiene el paciente y cuál es el motivo de consulta?");
  record("2. edad y contexto ausentes (modelo real)", { ok: missing.outcome === "answer", ms: missing.ms, text: missing.text });
  if (missing.outcome === "answer") {
    check("2. no inventa una edad", !/\b\d{2}\s*(años|años)\b/i.test(missing.text), missing.text.slice(0, 220));
    check("2. dice que no está informado", /no est[aá]n? informad|no se (informa|registr|dispone)|sin (dato|informaci)/i.test(missing.text), missing.text.slice(0, 220));
  }

  /* ------------------------------------------------------------------ 3. OSF A/B desde el visor dual */
  await openStudy(OSF_CURRENT);
  await page.getByTestId("tools-open").click();
  await page.locator('[data-tool-id="comparison"]').click();
  await page.getByTestId("initial-comparison").waitFor({ timeout: 60_000 });
  await page.locator("#rr-cmp-reference").selectOption(OSF_REFERENCE);
  await page.getByTestId("open-dual-comparison").click();
  await page.getByTestId("dual-comparison").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(4000);
  const cornerBefore = await page.locator(".rr-corner-bl").allInnerTexts();
  await page.getByTestId("dual-tab-assistant").click();
  await page.getByTestId("assistant-panel").waitFor({ timeout: 30_000 });
  const dualConnection = await connectionText();
  check("3. el dual ofrece el asistente y muestra el par A/B", /A = Referencia \(OSF-ID10-V1-T1\)/.test(await page.getByTestId("assistant-scope").innerText()), dualConnection);
  check("3. el dual NO promete comparación de hallazgos (el par no tiene P10.7)", await page.getByTestId("assistant-no-findings-note").count() > 0);
  const pairSuggestions = await page.getByTestId("assistant-suggestions").getByRole("button").allInnerTexts();
  check("3. preguntas sugeridas del par, sin hallazgos", pairSuggestions[0] === "¿Qué diferencias se registraron entre A y B?" && !pairSuggestions.some((q) => /clasificaci/i.test(q)), pairSuggestions.join(" | "));
  await page.screenshot({ path: `${OUT}/03-dual-panel.png` });

  const diffs = await ask("¿Qué diferencias se registraron entre A y B?", { suggested: true });
  record("3. diferencias A/B del par OSF (modelo real)", { ok: diffs.outcome === "answer", ms: diffs.ms, text: diffs.text, references: diffs.references });
  await page.screenshot({ path: `${OUT}/04-dual-diferencias.png` });
  const cornerAfter = await page.locator(".rr-corner-bl").allInnerTexts();
  check("3. el asistente no altera corte, zoom ni W/L de los visores", JSON.stringify(cornerBefore) === JSON.stringify(cornerAfter), JSON.stringify(cornerAfter));

  const findings = await ask("¿Cambió la clasificación de algún hallazgo entre A y B?");
  record("3. pregunta por hallazgos en un par sin P10.7 (modelo real)", { ok: findings.outcome === "answer", ms: findings.ms, text: findings.text });
  if (findings.outcome === "answer") {
    check("3. reconoce que no hay hallazgos P10.7 para comparar", /no (hay|existe|se dispone|se registr|tiene)|sin hallazgos|no (est[aá] )?disponible/i.test(findings.text), findings.text.slice(0, 240));
  }

  /* ------------------------------------------------------------------ 4. cambio de referencia y respuesta tardía */
  const options = await page.locator('[data-testid="dual-reference-select"] option').evaluateAll((nodes) => nodes.map((n) => n.value).filter(Boolean));
  const other = options.find((value) => value !== OSF_REFERENCE);
  if (other) {
    await page.getByLabel("Escribir una pregunta").fill("¿Qué diferencias se registraron entre A y B? Explicalo con detalle por nivel.");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await page.getByTestId("assistant-sending").waitFor({ timeout: 10_000 });
    await page.getByTestId("dual-reference-select").selectOption(other);
    await page.getByTestId("dual-tab-assistant").click();
    await page.getByTestId("assistant-panel").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    const scopeNow = await page.getByTestId("assistant-scope").innerText();
    check("4. al cambiar la referencia el panel pasa a la nueva referencia", scopeNow.includes(other), scopeNow.replace(/\s+/g, " "));
    check("4. la conversación nueva empieza vacía (no hereda mensajes de la referencia anterior)", await page.getByTestId("assistant-message-user").count() === 0 && await page.getByTestId("assistant-message-assistant").count() === 0);
    // Se espera a que el modelo termine la consulta que quedó en vuelo; su respuesta NO debe aparecer en el ámbito nuevo.
    await page.waitForTimeout(Number(process.env.LATE_WAIT_MS ?? 60_000));
    check("4. la respuesta tardía de la referencia anterior se ignora", await page.getByTestId("assistant-message-assistant").count() === 0 && await page.getByTestId("assistant-message-user").count() === 0);
    await page.screenshot({ path: `${OUT}/05-cambio-de-referencia.png` });
    await page.getByTestId("dual-reference-select").selectOption(OSF_REFERENCE);
    await page.getByTestId("dual-tab-assistant").click();
    await page.getByTestId("assistant-panel").waitFor({ timeout: 30_000 });
    await connectionText();
    const options2 = await page.getByLabel("Conversaciones").locator("option").allInnerTexts();
    check("4. al volver a la referencia anterior su conversación sigue en su ámbito", options2.length > 1, options2.join(" | "));
  } else {
    record("4. cambio de referencia", { ok: false, note: "no hay otra referencia disponible para el estudio" });
  }

  /* ------------------------------------------------------------------ 5. proveedor apagado */
  if (!process.env.SKIP_PROVIDER_OFF) {
    await exec("lms", ["unload", MODEL]).catch(() => {});
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Nueva conversación" }).click().catch(() => {});
    const off = await ask("¿Qué diferencias se registraron entre A y B?");
    record("5. proveedor apagado: error visible", { ok: off.outcome === "error", ms: off.ms, text: off.text });
    check("5. el error permite reintentar", await page.getByTestId("assistant-error").getByRole("button", { name: "Reintentar" }).count() > 0);
    check("5. el error no expone infraestructura", !/localhost|host\.docker|:1234|http:/i.test(off.text ?? ""));
    await page.screenshot({ path: `${OUT}/06-proveedor-apagado.png` });
    await exec("lms", ["load", MODEL, "--identifier", MODEL, "-c", "8192", "--gpu", "max", "--parallel", "1", "-y"], { timeout: 170_000 }).catch(() => {});
    await page.getByTestId("assistant-error").getByRole("button", { name: "Reintentar" }).click();
    await page.getByTestId("assistant-message-assistant").last().waitFor({ timeout: ANSWER_TIMEOUT });
    check("5. al volver el proveedor, Reintentar responde", await page.getByTestId("assistant-error").count() === 0);
    await page.screenshot({ path: `${OUT}/07-reintento.png` });
  }

  check("sin errores de página", failures.length === 0, failures.join(" | "));
} finally {
  writeFileSync(`${OUT}/assistant-e2e-log.json`, JSON.stringify(log, null, 1));
  await browser.close();
}
const failed = log.filter((entry) => entry.ok === false);
console.log(`\n${log.length - failed.length}/${log.length} comprobaciones correctas${failed.length ? `; ${failed.length} con falla: ${failed.map((f) => f.name).join(" | ")}` : ""}`);
process.exitCode = failed.length ? 1 : 0;

