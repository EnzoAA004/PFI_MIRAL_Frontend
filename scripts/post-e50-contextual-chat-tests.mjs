import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/**
 * Asistente sobre los resultados REALES: contrato con el Backend, estado, ámbito (corrida o par A/B), respuestas anteriores,
 * errores y qué se promete en la interfaz. Se ejecuta el código real transpilado, sin React ni red. Son pruebas de contrato
 * y de lógica de la interfaz: NO evalúan la calidad de ningún modelo de lenguaje (eso se mide con el modelo real, aparte).
 */

function load(paths, exportNames) {
  const source = paths
    .map((path) => readFileSync(path, "utf8").replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "").replace(/export /g, ""))
    .join("\n");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { exports: {}, console };
  vm.runInNewContext(`${js}\n${exportNames.map((name) => `exports.${name} = ${name};`).join("\n")}`, sandbox);
  return sandbox.exports;
}

const api = load(["src/chatApi.ts"], [
  "parseChatResponse", "parseChatContextInfo", "parseChatConversationHistory", "parseChatConversationDetail", "chatRequestFor", "ChatContractError",
]);
const state = load(["src/features/reading/chatState.ts"], [
  "chatScopeKey", "isPairScope", "initialChatUiState", "questionSent", "answerReceived", "requestFailed", "retryPrepared", "conversationLoaded",
  "canSend", "newConversationStarted", "shouldSubmitQuestion", "isStaleAnswer", "connectionState", "promisesFindingsComparison",
]);
const display = load(["src/features/reading/chatState.ts", "src/features/reading/chatDisplay.ts"], [
  "CHAT_DISCLAIMER", "CHAT_NO_FINDINGS_COMPARISON_TEXT", "suggestedQuestions", "classifyChatError", "displayContextSource", "displayConversationLabel",
  "displayElapsed", "connectionLabel", "modelAvailabilityNote", "sourceLabel", "shownOfTotalLabel", "CHAT_ORIGIN_LABELS",
]);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const backendError = (status, code, message = "error") => ({ name: "BackendApiError", status, code, message, path: "/api/studies/x/chat" });
const STUDY = { caseId: "CASO-1", runId: "run-1" };
const PAIR = { caseId: "CASO-1", runId: "run-1", referenceCaseId: "REF-1", referenceRunId: "run-ref" };
const scope = (kind, comparable) => ({ kind, runId: "run-1", referenceCaseId: kind === "pair" ? "REF-1" : null, referenceRunId: kind === "pair" ? "run-ref" : null, findingsComparable: comparable });

function chatResponse(overrides = {}) {
  return {
    answer: "La altura del disco L4-L5 es 5.79 mm [M1].",
    conversationId: "conv-1",
    messageId: "msg-1",
    model: "qwen3-4b-instruct-2507",
    provider: "self-hosted",
    promptVersion: "pfi.chat-system-prompt.v2",
    generatedAt: "2026-10-17T12:00:00Z",
    warnings: [],
    humanReviewRequired: true,
    notClinicalDiagnosis: true,
    contextSources: ["current_analysis"],
    references: [{ ref: "M1", label: "altura del disco L4-L5" }],
    removedReferences: 0,
    contextFingerprint: "ctx-aaaa",
    scope: scope("study", false),
    elapsedMs: 4200,
    promptTokens: 3000,
    completionTokens: 40,
    mode: "structured",
    intent: "LIST_MEASUREMENTS",
    shownCount: 1,
    totalCount: 1,
    answerSupported: true,
    ...overrides,
  };
}

function contextInfo(overrides = {}) {
  return {
    scope: scope("study", false),
    contextFingerprint: "ctx-aaaa",
    promptVersion: "pfi.chat-system-prompt.v2",
    contextSources: ["current_analysis"],
    missing: ["Edad al estudio"],
    elementCount: 12,
    contextText: "ÁMBITO: un único estudio",
    provider: { enabled: true, available: true, model: "qwen3-4b-instruct-2507" },
    mode: "structured",
    suggestedQuestions: [
      { text: "Resumí los datos registrados de este estudio", intent: "SUMMARY" },
      { text: "¿Qué clasificaciones predijo el modelo como presentes?", intent: "LIST_FINDINGS" },
      { text: "¿Qué datos faltan?", intent: "LIST_MISSING_DATA" },
    ],
    ...overrides,
  };
}

