# Execution ledger — plan: docs/superpowers/plans/2026-10-15-generative-ui-alignment.md

User approved the written spec and continuous implementation without stage-by-stage confirmation.

## Preflight

| Tasks | Shared interface / check | Decision |
| --- | --- | --- |
| 1 → 4 | ArtifactStore scopes and atomic commit | Owner/session/branch; head and stateRevision checked together |
| 2 → 4 | compile/probe and runtime bundle API | React source persists; compiled bundle stays server-side/cached |
| 3 → 4 | workbench props and stable compatibility island | Root integrates lazy import; no direct controller edits by worker |
| 1 | persistence tests vs manifest implementation | Restart, duplicate request and state conflict covered |
| 2 | runtime validation vs supported source | TSX only with fixed imports; legacy unchanged |
| 3 | UI state vs DOM identity | Unchanged content must preserve iframe |
| 4 | route/stream vs story authority | Preparation and rollback cannot commit story operations |
| 5 | measurements vs claims | Separate deterministic, live model and external product evidence |

Ruling: use current branch codex/multiverse-design with existing uncommitted work — approved spec depends on it — do not reset or commit unrelated changes.
Ruling: parallelize exclusive-file tasks under active developer delegation guidance; root integrates shared files sequentially.
Baseline: 120 relevant tests and 674 full-suite tests passed before implementation. Evidence: test-results/frontier-alignment-full-baseline-2026-10-15.log.

## Status

- Task 1: implemented — atomic manifests, CAS, replay receipts, cancellation fences, bounded events, archive import; focused 38/38.
- Task 2: implemented — React TSX build, fixed imports, sandbox runtime, independent browser probe and process timeout; saved-state and textarea regressions included.
- Task 3: implemented — React/TypeScript/Vite workbench; stable iframe island, history, cancel, export/import. Browser component 7/7.
- Task 4: integrated — semantic routing + candidate in one response, exact patches, typed SSE replay, state migration, durable metadata, recovery and artifact archive endpoints. Existing story ledger remains authoritative.
- Task 5: engineering verification complete; exact final suite counts and live evidence are recorded in docs/GENERATIVE-UI-ALIGNMENT-DELIVERY-2026-10-15.md. Desktop/mobile controlled app path and bounded actual model acceptance were run. Full external product and statistical benchmarks remain unmeasured.

## Review fixes

- Read/reconcile and state saves now hold the story ledger lock.
- Replay/restore project the current durable head, retaining the original receipt separately.
- Commit fencing prevents late cancellation from reporting an already committed result as cancelled; failed ledger projection recovers from the artifact manifest.
- Serialized terminal events reference current results instead of retaining entire stories; oversized payload cannot hang a job.
- Initial defaults no longer overwrite saved parameters. Explicit bounded key migration supports renamed parameters.
- All remaining real free input reaches semantic routing after deterministic local/query commands, including first-artifact requests.
- Same-content revision changes rebind the sandbox via head identity; offscreen readiness has a timer fallback instead of relying solely on animation frames.
- State-save failures are scoped by branch and have an explicit retry/recovery path.
- Retry completion checks scope, head and failure identity again after every awaited write; late responses cannot update another branch or clear a newer failure.
- Key migration reads values from the original snapshot after removing all mapped source keys, preserving swaps and chains.
- Large bounded archives use a separate hash budget; duplicate import is checked before candidate probes.
- Candidate probes receive the exact migrated state that will be committed; textarea and its bounded form attributes survive the legacy sanitizer.
- The migration flag defaults off in the repository; this local .env explicitly enables it. Before config is ready, send preserves input. Legacy generation neither advertises nor accepts unverified React.
- Independent final re-review found no additional P1/P2 in its requested scope.

## Measurement boundary

Controlled fixtures exercise the real UI, compile/runtime, server and storage but bypass model generation and candidate probe in that one verifier. Independent probe tests exercise actual browser processes separately. These are not measurements of model quality or ChatGPT/Claude product parity. External product same-prompt runs and blind quality ratings remain unmeasured.
