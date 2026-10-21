# ElseLife Narrative Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement explicit narrative stages, durable narrative memory, reviewed state changes and revision-bound preparation across the existing product.

**Architecture:** Rust owns finite generation stages. Go authorizes each stage, persists formal state and atomically consumes validated preparation. Flutter observes public progress and committed short scene beats.

**Tech Stack:** Rust/Tokio/protobuf, Go/PostgreSQL/sqlc, Flutter/Dart.

**Spec:** `docs/superpowers/specs/2026-10-19-narrative-engine-design.md`

## Global Constraints

- Go is sole formal authority; Rust never accesses business SQL; Flutter never owns world state.
- Preserve existing uncommitted work and the preexisting prompt-engineering document.
- New production pipeline fails closed; no prose-only fallback or retries to make the player win.
- All contract copies, hashes, generated code and validators remain synchronized.
- At most 12 model calls, 2 actor calls and 1 revision attempt per operation.
- Do not expose hidden notebook, candidate, author attachments or reviewer reasoning in public progress/preparation.
- No credentials, real user stories, database or build cache in version control.

## Review Focus

- An offstage actor must not receive raw input or another character's private author material.
- A reviewed candidate must not be changed between approval and commit.
- A late prepared result cannot cross revision/fence/preferences/author boundaries.
- Historical branch/archive restoration must retain the corresponding notebook without leaking it through ask.
- Interrupted requests and temporary feedback must recover with the original request ID.

### Task 1: Shared contracts and design

Owner: root. Files: canonical JSON/proto, all snapshots/pins/generated protobuf, `tests/test_narrative_engine_contract.py`.

- [x] Add failing schema tests for typed notebook, pipeline and reading_request; reject unknown fields, future or wrong-type values where structural constraints apply.
- [x] Add optional State.narrative, Candidate.narrative_update, Context.pipeline/reading_request and typed definitions.
- [x] Add protobuf stage and actor fields, regenerate Go binding and synchronize Rust build inputs/hashes without weakening drift checks.
- [x] Verify Python schema tests and contract consistency (15 tests pass; new tests first produced four expected failures).

### Task 2: Go authority, persistence and preparation

Owner: architecture_backend. Files: experience types/state/pipeline/preparation/service/algorithm, HTTP, migration/schema/sqlc, product-dev.

- [x] Write tests for notebook reference validation, reader stripping, strict approval binding and stage FSM; observe failures.
- [x] Implement typed notebook and Apply semantics, stage-aware model dispatch including actor projection, strict v4 commit.
- [x] Add preparation SQL with lease/pin/digest/claim conditions and progress fields; regenerate sqlc.
- [x] Integrate background preparation, cancellation, cache consumption, reading_request and public endpoints.
- [x] Verify unit tests and isolated PostgreSQL tests including race/fence/mismatch cases; report commands and evidence. `go test ./...` passed; focused PostgreSQL regressions with `-race -tags=integration` passed in 13.522s; actual Rust plus synthetic model approval/repair/cache/ask integration passed in 5.031s. Parent independently ran all Go integration tests with race detection (318 passed, one expected helper skip), build and vet. Latest actor historical-recall regression and full 12 KiB notebook/7.8 KiB scene through actual Rust review passed with race detection in 8.815s.

### Task 3: Rust explicit generation pipeline

Owner: generation_audit. Files: new focused narrative modules, experience types/channel, tests.

- [x] Write failing stage tests using explicitly labeled synthetic model responses: actor projection, candidate selection, exact extraction, review rejection and one repair budget.
- [x] Implement memory, actor, plan, evaluate, write, extract and review stages with typed intermediate outputs and public stage metadata.
- [x] Preserve bounded original-history reads, enforce total budget, strict candidate generation, independent ask path.
- [x] Return narrative_update with validated source references and stable writer/extractor text.
- [x] Verify default/no-default Rust tests and real runtime transport integration. Final default 80 tests and no-default 74 tests passed; complete six-stage runtime wire fixture, near-capacity carrier/provider checks and explicit runtime build passed. Final logs: `.validation/narrative-rust-default-final.log`, `.validation/narrative-rust-no-default-final.log`.

### Task 4: Flutter public progress and feedback

Owner: implementation_review. Files: experience models/client/controller/waiting/feedback and tests.

- [x] Write tests for monotonic progress, stale preparation polling, no uncommitted text, and recoverable one-turn reading_request.
- [x] Add typed progress/preparation, small isolated polling lifecycle and user-facing phase copy.
- [x] Preserve committed-page rendering and journal recovery; add “用于下一段” separate from long-term preferences.
- [x] Verify Flutter tests/analyze and release web build. Final full suite 275 passed, including initial-record display and 10-minute preparation polling regressions; analyze 155 info, no errors/warnings; release web build passed.

