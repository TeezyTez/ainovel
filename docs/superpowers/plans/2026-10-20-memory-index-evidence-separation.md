# Memory Index / Evidence Separation Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans task by task. This continues the user's approved development scope; no new permission request is needed. Preserve the existing dirty workspace and sealed evidence.

**Goal:** Separate literary retrieval summaries from actual source evidence, without weakening independent semantic review, character knowledge, source binding or commit safety.

**Architecture:** Go registers sources present in each final stage request and resolves approved memory source selections into durable references. Rust produces a versioned interpretation delta and independently reviews it against the actual evidence. Existing formal history, read budgets, stage machine, preparation handoff and atomic commit remain authoritative.

**Tech Stack:** Go, Rust, PostgreSQL/sqlc, shared JSON Schema, Python contract tests; existing Flutter archive entrypoint.

**Spec:** [Accepted specification](../specs/2026-10-20-memory-index-evidence-separation.md).

**2026-10-20 implementation status:** A–E are integrated in v4.13. Full backend race/integration validation is 1148 PASS / 26 explicit SKIP / 0 FAIL; Rust default/no-default are 151/145 PASS; Python is 104 PASS. The final `repair_state` carrier gap has a preserved RED, corrected-test GREEN and independent closure. Detailed evidence and limitations: [v4.13 validation record](../../../notes/2026-10-20-memory-evidence-v2-validation.md). The original task checklist below is retained as the implementation breakdown; source freeze, real-model runs and semantic acceptance remain separate F-stage work.

## Global constraints

- The running v4.12 batch uses its immutable source copy/runtime. Never edit that copy, old runs, manifests or failures.
- Only one product model pipeline. This implementation adds no live calls until its engineering checks pass and the existing batch exits.
- Preserve the existing maximum 12 model calls, one shared repair, read limits, one read per stage, candidate 24,576-byte and passage 8,192-byte ceilings.
- Retain original ID/kind/known_by/authority checks. New source IDs grant no character knowledge.
- Keep new engine generation disabled until representation, final-request binding, storage, archive and failure paths all work together.
- Use fixed providers for protocol tests and label them synthetic. Their passing is not literary acceptance.
- Test first. A missing import, broken harness or compile error is not evidence that the intended behavior failed. Save actual RED and GREEN results separately.
- Product builds and DB suites are serialized by the root agent; do not start them independently or compete with the active benchmark. Python contract tests can run without a product build.
- No automatic commit of unrelated preexisting work. Root integrates the owned files and records exactly which checks ran.

## Review focus

1. A valid preparation result has a different consumer request/fence; legitimate handoff must work while arbitrary reuse fails.
2. The same passage with changed memory or knowledge state must get a new full-candidate approval.
3. A source available in storage or fetched by an earlier stage is not automatically present in this request.
4. Missing required pages must leave an initial review opportunity to ask for a read; partial/remote-range acquisition limits must not be disguised as byte overflow.
5. Author Repair and archive Apply have no live review credential; new source references must not gain authority through these paths.

## A. Closed representations and durable-source foundation

**Owned files**

- `tools/update_memory_evidence_contract.py` (new focused additive updater).
- `contracts/experience/v1/contract.json` and the existing three snapshots/pins.
- `backend/internal/experience/literary_memory.go`, new `literary_memory_v2.go`, corresponding tests.
- `backend/internal/experience/memory_invalidation.go`, tests.
- `backend/internal/experience/types.go`: only `Candidate.MemoryDelta` and memory-specific typed fields; coordinate other edits with root.
- `tests/test_memory_evidence_contract.py` (new).

**Interfaces**

- `MemoryInterpretation`: current interpretation fields, plus optional `LocatorQuote`; no revision/hash/permission fields.
- `MemoryDelta {Version int, Entries []MemoryInterpretation}`; version exactly 2, max 12 entries.
- `MemoryEvidenceRef`: closed formal-page or authority-fact reference.
- `MemoryEntry` accepts the old v1 shape and explicit v2 `legacy_v1` / `source_refs_v2` shapes. Existing field access may be retained internally, but canonical output must match the closed variant.
- Helpers expose latest source revision, complete durable dependency chain and legacy representation without converting old fact IDs into certified record hashes.
- No independent generation source resolver here: new v2 writes require the root's verified approval results. Do not create a temporary fallback just to make tests pass.

