# Stage 80 — Contextual conversational module / self-hosted LLM (Frontend)

Branch: `research/post-e50-frontend-product-analysis` (same branch as stages 77/78/79 — no new branch). Base commit `d9d6a92` (Stage 79). Not committed/pushed/merged as of this document.

## 1. Existing chat/assistant UI found (80-A)

Grepped `chat`, `Chat`, `assistant`, `Asistente`, `llm`, `Llm`, `message` across `src/` before writing anything. **No chat component, no message-list UI, and no conversational client existed anywhere.** The closest prior art is `ProductAnalysisV1Panel.tsx`'s own read-only rendering of Backend-computed data (stage 77/78) and `LongitudinalComparisonPanel.tsx`'s (stage 79) `<details className="rr-more-section">` collapsible-section convention inside `StudyReviewView.tsx`'s "Más" tab — reused directly for this stage's "Asistente" section (§2) rather than inventing a new placement convention. `ReviewInspector`'s 4 fixed tabs (`measurements|ai|review|more`, type `ReviewInspectorTab`) are protected by an existing test asserting exactly 4 tabs; this stage does **not** add a 5th tab (per the "NO hacer chatbot flotante global" instruction), it extends the existing "more" tab instead, exactly as stage 79 did for "Evolución".

## 2. Where the feature lives

Added to `StudyReviewView.tsx`'s "Más" tab as a new `<details className="rr-more-section">` titled **"Asistente"**, immediately after the stage-79 "Evolución" block, guarded by `{displayRun.caseId && (<ChatPanel caseId={displayRun.caseId} />)}` — the same `caseId`-presence guard pattern already used for "Evolución". It is a section inside the existing reading-room workspace, not a floating global widget, and not a separate route/page.

## 3. Types / API client

`src/contracts/chatTypes.ts`: `ChatMessageRole` (`"USER"|"ASSISTANT"`), `ChatMessage`, `ChatRequest` (`question`, `analysisId?`, `baselineCaseId?`), `ChatResponse` (`answer`, `conversationId`, `messageId`, `model`, `provider`, `promptVersion`, `generatedAt`, `warnings`, `humanReviewRequired`, `notClinicalDiagnosis`, `contextSources`), `ChatConversationSummary`, `ChatConversationHistory`, `ChatConversationDetail`.

`src/chatApi.ts`, built on the same `multiplanarRequest` helper reused since stage 77:
```ts
sendChatMessage(caseId, request: ChatRequest): Promise<ChatResponse>
// POST /api/studies/{caseId}/chat

getChatConversations(caseId): Promise<ChatConversationHistory>
// GET /api/studies/{caseId}/chat-conversations

getChatConversation(caseId, conversationId): Promise<ChatConversationDetail>
// GET /api/studies/{caseId}/chat-conversations/{conversationId}
```
`parseChatResponse`/`parseChatConversationHistory`/`parseChatConversationDetail` are strict, fail-closed parsers matching the discipline of `productAnalysisV1Api.ts`/`longitudinalComparisonApi.ts` — a response missing `humanReviewRequired` (or any other required field) throws `ChatContractError` rather than rendering a guessed shape; verified by a dedicated test (§9 item "extra").

**The Frontend never computes an answer, never assembles the context, and never talks to the LLM directly** — it only sends the question (plus optional `analysisId`/`baselineCaseId`) and renders whatever the Backend returns, unchanged (§6).

## 4. State (pure, testable without mocking `fetch`)