const PAIR_QUESTIONS_FROM_SERVER = [
  { text: "¿Qué diferencias se registraron entre A y B?", intent: "LIST_DIFFERENCES" },
  { text: "¿Cambió alguna clasificación entre A y B?", intent: "LIST_FINDING_CHANGES" },
  { text: "¿Qué resultados no se pudieron comparar y por qué?", intent: "LIST_NOT_COMPARABLE" },
];

/* ------------------------------------------------------------------ contrato */

check("la petición identifica la corrida y no envía datos: solo pregunta y ámbito", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(api.chatRequestFor(STUDY, "hola"))), { question: "hola", runId: "run-1" });
  assert.deepEqual(JSON.parse(JSON.stringify(api.chatRequestFor(PAIR, "hola", "conv-9"))), {
    question: "hola", runId: "run-1", referenceCaseId: "REF-1", referenceRunId: "run-ref", conversationId: "conv-9",
  });
  // Una referencia a medias no se envía: el ámbito es una corrida o el par completo, nunca algo intermedio.
  assert.deepEqual(JSON.parse(JSON.stringify(api.chatRequestFor({ ...STUDY, referenceCaseId: "REF-1" }, "hola"))), { question: "hola", runId: "run-1" });
  const keys = Object.keys(api.chatRequestFor(PAIR, "hola", "c"));
  for (const forbidden of ["measurements", "findings", "context", "analysisId", "baselineCaseId"]) assert.equal(keys.includes(forbidden), false, forbidden);
});

check("la respuesta se parsea estricta: faltan flags de seguridad o huella y falla", () => {
  const parsed = api.parseChatResponse(chatResponse());
  assert.equal(parsed.humanReviewRequired, true);
  assert.equal(parsed.contextFingerprint, "ctx-aaaa");
  assert.equal(parsed.references[0].ref, "M1");
  assert.equal(parsed.scope.kind, "study");
  for (const missing of ["humanReviewRequired", "notClinicalDiagnosis", "contextFingerprint", "answer", "scope"]) {
    const broken = chatResponse();
    delete broken[missing];
    assert.throws(() => api.parseChatResponse(broken), /Contrato de chat inválido/, missing);
  }
  assert.throws(() => api.parseChatResponse(chatResponse({ scope: { kind: "otro" } })), /ámbito desconocido/);
});

check("el contexto describe el modelo, lo ausente y lo que recibiría el proveedor", () => {
  const info = api.parseChatContextInfo(contextInfo());
  assert.equal(info.provider.available, true);
  assert.deepEqual(Array.from(info.missing), ["Edad al estudio"]);
  assert.throws(() => api.parseChatContextInfo({ ...contextInfo(), provider: undefined }), /estado del proveedor/);
});

check("el historial y la conversación traen su ámbito, la huella y las referencias de cada mensaje", () => {
  const history = api.parseChatConversationHistory({ caseId: "CASO-1", scopeKey: "run:run-1", conversations: [{ conversationId: "c1", createdAt: "2026-10-17T12:00:00Z", messageCount: 2 }] });
  assert.equal(history.scopeKey, "run:run-1");
  const detail = api.parseChatConversationDetail({
    conversationId: "c1", caseId: "CASO-1", createdAt: "2026-10-17T12:00:00Z", scopeKey: "run:run-1", runId: "run-1", referenceRunId: null,
    messages: [{ id: "m1", role: "ASSISTANT", content: "x", createdAt: "2026-10-17T12:00:00Z", model: "m", provider: "p", promptVersion: "v2", contextFingerprint: "ctx-aaaa", references: [{ ref: "M1", label: "l" }, { malformada: true }] }],
  });
  assert.equal(detail.messages[0].contextFingerprint, "ctx-aaaa");
  assert.equal(detail.messages[0].references.length, 1, "una referencia mal formada se descarta, no se inventa");
});

/* ------------------------------------------------------------------ ámbito y estado */

check("el ámbito distingue estudio, otra corrida y otra referencia", () => {
  const keys = new Set([
    state.chatScopeKey(STUDY), state.chatScopeKey({ ...STUDY, runId: "run-2" }), state.chatScopeKey(PAIR),
    state.chatScopeKey({ ...PAIR, referenceRunId: "run-otra" }), state.chatScopeKey({ ...PAIR, referenceCaseId: "REF-2" }), state.chatScopeKey({ ...STUDY, caseId: "OTRO" }),
  ]);
  assert.equal(keys.size, 6);
  assert.equal(state.isPairScope(STUDY), false);
  assert.equal(state.isPairScope(PAIR), true);
  assert.equal(state.isPairScope({ ...STUDY, referenceCaseId: "REF-1" }), false);
});

