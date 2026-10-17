import fs from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * Caso aislado con una corrección profesional, creado por los mecanismos soportados de la aplicación.
 *
 * Lo comparten los E2E de comparación de 8288/8280. Ningún E2E depende de un estudio que alguien haya dejado en la
 * base: cada ejecución crea el suyo (ZIP sintético por «Nuevo estudio», análisis inicial real, corrección escrita en
 * la tabla de mediciones y guardada con «Guardar borrador») y lo verifica en la base y tras recargar. No se modifica
 * ningún estudio existente.
 */

export const DEFAULT_ZIP = "C:/Users/franc/Desktop/tesis/caso-2001-estudio.zip";
export const DEFAULT_PATIENT_QUERY = "VIS-006857";
export const CORRECTED_MEASUREMENT_ID = "sagittal-disc-l4-l5-height";

export function sql(query) {
  return execFileSync("docker", ["exec", "lumbarai-clean-postgres", "psql", "-U", "pfi", "pfi_backend", "-tAc", query], { encoding: "utf8" }).trim();
}

/** Última corrección persistida de una medición de un estudio, o `null`. */
export function persistedCorrectionOf(caseId, measurementId = CORRECTED_MEASUREMENT_ID) {
  const text = sql(
    `select c.after_value::text from domain_review_corrections c join domain_study_runs r on r.id=c.study_run_id join domain_studies s on s.id=r.study_id ` +
    `where s.case_id='${caseId}' and c.measurement_id='${measurementId}' order by c.created_at desc limit 1`,
  );
  return text ? JSON.parse(text) : null;
}

export function correctionCountOf(caseId) {
  return Number(sql(
    `select count(*) from domain_review_corrections c join domain_study_runs r on r.id=c.study_run_id join domain_studies s on s.id=r.study_id where s.case_id='${caseId}'`,
  ));
}

/** Valor de la IA persistido en el snapshot de la corrida más reciente (nunca se pisa con la corrección). */
export function persistedAiValueOf(caseId, measurementId = CORRECTED_MEASUREMENT_ID) {
  const text = sql(
    `select e.value->>'value' from domain_study_runs r join domain_studies s on s.id=r.study_id, ` +
    `jsonb_array_elements(r.metrics_snapshot->'planes'->'sagittal'->'measurements') e ` +
    `where s.case_id='${caseId}' and e.value->>'id'='${measurementId}' order by r.created_at desc limit 1`,
  );
  return text === "" ? null : Number(text);
}

export function latestRunIdOf(caseId) {
  return sql(`select r.multiplanar_run_id from domain_study_runs r join domain_studies s on s.id=r.study_id where s.case_id='${caseId}' order by r.created_at desc, r.updated_at desc limit 1`);
}

/**
 * Crea el estudio por la pantalla «Nuevo estudio», lo analiza y guarda una corrección de la altura discal L4-L5.
 * Devuelve `{ caseId, original, corrected, runId }`. La página queda en el visor del estudio recién creado.
 */
export async function createIsolatedCorrectionCase(page, options = {}) {
  const {
    caseId,
    corrected = 7.3,
    studyZip = DEFAULT_ZIP,
    patientQuery = DEFAULT_PATIENT_QUERY,
    studyDate = "2026-10-14",
    mutations = [],
    log = () => undefined,
  } = options;
  if (!caseId) throw new Error("createIsolatedCorrectionCase: falta caseId");
  if (!fs.existsSync(studyZip)) throw new Error(`No existe el ZIP sintético ${studyZip}`);

  await page.getByRole("button", { name: "Nuevo estudio" }).click();
  await page.getByRole("heading", { name: "Nuevo estudio", level: 1 }).waitFor();
  await page.getByLabel("Buscar paciente por código o nombre").fill(patientQuery);
  await page.getByRole("list", { name: "Resultados de pacientes" }).getByRole("button").first().click();
  await page.locator('[aria-label="Paciente seleccionado"]').waitFor();
  await page.getByPlaceholder("CASE-XXXX").fill(caseId);
  await page.getByLabel(/Fecha del estudio/).fill(studyDate);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.locator('.ns-zip input[type="file"]').setInputFiles(studyZip);
  await page.getByText(/series detectadas/).waitFor({ timeout: 120000 });
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("heading", { name: "Contexto y revisión", level: 2 }).waitFor();
  await page.getByRole("button", { name: "Analizar estudio", exact: true }).click();
  await page.waitForURL(new RegExp(`/estudio/${caseId}`), { timeout: 900000 });
  await page.locator("aside.rr-panel").waitFor();
  await page.waitForTimeout(3000);
  log(`caso ${caseId} creado y analizado`);

  await page.locator(".rr-level", { hasText: "L4-L5" }).first().click();
  const heightRow = page.locator(".rr-measure", { hasText: "Altura discal" }).first();
  await heightRow.waitFor();
  const originalText = (await heightRow.locator(".rr-measure-ai").innerText()).trim();
  const original = Number(originalText.replace(/[^\d.,]/g, "").replace(",", "."));
  await heightRow.locator(".rr-measure-input").fill(String(corrected));
  await page.getByRole("tab", { name: "Revisión" }).click();
  const before = mutations.length;
  await page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
  await page.getByText(/Borrador guardado correctamente/).first().waitFor({ timeout: 20000 });
  if (mutations.slice(before).some((item) => /product-analysis|multiplanar\/run/.test(item))) {
    throw new Error("guardar la corrección disparó un análisis");
  }
  log(`corrección ${corrected} guardada (IA ${original})`);
  return { caseId, original, corrected, runId: latestRunIdOf(caseId) };
}
