import { chromium } from "playwright";

/**
 * Protección de ediciones sin guardar, probada en 8288 con un CASO PROPIO (REVFIN-*): nunca MENDELEY ni OSF.
 *
 * Usa solo guardados normales de la propia interfaz sobre ese caso (notas de la revisión y borrador del preinforme).
 * No finaliza ni aprueba nada. El guardado fallido se simula en el navegador (respuesta 500 controlada).
 *
 * Uso: CASE=REVFIN-2110 node scripts/playwright-unsaved-changes-e2e.mjs
 */
const WEB = process.env.PFI_WEB ?? "http://localhost:8288";
const CASE = process.env.CASE;
if (!/^REVFIN-/.test(CASE ?? "")) throw new Error("Definí CASE con un caso propio REVFIN-*");

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
const writes = [];
const nativeDialogs = [];
page.on("request", (r) => { if (r.method() !== "GET" && /8280/.test(r.url())) writes.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });
let acceptLeave = false;
page.on("dialog", async (d) => { nativeDialogs.push(`${d.type()}`); await (acceptLeave ? d.accept() : d.dismiss()).catch(() => undefined); });

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, extra = "") {
  if (ok) passed += 1;
  else { failed += 1; failures.push(name); }
  console.log(`${ok ? "ok" : "FALLA"} - ${name}${extra ? ` · ${extra}` : ""}`);
}

const notesBox = () => page.getByPlaceholder(/Observaciones generales/);
const dialog = () => page.getByTestId("unsaved-dialog");
async function openStudy() {
  await page.waitForTimeout(500); // deja que la vista anterior termine de desmontarse (y quite su protección)
  await page.goto(`${WEB}/estudio/${CASE}`, { waitUntil: "networkidle" });
  await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2000);
  await page.getByRole("tab", { name: "Revisión" }).click();
}

/** Abre el estudio desde la lista, con navegación interna (así «atrás» vuelve a la lista dentro de la misma app). */
async function openFromList() {
  await page.waitForTimeout(500);
  await page.goto(`${WEB}/worklist`, { waitUntil: "networkidle" });
  await page.getByPlaceholder(/Buscar por paciente/).fill(CASE);
  await page.locator("tbody tr").first().click();
  await page.getByRole("button", { name: "Abrir estudio" }).click();
  await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2000);
  await page.getByRole("tab", { name: "Revisión" }).click();
}

await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Entrar con doctor demo/ }).click();
await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();

await openStudy();
const original = await notesBox().inputValue();
const statusBefore = await page.locator("aside.rr-panel select").last().inputValue();
const writesStart = writes.length;

/* ---- 1. sin cambios no se pregunta */
await page.getByRole("button", { name: /Estudios/ }).first().click();
await page.waitForURL(/\/worklist/);
check("sin cambios, volver a la lista no pregunta", (await dialog().count()) === 0);

