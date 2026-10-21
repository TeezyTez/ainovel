package experience

import (
	"bytes"
	"encoding/json"

	pb "elselife/backend/internal/contract/generated/algorithm/v1"
)

// This is a rejected candidate, never authority or actor evidence. Keep it
// separately because revise replaces the draft and clears extracted.
type narrativeRepairBinding struct {
	Candidate json.RawMessage
	Issues    []NarrativeIssue
	Scope     string
}

func validNarrativeRepairScope(scope string, approved bool) bool {
	switch scope {
	case "": // Only absent legacy fields reach this case from model decoding.
		return true
	case "none":
		return approved
	case "candidate_state", "draft", "mixed", "undetermined":
		return !approved
	default:
		return false
	}
}

func narrativeSingleUser(call *pb.ModelCallRequest) (*pb.ModelMessage, error) {
	var user *pb.ModelMessage
	systemSeen := false
	for _, m := range call.Messages {
		if m == nil {
			return nil, fail("narrative_stage_invalid")
		}
		switch m.Role {
		case "system":
			if systemSeen {
				return nil, fail("narrative_stage_invalid")
			}
			systemSeen = true
		case "user":
			if user != nil {
				return nil, fail("narrative_stage_invalid")
			}
			user = m
		default:
			return nil, fail("narrative_stage_invalid")
		}
	}
	if user == nil {
		return nil, fail("narrative_stage_invalid")
	}
	return user, nil
}

func (p *narrativeRun) repairCandidate() (*Candidate, error) {
	if p.repairSource == nil || len(p.repairSource.Candidate) == 0 {
		return nil, fail("narrative_stage_invalid")
	}
	var candidate Candidate
	if StrictJSON(p.repairSource.Candidate, &candidate) != nil {
		return nil, fail("narrative_stage_invalid")
	}
	return &candidate, nil
}

