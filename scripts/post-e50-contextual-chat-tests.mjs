import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/**
 * Stage 80: contextual chat / self-hosted LLM module. Same pattern as the other post-e50 test
 * scripts: transpile the pure .ts modules to CommonJS and run them in a vm sandbox — no
 * DOM/React renderer, so all the logic worth testing (parsing, presentation, state transitions)
 * lives in plain .ts files with no React import.
 */

function load(path, exportNames) {
  const source = readFileSync(path, "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/export /g, "");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = { exports: {}, console };
  vm.runInNewContext(`${js}\n${exportNames.map((name) => `exports.${name} = ${name};`).join("\n")}`, sandbox);
  return sandbox.exports;
}

const api = load("src/chatApi.ts", [
  "parseChatResponse",
  "parseChatConversationHistory",
  "parseChatConversationDetail",
]);

const display = load("src/features/reading/chatDisplay.ts", [
  "CHAT_DISCLAIMER",
  "CHAT_EMPTY_STATE_TEXT",
  "CHAT_SENDING_TEXT",
  "SUGGESTED_QUESTIONS",
  "displayContextSource",
]);

const state = load("src/features/reading/chatState.ts", [
  "initialChatUiState",
  "questionSent",
  "answerReceived",
  "requestFailed",
  "conversationLoaded",
  "canSend",
  "shouldSubmitQuestion",
]);

const errorState = load("src/features/reading/productAnalysisV1State.ts", ["classifyProductAnalysisError"]);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function backendApiError(status, message = "error") {
  return { name: "BackendApiError", status, message, path: "/api/studies/x/chat", traceId: "trace-1" };
}

function chatResponse(overrides = {}) {
  return {
    answer: "Hay 1 medicion disponible en L4-L5.",
    conversationId: "conv-1",
    messageId: "msg-1",
    model: "Qwen2.5-7B-Instruct",
    provider: "self-hosted",
    promptVersion: "pfi.chat-system-prompt.v1",
    generatedAt: "2026-08-25T12:00:00Z",
    warnings: [],
    humanReviewRequired: true,
    notClinicalDiagnosis: true,
    contextSources: ["current_analysis"],
    ...overrides,
  };
}

// ---- 1: chat empty state ----
check("1. chat empty state: sin mensajes al inicio", () => {
  const initial = state.initialChatUiState();
  assert.equal(initial.messages.length, 0);
  assert.ok(display.CHAT_EMPTY_STATE_TEXT.length > 0);
});

// ---- 2: suggested questions ----
check("2. suggested questions: existen al menos 4 sugerencias", () => {
  assert.ok(display.SUGGESTED_QUESTIONS.length >= 4);
});

// ---- 3-4: send question / loading ----
check("3-4. send question deja phase=sending con el mensaje del usuario visible", () => {
  const sent = state.questionSent(state.initialChatUiState(), "hola");
  assert.equal(sent.phase, "sending");
  assert.equal(sent.messages[0].role, "USER");
  assert.equal(sent.messages[0].content, "hola");
});

// ---- 5: double submit blocked ----
check("5. double submit: canSend=false mientras phase=sending", () => {
  const sending = state.questionSent(state.initialChatUiState(), "hola");
  assert.equal(state.canSend(sending), false);
});

// ---- 6: response displayed ----
check("6. la respuesta se agrega como mensaje ASSISTANT", () => {
  const sent = state.questionSent(state.initialChatUiState(), "hola");
  const withAnswer = state.answerReceived(sent, chatResponse());
  assert.equal(withAnswer.phase, "success");
  assert.equal(withAnswer.messages[1].role, "ASSISTANT");
  assert.equal(withAnswer.messages[1].content, "Hay 1 medicion disponible en L4-L5.");
});

// ---- 7-11: error classification ----
check("7. provider unavailable (502) se clasifica como upstream", () => {
  assert.equal(errorState.classifyProductAnalysisError(backendApiError(502)).kind, "upstream");
});

check("8. 400 se clasifica como functional", () => {
  assert.equal(errorState.classifyProductAnalysisError(backendApiError(400)).kind, "functional");
});

check("9. 404 se clasifica como not_found", () => {
  assert.equal(errorState.classifyProductAnalysisError(backendApiError(404)).kind, "not_found");
});

check("10. 503 (LLM deshabilitado) se clasifica como upstream, nunca oculto", () => {
  assert.equal(errorState.classifyProductAnalysisError(backendApiError(503)).kind, "upstream");
});

check("11. network error se clasifica como network", () => {
  assert.equal(errorState.classifyProductAnalysisError(new TypeError("Failed to fetch")).kind, "network");
});

// ---- 12-14: conversation history ----
check("12. GET history se parsea con la lista de conversaciones", () => {
  const parsed = api.parseChatConversationHistory({ caseId: "case-1", conversations: [{ conversationId: "c1", createdAt: "2026-08-25T12:00:00Z", messageCount: 2 }] });
  assert.equal(parsed.conversations.length, 1);
});

check("13. reload conversation: conversationLoaded repone los mensajes persistidos", () => {
  const detail = { conversationId: "c1", caseId: "case-1", createdAt: "2026-08-25T12:00:00Z", messages: [
    { id: "m1", role: "USER", content: "hola", createdAt: "t", model: null, provider: null, promptVersion: null },
    { id: "m2", role: "ASSISTANT", content: "respuesta", createdAt: "t", model: "Qwen2.5-7B-Instruct", provider: "self-hosted", promptVersion: "pfi.chat-system-prompt.v1" },
  ] };
  const parsed = api.parseChatConversationDetail(detail);
  const loaded = state.conversationLoaded(state.initialChatUiState(), parsed);
  assert.equal(loaded.messages.length, 2);
  assert.equal(loaded.conversationId, "c1");
});

check("14. multiple conversations: el historial preserva cada una por separado", () => {
  const parsed = api.parseChatConversationHistory({
    caseId: "case-1",
    conversations: [
      { conversationId: "c1", createdAt: "2026-08-25T10:00:00Z", messageCount: 2 },
      { conversationId: "c2", createdAt: "2026-08-25T11:00:00Z", messageCount: 2 },
    ],
  });
  assert.equal(parsed.conversations.length, 2);
  assert.notEqual(parsed.conversations[0].conversationId, parsed.conversations[1].conversationId);
});

// ---- 15: disclaimer ----
check("15. el disclaimer existe y no es texto clínico", () => {
  assert.ok(display.CHAT_DISCLAIMER.includes("no reemplaza"));
});

// ---- 16-17: safe rendering ----
check("16. el contenido de la respuesta se preserva literal, nunca se reescribe", () => {
  const withAnswer = state.answerReceived(state.initialChatUiState(), chatResponse({ answer: "<b>no deberia interpretarse</b>" }));
  assert.equal(withAnswer.messages[0].content, "<b>no deberia interpretarse</b>");
});

check("17. el panel nunca usa dangerouslySetInnerHTML", () => {
  // Se busca el uso real como atributo JSX (`dangerouslySetInnerHTML={`), no la mención en un
  // comentario que explica por qué no se usa.
  const panelSource = readFileSync("src/features/reading/ChatPanel.tsx", "utf8");
  assert.equal(panelSource.includes("dangerouslySetInnerHTML={"), false);
});

// ---- 18: Enter submits ----
check("18. el panel envía con Enter (sin Shift) y agrega salto de línea con Shift+Enter", () => {
  const panelSource = readFileSync("src/features/reading/ChatPanel.tsx", "utf8");
  assert.match(panelSource, /event\.key === "Enter" && !event\.shiftKey/);
});

// ---- 19: blank rejected ----
check("19. una pregunta en blanco nunca se envía", () => {
  assert.equal(state.shouldSubmitQuestion("   "), false);
  assert.equal(state.shouldSubmitQuestion(""), false);
});

// ---- 20: long question handled ----
check("20. una pregunta larga no se bloquea client-side (el límite lo valida el Backend)", () => {
  assert.equal(state.shouldSubmitQuestion("a".repeat(3000)), true);
});

// ---- 21: context source badges ----
check("21. displayContextSource traduce fuentes conocidas y no rompe con una desconocida", () => {
  assert.equal(display.displayContextSource("current_analysis"), "Análisis actual");
  assert.equal(display.displayContextSource("professional_correction"), "Corrección profesional");
  assert.equal(display.displayContextSource("unknown_source_xyz"), "unknown_source_xyz");
});

// ---- 22: longitudinal suggestion ----
check("22. existe una sugerencia sobre qué cambió respecto del estudio anterior", () => {
  assert.ok(display.SUGGESTED_QUESTIONS.includes("¿Qué cambió respecto del estudio anterior?"));
});

// ---- 23: corrected measurement question ----
check("23. existe una sugerencia sobre mediciones corregidas profesionalmente", () => {
  assert.ok(display.SUGGESTED_QUESTIONS.includes("¿Qué mediciones fueron corregidas profesionalmente?"));
});

// ---- 24: P10.7 unavailable semantics (frontend never invents its own claim) ----
check("24. ningún texto estático del chat afirma 'normal'/'sin hallazgos' por su cuenta", () => {
  const forbidden = /\bnormal\b|sin hallazgos|no se detect/i;
  const texts = [display.CHAT_DISCLAIMER, display.CHAT_EMPTY_STATE_TEXT, display.CHAT_SENDING_TEXT, ...display.SUGGESTED_QUESTIONS];
  for (const text of texts) assert.equal(forbidden.test(text), false, `texto indebido: "${text}"`);
});

// ---- 25: no diagnosis language hardcoded by frontend ----
check("25. ningún texto estático del chat afirma un diagnóstico o tratamiento", () => {
  const forbidden = /diagn[oó]stic|tratamiento|pron[oó]stico|mejor[oó]|empeor[oó]/i;
  const texts = [display.CHAT_DISCLAIMER, display.CHAT_EMPTY_STATE_TEXT, display.CHAT_SENDING_TEXT, ...display.SUGGESTED_QUESTIONS];
  for (const text of texts) assert.equal(forbidden.test(text), false, `texto indebido: "${text}"`);
});

// ---- extra: fail-closed parsing ----
check("extra. una respuesta de chat sin humanReviewRequired es rechazada", () => {
  const invalid = chatResponse();
  delete invalid.humanReviewRequired;
  assert.throws(() => api.parseChatResponse(invalid));
});

check("extra. requestFailed conserva el mensaje del usuario ya enviado", () => {
  const sent = state.questionSent(state.initialChatUiState(), "hola");
  const failed = state.requestFailed(sent, errorState.classifyProductAnalysisError(backendApiError(502)));
  assert.equal(failed.messages.length, 1, "la pregunta del usuario no debe desaparecer tras un error");
  assert.equal(failed.phase, "error");
});

console.log(`Post-E50 contextual chat (stage 80): ${passed} tests OK`);
