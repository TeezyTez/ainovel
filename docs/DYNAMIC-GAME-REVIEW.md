# Contextual gameplay independent review

Reviewed 2026-10-10 against `docs/DYNAMIC-GAME-PLAN.md`. The workspace has no usable baseline commit, so this is a review of the resulting implementation, not an assertion about which historical change introduced each issue. No credentials, running server, user browser, or personal saves were accessed. Product files were not edited by this reviewer.

## Findings

### P1 — Deterministic costs do not yet reconcile all public records (original repro fixed)

Locations: `src/core.js:51–70`, `src/game-state.js:104–120`, `src/experience-state.js:58–77` (line numbers before the coordinated fix).

Reproduced with a valid initial coin entity (`id=coin`, value 3), a same-ID experience object (`amount=3枚`, summary `你有铜币3枚。`), and the legacy `item-add` value `铜币3枚`. Execute a saved `delta=-1` action with a successful next prose and `game:null`, omitting experience changes. The committed game value is 2, but `publicSituation()` still reports 3枚 and `state.inventory` remains `["铜币3枚"]`. `validateArchive()` accepts the resulting archive. This requires no forged receipt or dishonest next-model output: omission of unchanged/duplicated experience is enough.

The original transaction froze only game values; public records advanced independently. The coordinated fix now rejects explicit conflicting amounts/units, projects game quantities over stale public fields and summaries, and normalizes exact known legacy inventory aliases on action effects. Independent regression tests pass, including historical projection, zero quantity, ordinary-turn conflicts, and synonymous status labels. The original repro and subsequent mapping regressions below are closed.

### P2 — Decimal arithmetic can disable valid bounded actions (fixed)

Location: `src/game-state.js:97–98` (before the coordinated fix).

Reproduced a meter with value 0.1, max 0.3, and a saved apply effect +0.2. Resolution originally threw `资源不足或操作超出数值上限。` because binary floating point produced 0.30000000000000004. The fix adds the decimal representations using BigInt before conversion back to Number. Independent regression tests now confirm the valid result 0.3 and rejection of the genuinely excessive +0.20000000000000004 case. Closed for the demonstrated defect; quantities are still bounded JavaScript Number values, not arbitrary precision accounting.

### P2 — Route costs were rendered as map destinations (fixed during review)

Location: `src/game-ui.js:16`, original `mapView`.

Effects must reference the surface's entityIds, so a map with a coin/energy cost necessarily includes those resources. The original map renderer drew every referenced entity as a numbered map node and place-list entry. The UI owner now filters map nodes to places and displays non-place resources separately. The regression `map cost entities remain resource context and never become location nodes` passes in the independent targeted run.

### P1 — Public projection merges independently identified same-name objects (fixed after re-review)

Locations: new matching logic in `src/game-state.js` and `src/experience-state.js`.

Confirmed in-memory repro: register two experience items with IDs `my-key` and `shop-key`, both named `钥匙`; register only `my-key` as a game entity. The commit succeeds, but `publicSituation()` emits only `my-key`, deleting the shopkeeper's independently identified key. The fallback checks whether the game has one same-name item, not whether all source records identify a single item. Different explicit quantities on those two source objects can also wrongly trigger cross-record validation. Exact stable IDs must win; fallback matching must not absorb a second independently identified object. Reported to the state owner for correction.

Disposition: fixed. The independent original repro now preserves both IDs and passes archive replay. Regression coverage also checks independent quantities and later updates to the other object. Matching now prioritizes exact IDs and restricts fallback identities.

### P2 — Objective/agreement type mapping rejects legitimate task updates (fixed after re-review)

Locations: new `experienceKind`/`gameKinds` maps in `src/game-state.js` and `src/experience-state.js`, compared with `src/game-query.js`.

Confirmed in-memory repro: one `game` entity `id=deliver, kind=objective, name=送信约定` plus a same-ID experience object `kind=agreement` rejects the entire valid proposal with `情况记录不能改写已结算对象的身份。`. Existing recall explicitly maps agreement → objective and prompts require reusing the same object's ID, but the new reverse map permits only objective → event. Support compatible agreement/event representations and preserve an existing agreement's kind and lifecycle. Reported to the state owner.

Disposition: fixed. The independent original repro now commits, retains `kind=agreement` in public projection, and passes archive replay. The new regression also keeps terminal agreements from being reopened.

## Verified behavior

