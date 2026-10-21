package experience

import (
	"bytes"
	"encoding/json"
	"reflect"

	pb "elselife/backend/internal/contract/generated/algorithm/v1"
)

// Review evidence is a read-only projection of this operation's pinned state.
// It is not a world update, a recall result, or additional actor knowledge.
type narrativeReviewEvidence struct {
	ExperienceID     string   `json:"experience_id"`
	BranchID         string   `json:"branch_id"`
	BaseRevision     int64    `json:"base_revision"`
	SourceHandle     string   `json:"source_handle"`
	KnowledgeTargets []Fact   `json:"knowledge_targets"`
	Subjects         []Entity `json:"subjects"`
}

// hydrateReviewEvidence makes the entire target of every proposed knowledge
// edge visible to the reviewer. Existence at commit time cannot substitute for
// reviewing the full record now. Semantic support still requires model review.
//
// Rust's context_view merges current recalls into state and leaves historical
// recalls separate. Only state is considered already materialized here; an old
// snapshot cannot stand in for this operation's target.
func (p *narrativeRun) hydrateReviewEvidence(body map[string]json.RawMessage, candidate Candidate) (bool, error) {
	bad := func() (bool, error) { return false, fail("narrative_review_evidence_invalid") }
	if _, supplied := body["review_evidence"]; supplied {
		return bad()
	}
	subjectIDs, targetIDs := []string{}, []string{}
	for _, edge := range candidate.KnowledgeChanges {
		subjectIDs = append(subjectIDs, edge.SubjectID)
		targetIDs = append(targetIDs, edge.FactID)
	}
	for _, fact := range candidate.NewFacts {
		subjectIDs = append(subjectIDs, fact.KnownBy...)
		if len(fact.KnownBy) > 0 && fact.SubjectID != "" {
			subjectIDs = append(subjectIDs, fact.SubjectID)
		}
	}
	// Decode only the fields owned by this boundary. context_view also contains
	// stage-specific fields which are not part of the serialized Go Context.
	var visible struct {
		Version       int           `json:"version"`
		ExperienceID  string        `json:"experience_id"`
		BranchID      string        `json:"branch_id"`
		Revision      *int64        `json:"revision"`
		NextRevision  *int64        `json:"next_revision"`
		Mode          string        `json:"mode"`
		State         *State        `json:"state"`
		StateCoverage StateCoverage `json:"state_coverage"`
	}
	if json.Unmarshal(body["context"], &visible) != nil || visible.Version != 2 ||
		visible.Revision == nil || visible.NextRevision == nil || visible.State == nil ||
		visible.ExperienceID != p.context.ExperienceID || visible.BranchID != p.context.BranchID ||
		*visible.Revision != p.context.Revision || *visible.NextRevision != p.context.Revision+1 || visible.Mode != p.context.Mode ||
		visible.StateCoverage.SourceHandle != p.context.StateCoverage.SourceHandle ||
		visible.StateCoverage.Audience != p.context.StateCoverage.Audience {
		return bad()
	}
	if len(subjectIDs) == 0 && len(targetIDs) == 0 {
		return false, nil
	}
	// answer constructs an empty delta before reaching review. Keep this
	// reader boundary explicit even if a future caller bypasses that guard.
	if p.context.Mode == "ask" {
		return bad()
	}
	authority := p.context.State
	if p.context.AuthorityState != nil {
		authority = *p.context.AuthorityState
	}
	facts, entities := map[string]Fact{}, map[string]Entity{}
	for _, f := range authority.Facts {
		facts[f.ID] = f
	}
	for _, e := range authority.Entities {
		entities[e.ID] = e
	}
	newFacts, newEntities := map[string]Fact{}, map[string]bool{}
	for _, f := range candidate.NewFacts {
		_, duplicate := newFacts[f.ID]
		if _, existing := facts[f.ID]; existing || duplicate {
			return bad()
		}
		newFacts[f.ID] = f
	}
	for _, e := range candidate.NewEntities {
		if _, existing := entities[e.ID]; existing || newEntities[e.ID] {
			return bad()
		}
		newEntities[e.ID] = true
	}
	visibleFacts, visibleEntities := map[string]Fact{}, map[string]Entity{}
	for _, f := range visible.State.Facts {
		if _, duplicate := visibleFacts[f.ID]; duplicate {
			return bad()
		}
		visibleFacts[f.ID] = f
	}
	for _, e := range visible.State.Entities {
		if _, duplicate := visibleEntities[e.ID]; duplicate {
			return bad()
		}
		visibleEntities[e.ID] = e
	}
	evidence := narrativeReviewEvidence{
		ExperienceID: p.context.ExperienceID, BranchID: p.context.BranchID, BaseRevision: p.context.Revision,
		SourceHandle: p.context.StateCoverage.SourceHandle, KnowledgeTargets: []Fact{}, Subjects: []Entity{},
	}
	seenTargets, seenSubjects := map[string]bool{}, map[string]bool{}
	for _, id := range targetIDs {
		if seenTargets[id] {
			continue
		}
		seenTargets[id] = true
		if f, newTarget := newFacts[id]; newTarget {
			if f.SubjectID != "" {
				subjectIDs = append(subjectIDs, f.SubjectID)
			}
			continue // New targets are already fully present in the frozen candidate.
		}
		f, exists := facts[id]
		if !exists || f.SourceRevision > p.context.Revision {
			return bad()
		}
		// Resolve the record's attributed subject, not everybody who knows it.
		// This supplies identity, never a claim that the receiver knows more.
		if f.SubjectID != "" {
			subjectIDs = append(subjectIDs, f.SubjectID)
		}
		if materialized, ok := visibleFacts[id]; ok {
			if !reflect.DeepEqual(materialized, f) {
				return bad()
			}
		} else {
			evidence.KnowledgeTargets = append(evidence.KnowledgeTargets, f)
		}
	}
	for _, id := range subjectIDs {
		if seenSubjects[id] || newEntities[id] {
			continue
		}
		seenSubjects[id] = true
		e, exists := entities[id]
		if !exists {
			return bad()
		}
		if materialized, ok := visibleEntities[id]; ok {
			if !reflect.DeepEqual(materialized, e) {
				return bad()
			}
		} else {
			evidence.Subjects = append(evidence.Subjects, e)
		}
	}
	if len(evidence.KnowledgeTargets) == 0 && len(evidence.Subjects) == 0 {
		return false, nil
	}
	body["review_evidence"], _ = json.Marshal(evidence)
	// The caller sends this modified request through the existing frame and
	// model context budget guards. No budget or coverage claim is enlarged.
	return true, nil
}

