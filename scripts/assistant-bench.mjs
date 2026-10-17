import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";

/**
 * Medición del asistente con el modelo REAL y la aplicación en funcionamiento (no es una prueba automática: depende de que el
 * stack y el modelo local estén encendidos). Llama a la API del Backend con la sesión de doctor demo, mide el tiempo de cada
 * consulta y toma muestras de VRAM (nvidia-smi), RAM del runtime del modelo y memoria del contenedor del Backend mientras
 * el modelo trabaja. No analiza imágenes ni modifica resultados, revisiones ni datos clínicos: solo escribe las
 * conversaciones del asistente, que quedan identificadas por su ámbito.
 *
 * Uso: node scripts/assistant-bench.mjs [salida.json]
 */
const run = promisify(execFile);
const API = process.env.PFI_API ?? "http://localhost:8280";
const MENDELEY = "MENDELEY-0015-MVBLQ5XS";
const OSF_CURRENT = "OSF-ID10-V2-T1";
const OSF_REFERENCE = "OSF-ID10-V1-T1";

async function login() {
  const res = await fetch(`${API}/api/auth/demo-doctor`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const body = await res.json();
  return body.accessToken ?? body.token;
}

async function sample() {
  const out = { t: Date.now() };
  try {
    const gpu = await run("nvidia-smi", ["--query-gpu=memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits"]);
    const [used, total, util] = gpu.stdout.trim().split(",").map((v) => Number(v));
    Object.assign(out, { vramUsedMiB: used, vramTotalMiB: total, gpuUtilPct: util });
  } catch { /* sin GPU NVIDIA */ }
  try {
    const ps = await run("powershell", ["-NoProfile", "-Command", "[math]::Round((Get-Process -Name 'LM Studio' -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum / 1MB)"]);
    out.runtimeRamMiB = Math.round(Number(ps.stdout.trim()));
  } catch { /* sin dato */ }
  try {
    const mem = await run("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_OperatingSystem | ForEach-Object { [math]::Round(($_.TotalVisibleMemorySize - $_.FreePhysicalMemory)/1024) })"]);
    out.systemRamUsedMiB = Number(mem.stdout.trim());
  } catch { /* sin dato */ }
  try {
    const docker = await run("docker", ["stats", "--no-stream", "--format", "{{.Name}}={{.MemUsage}}", "lumbarai-clean-backend"]);
    out.backendContainer = docker.stdout.trim();
  } catch { /* sin docker */ }
  return out;
}

async function timed(label, token, path, init) {
  const samples = [];
  let stop = false;
  const sampler = (async () => {
    while (!stop) {
      samples.push(await sample());
      await new Promise((r) => setTimeout(r, 1500));
    }
  })();
  const started = Date.now();
  let status = 0;
  let body = null;
  try {
    const res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
    status = res.status;
    body = await res.json().catch(() => null);
  } catch (error) {
    body = { error: String(error) };
  }
  const totalMs = Date.now() - started;
  stop = true;
  await sampler;
  const peak = (key) => samples.reduce((max, s) => (typeof s[key] === "number" ? Math.max(max, s[key]) : max), 0);
  return {
    label, status, totalMs,
    elapsedMsReportedByBackend: body?.elapsedMs ?? null,
    promptTokens: body?.promptTokens ?? null,
    completionTokens: body?.completionTokens ?? null,
    peakVramMiB: peak("vramUsedMiB"), peakGpuUtilPct: peak("gpuUtilPct"),
    peakRuntimeRamMiB: peak("runtimeRamMiB"), peakSystemRamUsedMiB: peak("systemRamUsedMiB"),
    backendContainer: samples.at(-1)?.backendContainer ?? null,
    answer: body?.answer ?? null, references: body?.references ?? null, removedReferences: body?.removedReferences ?? null,
    warnings: body?.warnings ?? null, errorCode: status >= 400 ? (body?.code ?? body?.error ?? null) : null,
  };
}

const token = await login();
const detail = async (caseId) => (await (await fetch(`${API}/api/studies/${caseId}`, { headers: { Authorization: `Bearer ${token}` } })).json());
const runIdOf = (study) => study.runs[0].runId ?? study.runs[0].multiplanarRunId ?? study.runs[0].summary?.runId;
const mendeley = runIdOf(await detail(MENDELEY));
const osfCurrent = runIdOf(await detail(OSF_CURRENT));
const osfReference = runIdOf(await detail(OSF_REFERENCE));

const chat = (caseId, body) => ({ method: "POST", body: JSON.stringify(body) });
const results = { startedAt: new Date().toISOString(), baseline: await sample(), calls: [] };

const plan = [
  ["estudio · primera consulta (modelo en frío para este contexto)", MENDELEY, { question: "Resumí los resultados de este estudio", runId: mendeley }],
  ["estudio · segunda consulta (mismo contexto)", MENDELEY, { question: "¿Qué resultados faltan o requieren especial revisión?", runId: mendeley }],
  ["estudio · edad ausente", MENDELEY, { question: "¿Qué edad tiene el paciente y cuál es el motivo de consulta?", runId: mendeley }],
  ["estudio · pregunta de un valor", MENDELEY, { question: "¿Qué predijo el modelo para el abombamiento en L5-S1 y con qué probabilidad?", runId: mendeley }],
  ["comparación OSF · primera consulta", OSF_CURRENT, { question: "¿Qué diferencias se registraron entre A y B?", runId: osfCurrent, referenceCaseId: OSF_REFERENCE, referenceRunId: osfReference }],
  ["comparación OSF · hallazgos", OSF_CURRENT, { question: "¿Cambió la clasificación de algún hallazgo entre A y B?", runId: osfCurrent, referenceCaseId: OSF_REFERENCE, referenceRunId: osfReference }],
  ["comparación OSF · resultados no comparables", OSF_CURRENT, { question: "¿Qué resultados no se pudieron comparar y por qué?", runId: osfCurrent, referenceCaseId: OSF_REFERENCE, referenceRunId: osfReference }],
];
for (const [label, caseId, body] of plan) {
  results.calls.push(await timed(label, token, `/api/studies/${encodeURIComponent(caseId)}/chat`, chat(caseId, body)));
  console.log(`${label}: ${results.calls.at(-1).status} ${results.calls.at(-1).totalMs} ms`);
}
results.finishedAt = new Date().toISOString();
const out = process.argv[2] ?? "assistant-bench.json";
writeFileSync(out, JSON.stringify(results, null, 1));
console.log(`escrito ${out}`);
