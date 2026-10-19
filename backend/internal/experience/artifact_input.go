package experience

import (
	"context"
	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/sqlc/pgq"
	_ "embed"
	"encoding/json"
	"time"
)

//go:embed artifact_input_prompt.txt
var sourceArtifactInputPrompt string

type ArtifactInputRequest struct {
	DynamicAttempt   json.RawMessage `json:"dynamic_attempt,omitempty"`
	RequestID        string          `json:"request_id"`
	BranchID         string          `json:"branch_id"`
	ExpectedRevision int64           `json:"expected_revision"`
	Input            string          `json:"input"`
}
type ArtifactInputDecision struct {
	Kind    string         `json:"kind"`
	Message string         `json:"message"`
	Execute map[string]any `json:"execute,omitempty"`
}
type artifactInputModelDecision struct {
	Kind             string          `json:"kind"`
	InteractionID    *string         `json:"interactionId"`
	DefinitionDigest *string         `json:"definitionDigest"`
	ActionID         *string         `json:"actionId"`
	Params           json.RawMessage `json:"params"`
	Message          string          `json:"message"`
}
type inputContract struct {
	Document   *ArtifactDocument
	Definition map[string]any
	Digest     string
}

func (s *Service) InterpretArtifactInput(ctx context.Context, a, e string, r ArtifactInputRequest, i *FeedbackInterpreter) (ArtifactResponse, error) {
	if !keyOK(r.RequestID) || !keyOK(r.BranchID) || r.ExpectedRevision < 1 || !textOK(r.Input) || len(r.Input) > 24000 || len(r.DynamicAttempt) > 24000 {
		return ArtifactResponse{}, fail("invalid_input")
	}
	d := digest("artifact-input", e, r)
	if previous, err := artifactPrior(ctx, pgq.New(s.DB), a, r.RequestID, d); err != nil {
		return ArtifactResponse{}, err
	} else if previous != nil {
		return *previous, nil
	}
	v, err := s.Get(ctx, a, e, r.BranchID)
	if err != nil {
		return ArtifactResponse{}, err
	}
	if v.Revision != r.ExpectedRevision {
		return ArtifactResponse{}, fail("revision_conflict")
	}
	before, err := s.GetArtifact(ctx, a, e, r.BranchID, "", "")
	if err != nil {
		return ArtifactResponse{}, err
	}
	public := artifactPublicContext(v, len(before.Revisions)+1)
	if len(r.DynamicAttempt) > 0 {
		if err := s.validateContractAttempt(ctx, a, e, r, v, before, public); err != nil {
			return ArtifactResponse{}, err
		}
		before.InputDecision = &ArtifactInputDecision{Kind: "attempt"}
		before.RoutingScope = &ArtifactRoutingScope{RequestID: r.RequestID, ExperienceID: e, BranchID: r.BranchID, BaseRevision: r.ExpectedRevision}
		return s.commitArtifactIntent(ctx, a, e, ArtifactPrepareRequest{RequestID: r.RequestID, BranchID: r.BranchID, ExpectedRevision: r.ExpectedRevision}, d, before, nil)
	}

	// Exact matching is the original fixed source function, including journey offers.
	match, err := s.Artifacts.run(ctx, map[string]any{"op": "gameplay-match", "revision": v.Revision, "before": v.Gameplay, "input": r.Input, "branchId": r.BranchID, "facts": public["facts"]})
	if err != nil {
		return ArtifactResponse{}, fail("action_not_authorized")
	}
	var matched struct {
		Reference map[string]any `json:"reference"`
		Mode      string         `json:"mode"`
	}
	if StrictJSON(match, &matched) != nil {
		return ArtifactResponse{}, fail("invalid_artifact")
	}
	var result ArtifactInputDecision
	if matched.Reference != nil {
		reference := matched.Reference
		if matched.Mode == "attempt" {
			result = ArtifactInputDecision{Kind: "attempt"}
		} else {
			before, err = s.ensureInputArtifact(ctx, a, e, r, v, before)
			if err != nil {
				return ArtifactResponse{}, err
			}
			kind := "game"
			if reference["surfaceId"] == "$journeys" {
				kind = "journey"
			}
			result = ArtifactInputDecision{Kind: "execute", Execute: inputExecutionPlan(before.Artifact, before.Artifact, kind, reference, map[string]any{})}
		}
	} else {
		composed := false
		for {
			contracts, previous, err := s.inputContracts(ctx, a, e, r, before)
			if err != nil {
				return ArtifactResponse{}, err
			}
			var game struct {
				Entities []any `json:"entities"`
			}
			if v.Gameplay != nil {
				_ = json.Unmarshal(v.Gameplay.Game, &game)
			}
			if len(contracts) == 0 && len(game.Entities) == 0 {
				result = ArtifactInputDecision{Kind: "unrelated"}
				break
			}
			decision, err := s.interpretInputModel(ctx, i, public, r.Input, contracts, previous)
			if err != nil {
				return ArtifactResponse{}, err
			}
			result = ArtifactInputDecision{Kind: decision.Kind, Message: decision.Message}
			if decision.Kind == "clarify" || decision.Kind == "attempt" || decision.Kind == "unrelated" {
				break
			}
			selected := []inputContract{}
			if decision.Kind == "execute" && decision.ActionID != nil {
				for _, c := range contracts {
					if decision.InteractionID != nil && *decision.InteractionID != c.Definition["id"] {
						continue
					}
					if decision.DefinitionDigest != nil && *decision.DefinitionDigest != c.Digest {
						continue
					}
					for _, raw := range c.Definition["actions"].([]any) {
						action := raw.(map[string]any)
						if action["id"] == *decision.ActionID && action["mode"] == "rule" {
							selected = append(selected, c)
						}
					}
				}
			}
			if decision.Kind == "compose" || (decision.Kind == "execute" && len(selected) == 0) {
				if composed {
					result = ArtifactInputDecision{Kind: "attempt", Message: "当前没有可确定执行的已审核契约，应按当前世界条件裁定，不能沿用旧报价。"}
					break
				}
				child := ArtifactPrepareRequest{RequestID: "input-compose-" + d[:32], BranchID: r.BranchID, ExpectedRevision: r.ExpectedRevision, Intent: r.Input, Retry: true}
				before, err = s.PrepareArtifact(ctx, a, e, child, i)
				if err != nil {
					return ArtifactResponse{}, err
				}
				composed = true
				continue
			}
			if len(selected) != 1 {
				return ArtifactResponse{}, fail("invalid_intent")
			}
			contract := selected[0]
			var action map[string]any
			for _, raw := range contract.Definition["actions"].([]any) {
				x := raw.(map[string]any)
				if x["id"] == *decision.ActionID {
					action = x
				}
			}
			var params map[string]any
			if StrictJSON(decision.Params, &params) != nil || params == nil {
				return ArtifactResponse{}, fail("invalid_intent")
			}
			ref := map[string]any{"interactionId": contract.Definition["id"], "revision": contract.Definition["revision"], "actionId": action["id"], "targets": action["targets"], "scope": contract.Definition["scope"]}
			// Resolve validates the original parameter, condition, target and finite formula rules.
			var payload map[string]any
			_ = json.Unmarshal(contract.Document.Payload, &payload)
			baseline, err := s.Artifacts.run(ctx, map[string]any{"op": "gameplay-baseline", "revision": v.Revision, "before": v.Gameplay, "payload": payload, "prose": public["prose"], "storyTime": public["time"]})
			if err != nil {
				return ArtifactResponse{}, fail("invalid_gameplay")
			}
			full := map[string]any{}
			for k, value := range ref {
				full[k] = value
			}
			full["requestId"] = r.RequestID
			full["params"] = params
			_, err = s.Artifacts.run(ctx, map[string]any{"op": "gameplay-resolve", "revision": v.Revision, "before": baseline, "definition": contract.Definition, "reference": full, "kind": "dynamic", "branchId": r.BranchID, "facts": public["facts"]})
			if err != nil {
				return ArtifactResponse{}, fail("action_not_authorized")
			}
			result.Execute = inputExecutionPlan(contract.Document, before.Artifact, "dynamic", ref, params)
			break
		}
	}
	before.InputDecision = &result
	before.RoutingScope = &ArtifactRoutingScope{RequestID: r.RequestID, ExperienceID: e, BranchID: r.BranchID, BaseRevision: r.ExpectedRevision}
	return s.commitArtifactIntent(ctx, a, e, ArtifactPrepareRequest{RequestID: r.RequestID, BranchID: r.BranchID, ExpectedRevision: r.ExpectedRevision}, d, before, nil)
}
func inputExecutionPlan(selected, head *ArtifactDocument, kind string, reference, params map[string]any) map[string]any {
	var p struct {
		Digest string `json:"definitionDigest"`
		Scope  struct {
			BranchID string `json:"branchId"`
		} `json:"scope"`
	}
	_ = json.Unmarshal(selected.Payload, &p)
	return map[string]any{"artifact_id": selected.ArtifactID, "branch_id": p.Scope.BranchID, "expected_revision": selected.BaseRevision, "revision_id": selected.RevisionID, "expected_head": head.RevisionID, "definition_digest": p.Digest, "kind": kind, "reference": reference, "params": params}
}
func (s *Service) ensureInputArtifact(ctx context.Context, a, e string, r ArtifactInputRequest, v View, before ArtifactResponse) (ArtifactResponse, error) {
	if before.Artifact != nil && before.Artifact.BaseRevision == v.Revision {
		return before, nil
	}
	public := artifactPublicContext(v, len(before.Revisions)+1)
	payload, err := s.Artifacts.run(ctx, map[string]any{"op": "validate", "value": map[string]any{"definition": nil, "game": nil, "reason": "当前正式玩法状态"}, "context": public, "allowScripts": true})
	if err != nil {
		return ArtifactResponse{}, err
	}
	id := "input-snapshot-" + digest("snapshot", e, r)[:32]
	return s.commitArtifact(ctx, a, e, id, r.BranchID, r.ExpectedRevision, digest("input-snapshot", e, r), before, payload, json.RawMessage(`{}`))
}
func (s *Service) inputContracts(ctx context.Context, a, e string, r ArtifactInputRequest, before ArtifactResponse) ([]inputContract, []map[string]any, error) {
	out := []inputContract{}
	previous := []map[string]any{}
	if before.Artifact == nil {
		return out, previous, nil
	}
	rows, err := pgq.New(s.DB).ExperienceArtifactVersions(ctx, pgq.ExperienceArtifactVersionsParams{AccountID: a, ExperienceID: e, BranchID: r.BranchID})
	if err != nil {
		return nil, nil, err
	}
	for _, meta := range rows {
		if meta.ArtifactID != before.Artifact.ArtifactID {
			return nil, nil, fail("artifact_conflict")
		}
		if meta.BaseRevision == r.ExpectedRevision && len(out) >= 16 || meta.BaseRevision != r.ExpectedRevision && len(previous) >= 3 {
			continue
		}
		document := &ArtifactDocument{meta.ArtifactID, meta.ID, meta.BaseRevision, meta.StateRevision, meta.LocalState, meta.Payload, artifactDigest(meta.Payload), meta.CreatedAt, meta.BaseRevision != r.ExpectedRevision}
		var p struct {
			Definition map[string]any `json:"definition"`
			Digest     string         `json:"definitionDigest"`
		}
		if json.Unmarshal(document.Payload, &p) != nil {
			return nil, nil, fail("history_unavailable")
		}
		if p.Definition == nil {
			continue
		}
		actions, _ := p.Definition["actions"].([]any)
		if len(actions) == 0 {
			continue
		}

		if meta.BaseRevision == r.ExpectedRevision {
			if len(out) < 16 {
				out = append(out, inputContract{document, p.Definition, p.Digest})
			}
		} else if len(previous) < 3 {
			previous = append(previous, map[string]any{"id": p.Definition["id"], "title": p.Definition["title"], "scope": p.Definition["scope"]})
		}
	}
	return out, previous, nil
}
func (s *Service) interpretInputModel(ctx context.Context, i *FeedbackInterpreter, public map[string]any, input string, contracts []inputContract, previous []map[string]any) (artifactInputModelDecision, error) {
	var out artifactInputModelDecision
	if i == nil || i.Model == nil || i.ModelName == "" {
		return out, fail("model_unavailable")
	}
	available := []map[string]any{}
	for _, c := range contracts {
		d := map[string]any{}
		for k, v := range c.Definition {
			d[k] = v
		}
		d["view"] = []any{}
		d["definitionDigest"] = c.Digest
		available = append(available, d)
	}
	raw, _ := json.Marshal(map[string]any{"public": public, "intent": input, "availableContracts": available, "previousContracts": previous})
	req := model.Request{Model: i.ModelName, Schema: json.RawMessage(`{"type":"object","properties":{"payload":{"type":"string"}},"required":["payload"],"additionalProperties":false}`), Messages: []model.Message{{Role: "system", Content: sourceArtifactInputPrompt}, {Role: "user", Content: string(raw)}}}
	if i.MaxInputBytes > 0 && len(raw)+len(sourceArtifactInputPrompt) > i.MaxInputBytes {
		return out, fail("context_budget_exceeded")
	}
	req, err := model.VerifyContextBudget(req, i.ContextTokens, min(i.OutputTokens, 4096), i.ByteTokenBoundVerified)
	if err != nil {
		return out, fail("context_budget_exceeded")
	}
	timeout := i.Timeout
	if timeout <= 0 {
		timeout = 2 * time.Minute
	}
	run, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	answer, err := i.Model.Generate(run, req)
	if err != nil {
		return out, fail("model_failed")
	}
	var envelope struct {
		Payload string `json:"payload"`
	}
	if len(answer.Text) > 64<<10 || StrictJSON([]byte(answer.Text), &envelope) != nil || StrictJSON([]byte(envelope.Payload), &out) != nil || utf16Length(out.Message) > 1000 {
		return out, fail("invalid_intent")
	}
	switch out.Kind {
	case "execute", "attempt", "unrelated", "clarify", "compose":
	default:
		return out, fail("invalid_intent")
	}
	return out, nil
}