**Steps**

- [ ] Add Python shape tests for valid new delta, field-presence exclusivity (including empty old/new), null/unknown version, forbidden model hash/known_by, and v1 compatibility. Run against unchanged schema and save the expected behavioral rejection of valid v2.
- [ ] Add the focused updater preserving all v1 definitions and unchanged runtime protobuf; produce the four byte-identical JSON snapshots and pins. Re-running must be idempotent.
- [ ] Add Go representation tests: empty delta is distinct from absent; ask rejects even empty delta; legacy conversion preserves every original field; source-ref variants reject impossible combinations.
- [ ] Implement versioned types and canonical serialization. Candidate interpretation and formal provenance are separate.
- [ ] Implement complete dependency retention and invalidation over page refs, fact as-of refs and legacy sources. Fact edits retain current conservative invalidation.
- [ ] Run the targeted tests when root releases the build slot; preserve RED/GREEN, not just the final passing output.

## B. Current-request evidence compiler

**Owned files**

- New `backend/internal/experience/memory_evidence.go` and tests.
- `context_materials.go`, `memory_sources.go`, `source_reader.go` only for evidence compilation/source access integration.
- Shared context material v2 definitions: coordinate with A's updater owner.

**Interfaces**

- A source registry contains operation-local source IDs, source kind, payload location and Go provenance; it is rebuilt from the final request.
- Registry kinds: candidate, formal_page, authority_fact. Candidate new_facts are never registered as formal facts.
- `MemoryEvidenceRequirements(candidate, authority)` returns recent-update page requirements only for old IDs actually updated by this candidate.
- Registry/required results are input to C's approval verifier. Persisted refs never contain temporary source IDs.

**Steps**

- [ ] Add fixed-request tests: present page vs locator-only; a previous-stage read without reinstallation; same text/different revision; new candidate facts vs authority; conflicting duplicates.
- [ ] Build registry only after validating original input, reconstructing materials and exact de-duplication. Each compilation retry rebuilds it; dropped payload must lose its source ID.
- [ ] Selectively reinstall required data from already verified same-operation ReadReply cache. Preserve original reply/receipt and count its previous read use; expose a distinct evidence projection, not a fabricated reply. Do not cache internal source-validation SQL as model-readable evidence.
- [ ] Handle required statuses separately: initially missing may reach review to request one read, but cannot approve; after-read missing/acquisition-limited fails; known over-capacity fails. Do not enforce the newly produced old ID against extract's prior input.
- [ ] Test required recalculation after repair adds/deletes old IDs, and r3/r80 acquisition gaps where the target pages fit but a contiguous one-read range cannot deliver both.
- [ ] Measure exact final directory+schema+messages bytes. Retain latest-page continuity and required fact/knowledge sidecars, original reconcile order, and final provider capacity check.

## C. Approval, source resolution and lifecycle

**Owned by root**

- New `backend/internal/experience/memory_evidence_approval.go`, tests.
- `narrative_pipeline.go`, `algorithm.go`, `service.go`, `narrative_preparation.go`, their focused tests.
- Existing SQL query files/sqlc only if an additional query is actually necessary; prefer existing approval JSONB.

**Interfaces**

- `NarrativeApproval.Evidence` is private versioned Go data: origin, full candidate hash, stage/provider request bindings, source registry and strictly re-derivable per-memory resolved refs.
- A narrow Go-only reader interface provides trusted operation/preparation origin. Never infer request/fence from frame strings or model context.
- Full fact hashes use the existing Go canonical receipt JSON rule (integer precision, object key order, unchanged arrays).
- V2 memory supports select `source_ids` from the current registry, cover every delta entry exactly once and include the current candidate.

**Steps**