check("la pregunta queda visible y bloquea el doble envío; la respuesta suma el mensaje con su huella y fuentes", () => {
  const sent = state.questionSent(state.initialChatUiState(), "hola");
  assert.equal(sent.phase, "sending");
  assert.equal(state.canSend(sent), false);
  const answered = state.answerReceived(sent, api.parseChatResponse(chatResponse()));
  assert.equal(answered.phase, "idle");
  assert.equal(answered.messages[1].role, "ASSISTANT");
  assert.equal(answered.messages[1].fingerprint, "ctx-aaaa");
  assert.equal(answered.messages[1].references[0].ref, "M1");
  assert.equal(answered.conversationId, "conv-1");
});

check("tras un error la pregunta sigue visible y el reintento no la duplica", () => {
  const sent = state.questionSent(state.initialChatUiState(), "hola");
  const failed = state.requestFailed(sent, { kind: "timeout", message: "tardó", retryable: true });
  assert.equal(failed.phase, "error");
  assert.equal(failed.messages.length, 1);
  assert.equal(failed.messages[0].content, "hola");
  const prepared = state.retryPrepared(failed);
  assert.equal(prepared.question, "hola");
  assert.equal(prepared.state.messages.length, 0, "se saca la pregunta fallida antes de reenviarla");
  assert.equal(state.retryPrepared(state.initialChatUiState()), null);
});

check("una respuesta es «de datos anteriores» si su huella no es la actual", () => {
  const assistant = { role: "ASSISTANT", fingerprint: "ctx-viejo" };
  assert.equal(state.isStaleAnswer(assistant, "ctx-nuevo"), true);
  assert.equal(state.isStaleAnswer(assistant, "ctx-viejo"), false);
  assert.equal(state.isStaleAnswer(assistant, null), false, "sin huella actual conocida no se afirma nada");
  assert.equal(state.isStaleAnswer({ role: "USER", fingerprint: "ctx-viejo" }, "ctx-nuevo"), false);
  assert.equal(state.isStaleAnswer({ role: "ASSISTANT", fingerprint: null }, "ctx-nuevo"), true);
});

check("cargar una conversación guarda la huella de cada respuesta", () => {
  const detail = api.parseChatConversationDetail({
    conversationId: "c1", caseId: "CASO-1", createdAt: "2026-10-17T12:00:00Z", scopeKey: "run:run-1", runId: "run-1", referenceRunId: null,
    messages: [
      { id: "m1", role: "USER", content: "hola", createdAt: "2026-10-17T12:00:00Z", model: null, provider: null, promptVersion: "v2", contextFingerprint: "ctx-aaaa", references: [] },
      { id: "m2", role: "ASSISTANT", content: "x", createdAt: "2026-10-17T12:00:00Z", model: "m", provider: "p", promptVersion: "v2", contextFingerprint: "ctx-aaaa", references: [] },
    ],
  });
  const loaded = state.conversationLoaded(state.initialChatUiState(), detail);
  assert.equal(loaded.messages[1].fingerprint, "ctx-aaaa");
  assert.equal(loaded.messages[0].fingerprint, undefined);
  assert.equal(state.newConversationStarted().messages.length, 0);
  assert.equal(state.shouldSubmitQuestion("   "), false);
});

/* ------------------------------------------------------------------ qué se promete y cómo se conecta */

check("no se promete comparación de hallazgos si el par no tiene P10.7 en los dos lados", () => {
  const withFindings = api.parseChatContextInfo(contextInfo({ scope: scope("pair", true) }));
  const without = api.parseChatContextInfo(contextInfo({ scope: scope("pair", false) }));
  assert.equal(state.promisesFindingsComparison(PAIR, withFindings), true);
  assert.equal(state.promisesFindingsComparison(PAIR, without), false);
  assert.equal(state.promisesFindingsComparison(PAIR, null), false);
  assert.equal(state.promisesFindingsComparison(STUDY, withFindings), false);
  const pairWith = api.parseChatContextInfo(contextInfo({ scope: scope("pair", true), suggestedQuestions: PAIR_QUESTIONS_FROM_SERVER }));
  const pairWithout = api.parseChatContextInfo(contextInfo({ scope: scope("pair", false), suggestedQuestions: PAIR_QUESTIONS_FROM_SERVER }));
  assert.equal(display.suggestedQuestions(PAIR, pairWithout).some((q) => /clasificaci/i.test(q)), false);
  assert.equal(display.suggestedQuestions(PAIR, pairWith).some((q) => /clasificaci/i.test(q)), true);
  assert.match(display.CHAT_NO_FINDINGS_COMPARISON_TEXT, /no hay comparación de hallazgos/);
});

