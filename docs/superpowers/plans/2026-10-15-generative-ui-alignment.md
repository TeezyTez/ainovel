# Generative UI Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track completion below and in the execution ledger.

**Goal:** Deliver a versioned, editable generative UI workspace with genuine progress, semantic routing, React rendering and verified recovery.
**Architecture:** Keep BranchLedger authoritative for story operations. Add an independent artifact manifest with atomic revision/state/request commits, a job event stream, and a React workbench. Keep legacy definition renderers while adding validated TSX as a separate renderer.
**Tech Stack:** Node.js, React, TypeScript, Vite, Zod, esbuild, Playwright, API SDK adapter where supported.
**Spec:** `docs/superpowers/specs/2026-10-15-generative-ui-alignment-design.md`

## Global Constraints

- User approved continuous implementation including routine decisions, tests and fixes.
- Work in the approved current workspace; preserve pre-existing uncommitted changes. Do not commit, push, publish or touch player data.
- Keep Codex login and current model configuration. A provider without content deltas emits actual stage events only.
- No generated code runs in the host or on the server. Full candidates compile and are checked before activation; sandbox retains its opaque origin and restricted bridge.
- UI state, revisions and rollback never mutate story turns, inventory, operation receipts or authoritative story version.
- New backend modules may remain ES modules for compatibility; new UI and shared protocol types use TypeScript. Schema validation lives in one Zod runtime module.

## Review Focus

| Condition | Required behavior | Owner |
| --- | --- | --- |
| Parameters change while candidate is generated | State/head CAS rejects stale state; preserve latest values | 1,4 |
| Duplicate request after process restart | Same committed result; changed payload rejected | 1,4 |
| Old job or frame sends after branch switch | Cancel or ignore; no overwrite | 1,3,4 |
| Model source imports host files or hangs | Deny imports; independent browser timeout; keep old version | 2 |
| Display refinement resembles NPC dialogue | Route using context; no unintended story submission | 4 |

## Task 1 Artifact persistence and job protocol

Files: create `src/artifacts/protocol.mjs`, `src/artifacts/store.mjs`, `src/artifacts/jobs.mjs`; tests `tests/artifact-store.test.mjs`, `tests/artifact-jobs.test.mjs`.

Interfaces:
- `ArtifactStore(directory)`; `read(scope)`, `commit(scope,{requestId,requestHash,definition,expectedHead,expectedStateRevision,state?,reason?})`, `saveState(scope,{artifactId,revisionId,expectedStateRevision,state})`, `restore(scope,{revisionId,expectedHead,expectedStateRevision,requestId})`, `history(scope)`. Scope `{owner,sessionId,branchId}`; returned record `{artifactId,head,stateRevision,state,revisions,requests}`; revision `{id,parentId,definition,createdAt,reason}`.
- `JobRegistry.start(key,{requestId,requestHash,signal},run)` returns job with `id`, `controller`, `events`, `done`; same request deduplicates, changed hash conflicts, new request aborts predecessor. Each event `{sequence,type,stage?,value?,error?}`; job runner `(signal,emit)=>result`; `get(id,key)` isolates ownership. Bounded retention and concurrency.
- All IDs/path input validated or hashed, JSON state uses existing cleanArtifactState, file manifests atomic and scoped. Revisions and state commit in one file; final request result included. Restore changes presentation head only.

- [x] Write tests for CAS, concurrent state, restart, duplicate requests, isolation, rollback, unsafe JSON.
- [x] Run tests red, implement store/jobs, run green; record commands and results.
- [x] Review interfaces and concurrency before HTTP integration.

## Task 2 Controlled React renderer and runtime checks

Files: create `src/react-artifact.js`, `src/server-artifact-build.mjs`, `src/server-artifact-probe.mjs`; modify `src/rich-interaction.js`, `src/rich-interaction-view.js`, `src/interactive-runtime.js`; relevant new tests. Root owns server routes and dynamic controller.

Interfaces:
- React node `{type:'react',title,description,source,css?,height?,initialState?}`; `source` exports a default React component, uses `react` and optional `@story/ui` only, gets existing `window.ui` state/draft bridge through a provided hook. No arbitrary host imports, network, storage or dependencies.
- `validateReactArtifact(node)` frontend-safe validation; `compileReactArtifact(node)` async returns legacy-shaped `{type:'interactive',title,description,html,css,script,initialState?,height?}` bundle. Bundle is never mistaken for model-authored legacy source or persisted into the model definition.
- `probeArtifact(renderNode,{signal,timeoutMs?,viewport?})` performs independent browser-process boot, errors/visible-content/controls/layout; returns `{ok,errors,metrics}`. Inject browser path/discovery without credentials. Source is compiled, never evaluated in Node.
- Extend existing runtime with optional `api.bundle(node)` and `api.onState(state)`; a React node awaits host build before iframe initialization, validates active frame again, retains existing legacy behavior. Runtime receives no execute authority.