### Task 5: Integration, review, real model evidence and local switch

Owner: root with independent reviewer after implementation tasks complete.

- [x] Run Go/Rust actual runtime + PostgreSQL tests with fake model explicitly labeled as protocol evidence. Full Go race suite 318 passed, one expected harness skip; build/vet passed. Later historical-recall and large-notebook cases passed targeted race checks.
- [x] Run real model sequential story and prepared-read comparison, retain every failure and phase latency. Two original failures retained; four continuous formal pages plus an exact-history isolated replay with prepared read and ask. Preparation 181.168s, cache claim/commit 100ms/zero model calls, ask 33.095s/state unchanged. Cold generation remains slower; no overall literary-quality success claim.
- [x] Review whole diff against spec, resolve blocking issues, run affected tests and final build/checks. Independent Go/Rust review and reading review completed. Final Rust 80/74; Flutter 275, analyze no errors/warnings, web build; Go full race plus targeted follow-ups; Python15 and contract check.
- [x] Update architecture and validation records with actual results and limitations. See notes/2026-10-19-narrative-engine.md and narrative-engine-samples.md.
- [x] Switch local services only when no active generation; verify migration and running binary identity. Known Go/Rust processes stopped gracefully; additive migration applied, contract/binary identity and Windows HTTP200 verified. No public deployment or Git commit/push.

## Progress ledger

- Design: explicit refactor authorized by user; execution continues in existing registered dirty workspace to preserve prior work.
- Ruling: use atomic short scene pages plus next-read preparation instead of exposing uncommitted paragraphs; cost is that first scene still waits for its own review.
- Ruling: notebook remains a private versioned part of existing state; formal facts are not duplicated into a second authority.
- Ruling: extraction uses a small `{result:{candidate_json:string}}` transport schema followed immediately by strict canonical decoding; cost is that the provider cannot enforce nested candidate shape before local validation.
- Ruling: actor input receives current text only for a fully matched, directly addressed quoted utterance; ordinary private/natural-language actions are not forwarded wholesale. Cost: some same-turn reactions remain director/reviewer work until supported by committed observations.
- Ruling: notebooks are limited to 12 KiB; omitted references can defer in an explicitly incomplete generation view, while Go validates against complete authority. Cost: detailed old prose still requires source recall.
- Concurrent edits: world-draft/author-world retry and portal settings/studio files appeared during implementation and both workers confirm they are external to this task. Preserve them and do not attribute or overwrite them.
- Real-model attempt 1: first formal page committed in 184.423 seconds over six calls; the next act failed because Rust allowed fewer actor fact references than Go supplied. Evidence retained in `.validation/narrative-evaluation/v4-20261019T072916Z/engine-v4.json`; this attempt predates the added gameplay guide and reveal-support checks. No overall speed or quality improvement claimed.
- Independent review found explicit reveal evidence missing, JSON object key-order mismatch across Go/Rust, cancelled preparation blocking the next revision, and insufficient v4 aggregate capacity reserve. All are being handled with targeted regression checks before acceptance.
- Task 2 review fixes are implemented with regressions: typed reveal quote coverage, canonical JSON comparison preserving integer precision, token-owned cancellation cleanup, separate ready TTL (20 minutes), and the v4 aggregate reserve (36 KiB plus a second 4 KiB schema allowance). Historical recall does not become current actor evidence; current recall remains usable. A full 12 KiB notebook plus the latest short page fits the configured 65k context, while an unsupported 49k context fails before model calls.
- Task 2 limits: a read accepted before preparation is ready cancels that work and regenerates under its new fence; only a ready hit avoids model calls. Preparation runs once after a successful non-ask, non-ending formal commit and never recursively dispatches itself. Quote coverage establishes literal evidence and reviewed binding, not a proof of narrative semantics. Synthetic protocol tests do not establish literary quality or real-model latency.
- Prompt follow-up during live attempt 2: immutable entity descriptions and related IDs are now explicitly initial identity anchors; more recent formal facts determine current ownership/location/relationships. Extraction now directs mutable details into facts/reader and stable identity into new entity descriptions. Existing history is unchanged. The running live process predates this guidance; subsequent rebuild SHA-256 is `6d9a2124cd83e150e683def309f639db4ae5de662a8e413ee3445d4decd0ed4c`. Related capacity, pipeline and official-wire suites passed 26 tests (`/tmp/elselife-v4-entity-anchor.log`); no new real-model quality claim is made for this prompt adjustment.