check("las consultas disponibles las define el servidor y coinciden con el alcance del asistente", () => {
  assert.deepEqual(Array.from(display.suggestedQuestions(STUDY, null)), [], "sin información no se sugiere nada");
  const study = api.parseChatContextInfo(contextInfo());
  assert.deepEqual(Array.from(display.suggestedQuestions(STUDY, study)), [
    "Resumí los datos registrados de este estudio", "¿Qué clasificaciones predijo el modelo como presentes?", "¿Qué datos faltan?",
  ]);
  // Ninguna consulta pide un juicio sobre los valores ni una interpretación clínica.
  for (const question of display.suggestedQuestions(STUDY, study)) assert.doesNotMatch(question, /normal|grave|elevad|reducid|diagn[oó]stic|causa|mejor|empeor/i);
  const pair = api.parseChatContextInfo(contextInfo({ scope: scope("pair", true), suggestedQuestions: PAIR_QUESTIONS_FROM_SERVER }));
  assert.equal(display.suggestedQuestions(PAIR, pair)[0], "¿Qué diferencias se registraron entre A y B?");
});

check("modelo conectado, fuente disponible y respuesta respaldada son tres cosas distintas", () => {
  const info = api.parseChatContextInfo(contextInfo());
  assert.match(display.connectionLabel("ready", "qwen"), /Modelo local conectado/);
  assert.match(display.sourceLabel(info), /Datos registrados disponibles \(12 elementos citables\)/);
  assert.match(display.sourceLabel(api.parseChatContextInfo(contextInfo({ elementCount: 0 }))), /No hay datos registrados disponibles/);
  assert.match(display.sourceLabel(null), /Comprobando/);
  // Con el modelo apagado la fuente sigue disponible y las consultas disponibles siguen funcionando.
  assert.match(display.modelAvailabilityNote("offline"), /consultas disponibles siguen funcionando sin el modelo/);
  assert.match(display.modelAvailabilityNote("disabled"), /preguntas escritas necesitan/);
  assert.equal(display.modelAvailabilityNote("ready"), null);
  assert.equal(display.CHAT_ORIGIN_LABELS.supported, "Respuesta respaldada por datos registrados");
  assert.match(display.CHAT_ORIGIN_LABELS.legacy, /no verificada con el modo acotado/);
  assert.notEqual(display.CHAT_ORIGIN_LABELS.supported, display.connectionLabel("ready", ""));
});

check("la respuesta lleva su origen: respaldada, fuera de alcance o texto libre anterior no verificado", () => {
  const sent = state.questionSent(state.initialChatUiState(), "¿Qué datos faltan?");
  const supported = state.answerReceived(sent, api.parseChatResponse(chatResponse()));
  assert.equal(supported.messages.at(-1).origin, "supported");
  const out = state.answerReceived(sent, api.parseChatResponse(chatResponse({ answerSupported: false, intent: "UNSUPPORTED", references: [] })));
  assert.equal(out.messages.at(-1).origin, "out_of_scope");
  const free = state.answerReceived(sent, api.parseChatResponse(chatResponse({ mode: "free", intent: null, answerSupported: true })));
  assert.equal(free.messages.at(-1).origin, "legacy", "el texto libre no se presenta como respaldado");
  // Sin la marca explícita del servidor no se presenta como respaldada (fail-closed).
  const unmarked = chatResponse();
  delete unmarked.answerSupported;
  assert.equal(api.parseChatResponse(unmarked).answerSupported, false);
  const noMode = chatResponse();
  delete noMode.mode;
  assert.equal(api.parseChatResponse(noMode).mode, "free");
});

check("las conversaciones guardadas identifican su origen: lo anterior de texto libre queda como no verificado", () => {
  const detail = (promptVersion, references) => ({
    conversationId: "c", caseId: "CASO-1", createdAt: "2026-10-17T12:00:00Z", scopeKey: "run:run-1", runId: "run-1", referenceRunId: null,
    messages: [
      { id: "u1", role: "USER", content: "Resumí", createdAt: "2026-10-17T12:00:00Z", model: null, provider: null, promptVersion: null, contextFingerprint: null, references: [] },
      { id: "a1", role: "ASSISTANT", content: "texto", createdAt: "2026-10-17T12:00:01Z", model: "m", provider: "p", promptVersion, contextFingerprint: "ctx-aaaa", references },
    ],
  });
  const originOf = (promptVersion, references) => state.conversationLoaded(state.initialChatUiState(), api.parseChatConversationDetail(detail(promptVersion, references))).messages.at(-1).origin;
  assert.equal(originOf("pfi.chat-system-prompt.v3", [{ ref: "M1", label: "x" }]), "legacy");
  assert.equal(originOf("pfi.chat-system-prompt.v2", []), "legacy");
  assert.equal(originOf(null, []), "legacy");
  assert.equal(originOf("pfi.chat-structured.v1", [{ ref: "M1", label: "x" }]), "supported");
  assert.equal(originOf("pfi.chat-structured.v1", []), "out_of_scope");
  const loaded = state.conversationLoaded(state.initialChatUiState(), api.parseChatConversationDetail(detail("pfi.chat-structured.v1", [])));
  assert.equal(loaded.messages[0].origin, undefined, "la pregunta del usuario no tiene origen");
});