func (s *Service) validateContractAttempt(ctx context.Context, a, e string, r ArtifactInputRequest, v View, before ArtifactResponse, public map[string]any) error {
	var reference map[string]any
	if StrictJSON(r.DynamicAttempt, &reference) != nil || reference == nil {
		return fail("invalid_input")
	}
	digest, ok := reference["definitionDigest"].(string)
	if !ok || len(digest) != 64 {
		return fail("invalid_input")
	}
	contracts, _, err := s.inputContracts(ctx, a, e, r, before)
	if err != nil {
		return err
	}
	var selected *inputContract
	for index := range contracts {
		if contracts[index].Digest == digest {
			if selected != nil {
				return fail("action_not_authorized")
			}
			selected = &contracts[index]
		}
	}
	if selected == nil {
		return fail("action_not_authorized")
	}
	baseline, err := s.Artifacts.run(ctx, map[string]any{"op": "gameplay-baseline", "revision": v.Revision, "before": v.Gameplay, "payload": selected.Document.Payload, "prose": public["prose"], "storyTime": public["time"]})
	if err != nil {
		return fail("invalid_gameplay")
	}
	_, err = s.Artifacts.run(ctx, map[string]any{"op": "gameplay-attempt", "revision": v.Revision, "before": baseline, "definition": selected.Definition, "reference": reference, "facts": public["facts"]})
	if err != nil {
		return fail("action_not_authorized")
	}
	return nil
}