- [ ] Add tests for wrong/full-candidate bindings, false-result credential reuse, unprovided source IDs, overwritten registry IDs, and same-passage state-repair reuse.
- [ ] Preserve stage_request protobuf hash separately from final model.Request hash. Capture the latter after author_world attachment and VerifyContextBudget, immediately before Generate. Both refer to the same call; capacity rejection does not claim dispatch.
- [ ] Resolve selections from the actual review registry, reject unsatisfied required pages at approval, and store a self-contained approval. Source IDs alone never enter Apply.
- [ ] Clear registry/approval binding on each review and after candidate changes. Review source validation does not turn IDs/hashes into proof of entailment.
- [ ] Serialize through ready preparation, consume and normal operation. Preserve preparation origin; verify the existing DB single-claim handoff instead of relabeling it as the consumer.
- [ ] Apply v2 only with trusted resolved dependencies. Before formal commit, recheck operation/preparation handoff, branch/base/fence/lease and durable source identity. Page, state, index, approval and operation outcome commit atomically.
- [ ] Test ready and in-progress claims, changed preference/pin/fence, expired/restarted preparation, cancellation and transaction rollback; no fresh generation fallback or new crash replay.

## D. Archive and author-edit boundary

**Root / storage owner coordination**

- `archive.go`, `author_edit.go`, `branches.go`, related tests.
- Frontend archive format checks, if present.

**Steps**

- [ ] Add archive v1/v2 round-trip tests, v2 fact as-of/hash mismatch, valid inherited branch, edited-page invalidation and legacy preservation.
- [ ] Export archive version 2 when v2 memory is present; read versions 1/2. Validate formal pages and full fact records using each ArchivePage.State.
- [ ] Keep archive source validation separate from historical review certification. Do not synthesize approval from imported labels or hashes.
- [ ] Reject memory_delta in author Repair, including empty delta, before structural ReviewCandidate/Apply; remove it from author-assist schema. Retain other author repair functionality.
- [ ] Keep archive Repair replay consistent with this boundary. No `skip_review` switch or trusted-caller string fallback.

## E. Rust types, stage contracts and semantics

**Owned Rust files**

- `algorithms/src/literary_memory.rs`, `experience.rs`, `narrative_pipeline.rs`, `narrative_extraction.rs`, focused tests.
- Pins only by A; no competing updater.

**Steps**

- [ ] Add typed tests for memory_delta/v1 mutual exclusion, new state variants, exact frozen draft rehydration, and malformed v2 supports. Retain old recording decoders without letting the new engine produce v1 changes.
- [ ] Emit delta from extract, repair_extract and repair_state; use source_ids in memory supports. Enforce shape, coverage and immutable candidate binding; final Go-injected registry membership belongs to Go.
- [ ] Replace the old memory quote-sufficiency instructions consistently. Summary truth/conditions/knowledge are still reviewed; locator is not evidence sufficiency. Keep fact/knowledge/reveal support edges unchanged.
- [ ] Preserve read scheduling, reserved remaining calls and the single repair. A missing required page can request an existing read; no added retry or cursor loop.
- [ ] Run actual stage-schema/capacity controls and recorded positive/negative tests; new schema bytes count against the current ceiling.

## F. Integration, freeze and original live validation

- [ ] Integrate A–E without enabling a partially closed path. Update Go/Rust engine versions together only when the complete chain is ready.
- [ ] Run shared Python contracts, targeted Go/Rust tests, actual Rust→Go fixed-provider integration, archive/claim/fence fault controls, then the normal full backend/Rust checks. Record explicitly skipped checks.
- [ ] Run reviewer-owned static checks over the final diff and fix actual source/authority/budget defects.
- [ ] Freeze all actual source inputs and independently bind build/runtime. Never mix this new source with v4.12 live results.
- [ ] After the current serial batch finishes, run unchanged original real cases with existing budgets; preserve every failed output and formal write boundary.
- [ ] Independently audit summary support and character knowledge, including the accepted design's seven semantic counterexamples and subsequent retrieval→commit. Do not infer quality from valid source IDs or zero repair.
- [ ] Report execution completion, formal commits, semantic findings, late retrieval, latency and byte counts separately; retain REVIEW where literary acceptance is missing.

## Work coordination and current state

At plan creation the v4.12 run has sealed NAR-010 (10 commits, REVIEW), sealed NAR-017 (4 commits then S05 operation deadline, FAIL), and started NAR-014. That run remains the only live pipeline. Its failed S05 choice is not formal history.

The root owns integration, approval/lifecycle and build scheduling. Independent workers own closed contract/storage and Rust code only after receiving explicit file ownership; the NAR-014 reviewer continues reading the immutable run. No task may edit another worker's files or start another live model.