check("cuando se muestra un subconjunto, se dice cuántos de cuántos", () => {
  assert.equal(display.shownOfTotalLabel(40, 49), "Se muestran 40 de 49");
  assert.equal(display.shownOfTotalLabel(49, 49), null);
  assert.equal(display.shownOfTotalLabel(null, 49), null);
  assert.equal(display.shownOfTotalLabel(0, 0), null);
});

check("el estado de conexión distingue conectado, apagado, sin modelo y error de contexto", () => {
  assert.equal(state.connectionState(null, null).kind, "checking");
  assert.equal(state.connectionState(api.parseChatContextInfo(contextInfo()), null).kind, "ready");
  assert.equal(state.connectionState(api.parseChatContextInfo(contextInfo({ provider: { enabled: false, available: false, model: "m" } })), null).kind, "disabled");
  assert.equal(state.connectionState(api.parseChatContextInfo(contextInfo({ provider: { enabled: true, available: false, model: "m" } })), null).kind, "offline");
  assert.equal(state.connectionState(null, { kind: "scope", message: "no existe", retryable: false }).kind, "scope_error");
  assert.equal(state.connectionState(null, { kind: "network", message: "x", retryable: true }).kind, "offline");
  assert.match(display.connectionLabel("ready", "qwen"), /conectado \(qwen\)/);
});

/* ------------------------------------------------------------------ errores */

check("cada falla tiene un mensaje claro y dice si tiene sentido reintentar", () => {
  const disabled = display.classifyChatError(backendError(503, "LLM_PROVIDER_DISABLED"));
  assert.equal(disabled.kind, "disabled");
  assert.equal(disabled.retryable, false);
  const timeout = display.classifyChatError(backendError(504, "LLM_PROVIDER_TIMEOUT"));
  assert.equal(timeout.kind, "timeout");
  assert.equal(timeout.retryable, true);
  const down = display.classifyChatError(backendError(502, "LLM_PROVIDER_UNAVAILABLE"));
  assert.equal(down.kind, "unavailable");
  assert.equal(down.retryable, true);
  assert.equal(display.classifyChatError(backendError(403, "")).kind, "forbidden");
  assert.equal(display.classifyChatError(backendError(401, "")).kind, "forbidden");
  const gone = display.classifyChatError(backendError(404, "CHAT_RUN_NOT_FOUND"));
  assert.equal(gone.kind, "scope");
  assert.equal(gone.retryable, false);
  assert.match(gone.message, /No se usó ningún otro/);
  assert.equal(display.classifyChatError(new Error("Failed to fetch")).kind, "network");
  // Nunca se filtra infraestructura del servidor.
  for (const error of [disabled, timeout, down, gone]) assert.doesNotMatch(error.message, /localhost|host\.docker|:1234|http/i);
});

check("el aviso de revisión profesional y de que no ve imágenes está siempre", () => {
  assert.match(display.CHAT_DISCLAIMER, /no ve las imágenes/);
  assert.match(display.CHAT_DISCLAIMER, /revisión profesional/);
  assert.match(display.CHAT_DISCLAIMER, /no es un diagnóstico/);
  assert.match(display.CHAT_DISCLAIMER, /cifras, niveles y referencias salen del sistema/);
});

check("etiquetas: fuentes desconocidas no rompen y las latencias se leen bien", () => {
  assert.equal(display.displayContextSource("numeric_comparison"), "Comparación de mediciones");
  assert.equal(display.displayContextSource("algo_nuevo"), "algo_nuevo");
  assert.equal(display.displayElapsed(850), "850 ms");
  assert.equal(display.displayElapsed(4200), "4,2 s");
  assert.equal(display.displayConversationLabel("no-es-fecha"), "no-es-fecha");
});

console.log(`Asistente (contrato y lógica de la interfaz): ${passed} pruebas pasaron`);