// reconcileReviewEvidence removes only exact duplicate evidence after a stage
// compiler has rebuilt context.state. The original hydrateReviewEvidence check
// must already have succeeded. Call this before measuring each rebuilt request,
// not after a budget rejection. It never fills state or changes the candidate.
func (p *narrativeRun) reconcileReviewEvidence(call *pb.ModelCallRequest) error {
	bad := func() error { return fail("narrative_review_evidence_invalid") }
	if call == nil || call.NarrativeStage != "review" && call.NarrativeStage != "repair_review" {
		return bad()
	}
	var user *pb.ModelMessage
	systemSeen := false
	for _, message := range call.Messages {
		if message == nil {
			return bad()
		}
		switch message.Role {
		case "system":
			if systemSeen {
				return bad()
			}
			systemSeen = true
		case "user":
			if user != nil {
				return bad()
			}
			user = message
		default:
			return bad()
		}
	}
	if user == nil {
		return bad()
	}
	var body map[string]json.RawMessage
	var candidate Candidate
	if StrictJSON([]byte(user.Content), &body) != nil || StrictJSON(body["candidate"], &candidate) != nil {
		return bad()
	}
	frozen, err := canonicalCandidate(candidate)
	if err != nil || p.reviewed == nil || p.extracted == nil || !bytes.Equal(frozen, p.reviewed) || !bytes.Equal(frozen, p.extracted) {
		return bad()
	}

	// Reuse the existing scope, identity, and authoritative-target validator on
	// the final context. Its temporary result says exactly which evidence is
	// still missing; it is not copied into the outgoing request.
	check := make(map[string]json.RawMessage, len(body))
	for key, value := range body {
		if key != "review_evidence" {
			check[key] = value
		}
	}
	if _, err := p.hydrateReviewEvidence(check, candidate); err != nil {
		return err
	}
	missing := narrativeReviewEvidence{}
	if raw := check["review_evidence"]; raw != nil {
		if StrictJSON(raw, &missing) != nil {
			return bad()
		}
	}
	var view map[string]json.RawMessage
	var state State
	if StrictJSON(body["context"], &view) != nil || StrictJSON(view["state"], &state) != nil {
		return bad()
	}
	visibleFacts, visibleEntities := map[string]Fact{}, map[string]Entity{}
	for _, fact := range state.Facts {
		if _, exists := visibleFacts[fact.ID]; exists {
			return bad()
		}
		visibleFacts[fact.ID] = fact
	}
	for _, entity := range state.Entities {
		if _, exists := visibleEntities[entity.ID]; exists {
			return bad()
		}
		visibleEntities[entity.ID] = entity
	}
	raw, supplied := body["review_evidence"]
	if !supplied {
		if len(missing.KnowledgeTargets)+len(missing.Subjects) != 0 {
			return bad() // Recompilation lost evidence; do not silently repair it.
		}
		return nil
	}
	var evidence narrativeReviewEvidence
	if StrictJSON(raw, &evidence) != nil || evidence.KnowledgeTargets == nil || evidence.Subjects == nil ||
		evidence.ExperienceID != p.context.ExperienceID || evidence.BranchID != p.context.BranchID ||
		evidence.BaseRevision != p.context.Revision || evidence.SourceHandle != p.context.StateCoverage.SourceHandle {
		return bad()
	}

	// Ask the same validator for the full permitted projection. This validates
	// even a redundant sidecar against authority, rather than trusting agreement
	// between two equally forged copies. No source read or world mutation occurs.
	delete(check, "review_evidence")
	view["state"] = narrativeMarshal(EmptyState())
	check["context"] = narrativeMarshal(view)
	if _, err := p.hydrateReviewEvidence(check, candidate); err != nil {
		return err
	}
	permitted := narrativeReviewEvidence{}
	if raw := check["review_evidence"]; raw != nil {
		if StrictJSON(raw, &permitted) != nil {
			return bad()
		}
	}
	facts, entities := map[string]Fact{}, map[string]Entity{}
	for _, fact := range permitted.KnowledgeTargets {
		facts[fact.ID] = fact
	}
	for _, entity := range permitted.Subjects {
		entities[entity.ID] = entity
	}
	retained := evidence
	retained.KnowledgeTargets, retained.Subjects = []Fact{}, []Entity{}
	seenFacts, seenEntities := map[string]bool{}, map[string]bool{}
	keptFacts, keptEntities := map[string]bool{}, map[string]bool{}
	for _, fact := range evidence.KnowledgeTargets {
		source, allowed := facts[fact.ID]
		if seenFacts[fact.ID] || !allowed || !reflect.DeepEqual(source, fact) {
			return bad()
		}
		seenFacts[fact.ID] = true
		if visible, exists := visibleFacts[fact.ID]; exists {
			if !reflect.DeepEqual(visible, fact) {
				return bad()
			}
			continue
		}
		retained.KnowledgeTargets = append(retained.KnowledgeTargets, fact)
		keptFacts[fact.ID] = true
	}
	for _, entity := range evidence.Subjects {
		source, allowed := entities[entity.ID]
		if seenEntities[entity.ID] || !allowed || !reflect.DeepEqual(source, entity) {
			return bad()
		}
		seenEntities[entity.ID] = true
		if visible, exists := visibleEntities[entity.ID]; exists {
			if !reflect.DeepEqual(visible, entity) {
				return bad()
			}
			continue
		}
		retained.Subjects = append(retained.Subjects, entity)
		keptEntities[entity.ID] = true
	}
	if len(keptFacts) != len(missing.KnowledgeTargets) || len(keptEntities) != len(missing.Subjects) {
		return bad()
	}
	for _, fact := range missing.KnowledgeTargets {
		if !keptFacts[fact.ID] {
			return bad()
		}
	}
	for _, entity := range missing.Subjects {
		if !keptEntities[entity.ID] {
			return bad()
		}
	}
	if len(retained.KnowledgeTargets) == len(evidence.KnowledgeTargets) && len(retained.Subjects) == len(evidence.Subjects) {
		return nil
	}
	if len(retained.KnowledgeTargets)+len(retained.Subjects) == 0 {
		delete(body, "review_evidence")
	} else {
		body["review_evidence"] = narrativeMarshal(retained)
	}
	user.Content = string(narrativeMarshal(body))
	return nil
}
