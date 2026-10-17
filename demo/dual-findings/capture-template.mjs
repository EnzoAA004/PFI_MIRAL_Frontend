import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Regenera `template.json` desde el stack local (solo lectura): la ESTRUCTURA de un estudio real que usan los
 * fixtures. Los identificadores se reemplazan al armar cada estudio simulado; de la plantilla no sale ningún dato
 * de paciente. Solo hace falta si cambia el contrato de la API: la demostración corre con el archivo ya guardado.
 *
 *   node demo/dual-findings/capture-template.mjs   (API_URL=http://localhost:8280, TEMPLATE_CASE=…)
 */
const api = process.env.API_URL ?? "http://localhost:8280";
const templateCase = process.env.TEMPLATE_CASE ?? "MENDELEY-0015-MVBLQ5XS";

async function request(path, token, init = {}) {
  const response = await fetch(api + path, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
}

const login = await request("/api/auth/demo-doctor", null, { method: "POST", body: "{}" });
const token = login.accessToken ?? login.token;
const detail = await request(`/api/studies/${templateCase}`, token);
const runs = await request(`/api/studies/${templateCase}/runs`, token);
const candidates = await request("/api/studies/OSF-ID10-V2-T1/initial-analysis-comparison/candidates", token);
const comparison = await request("/api/studies/OSF-ID10-V2-T1/initial-analysis-comparison?referenceCaseId=OSF-ID10-V1-T1", token);

// Lo que la demostración reemplaza o no usa se descarta: las mediciones numéricas, la auditoría y la copia de las corridas.
if (JSON.stringify(detail.runs) !== JSON.stringify(runs.runs)) throw new Error("detail.runs y runs.runs difieren: la plantilla los comparte");
delete detail.runs;
detail.auditTrail = [];
comparison.comparisons = [];
comparison.excluded = [];

const target = fileURLToPath(new URL("./template.json", import.meta.url));
fs.writeFileSync(target, JSON.stringify({ templateCase, detail, runs, candidates, comparison }));
console.log(`${target}: ${fs.statSync(target).size} bytes`);
