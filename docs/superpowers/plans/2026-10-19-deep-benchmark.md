# Deep Benchmark Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or subagent-driven-development. Preserve existing uncommitted work; changes are verified in this registered workspace.

**Goal:** Execute the supplied deep benchmark against the real current product, reproduce failures, repair their causes and retain honest assertion-level evidence.

**Architecture:** An evaluator-side catalog preserves source sections and hashes. A Go adapter drives the actual Service, Rust runtime and configured model against isolated PostgreSQL, while separate reads capture authoritative snapshots. Flutter behavioral tests cover interaction contracts; device evidence and independent reader evaluation remain separate gates.

**Tech Stack:** Python standard library, Go integration tests/PostgreSQL, Rust, Flutter.

**Spec:** `C:/Users/16039/Downloads/ElseLife_深度测试基准_2026-10-19.md` and `ElseLife_叙事生成改造方案_2026-10-19.md`.

## Constraints

- The user confirmed no companion ZIP exists and authorized building our own executor. Do not claim compatibility with the unavailable original executor.
- Product inputs contain only legitimate world material and player actions; case IDs, oracles, expected answers and scoring instructions remain evaluator-side.
- Go remains the sole state/commit authority; no accounts, payment or old task systems.
- Keep every failed run. Fixed model tests prove engineering boundaries, never narrative quality.
- Missing evidence stays BLOCKED/INCONCLUSIVE/REVIEW; no fabricated human, holdout, device or fault-injection results.
- Freeze inputs and record source/runtime/model/contract identities before each attempt. Local evidence hashes are not an independent external registration service.

## Review Focus

- Ask and private notes must not mutate the world or disclose private material.
- Conditional actions and reserved decisions must survive stage transitions.
- Outdated artifacts/drafts must not act on a different revision or branch.
- Genuine model rejection, malformed output and bounded repair must preserve all failed candidates without publishing them.
- Natural completion and lawful low-stakes success must remain reachable without manufactured danger.

### Task 1: Catalog and evidence executor

- [ ] Parse all 78 primary and 13 UI cases losslessly, with source line/hash and assertion-level inventory.
- [ ] Test incomplete/malformed source, missing evidence, process failure and evidence tampering.
- [ ] Provide resumable run registration and report generation without converting pending reviews to PASS.

### Task 2: Real-model adapter

**Files:** `backend/internal/experience/deep_benchmark_live_test.go`, `backend/internal/experience/testdata/deep_benchmark/`, `tools/run-deep-benchmark.sh`.

- [ ] Validate isolated initial fixtures and read them back before executing steps.
- [ ] Drive actual Service→Rust→model→review→commit; record each request/result/stage and independent DB snapshot.
- [ ] Run frozen privacy/authorization and complete quiet-success trajectory; retain failed attempts and review prose against source clauses.
- [ ] Add further fixtures and variants with explicit mode mapping and conditional-player policy, never guessing inaccessible branch outcomes.

### Task 3: Backend and UI regressions

- [ ] Reproduce benchmark boundary failures in named regression tests.
- [ ] Trace evidence to the responsible state, projection or lifecycle implementation and fix there.
- [ ] Run targeted tests, then complete relevant existing suites after changes stabilize.

### Task 4: Iteration and acceptance evidence

- [ ] Bind each observed failure, fix and rerun to exact source clauses and immutable run evidence.
- [ ] Independently review full produced trajectories, with model-assisted observations explicitly labeled.
- [ ] Report actual covered steps, incomplete trajectories and outstanding real-reader/device/holdout gates, never a blanket pass percentage.