- [x] First test accepted TSX, rejected imports, compile diagnostics, iframe bootstrap, state/draft, and timeout behavior.
- [x] Build renderer with fixed local React dependencies and a minimal reusable UI kit.
- [x] Run actual browser checks for React counter/allocation; corrupted source cannot replace an old artifact.
- [x] Review boundary and report exact module signatures to root.

## Task 3 React TypeScript workbench

Files: create `src/workbench/entry.tsx`, `src/workbench/workbench.css`, `src/workbench/types.ts`, `vite.config.mjs`, `tsconfig.json`; tests/browser scenarios. Root owns package.json, existing controller, index and HTTP.

Interface `mountArtifactWorkbench(element,props)` returns `{update(props),dispose()}`. Props `{title,summary,html,busy,stage,error,revisions,currentRevision,onRestore,onRetry,onCancel,onContentMount}`. React owns header, true stage indicator, expand/collapse, history/restore and errors. Legacy `html` rendered only within a stable compatibility island; `onContentMount` binds existing controls only when island content changes. Unchanged HTML must retain iframe DOM identity. Surface hidden when no title/html/job/error.

Vite library build produces `dist/workbench/workbench.js` and `workbench.css`; exports mount function, bundles React. No Node/browser globals at module import. Styling follows existing tokens, keyboard focus and reduced-motion; 390px fits without horizontal scrolling.

- [x] Write behavioral DOM/browser tests for update preserving child iframe, restore/cancel callbacks and error display.
- [x] Implement TS workbench and build configuration, then typecheck/build.
- [x] Root integrates the mount through a lazy browser import; Node tests keep legacy fallback.

## Task 4 Model orchestration and integration

Files: new `src/model-gateway.mjs`, `src/interaction-intent.mjs`, `src/artifact-client.js`, `src/server-artifact-service.mjs`; modify `server.mjs`, `src/app.js`, `src/dynamic-ui.js`, `src/server-dynamic.mjs`, `src/server-dynamic-model.mjs`, `src/interactive-artifact.js` as required. Root owns these files.

- [x] Add tests for semantic response enum/target validation, refinements routed without story actions, and ambiguous mixed inputs preserved.
- [x] Add `ModelGateway` capability-based adapter events using existing model config; do not expose raw CLI stdout, secrets, internal reasoning or private state.
- [x] Add SSE prepare jobs and read/history/state/restore/bundle endpoints under `/api/artifacts/*`, with same origin/owner/branch checks; immutable candidate and story-version checks before commit.
- [x] Add prepare hooks to DynamicInteractions for genuine phase events and candidate verification. Only react/interactive generated code enters probe; standard components remain fast.
- [x] Save accepted definitions as artifacts, explicitly migrate bounded state by validated key mapping; return artifact metadata beside authoritativeBranch. Conflict retains draft/current version.
- [x] Extend edit protocol with version-hash-checked source/definition patches and tests; existing full definitions remain accepted.
- [x] Connect workbench to current reader, history restore, server state and runtime onState; display requests do not advance story. Preserve existing pure component tests with no-browser fallback.
- [x] Export/import optional artifact records with bounded validation and isolated identities, preserving old files.

## Task 5 End-to-end verification and delivery

Files: `scripts/verify-artifact-workspace.mjs`, `scripts/eval-generative-ui.mjs`, fixture task set, README and delivery record.

- [x] Run all existing tests, typecheck and build; resolve regressions without weakening assertions.
- [x] Browser test desktop/mobile, actual first-version operation then three edits, state reload, history restore, cancel and wrong-branch isolation. Record screenshots/trace and story snapshot invariants.
- [x] Run bounded real-model acceptance in an isolated ledger when current login is available; record source/model/protocol and stage timings. Do not substitute controlled results for real model output.
- [x] Implement reproducible evaluation runner and report results separately for controlled, real model and external product observations. Cross-product account runs and human blind ratings remain explicitly unmeasured if access is unavailable.
- [x] Independent final review; fix findings; rerun affected checks and full suite when warranted.

## Execution decisions

- Backend stays on Node HTTP to preserve current transport and ledger tests; no evidence that changing server framework improves these bottlenecks.
- Use approved current worktree instead of dropping uncommitted features into a clean checkout.
- Distinct implementation tasks may run in parallel with exclusive file ownership; integration is sequential. This follows the active parallel-delegation instruction and avoids shared-file edits.
- No Git commit required by this task; preserve reviewable workspace changes.

## Delivery boundary

Engineering implementation and bounded verification are complete; exact evidence and final run counts are recorded in docs/GENERATIVE-UI-ALIGNMENT-DELIVERY-2026-10-15.md. This checklist does not certify the design document's full product-level benchmarks. Repository defaults retain the legacy path behind GENERATIVE_UI_ENABLED=false; this user's local environment explicitly enables the new workbench. External product account tests, 20-by-5 repetition, broad held-out routing and blind ratings remain open. Durable successful commits survive restart; uncommitted job event journals remain in memory.
