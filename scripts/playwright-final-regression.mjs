import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

/**
 * Recorrido de regresión final en 8288, SOLO LECTURA: toda escritura del navegador (salvo la autenticación) se bloquea y se
 * registra. Usa el caso propio REVFIN-* y, de solo lectura, MENDELEY/OSF. Los errores de red y la sesión vencida se simulan en
 * el navegador (respuestas controladas), y el único dato creado es un paciente de prueba sin estudios, por la API.
 *
 * Uso: CASE=REVFIN-2110 OUT_DIR=... node scripts/playwright-final-regression.mjs
 */
const WEB = process.env.PFI_WEB ?? "http://localhost:8288";
const API = process.env.PFI_API ?? "http://localhost:8280";
const CASE = process.env.CASE;
const OUT = process.env.OUT_DIR ?? "final-regression-out";
if (!/^REVFIN-/.test(CASE ?? "")) throw new Error("Definí CASE con un caso propio REVFIN-*");
mkdirSync(OUT, { recursive: true });

const login = await (await fetch(`${API}/api/auth/demo-doctor`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
const token = login.accessToken ?? login.token;
const call = async (path, init = {}) => fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });

const results = [];
const check = (name, ok, note = "") => { results.push({ name, ok: Boolean(ok), note }); console.log(`${ok ? "ok" : "FALLA"} - ${name}${note ? ` · ${note}` : ""}`); };

// Paciente de prueba sin estudios (único dato nuevo de este recorrido).
const patientRef = `REVFIN-PAC-${Date.now() % 100000}`;
const created = await call("/api/patients", { method: "POST", body: JSON.stringify({ patientReference: patientRef, firstName: "Paciente", lastName: "De prueba", dateOfBirth: "1990-01-01" }) });
check("dato de prueba: paciente sin estudios creado por la API", created.ok, `${patientRef} · HTTP ${created.status}`);

