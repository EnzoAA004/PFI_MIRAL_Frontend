import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { route } from "./scenario.mjs";

/**
 * Demostración interactiva de la comparación de hallazgos A/B del visor dual.
 *
 *   npm run demo:dual-findings          (construye si hace falta y sirve en http://localhost:8290/)
 *   npm run demo:dual-findings -- --rebuild
 *
 * Es un entorno APARTE del stack real (8288/8280/8200):
 * - Sirve su propio build (`dist-demo/`), con los componentes reales del visor dual.
 * - La API es simulada aquí mismo (`scenario.mjs`), con datos e imágenes sintéticos y reproducibles. No lee ni escribe
 *   la base de 8288, no llama al Backend ni a la IA, no ejecuta ningún análisis.
 * - No hay sesión ni bypass de autenticación: la página no pasa por la aplicación ni por su login.
 * - Solo se compila con el modo `demo-dual-findings`; el build normal (`npm run build`) no la incluye.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const distDir = path.join(projectRoot, "dist-demo");
const port = Number(process.env.DEMO_PORT ?? 8290);
const origin = `http://localhost:${port}`;

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2", ".map": "application/json",
};

if (process.argv.includes("--rebuild") || !fs.existsSync(path.join(distDir, "index.html"))) {
  console.log("Construyendo la demostración (modo demo-dual-findings)…");
  await build({
    configFile: false,
    root: here,
    mode: "demo-dual-findings",
    plugins: [react()],
    // La API de la página es este mismo servidor: el cliente real de la aplicación no sabe que es simulada.
    define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify(origin) },
    build: { outDir: distDir, emptyOutDir: true, chunkSizeWarningLimit: 1500, sourcemap: false },
    logLevel: "warn",
  });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", origin);
  response.setHeader("Cache-Control", "no-store");

  if (url.pathname.startsWith("/api/")) {
    if (request.method !== "GET") {
      // La demostración es de solo lectura: ninguna escritura llega a ninguna parte.
      response.writeHead(405, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "La demostración es de solo lectura." }));
      return;
    }
    const answer = route(url.pathname, url.searchParams);
    if (!answer) {
      response.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "No existe en la demostración." }));
      return;
    }
    response.writeHead(answer.status, { "Content-Type": answer.type }).end(answer.body);
    return;
  }

  const requested = path.normalize(path.join(distDir, url.pathname === "/" ? "index.html" : url.pathname));
  if (!requested.startsWith(distDir) || !fs.existsSync(requested) || fs.statSync(requested).isDirectory()) {
    // Cualquier otra ruta devuelve la página de la demostración (recargar en cualquier URL sigue funcionando).
    const index = path.join(distDir, "index.html");
    response.writeHead(200, { "Content-Type": MIME[".html"] }).end(fs.readFileSync(index));
    return;
  }
  response.writeHead(200, { "Content-Type": MIME[path.extname(requested)] ?? "application/octet-stream" }).end(fs.readFileSync(requested));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`DEMOSTRACIÓN · DATOS SIMULADOS · NO REPRESENTA EVOLUCIÓN DE UN PACIENTE`);
  console.log(`Abrí ${origin}/  (Ctrl+C para detener)`);
});
