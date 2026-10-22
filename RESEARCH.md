# Laya integration research

Reviewed 21 October 2026. Local behavior was checked against the running Ollama installation, rather than inferred solely from online examples.

## Native Ollama contract

[Ollama's Laya documentation](https://ollama.com/library/laya) specifies `POST /v1/systemone`, with `model`, source `state`, and named typed `questions`. Its three primitives are `noul`, `choice`, and `score`. Choice uses label-to-description criteria; score uses an ordered array. The response contains named answers and probabilities. API confidence measures distribution concentration.

Implementation: separate context from question; use fixed true/false keys for Bool and label descriptions for Choice. The app offers Bool, Choice, and Ranking; the native Score primitive is no longer exposed for new decisions. Older Score exports remain readable. Ranking is a UI view of a choice distribution sorted by probability. It does not claim an additional native model primitive.

The exact [Typed Decisions](https://ollama.com/library/laya:421m-typed-decisions-bf16) and [English](https://ollama.com/library/laya:421m-english-bf16) model pages match the user's model names. The installed `/api/tags` digests also match the supplied prefixes, `84a7be5dd978` and `1f196b378202`. Ollama reported version `0.40.5`. A direct call produced valid native answers for all three primitives. `/api/decide` is not the endpoint on this installation.

## Use cases

The [official use-case catalog](https://laya.studio/use-cases) covers support operations, email screening, sentiment, policy decisions, and agent routing. This informed the six small, editable starter scenarios. The examples are original demonstration inputs, not claims of application-specific accuracy.

## Checkpoint limits

The [upstream model card](https://huggingface.co/convaiinnovations/laya) distinguishes English and task-specialized checkpoints. It reports short default sequence budgets and cautions about domain transfer, ordinal scoring, label effects, and calibration. The UI defaults to the specialized checkpoint, presents unmodified probabilities, documents token limits, and supplies no invented rationale. It does not describe estimates as certainty.

## Integration choice

Ollaya is a separate project with similar naming and a different local default port. Research results initially included its `/api/decide` examples. This app uses the user's existing Ollama daemon on port 11434 and its verified `/v1/systemone` endpoint; it installs no additional inference engine or model.

The web UI uses vanilla JavaScript; the same-origin HTTP server uses Node's standard library. This avoids browser-to-Ollama cross-origin configuration. Only two exact model names pass server validation. No cloud service participates in inference.

## Desktop and file workflow update

The app launcher owns a dedicated Electron window and its local UI server. The [BrowserWindow close event](https://www.electronjs.org/docs/latest/api/browser-window) is cancelled until the user chooses Save JSON, Save Excel, Save Both, or Discard; Cancel keeps the window open. [Native dialogs](https://www.electronjs.org/docs/latest/api/dialog) choose file destinations, and cancelled or failed saves prevent exit. The renderer uses sandboxing, context isolation, and a narrow preload bridge without Node integration. Completed exit clears temporary conversation storage and releases the server; unrelated browser windows and the shared Ollama daemon remain separate.

Conversation JSON uses an explicitly versioned format with validated inputs and distributions; older single-decision exports remain loadable. Runtime Excel export uses [ExcelJS](https://github.com/exceljs/exceljs) to create actual workbooks with numeric probabilities and literal user text. The managed window and Excel features use installed runtime npm dependencies.

## Verification evidence

- `verification/live-results.json`: real inputs, native responses, and timings for both checkpoints in all four UI modes.
- `tests/server.test.mjs`: contract mapping, validation, local-only routing, failures, UTF-8, and static-file boundaries.
- `tests/browser/studio.spec.mjs`: user workflows, real model rendering, and responsive screenshots; error-path tests use mocked responses where noted.

Timing is local observation and includes model loading on cold calls; it is not a hardware-independent performance claim. Model-response validity checks are not an accuracy benchmark.
