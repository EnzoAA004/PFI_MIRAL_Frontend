import { chromium } from "playwright";
const WEB = "http://localhost:8288", OUT = process.env.OUT_DIR;
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Entrar con doctor demo/ }).click();
await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
// vence la sesión: todo /api (salvo auth) devuelve 401
await page.route(/localhost:8280\/api\/(?!auth\/demo)/, (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ status: 401, error: "Unauthorized", message: "Token expirado" }) }));
await page.goto(`${WEB}/pacientes`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
console.log("401 en pacientes →", (await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 400), "| url", page.url());
await page.screenshot({ path: `${OUT}/s401-pacientes.png` });
await page.goto(`${WEB}/estudio/MENDELEY-0015-MVBLQ5XS`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
console.log("401 en estudio →", (await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 400), "| url", page.url());
await page.screenshot({ path: `${OUT}/s401-estudio.png` });
// 500 en la lista
await page.unroute(/localhost:8280\/api\/(?!auth\/demo)/);
await page.route(/localhost:8280\/api\/studies$|localhost:8280\/api\/studies\?/, (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
await page.goto(`${WEB}/worklist`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
console.log("500 en lista →", (await page.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 400));
await page.screenshot({ path: `${OUT}/s500-lista.png` });
await browser.close();
