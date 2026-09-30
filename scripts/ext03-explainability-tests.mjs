// EXT-03: contract tests for the subarticular explainability API client. Follows the same
// transpile-and-vm-load convention as scripts/ext04b3-visual-evidence-tests.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// multiplanarApi.ts DEFINES `multiplanarRequest` itself (rather than importing it), so loading
// the whole file the way ext04b3's own loader does would pull in generateTraceId/authHeaders/
// ensureAuthSession/etc. too. This only needs the one exported function under test, so it is
// extracted by name and evaluated against a stubbed `multiplanarRequest` instead of the file's
// real networking implementation (which is exercised live in the Docker E2E, never unit-mocked).
function loadSingleFunction(path, functionName, extraSandbox = {}) {
  const source = readFileSync(path, "utf8");
  const marker = `export async function ${functionName}`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`function ${functionName} not found in ${path}`);
  // Find the parameter list's matching close-paren first (parens, not braces -- the params
  // themselves may contain object-type braces), then the function body's own opening brace,
  // which is the first "{" after that close-paren (skipping any ": ReturnType" in between).
  const parenStart = source.indexOf("(", start);
  let parenDepth = 0;
  let parenEnd = parenStart;
  for (let i = parenStart; i < source.length; i += 1) {
    if (source[i] === "(") parenDepth += 1;
    if (source[i] === ")") { parenDepth -= 1; if (parenDepth === 0) { parenEnd = i; break; } }
  }
  const bodyStart = source.indexOf("{", parenEnd);
  let depth = 0;
  let end = bodyStart;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") { depth -= 1; if (depth === 0) { end = i + 1; break; } }
  }
  const snippet = source.slice(start, end).replace("export async function", "async function");
  const js = ts.transpileModule(snippet, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = { exports: {}, console, ...extraSandbox };
  vm.runInNewContext(`${js}\nexports.${functionName} = ${functionName};`, sandbox);
  return sandbox.exports;
}

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

let capturedPath = null;
let capturedBody = null;
const api = loadSingleFunction("src/multiplanarApi.ts", "requestSubarticularExplanation", {
  multiplanarRequest: async (path, init) => {
    capturedPath = path;
    capturedBody = init && init.body ? JSON.parse(init.body) : null;
    return {
      modelId: "rsna_subarticular_axial_t2_2p5d",
      modelVersion: "sha256:fake",
      task: "subarticular_stenosis_left_right",
      targetClass: "moderate",
      layer: "backbone.bn2",
      method: "gradcam",
      heatmapPng: "iVBORw0KGgo=",
      generatedAt: "2026-09-06T12:00:00Z",
      experimental: true,
      disclaimer: "Mapa de activación experimental asociado a la predicción del clasificador.",
      layerDisclaimer: "Este mapa de activación explica únicamente la rama visual de la predicción.",
    };
  },
});

await check("1. requestSubarticularExplanation llama al endpoint /explain correcto", async () => {
  await api.requestSubarticularExplanation({ inputId: "inp_1", instanceNumber: 5, x: 10, y: 20, side: "left", level: "L4-L5" });
  assert.equal(capturedPath, "/api/ai/degenerative-findings/subarticular/explain");
});

await check("2. requestSubarticularExplanation envía el body con los campos del ROI", async () => {
  await api.requestSubarticularExplanation({ inputId: "inp_1", instanceNumber: 5, x: 10, y: 20, side: "right", level: "L3-L4" });
  assert.equal(capturedBody.side, "right");
  assert.equal(capturedBody.level, "L3-L4");
  assert.equal(capturedBody.inputId, "inp_1");
});

await check("3. requestSubarticularExplanation omite targetClass cuando no se pide uno específico", async () => {
  await api.requestSubarticularExplanation({ inputId: "inp_1", instanceNumber: 5, x: 10, y: 20, side: "left", level: "L4-L5" });
  assert.equal(capturedBody.targetClass, undefined);
});

await check("4. requestSubarticularExplanation reenvía un targetClass explícito", async () => {
  await api.requestSubarticularExplanation({ inputId: "inp_1", instanceNumber: 5, x: 10, y: 20, side: "left", level: "L4-L5", targetClass: "severe" });
  assert.equal(capturedBody.targetClass, "severe");
});

await check("5. la respuesta conserva method=gradcam y experimental=true sin transformarlos", async () => {
  const result = await api.requestSubarticularExplanation({ inputId: "inp_1", instanceNumber: 5, x: 10, y: 20, side: "left", level: "L4-L5" });
  assert.equal(result.method, "gradcam");
  assert.equal(result.experimental, true);
  assert.equal(result.layer, "backbone.bn2");
});

await check("6. la respuesta conserva ambos disclaimers sin lenguaje causal/diagnóstico", async () => {
  const result = await api.requestSubarticularExplanation({ inputId: "inp_1", instanceNumber: 5, x: 10, y: 20, side: "left", level: "L4-L5" });
  const forbidden = /zona de la patolog[ií]a|explicaci[oó]n causal|diagn[oó]stico confirmado/i;
  assert.doesNotMatch(result.disclaimer, forbidden);
  assert.doesNotMatch(result.layerDisclaimer, forbidden);
});

await Promise.all([]); // ensure all async `check` bodies above have settled before summarizing
console.log(`\n${passed} tests OK — EXT-03 explainability API contract`);