/* ---- 2. con cambios: botón propio */
await openStudy();
await notesBox().fill(`${original} · cambio de prueba sin guardar`);
const back = page.getByRole("button", { name: /Estudios/ }).first();
await back.click();
await dialog().waitFor({ timeout: 5000 });
check("con notas editadas aparece «Seguir editando / Salir sin guardar»", (await page.getByTestId("unsaved-stay").count()) === 1 && (await page.getByTestId("unsaved-leave").count()) === 1);
check("el diálogo dice qué se perdería", /Notas de la revisión/.test(await dialog().innerText()));
check("el foco entra en «Seguir editando»", await page.getByTestId("unsaved-stay").evaluate((el) => el === document.activeElement));
await page.keyboard.press("Tab");
check("Tab circula dentro del diálogo (no sale a la página)", await dialog().evaluate((el) => el.contains(document.activeElement)));
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("Esc equivale a «Seguir editando»: sigue en el estudio con lo escrito", (await dialog().count()) === 0 && /\/estudio\//.test(page.url()) && (await notesBox().inputValue()).includes("cambio de prueba"));
check("al cerrar el diálogo el foco vuelve al botón que lo abrió", await back.evaluate((el) => el === document.activeElement));
await back.click();
await dialog().waitFor();
await page.getByTestId("unsaved-stay").click();
check("«Seguir editando» conserva el texto", (await notesBox().inputValue()).includes("cambio de prueba"));

/* ---- 3. «Salir sin guardar» descarta y sale, sin escribir nada */
await back.click();
await dialog().waitFor();
await page.getByTestId("unsaved-leave").click();
await page.waitForURL(/\/worklist/);
await openStudy();
check("«Salir sin guardar» sale y el texto descartado no quedó guardado", (await notesBox().inputValue()) === original);

/* ---- 4. «atrás» del navegador */
await openFromList();
await notesBox().fill(`${original} · segundo cambio`);
await page.evaluate(() => window.history.back());
await dialog().waitFor({ timeout: 5000 });
check("el «atrás» del navegador también pregunta", /\/estudio\//.test(page.url()));
await page.getByTestId("unsaved-stay").click();
check("«Seguir editando» frente al «atrás» conserva la URL y el texto", /\/estudio\//.test(page.url()) && (await notesBox().inputValue()).includes("segundo cambio"));
await page.evaluate(() => window.history.back());
await dialog().waitFor();
await page.getByTestId("unsaved-leave").click();
await page.waitForTimeout(1500);
check("«Salir sin guardar» frente al «atrás» deja ir a la pantalla anterior", !/\/estudio\/REVFIN/.test(page.url()) || /\/worklist|\/$/.test(page.url()));

/* ---- 5. navegación interna (herramientas del estudio → historial del paciente) */
await openFromList();
await notesBox().fill(`${original} · tercero`);
await page.getByTestId("tools-open").click();
await page.locator('[data-tool-id="history"]').click();
await page.getByRole("button", { name: "Ver historial del paciente" }).click();
await dialog().waitFor({ timeout: 5000 });
check("la navegación interna desde las herramientas (historial del paciente) también pregunta", /\/estudio\//.test(page.url()));
await page.getByTestId("unsaved-stay").click();
check("tras «Seguir editando» sigue en el estudio", /\/estudio\//.test(page.url()));

/* ---- 6. cierre/recarga de la pestaña: protección nativa */
nativeDialogs.length = 0;
await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
await page.waitForTimeout(800);
check("recargar con cambios dispara la protección nativa del navegador (beforeunload)", nativeDialogs.includes("beforeunload"), nativeDialogs.join(","));
acceptLeave = true; // la persona decide salir de la página con cambios sin guardar
await openStudy();
acceptLeave = false;

/* ---- 7. guardado fallido conserva; guardado exitoso limpia */
await notesBox().fill(`${original} · cambio con guardado fallido`);
await page.route(/localhost:8280\/api\/ai\/runs\/[^/]+\/review$/, (route) => route.request().method() === "PUT" ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : route.continue());
await page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
await page.waitForTimeout(1500);
await page.getByRole("button", { name: /Estudios/ }).first().click();
await dialog().waitFor({ timeout: 5000 }).catch(() => undefined);
check("un guardado FALLIDO (500 simulado) conserva los cambios pendientes: sigue preguntando", await dialog().count() === 1);
await page.getByTestId("unsaved-stay").click();
await page.unroute(/localhost:8280\/api\/ai\/runs\/[^/]+\/review$/);
const savedNote = `${original} · nota REVFIN guardada`;
await notesBox().fill(savedNote);
await page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
await page.getByText(/Borrador guardado correctamente/).first().waitFor({ timeout: 20000 });
await page.getByRole("button", { name: /Estudios/ }).first().click();
await page.waitForURL(/\/worklist/);
check("un guardado EXITOSO limpia lo pendiente: se sale sin preguntar", (await dialog().count()) === 0);
await openStudy();
check("la nota guardada persiste al recargar y el estado no cambió", (await notesBox().inputValue()) === savedNote && (await page.locator("aside.rr-panel select").last().inputValue()) === statusBefore, statusBefore);

/* ---- 8. estado elegido sin confirmar */
await page.locator("aside.rr-panel select").last().selectOption({ label: "Observado" });
await page.getByRole("button", { name: /Estudios/ }).first().click();
await dialog().waitFor({ timeout: 5000 });
check("elegir otro estado sin confirmar también cuenta como cambio pendiente", /Estado de revisión elegido/.test(await dialog().innerText()));
await page.getByTestId("unsaved-leave").click();
await page.waitForURL(/\/worklist/);

/* ---- 9. cerrar sesión con cambios */
await openStudy();
await notesBox().fill(`${savedNote} · para cerrar sesión`);
await page.getByRole("button", { name: /Estudios/ }).first().click().catch(() => undefined);
await dialog().waitFor();
await page.getByTestId("unsaved-leave").click();
await page.waitForURL(/\/worklist/);

/* ---- 10. preinforme */
await openStudy();
await page.getByTestId("prepare-prereport").click();
await page.getByTestId("prereport-summary").waitFor({ timeout: 30_000 });
await page.waitForTimeout(1200);
await page.getByTestId("prereport-close").click();
await page.waitForTimeout(400);
check("preinforme sin ediciones: «Volver al visor» no pregunta", (await dialog().count()) === 0 && (await page.getByTestId("prereport-editor").count()) === 0);
await page.getByTestId("prepare-prereport").click();
await page.getByTestId("prereport-summary").waitFor({ timeout: 30_000 });
await page.waitForTimeout(1200);
await notesBox().waitFor({ state: "detached" }).catch(() => undefined);
const obsBase = await page.getByTestId("prereport-observations").inputValue();
await page.getByTestId("prereport-observations").fill("Observación de prueba sin guardar");
await page.getByTestId("prereport-close").click();
await dialog().waitFor({ timeout: 5000 });
check("preinforme con ediciones: «Volver al visor» pregunta y nombra el preinforme", /preinforme/i.test(await dialog().innerText()) && !/Notas de la revisión/.test(await dialog().innerText()));
await page.getByTestId("unsaved-stay").click();
check("«Seguir editando» deja el editor abierto con lo escrito", (await page.getByTestId("prereport-editor").count()) === 1 && (await page.getByTestId("prereport-observations").inputValue()) === "Observación de prueba sin guardar");
await page.getByTestId("prereport-close").click();
await dialog().waitFor();
await page.getByTestId("unsaved-leave").click();
await page.waitForTimeout(500);
check("«Salir sin guardar» cierra el editor", (await page.getByTestId("prereport-editor").count()) === 0);
await page.getByTestId("prepare-prereport").click();
await page.getByTestId("prereport-summary").waitFor({ timeout: 30_000 });
await page.waitForTimeout(1200);
check("lo descartado no quedó guardado en el preinforme", (await page.getByTestId("prereport-observations").inputValue()) === obsBase);
await page.getByTestId("prereport-observations").fill(`Observación REVFIN guardada ${Date.now() % 100000}`);
await page.getByTestId("prereport-save").click();
await page.getByText(/Borrador guardado/).first().waitFor({ timeout: 30_000 });
await page.getByTestId("prereport-close").click();
await page.waitForTimeout(400);
check("tras guardar el preinforme se cierra sin preguntar", (await dialog().count()) === 0 && (await page.getByTestId("prereport-editor").count()) === 0);

/* ---- 11. nada de esto aprobó ni cambió estados */
const statusAfter = await page.locator("aside.rr-panel select").last().inputValue();
const unexpected = writes.slice(writesStart).filter((w) => !/\/ai\/runs\/[^/]+\/(review|annotations)$|\/api\/ai\/audit$|\/prereport/.test(w));
check("ninguna escritura fue más allá de guardar notas y el borrador del preinforme del caso propio", unexpected.length === 0, unexpected.join(" ; ").slice(0, 300));
check("el estado de la revisión del caso propio sigue igual", statusAfter === statusBefore, `${statusBefore} → ${statusAfter}`);

await browser.close();
console.log(`${passed}/${passed + failed} comprobaciones correctas${failed ? `; con falla: ${failures.join(" | ")}` : ""}`);
process.exit(failed ? 1 : 0);