const browser = await chromium.launch({ headless: true });
const blocked = [];
function newPage(ctx) {
  return ctx.newPage().then(async (page) => {
    page.on("pageerror", (e) => blocked.push(`pageerror ${String(e).slice(0, 120)}`));
    await page.route(/localhost:8280\/api\/(?!auth\/)/, (route) => {
      const r = route.request();
      if (r.method() === "GET") return route.continue();
      blocked.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`);
      return route.abort();
    });
    return page;
  });
}
async function enter(page) {
  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  const demo = page.getByRole("button", { name: /Entrar con doctor demo/ });
  if (await demo.count()) await demo.click();
  await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
}
const bodyText = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

for (const [w, h] of [[1366, 768], [1920, 1080]]) {
  for (const scheme of ["light", "dark"]) {
    const tag = `${w}-${scheme}`;
    console.log(`\n=== ${tag}`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
    await ctx.addInitScript((t) => { try { if (!window.localStorage.getItem("pfi.theme")) window.localStorage.setItem("pfi.theme", t); } catch { /* sin almacenamiento */ } }, scheme);
    const page = await newPage(ctx);

    /* ---------- acceso, lista y sidebar */
    await enter(page);
    await page.waitForTimeout(1500);
    const listText = await bodyText(page);
    check(`[${tag}] la lista no muestra «Modo degradado» ni un falso «Sincronizado»`, !/Modo degradado|Sincronizado/.test(listText));
    await page.screenshot({ path: `${OUT}/lista-${tag}.png` });

    /* ---------- la lista recuerda lo que se dejó al volver del visor */
    const estado = page.locator("select").filter({ has: page.locator("option", { hasText: "Pendiente" }) }).first();
    await estado.selectOption({ label: "Finalizado (1)" });
    await page.getByPlaceholder(/Buscar por paciente/).fill("OSF");
    await page.locator("tbody tr").first().click();
    await page.getByRole("button", { name: "Abrir estudio" }).click();
    await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: /Estudios/ }).first().click();
    await page.waitForURL(/\/worklist/);
    await page.waitForTimeout(800);
    check(`[${tag}] al volver del visor la lista conserva el filtro de estado y la búsqueda`,
      (await estado.inputValue()) !== "todos" && (await page.getByPlaceholder(/Buscar por paciente/).inputValue()) === "OSF" && (await page.locator("tbody tr").count()) === 1, `filas ${await page.locator("tbody tr").count()}`);
    check(`[${tag}] el estudio elegido sigue seleccionado`, (await page.locator(".wl-panel").count()) === 1);
    await page.getByRole("button", { name: /Limpiar filtros/ }).click();
    await page.getByPlaceholder(/Buscar por paciente/).fill("");

    /* ---------- pacientes → historial real → estudio → comparación → regreso */
    await page.getByRole("button", { name: /Pacientes/ }).first().click();
    await page.waitForURL(/\/pacientes/);
    const listPac = await bodyText(page);
    check(`[${tag}] pacientes: sin «Modo degradado» y sin etiquetas técnicas`, !/Modo degradado|postgres-domain|measurementsByPlane/.test(listPac));
    await page.goto(`${WEB}/pacientes/OSF-ID10`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const hist = await bodyText(page);
    check(`[${tag}] historial: estudios con resultados reales (no «sin análisis» ni 0 mediciones)`, /Con resultados\s*4 de 4/i.test(hist) && /Resultados disponibles/.test(hist) && !/todavía no tiene un análisis|Mediciones reales/.test(hist));
    check(`[${tag}] historial: cada tarjeta cuenta las mediciones de su corrida (no una suma)`, /51 mediciones/.test(hist) || /50 mediciones/.test(hist) || /49 mediciones/.test(hist));
    check(`[${tag}] historial: sin jerga ni exportación JSON ni controles sin función`, !/postgres-domain|measurementsByPlane|Exportar resumen|Agregar estudio/.test(hist));
    check(`[${tag}] historial: estados completos y fechas con el formato de la interfaz`, !/T\d\d:\d\d:\d\d(\.\d+)?Z/.test(hist) && /Finalizado/.test(hist) && /Pendiente/.test(hist));
    await page.screenshot({ path: `${OUT}/historial-${tag}.png`, fullPage: true });
    await page.getByRole("button", { name: "Abrir estudio" }).first().click();
    await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
    await page.waitForTimeout(2500);
    await page.getByTestId("tools-open").click();
    await page.locator('[data-tool-id="comparison"]').click();
    await page.getByTestId("initial-comparison").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    check(`[${tag}] historial → estudio → comparación real disponible`, (await page.locator("#rr-cmp-reference option").count()) > 1);

    /* ---------- el visor conserva corte, zoom y W/L al cambiar de pestaña, abrir herramientas y cambiar de tema */
    await page.goto(`${WEB}/estudio/MENDELEY-0015-MVBLQ5XS`, { waitUntil: "networkidle" });
    await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
    await page.waitForTimeout(2500);
    await page.locator(".rr-slice-range").first().focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: "Acercar" }).first().click();
    await page.getByRole("combobox", { name: /Preset de ventana y nivel/ }).first().selectOption({ label: "Alto contraste" });
    await page.waitForTimeout(800);
    const viewerState = async () => ({
      corners: (await page.locator(".rr-corner").allInnerTexts()).map((t) => t.replace(/\s+/g, " ")).filter((t) => /corte|W /.test(t)).join(" | "),
      zoom: (await page.locator(".rr-viewport").first().innerText()).match(/\d+%/)?.[0] ?? "",
    });
    const before = await viewerState();
    await page.getByRole("tab", { name: "Revisión" }).click();
    await page.getByRole("tab", { name: "Contexto" }).click();
    await page.getByTestId("tools-open").click();
    await page.getByTestId("tools-open").click();
    await page.getByRole("tab", { name: "Resultados" }).click();
    const toggle = page.locator("button[aria-label*='tema' i], button[title*='tema' i]").first();
    if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(500); }
    const after = await viewerState();
    check(`[${tag}] cambiar de pestaña, abrir herramientas y cambiar de tema no reinicia corte, zoom ni W/L`, before.corners === after.corners && before.zoom === after.zoom && before.corners.length > 0, `${before.corners} / ${before.zoom}`);

    /* ---------- diálogos: Esc cierra y el foco vuelve al control que los abrió */
    const editBtn = page.getByRole("button", { name: "Editar datos" });
    await editBtn.click();
    await page.getByRole("dialog", { name: /Editar datos del estudio/ }).waitFor();
    const firstFocus = await page.evaluate(() => document.activeElement?.closest("[role=dialog]") !== null);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check(`[${tag}] «Editar datos»: el foco entra al diálogo, Esc lo cierra y el foco vuelve al botón`, firstFocus && (await page.getByRole("dialog", { name: /Editar datos del estudio/ }).count()) === 0 && (await editBtn.evaluate((el) => el === document.activeElement)));
    await page.getByRole("tab", { name: "Revisión" }).click();
    const prepare = page.getByTestId("prepare-prereport");
    await prepare.click();
    await page.getByTestId("prereport-summary").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/preinforme-${tag}.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    check(`[${tag}] preinforme: Esc vuelve al visor (sin cambios no pregunta) y el foco vuelve a «Preparar preinforme»`, (await page.getByTestId("prereport-editor").count()) === 0 && (await prepare.evaluate((el) => el === document.activeElement)));
    await page.screenshot({ path: `${OUT}/visor-${tag}.png` });

    /* ---------- ajustes, ayuda y menú de usuario */
    await page.getByRole("button", { name: /Estudios/ }).first().click();
    await page.waitForURL(/\/worklist/);
    await page.getByRole("button", { name: /Dra\. Demo Reviewer/ }).click();
    const menu = (await page.getByRole("menu").innerText()).replace(/\s+/g, " ");
    check(`[${tag}] menú de usuario: sin Review Analytics y sin prometer edición de perfil`, !/Review Analytics|editar perfil/i.test(menu) && /Mi perfil/.test(menu) && /Cerrar sesión/.test(menu), menu);
    await page.getByRole("menuitem", { name: /Mi perfil/ }).click();
    await page.waitForTimeout(800);
    const settings = await bodyText(page);
    check(`[${tag}] ajustes: solo lo que funciona (sin contraseña, notificaciones, idioma ni densidad)`, !/Cambiar contraseña|Notificaciones|Idioma|Densidad|Edición de perfil pendiente/.test(settings) && /Doble verificación/.test(settings) && /Cerrar sesión/.test(settings));
    await page.screenshot({ path: `${OUT}/ajustes-${tag}.png` });
    await page.getByRole("tab", { name: /Ayuda y alcance/ }).click();
    const help = await bodyText(page);
    check(`[${tag}] ayuda: nombres actuales, tres pasos, preinforme como borrador y sin afirmar que todo es de-identificado`, /Nuevo estudio/.test(help) && /Paciente y estudio/.test(help) && /Preparar preinforme/.test(help) && /borrador pendiente de revisión profesional/.test(help) && !/datos de-identificados|PAT-xxxx|Nuevo análisis/.test(help));
    await page.screenshot({ path: `${OUT}/ayuda-${tag}.png` });
    const stored = await page.evaluate(() => window.localStorage.getItem("pfi.theme"));
    await page.reload({ waitUntil: "networkidle" });
    check(`[${tag}] el tema elegido se conserva al recargar`, (await page.evaluate(() => window.localStorage.getItem("pfi.theme"))) === stored && stored !== null, stored ?? "");

    /* ---------- no encontrado, paciente sin estudios, error de servicio y sesión vencida (simulados) */
    await page.goto(`${WEB}/estudio/NO-EXISTE-999`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const nf = await bodyText(page);
    check(`[${tag}] estudio inexistente: «Estudio no encontrado», con volver y sin «contrato»`, /Estudio no encontrado/.test(nf) && !/contrato|incompatible/i.test(nf) && (await page.getByRole("button", { name: "Volver a estudios" }).count()) === 1 && (await page.getByRole("button", { name: "Reintentar" }).count()) === 0);
    await page.screenshot({ path: `${OUT}/estudio-no-encontrado-${tag}.png` });
    await page.goto(`${WEB}/pacientes/NO-EXISTE`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    check(`[${tag}] paciente inexistente: «Paciente no encontrado»`, /Paciente no encontrado/.test(await bodyText(page)));
    await page.goto(`${WEB}/pacientes/${patientRef}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const noStudies = await bodyText(page);
    check(`[${tag}] paciente existente sin estudios: se distingue del inexistente`, /todavía no tiene estudios/.test(noStudies) && !/Paciente no encontrado/.test(noStudies));
    await page.screenshot({ path: `${OUT}/paciente-sin-estudios-${tag}.png` });

    await page.route(/localhost:8280\/api\/studies\/MENDELEY-0015-MVBLQ5XS$/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    await page.goto(`${WEB}/estudio/MENDELEY-0015-MVBLQ5XS`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const svc = await bodyText(page);
    check(`[${tag}] [simulado] servicio caído: título propio, reintentar y detalle técnico plegado`, /No se pudo cargar el estudio/.test(svc) && (await page.getByRole("button", { name: "Reintentar" }).count()) === 1 && (await page.getByText("Detalle técnico").count()) === 1 && !/Detalle: Error|Backend respondio/.test(svc));
    await page.screenshot({ path: `${OUT}/error-servicio-${tag}.png` });
    await page.unroute(/localhost:8280\/api\/studies\/MENDELEY-0015-MVBLQ5XS$/);
    await page.getByRole("button", { name: "Reintentar" }).click();
    await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
    check(`[${tag}] el reintento carga el estudio cuando el servicio vuelve`, (await page.locator("aside.rr-panel").count()) === 1);

    /* ---------- cierre de sesión y reingreso */
    await page.getByRole("button", { name: /Estudios/ }).first().click();
    await page.waitForURL(/\/worklist/);
    await page.getByRole("button", { name: /Dra\. Demo Reviewer/ }).click();
    await page.getByRole("menuitem", { name: /Cerrar sesión/ }).click();
    await page.getByRole("button", { name: /Entrar con doctor demo/ }).waitFor({ timeout: 15_000 });
    check(`[${tag}] cerrar sesión vuelve al acceso sin avisos de error`, !/venció|incorrectos/.test(await bodyText(page)));
    await page.getByRole("button", { name: /Entrar con doctor demo/ }).click();
    await page.getByRole("button", { name: "Nuevo estudio" }).waitFor({ timeout: 30_000 });
    await page.locator("tbody tr").first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    check(`[${tag}] reingreso: vuelve la lista de trabajo con sus estudios`, (await page.locator("tbody tr").count()) > 0, `filas ${await page.locator("tbody tr").count()} · ${page.url()}`);
    await page.getByRole("button", { name: /Estudios|Lista de trabajo/ }).first().click().catch(() => undefined);

    /* ---------- sesión vencida simulada: se vuelve al acceso con un aviso comprensible */
    await page.route(/localhost:8280\/api\/(?!auth\/demo)/, (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ status: 401, error: "Unauthorized" }) }));
    await page.goto(`${WEB}/pacientes`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const expired = await bodyText(page);
    check(`[${tag}] [simulado] sesión vencida: vuelve al acceso con el aviso «Tu sesión venció»`, /Tu sesión venció/.test(expired) && !/Backend respondio/.test(expired), (await page.getByTestId("auth-notice").count()) ? "con aviso" : "sin aviso");
    await page.screenshot({ path: `${OUT}/sesion-vencida-${tag}.png` });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await ctx.close();
  }
}

/* ---------- credenciales inválidas (una sola vez) */
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.getByLabel(/Contraseña/).fill("incorrecta-xyz");
  await page.locator("button.primary-button").click();
  await page.waitForTimeout(1500);
  const invalid = await bodyText(page);
  check("credenciales inválidas: «Correo o contraseña incorrectos», sin «Backend respondio 401»", /Correo o contraseña incorrectos/.test(invalid) && !/Backend respondio/.test(invalid));
  await ctx.close();
}

const allowed = (entry) => /^pageerror/.test(entry) === false;
const writes = blocked.filter(allowed);
check("ninguna escritura salió del navegador durante el recorrido", writes.length === 0, writes.slice(0, 3).join(" ; "));
const pageErrors = blocked.filter((entry) => /^pageerror/.test(entry));
check("sin errores de página", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
writeFileSync(`${OUT}/final-regression-log.json`, JSON.stringify(results, null, 1));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas${failed.length ? `; con falla: ${[...new Set(failed.map((f) => f.name.replace(/^\[[^\]]+\] /, "")))].join(" | ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
