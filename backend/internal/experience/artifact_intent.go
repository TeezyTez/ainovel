package experience

import (
	"context"
	"database/sql"
	"elselife/backend/internal/sqlc/pgq"
	_ "embed"
	"encoding/json"
	"errors"
)

//go:embed artifact_intent_prompt.txt
var sourceArtifactIntentPrompt string

type ArtifactIntentDecision struct {
	Kind    string  `json:"kind"`
	Target  *string `json:"target"`
	Message string  `json:"message"`
}
type ArtifactRoutingScope struct {
	RequestID    string `json:"request_id"`
	ExperienceID string `json:"experience_id"`
	BranchID     string `json:"branch_id"`
	BaseRevision int64  `json:"base_revision"`
}

func parseArtifactIntent(raw json.RawMessage, before ArtifactResponse) (*ArtifactIntentDecision, json.RawMessage, error) {
	var envelope struct {
		Decision json.RawMessage `json:"intentDecision"`
		Output   json.RawMessage `json:"output"`
	}
	if RequiredJSON(raw, "intentDecision") != nil || StrictJSON(raw, &envelope) != nil || len(envelope.Output) == 0 {
		return nil, nil, fail("invalid_intent")
	}
	var d ArtifactIntentDecision
	if RequiredJSON(envelope.Decision, "kind") != nil || StrictJSON(envelope.Decision, &d) != nil || utf16Length(d.Message) > 1000 || (d.Target != nil && utf16Length(*d.Target) > 200) {
		return nil, nil, fail("invalid_intent")
	}
	switch d.Kind {
	case "edit":
		if before.Artifact == nil || d.Target == nil || *d.Target != before.Artifact.ArtifactID {
			return nil, nil, fail("artifact_target_conflict")
		}
		fallthrough
	case "create":
		var output map[string]any
		if StrictJSON(envelope.Output, &output) != nil || output == nil {
			return nil, nil, fail("invalid_intent")
		}
	case "story", "mixed", "clarify":
		if string(envelope.Output) != "null" {
			return nil, nil, fail("invalid_intent")
		}
	default:
		return nil, nil, fail("invalid_intent")
	}
	return &d, envelope.Output, nil
}
func withArtifactIntent(out ArtifactResponse, a, e, b, r string, revision int64, decisions []*ArtifactIntentDecision) ArtifactResponse {
	if len(decisions) > 0 && decisions[0] != nil {
		out.IntentDecision = decisions[0]
		out.RoutingScope = &ArtifactRoutingScope{RequestID: r, ExperienceID: e, BranchID: b, BaseRevision: revision}
	}
	return out
}

// Non-UI routing has a durable response receipt but cannot change a presentation
// or submit a story action. The client separately journals an explicit action.
func (s *Service) commitArtifactIntent(ctx context.Context, a, e string, r ArtifactPrepareRequest, digest string, before ArtifactResponse, decision *ArtifactIntentDecision) (ArtifactResponse, error) {
	out := ArtifactResponse{}
	err := s.transaction(ctx, func(q *pgq.Queries) error {
		if err := requestLock(ctx, q, a, r.RequestID); err != nil {
			return err
		}
		prior, err := artifactPrior(ctx, q, a, r.RequestID, digest)
		if err != nil {
			return err
		}
		if prior != nil {
			out = *prior
			return nil
		}
		if err = artifactLock(ctx, q, a, e, r.BranchID, r.ExpectedRevision); err != nil {
			return err
		}
		head, err := q.ExperienceArtifactHead(ctx, pgq.ExperienceArtifactHeadParams{AccountID: a, ExperienceID: e, BranchID: r.BranchID})
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if before.Artifact == nil {
			if !errors.Is(err, sql.ErrNoRows) {
				return fail("artifact_conflict")
			}
		} else {
			if head.ArtifactID != before.Artifact.ArtifactID || head.RevisionID != before.Artifact.RevisionID {
				return fail("artifact_conflict")
			}
			current, err := q.ExperienceArtifactVersion(ctx, pgq.ExperienceArtifactVersionParams{AccountID: a, ExperienceID: e, BranchID: r.BranchID, ArtifactID: head.ArtifactID, ID: head.RevisionID})
			if err != nil {
				return err
			}
			if current.StateRevision != before.Artifact.StateRevision {
				return fail("artifact_conflict")
			}
		}
		out = withArtifactIntent(before, a, e, r.BranchID, r.RequestID, r.ExpectedRevision, []*ArtifactIntentDecision{decision})
		return artifactReceipt(ctx, q, a, e, r.BranchID, r.RequestID, digest, out)
	})
	return out, err
}