- Saved action references bind branch, version, surface, and action; old/cross-branch references and forged receipts fail before commit.
- Resource underflow, capacity overflow, unknown arithmetic, duplicate effects, and travel without an explicit directed route are rejected.
- An action is resolved for generation without mutating the saved state. Successful submission applies it once; failed generation preserves state. Archive replay re-resolves receipts, and forks rebind copied receipt branch IDs.
- The current UI resolves action availability, refreshes old cards through live regions, renders receipt-only completed turns, escapes dynamic strings, and collapses historical cards as read-only. This is code/test verification, not a completed browser interaction review.
- Recall queries use exact whole-input matching, expose detached public state, do not turn quoted dialogue or mixed story actions into local commands, and do not fabricate numeric values from legacy prose.
- `server.mjs` routes a selected gameplay action through the planned pipeline even when direct narration is configured.

Independent targeted command: `node --test tests/game-state.test.mjs tests/game-ui.test.mjs tests/game-query.test.mjs tests/game-pipeline.test.mjs tests/narrative-pipeline.test.mjs`. Result at this checkpoint: **45 tests passed, 0 failed**. The public-record and decimal repros above were additional in-memory Node executions and were not covered by that passing snapshot. Other agents are editing concurrently; a later full-suite result is separate evidence.

Scoped re-review checkpoint: **53 targeted tests passed, 0 failed** after the first state fixes. Both `test-results/dynamic-craft-archive.json` and `test-results/dynamic-map-archive.json` were independently parsed and accepted by `validateArchive()`. At inspection each contains **one generated turn and zero gameAction receipts**: these artifacts establish valid initial real-model output/replay, not a completed real-model button execution. The root agent's subsequent action/browser checks are separate pending evidence. The two re-review findings above were additional executable repros beyond those 53 passing tests.

Final scoped re-review: **57 targeted tests passed, 0 failed** after both mapping fixes and the root's additional pipeline changes. Both initial real-model archives still pass. All five concrete findings above are closed for their reproduced cases. No remaining major defect was established in this scoped review; this does not certify all possible model-generated rules or untested long-story behavior.

## Acceptance and risk bounds

The implementation delivers six contextual layouts, generic world-defined entities/actions, deterministic saved-rule effects, unknown-result attempts, inline inspection/recall, historical views, and branch/replay safety. It does not introduce payment or community functionality. These are meaningful mechanics, rather than fixed per-world RPG widgets.

It is not justified to mark the entire roadmap complete solely from passing unit tests. The reproduced state findings are closed and targeted tests pass. Final acceptance still requires the root's latest full-suite result and actual local-model generation → button → committed state loop and browser/mobile evidence. This reviewer verified the initial model archives, not the root's running browser. The plan currently keeps the acceptance boxes unchecked, so it does not falsely claim completed verification. This review does not claim coverage of an entire external product's feature inventory.

Remaining bounded limitations:

- Numeric quote validation proves that an exact quote occurs in prose and contains numeric tokens; it does not prove the semantic ownership, cost sign, recipe completeness, or truth of the model's rule. The model still defines the rule. Describe this as structurally validated, evidence-linked deterministic execution, not a general theorem that all generated gameplay rules are correct.
- Entity retention is append/update only, with a 200-entity state cap. A read-only in-memory run confirmed that adding the 201st distinct entity rejects the entire update. There is no eviction/retirement policy. Long-running stories need an explicit capacity policy; raising the cap alone also grows mandatory model context.
- The prose prompt says at most 4 actions per card while the schema/runtime allow 6. This does not break the current UI but should be aligned.
- OpenAI-compatible transport uses JSON mode and `max_tokens=outputBudget`; the default output budget is 2400, while the expanded writer may emit prose, evidence, narrative, experience, and game. Codex receives the strict schema, but the compatible-API path does not send that schema as response format. The current tests use injected model responses; they do not establish truncation rates or production success for every provider. Actual-model evidence must state which transport/configuration was exercised.
- Assistant-side work is guarded in the click handler, but the reader's busy prop currently derives from pending story generation, not `assistantJob`. During an assistant job a visible game button may remain visually enabled while its click is ignored. This is an interaction polish issue, not a duplicate-commit vulnerability.
- Scene-button responses now force `ended=false` to prevent a small completed action from closing the entire story. This also means a final-goal action button cannot itself terminate the story; natural completion/explicit closure must use a subsequent non-button path. Treat this as an explicit first-version product boundary.

## Root integration acceptance after the scoped review

Final root verification completed: 216 full-suite tests passed. The browser-exported craft archive now contains two branches, each with an actual committed action receipt; the current branch remains open after crafting. The map archive now contains two turns and one movement receipt, ending in 配电间. Both archives pass `validateArchive`. Final desktop and 390×844 responsive views have no horizontal overflow; screenshots and the exact real-model recovery path are recorded in `DYNAMIC-GAME-VERIFICATION.md`. Earlier statements about one-turn archives and pending browser acceptance describe prior review checkpoints, not the final state. The current local Codex configuration uses output budget 4000; the compatible-provider default noted above remains a separate unverified transport limitation.