func (p *narrativeRun) bindRepairRequest(call *pb.ModelCallRequest) error {
	stage := call.NarrativeStage
	if stage != "repair_state" && stage != "extract" && stage != "revise" {
		return nil
	}
	if stage == "extract" && p.repairSource == nil {
		// Initial extraction is not a feedback carrier. Retain sparse legacy
		// test requests but never allow unsolicited model-authored feedback.
		for _, m := range call.Messages {
			if m == nil || m.Role != "user" {
				continue
			}
			var body map[string]json.RawMessage
			if StrictJSON([]byte(m.Content), &body) != nil {
				return fail("narrative_stage_invalid")
			}
			if _, exists := body["repair_feedback"]; exists {
				return fail("narrative_stage_invalid")
			}
		}
		return nil
	}
	user, err := narrativeSingleUser(call)
	if err != nil {
		return err
	}
	var body map[string]json.RawMessage
	if StrictJSON([]byte(user.Content), &body) != nil {
		return fail("narrative_stage_invalid")
	}
	allowedFields := map[string]bool{"context": true, "context_materials": true}
	if stage == "repair_state" {
		allowedFields["candidate"], allowedFields["issues"] = true, true
	} else if stage == "revise" {
		for _, field := range []string{"draft", "issues", "scene", "actors", "selected_plan"} {
			allowedFields[field] = true
		}
	} else {
		allowedFields["draft"], allowedFields["repair_feedback"] = true, true
	}
	for field := range body {
		if !allowedFields[field] {
			return fail("narrative_stage_invalid")
		}
	}
	candidate, err := p.repairCandidate()
	if err != nil {
		return err
	}
	if stage == "repair_state" || stage == "revise" {
		if (p.repairSource.Scope == "candidate_state") != (stage == "repair_state") ||
			p.approval == nil || p.approval.Result.RepairScope != p.repairSource.Scope ||
			!bytes.Equal(p.extracted, p.repairSource.Candidate) ||
			!bytes.Equal(narrativeMarshal(p.approval.Result.Issues), narrativeMarshal(p.repairSource.Issues)) {
			return fail("narrative_stage_invalid")
		}
		var issues []NarrativeIssue
		if StrictJSON(body["issues"], &issues) != nil ||
			!bytes.Equal(narrativeMarshal(issues), narrativeMarshal(p.repairSource.Issues)) {
			return fail("narrative_stage_invalid")
		}
		if stage == "repair_state" {
			var supplied Candidate
			if StrictJSON(body["candidate"], &supplied) != nil {
				return fail("narrative_stage_invalid")
			}
			bound, err := canonicalCandidate(supplied)
			if err != nil || !bytes.Equal(bound, p.repairSource.Candidate) || !narrativeDraftMatches(p.draft, supplied) {
				return fail("narrative_stage_invalid")
			}
		} else {
			var draft narrativeDraft
			if StrictJSON(body["draft"], &draft) != nil || p.draft == nil ||
				!bytes.Equal(narrativeMarshal(draft), narrativeMarshal(p.draft)) {
				return fail("narrative_stage_invalid")
			}
		}
	} else {
		if p.repairSource.Scope == "candidate_state" {
			return fail("narrative_stage_invalid")
		}
		var feedback struct {
			CandidateState json.RawMessage  `json:"candidate_state"`
			Issues         []NarrativeIssue `json:"issues"`
		}
		var draft narrativeDraft
		if StrictJSON(body["repair_feedback"], &feedback) != nil ||
			StrictJSON(body["draft"], &draft) != nil || p.draft == nil ||
			!bytes.Equal(narrativeMarshal(draft), narrativeMarshal(p.draft)) ||
			!bytes.Equal(narrativeMarshal(feedback.Issues), narrativeMarshal(p.repairSource.Issues)) {
			return fail("narrative_stage_invalid")
		}
		var state map[string]json.RawMessage
		if StrictJSON(feedback.CandidateState, &state) != nil || state == nil {
			return fail("narrative_stage_invalid")
		}
		for _, field := range []string{"title", "passage", "story_time", "outcome", "suggestions"} {
			if _, supplied := state[field]; supplied {
				return fail("narrative_stage_invalid")
			}
		}
		// Compose using the ORIGINAL draft, not the revised draft. Typed
		// canonical comparison tolerates Rust/Go optional-field encoding while
		// still binding every state field and rejecting duplicates/unknowns.
		originalDraft := narrativeDraft{candidate.Title, candidate.Passage, candidate.StoryTime, candidate.Outcome, candidate.Suggestions}
		raw, err := hydrateNarrativeExtraction(feedback.CandidateState, &originalDraft)
		var supplied Candidate
		if err != nil || StrictJSON(raw, &supplied) != nil {
			return fail("narrative_stage_invalid")
		}
		bound, err := canonicalCandidate(supplied)
		if err != nil || !bytes.Equal(bound, p.repairSource.Candidate) {
			return fail("narrative_stage_invalid")
		}
	}
	if _, err := p.hydrateReviewEvidence(body, *candidate); err != nil {
		return err
	}
	// Validate final state, even with no sidecar, before any reassembly could
	// erase conflicting authority or duplicate IDs.
	if err := p.reconcileRepairBody(body, *candidate); err != nil {
		return err
	}
	user.Content = string(narrativeMarshal(body))
	return nil
}

func narrativeDraftMatches(draft *narrativeDraft, candidate Candidate) bool {
	return draft != nil && draft.Title == candidate.Title && draft.Passage == candidate.Passage &&
		draft.StoryTime == candidate.StoryTime && draft.Outcome == candidate.Outcome &&
		bytes.Equal(narrativeMarshal(draft.Suggestions), narrativeMarshal(candidate.Suggestions))
}

// Reuse the authority reconciler on a private view. candidate_state remains
// exactly as sent; the temporary full candidate never becomes a second carrier.
func (p *narrativeRun) reconcileRepairBody(body map[string]json.RawMessage, candidate Candidate) error {
	check := make(map[string]json.RawMessage, len(body)+1)
	for key, value := range body {
		check[key] = value
	}
	frozen, err := canonicalCandidate(candidate)
	if err != nil {
		return err
	}
	check["candidate"] = frozen
	shadow := *p
	shadow.reviewed, shadow.extracted = frozen, frozen
	call := &pb.ModelCallRequest{NarrativeStage: "review", Messages: []*pb.ModelMessage{{Role: "user", Content: string(narrativeMarshal(check))}}}
	if err := shadow.reconcileReviewEvidence(call); err != nil {
		return err
	}
	var reconciled map[string]json.RawMessage
	if StrictJSON([]byte(call.Messages[0].Content), &reconciled) != nil {
		return fail("narrative_stage_invalid")
	}
	delete(body, "review_evidence")
	if evidence, exists := reconciled["review_evidence"]; exists {
		body["review_evidence"] = evidence
	}
	return nil
}
