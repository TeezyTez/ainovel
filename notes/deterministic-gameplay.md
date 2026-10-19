# Deterministic gameplay integration

The original dynamic-rule, game-state, spatial-state, journey-state and experience-state modules are fixed calculators. They receive bounded JSON and return candidates; they have no database access and do not run model-authored scripts. Go is the only writer of formal pages, branches, state and operation receipts. React source is compiled by the separate constrained compiler and executes only in the client sandbox.

## Execution

`POST /v1/experiences/{experience}/artifacts/{artifact}/execute` accepts:

```json
{"request_id":"unique-id","branch_id":"branch-id","expected_revision":1,"revision_id":"artifact-revision","definition_digest":"sha256","kind":"dynamic","reference":{"interactionId":"definition-id","revision":1,"actionId":"action-id","targets":["resource-id"],"scope":{}},"params":{}}
```

The dynamic reference uses the exact saved definition scope and action targets. For game and journey, reference is `{branchId,version,surfaceId,actionId}`; journey uses surfaceId `$journeys`. The server derives effects from the saved definition and current formal ledger. Clients cannot submit resulting resource values, a receipt, a candidate, or a replacement world snapshot.

Success is HTTP 202 with the ordinary Operation directly. It uses the existing global receipt, cancellation, recovery and unknown-outcome journal. The same request ID and body return the existing operation without a second charge or model review. A reused ID with different content conflicts. Current branch revision and artifact head are checked before acceptance and under the transaction lock. One operation occupies the branch until terminal.

A source-rule resolution and one bounded semantic model review precede acceptance. Review checks evidence, ownership, authorization and complete costs, and cannot repair a proposal or fabricate success. The accepted source definition, baseline, exact resolution and action are privately pinned beside the operation. The regular Rust/Go narrative contract generates and validates the candidate. Go replays the same fixed calculator under the branch lock and compares the resulting ledger before committing the formal page and receipt atomically. A generation or replay failure leaves formal history unchanged.

Dynamic and game actions cannot change story time, create facts/entities/threads, or reveal knowledge as a side effect. Their narrative describes the fixed result. Journey settlement uses the original quoted route costs and time bounds, actual transit and arrival location, and the updated clock. Overspending, model resource overrides, unsupported new inventory grants, and elapsed time beyond the quote are rejected.

## Public and private state

Optional canonical `State.gameplay`, `Candidate.gameplay_update` and `Context.gameplay_action` preserve old documents without these fields. Nested game/spatial/journey/experience values use the original source structures. The canonical extension retains every previous required field and rule; it does not replace the old contracts. Codex receives only its strict transport conversion, while Rust and Go retain the original semantic validation.

Current View.gameplay and Reader.gameplay are public validated gameplay state. Each historical Page.reader.gameplay comes from that page's own snapshot, never the current branch. Author-world secrets remain outside these projections and are only restricted input to the semantic review/model channel.

Committed pages include `gameplay_receipt`: schemaVersion, request_id, artifact_id, artifact_revision, definition_digest, kind, action_id, base_revision, revision, result, changes, location, and optional transit. Changes contain entity_id, kind, before and after. These are committed facts, not a browser preview. Historical controls remain non-executable.

## Persistence and upgrades

Migration `00158_experience_gameplay.sql` only adds `experience_gameplay_operations`, linked to the existing operation by account/request ID. It stores private baseline/replay/action and committed receipt. `product-dev --migrate-artifacts` applies both the presentation migration and this additive gameplay migration before the updated service starts. It does not reset existing story data.

The complete archive includes per-page and branch gameplay state and committed receipts. Import validates bounded original-source snapshots, revision metadata and receipt changes against their page states before writing. Existing experience IDs are preserved on retry. Pending gameplay operations are not imported; no latent action is executed during restoration.

`payload.capabilities.deterministic` is emitted by the new server context after this implementation is deployed. Old stored presentations may retain false until explicitly regenerated; the browser must never infer authority from a source action alone.

## Natural input and historical presentation pins

`POST /v1/experiences/{id}/artifacts/prepare` additionally accepts `input_routing:true`. It bypasses display-cache reuse and returns `intent_decision:{kind,target,message}` plus `routing_scope:{request_id,experience_id,branch_id,base_revision}`. Kinds are the original `create`, `edit`, `story`, `mixed`, and `clarify`. Edit targets must match the current artifact ID. Create/edit and their output are generated in one model call; story/mixed/clarify require null output and only save an idempotent response receipt, without changing any attachment or story.

After `story`, `POST /v1/experiences/{id}/artifacts/input` accepts `{request_id,branch_id,expected_revision,input}`. Its response includes `input_decision:{kind,message,execute?}` and the same routing scope. It first runs the original unique exact input/label/journey-option matcher. Otherwise it interprets against up to 16 saved same-scope contracts, with up to three older contracts as non-executable context. Rule selection must be unique and parameters pass the original source validator. Missing contracts can trigger one preparation and one interpretation; ambiguous saved rule selection is rejected; repeated compose becomes an explicit free attempt rather than a retry loop.

An execute decision contains `{artifact_id,branch_id,expected_revision,revision_id,expected_head,definition_digest,kind,reference,params}`. The client persists a separate stable operation request ID before submitting this plan to `/execute`. `expected_head` is optional for older button clients, defaulting to `revision_id`; natural-input plans provide it explicitly so a saved earlier rule can be selected while the latest head is independently protected by CAS. `attempt`/`unrelated` retain the original input for the regular story path. `clarify` preserves the draft. Unknown routing responses must be recovered with the same request ID, never automatically converted into a story action.

Each newly committed page freezes its predecessor's current artifact identity and local state in private storage metadata under the formal branch transaction. GET projects that association onto the predecessor as `interaction_snapshot:{artifact_id,revision_id,origin_branch_id,base_revision,state_revision,state}`. No model candidate or browser can supply this association. The browser retrieves that exact version under `origin_branch_id`, checks its scope, and uses the frozen local state in a read-only historical view. Forked pages keep their source branch identity; later edits in the source branch do not alter the fork's pin. The archive preserves these associations and verifies same-experience ancestor ownership, revision bounds, existing artifact versions, and bounded safe JSON state. Existing stories without a historical pin are not retroactively guessed from their latest layout.


Explicit source attempt buttons may add `dynamic_attempt:{definitionDigest,scope,interactionId,revision,actionId,targets,params}` to `/artifacts/input`. The server verifies the same-scope saved definition, attempt mode, exact target list and original parameter rules without a model call. It returns only an attempt decision; the client still submits the unchanged original input as a separate regular story operation. This reference never grants effects.