`src/features/reading/chatState.ts` — no React import, mirroring the stage-77/78/79 pattern. `ChatPhase` (`idle|sending|success|error`), `ChatUiState` (`messages`, `phase`, `conversationId`, `error`), `initialChatUiState()`, `questionSent` (optimistically appends the user's own message before the response arrives), `answerReceived` (appends the assistant message, phase→`success`), `requestFailed` (phase→`error`, **keeps** the already-sent user message rather than removing it — a failed request must not make it look like the user's question was never sent), `conversationLoaded` (replaces the message list wholesale from a `GET` reload), `canSend` (`false` while `phase==="sending"`, blocking double-submit), `shouldSubmitQuestion` (rejects blank/whitespace-only input; does **not** enforce a max length client-side — that validation belongs to the Backend, per 80-Y, so a long question is never silently truncated or blocked before the Backend's own message is seen).

`src/features/reading/useChat.ts` (`useChat(caseId)`) wraps this state with the two API calls, reusing `classifyProductAnalysisError` from `productAnalysisV1State.ts` (unchanged since stage 77) for error classification — no second error-classification function was written.

## 5. UI (80-V through 80-AC)

`ChatPanel.tsx`:
- A one-time disclaimer (`CHAT_DISCLAIMER`, `src/features/reading/chatDisplay.ts`) shown above the message list, always, not dismissible per-session (re-shown every time the panel mounts — a deliberate choice per 80-AA: this text should never be something a user opts out of seeing).
- A message list (`role="log" aria-live="polite"`), each message rendered as plain React text (`<p>{message.content}</p>`) — **never `dangerouslySetInnerHTML`**, so the LLM's own free-text answer can never inject markup into the page even if it contained HTML-looking text (80-AB).
- Suggested questions (`SUGGESTED_QUESTIONS`, exactly the four from the stage brief, including "¿Qué cambió respecto del estudio anterior?" and "¿Qué mediciones fueron corregidas profesionalmente?") shown only while the conversation is empty — they disappear once a real question has been asked, so they never look like a fixed toolbar.
- A `<textarea>` + "Enviar" button; **Enter (without Shift) submits, Shift+Enter inserts a newline** (`event.key === "Enter" && !event.shiftKey`), matching the stage brief's exact UX requirement.
- `contextSources` (`current_analysis|professional_correction|longitudinal_comparison`) are shown per-message via `displayContextSource`, a small badge line — translated to Spanish labels, falling back to the raw source string for any future/unknown value rather than throwing (verified: an unrecognized source renders as itself, never crashes the panel).
- A blocked/disabled input state (`canSend===false`) while a request is in flight, preventing double-submit (80-Y).
- Errors (`phase==="error"`) render inline via the existing `rr-disc-contract-error` convention (matching stage 77/78's own error presentation), never a full-page crash — a provider-down `502`/`504` from the Backend surfaces as a plain-language message, not a stack trace.

## 6. No diagnosis/clinical language, no fabricated claims (80-AD/80-AE)

Every static string in `chatDisplay.ts` (`CHAT_DISCLAIMER`, `CHAT_EMPTY_STATE_TEXT`, `CHAT_SENDING_TEXT`, all four `SUGGESTED_QUESTIONS`) is scanned by two dedicated tests against `/\bnormal\b|sin hallazgos|no se detect/i` and `/diagn[oó]stic|tratamiento|pron[oó]stico|mejor[oó]|empeor[oó]/i` — none of the Frontend's own hardcoded text may claim a normal/negative finding or a diagnosis/treatment/prognosis, mirroring the Backend's own P10.7/67C "never reinterpret blocked as normal" rule (§ backend doc) applied here to the chat surface specifically. The LLM's own answer text is rendered verbatim (§5, item 2) — the Frontend does not post-process, summarize, or re-word it, so responsibility for following those same rules on dynamic content rests with the Backend's system prompt (see backend doc §5), not duplicated logic here.

## 7. Conversation persistence / reload

`loadConversation(conversationId)` (`useChat.ts`) calls `getChatConversation` and replaces the panel's state via `conversationLoaded`, restoring the exact persisted question/answer pairs — exercised end-to-end against the real Backend in the Docker E2E (§8), not yet wired to a visible "conversation history" picker in the UI (no such control was requested by the stage brief; `ChatPanel` today always starts a fresh conversation on mount, matching the Backend's own single-turn-per-`POST` decision, §12 of the backend doc).

## 8. Docker E2E

Exercised for real against the Backend's stage-80 E2E setup (real Postgres, real Spring Boot, a mock AI server on port 8000, and a mock LLM server on port 8001 implementing the OpenAI chat-completions response shape) — not through the rendered browser page, for the same reason stated in stages 77/78/79 (`StudyReviewView.tsx` requires a full canonical multiplanar run precondition to render at all). The exact HTTP contract this Frontend's `chatApi.ts` also calls was exercised directly: `POST /api/studies/CASE-80-B/chat` with `baselineCaseId=CASE-80-A` after a professional correction (13.1→12.9) on CASE-80-B, confirming the response's `contextSources` includes `current_analysis`, `professional_correction`, and `longitudinal_comparison`; a `GET /chat-conversations` and `GET /chat-conversations/{id}` reload confirming the exact question/answer pair persisted; a cross-Study conversation lookup rejected with `404`; a blank question rejected with `400`; a missing-auth request rejected with `401`; and the LLM provider stopped mid-flow, confirming the request degrades to `502 LLM_PROVIDER_UNAVAILABLE` rather than hanging or crashing the rest of the API.

## 9. Tests (80-AN)

`scripts/post-e50-contextual-chat-tests.mjs` (wired as `npm run test:post-e50-contextual-chat`, appended to `npm test`) — **26 tests**, all passing: empty chat state, ≥4 suggested questions (including the two exact strings from §5), sending a question shows `phase=sending` with the user's own message visible, double-submit blocked (`canSend=false` while sending), the response is appended as an `ASSISTANT` message, five error-classification cases (502→upstream, 400→functional, 404→not_found, 503→upstream, network error→network — all reusing `classifyProductAnalysisError`, none silently swallowed), conversation-history parsing (single and multiple conversations, each preserved distinctly), conversation reload repopulating messages, the disclaimer text exists and contains no clinical claim, response content is rendered literally (an `<b>` tag in the answer is preserved as literal text, never interpreted), `dangerouslySetInnerHTML={` is never used as a JSX attribute (a source-text check narrow enough to ignore the code comment that mentions the term while explaining why it's avoided — see backend/session notes on the original false-positive), Enter-without-Shift submits (regex match against the actual handler), a blank/whitespace-only question is never submittable, a very long question is *not* blocked client-side (Backend's job), `displayContextSource` translates known sources and passes through an unknown one unchanged, the two "no normal/no diagnosis language" scans (§6), a fail-closed parsing test (a response missing `humanReviewRequired` throws), and a test confirming `requestFailed` keeps the user's already-sent message rather than discarding it.

## 10. Regression

`npx tsc -b`: clean except the two pre-existing `Cannot find module 'react-router-dom'` errors (confirmed present before this stage too, same as stage 79). `npx eslint` on all new/changed files: clean. Full `npm test`: see the final report for the exact count from this run.

## 11. Limits / what stage 80 deliberately does not do

- No visible conversation-history picker in the UI yet (§7) — `loadConversation` exists and is tested/E2E-verified, but nothing in `ChatPanel.tsx` calls it today; wiring a "past conversations" list is a natural Stage-81+ addition once multi-turn conversations exist on the Backend (backend doc §12).
- No markdown/rich-text rendering of the assistant's answer — plain text only (§5), matching "preferir texto plano inicialmente" from the stage brief.
- No streaming/token-by-token rendering — the full answer is rendered only once the `POST /chat` response completes.
- No browser-rendered E2E (§8) — covered instead by 26 frontend unit tests plus a real backend-scoped HTTP E2E, same pattern as stages 77/78/79.

## 12. Next stage (81)

- A conversation-history picker reusing `getChatConversations`/`loadConversation` (§7, §11), once multi-turn continuation exists on the Backend.
- Consider surfacing `analysisId`/`baselineCaseId` pickers in `ChatPanel.tsx` itself (today only the currently-open Study's effective run is used implicitly by the Backend when neither is supplied) once real usage shows this is needed.
