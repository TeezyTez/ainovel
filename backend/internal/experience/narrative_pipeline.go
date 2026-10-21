package experience

import (
	"bytes"
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"encoding/json"
	"strings"
)

const narrativeEngineVersion = "narrative-engine.v4.13"

type NarrativeIssue struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
}
type NarrativeSupport struct {
	FactID string `json:"fact_id"`
	Quote  string `json:"quote"`
}
type NarrativeKnowledgeSupport struct {
	SubjectID string `json:"subject_id"`
	FactID    string `json:"fact_id"`
	Quote     string `json:"quote"`
}
type NarrativeRevealSupport struct {
	Type  string `json:"type"`
	ID    string `json:"id"`
	Quote string `json:"quote"`
}
type NarrativeMemorySupport struct {
	MemoryID  string   `json:"memory_id"`
	Quote     string   `json:"quote,omitempty"`
	SourceIDs []string `json:"source_ids,omitempty"`
}
type NarrativeReview struct {
	Approved          bool                        `json:"approved"`
	RepairScope       string                      `json:"repair_scope,omitempty"`
	Issues            []NarrativeIssue            `json:"issues"`
	Supports          []NarrativeSupport          `json:"supports"`
	KnowledgeSupports []NarrativeKnowledgeSupport `json:"knowledge_supports"`
	RevealSupports    []NarrativeRevealSupport    `json:"reveal_supports,omitempty"`
	MemorySupports    []NarrativeMemorySupport    `json:"memory_supports,omitempty"`
}
type NarrativeApproval struct {
	Engine    string                     `json:"engine"`
	Candidate json.RawMessage            `json:"candidate"`
	Result    NarrativeReview            `json:"result"`
	Evidence  *narrativeEvidenceApproval `json:"evidence,omitempty"`
}
type narrativeTrigger struct {
	ActorID string   `json:"actor_id"`
	Trigger string   `json:"trigger"`
	FactIDs []string `json:"fact_ids"`
}
type narrativeDraft struct {
	Title       string   `json:"title"`
	Passage     string   `json:"passage"`
	StoryTime   string   `json:"story_time"`
	Outcome     string   `json:"outcome"`
	Suggestions []string `json:"suggestions"`
}
type narrativePlanReferences struct {
	FactIDs   []string
	ThreadIDs []string
}
type narrativeRun struct {
	evidenceV2          bool
	evidenceOrigin      *narrativeEvidenceOrigin
	evidencePacket      *memoryEvidencePacket
	evidenceCall        *narrativeEvidenceApproval
	context             Context
	last                string
	repairs             int
	actors              map[string]narrativeTrigger
	seen                map[string]bool
	reviewed            json.RawMessage
	approval            *NarrativeApproval
	pendingRead         bool
	readCompleted       bool
	draft               *narrativeDraft
	extracted           json.RawMessage
	extractionInvalid   bool
	reviewQuoteInvalid  bool
	activeActor         string
	actorFacts          map[string]bool
	needs               ContextNeeds
	materialBudget      int
	stageInputBudget    int
	materialSource      func(actorID string, factIDs []string, memoryIDs []string) (State, error)
	readStages          map[string]bool
	stageFacts          map[string]bool
	stageThreads        map[string]bool
	planFactIDs         []string
	planThreadIDs       []string
	actorUsedFactIDs    []string
	plans               map[string]narrativePlanReferences
	selectedPlanID      string
	repairSource        *narrativeRepairBinding
	remainingModelCalls int // Includes this request; -1 only for direct boundary tests.
}

func newNarrativeRun(c Context) *narrativeRun {
	return &narrativeRun{context: c, actors: map[string]narrativeTrigger{}, seen: map[string]bool{}, remainingModelCalls: -1}
}

func verifyNarrativeApproval(candidate Candidate, approval *NarrativeApproval) error {
	if approval == nil || approval.Engine != narrativeEngineVersion || !approval.Result.Approved || !validNarrativeRepairScope(approval.Result.RepairScope, true) || approval.Result.Issues == nil || len(approval.Result.Issues) > 0 || approval.Result.Supports == nil || approval.Result.KnowledgeSupports == nil {
		return fail("narrative_review_rejected")
	}
	raw, _ := canonicalCandidate(candidate)
	var reviewed Candidate
	if StrictJSON(approval.Candidate, &reviewed) != nil {
		return fail("narrative_review_mismatch")
	}
	canonical, _ := canonicalCandidate(reviewed)
	if !bytes.Equal(raw, canonical) {
		return fail("narrative_review_mismatch")
	}
	if err := narrativeReviewEvidenceShape(candidate, approval.Result); err != nil {
		return err
	}
	for _, s := range approval.Result.Supports {
		if !strings.Contains(candidate.Passage, s.Quote) {
			return fail("narrative_evidence_missing")
		}
	}
	for _, s := range approval.Result.KnowledgeSupports {
		if !strings.Contains(candidate.Passage, s.Quote) {
			return fail("narrative_evidence_missing")
		}
	}
	for _, s := range approval.Result.RevealSupports {
		if !strings.Contains(candidate.Passage, s.Quote) {
			return fail("narrative_evidence_missing")
		}
	}
	if candidate.MemoryDelta != nil {
		_, err := verifyMemoryEvidenceApproval(candidate, approval)
		return err
	}
	memoryQuotes := map[string]string{}
	for _, change := range candidate.MemoryChanges {
		memoryQuotes[change.ID] = change.Quote
	}
	for _, support := range approval.Result.MemorySupports {
		if memoryQuotes[support.MemoryID] != support.Quote || !strings.Contains(candidate.Passage, support.Quote) {
			return fail("narrative_evidence_missing")
		}
	}
	return nil
}

// Check the entire reference/coverage shape before classifying a quote mismatch.
// This grants no approval: every commit still requires exact passage substrings.
func narrativeReviewEvidenceShape(candidate Candidate, review NarrativeReview) error {
	facts := map[string]bool{}
	knowledge := map[string]bool{}
	for _, f := range candidate.NewFacts {
		facts[f.ID] = false
		for _, actor := range f.KnownBy {
			knowledge[actor+"\x00"+f.ID] = false
		}
	}
	for _, k := range candidate.KnowledgeChanges {
		knowledge[k.SubjectID+"\x00"+k.FactID] = false
	}
	for _, s := range review.Supports {
		if _, ok := facts[s.FactID]; !ok || facts[s.FactID] || !textOK(s.Quote) {
			return fail("narrative_evidence_missing")
		}
		facts[s.FactID] = true
	}
	for _, s := range review.KnowledgeSupports {
		id := s.SubjectID + "\x00" + s.FactID
		if _, ok := knowledge[id]; !ok || knowledge[id] || !textOK(s.Quote) {
			return fail("narrative_evidence_missing")
		}
		knowledge[id] = true
	}
	for _, v := range facts {
		if !v {
			return fail("narrative_evidence_missing")
		}
	}
	for _, v := range knowledge {
		if !v {
			return fail("narrative_evidence_missing")
		}
	}
	reveals := map[string]bool{}
	for _, id := range candidate.RevealFactIDs {
		reveals["fact\x00"+id] = false
	}
	for _, id := range candidate.RevealEntityIDs {
		reveals["entity\x00"+id] = false
	}
	for _, id := range candidate.RevealThreadIDs {
		reveals["thread\x00"+id] = false
	}
	for _, s := range review.RevealSupports {
		key := s.Type + "\x00" + s.ID
		if _, ok := reveals[key]; !ok || reveals[key] || !textOK(s.Quote) {
			return fail("narrative_evidence_missing")
		}
		reveals[key] = true
	}
	for _, covered := range reveals {
		if !covered {
			return fail("narrative_evidence_missing")
		}
	}
	memories := map[string]bool{}
	for _, change := range candidate.MemoryChanges {
		memories[change.ID] = false
	}
	if candidate.MemoryDelta != nil {
		for _, change := range candidate.MemoryDelta.Entries {
			memories[change.ID] = false
		}
	}
	for _, support := range review.MemorySupports {
		if _, ok := memories[support.MemoryID]; !ok || memories[support.MemoryID] {
			return fail("narrative_evidence_missing")
		}
		if candidate.MemoryDelta != nil {
			if support.Quote != "" || len(support.SourceIDs) == 0 {
				return fail("narrative_memory_evidence_invalid")
			}
			seen := map[string]bool{}
			for _, id := range support.SourceIDs {
				if !keyOK(id) || seen[id] {
					return fail("narrative_memory_evidence_invalid")
				}
				seen[id] = true
			}
		} else if !textOK(support.Quote) || support.SourceIDs != nil {
			return fail("narrative_evidence_missing")
		}
		memories[support.MemoryID] = true
	}
	for _, covered := range memories {
		if !covered {
			return fail("narrative_evidence_missing")
		}
	}
	return nil
}
func canonicalCandidate(c Candidate) ([]byte, error) {
	raw, err := json.Marshal(c)
	if err != nil {
		return nil, err
	}
	return canonicalRawJSON(raw)
}

func (p *narrativeRun) before(call *pb.ModelCallRequest) (bool, error) {
	stage := call.NarrativeStage
	p.evidencePacket = nil
	bad := func() (bool, error) { return false, fail("narrative_stage_invalid") }
	if len(call.SchemaJson) > narrativePipelineSchemaMaxBytes {
		return false, fail("context_budget_exceeded")
	}
	if p.context.Pipeline == nil || p.context.Pipeline.Version != 1 || p.context.Pipeline.MaxActors < 0 || p.context.Pipeline.MaxActors > 2 || p.context.Pipeline.MaxRepairs < 0 || p.context.Pipeline.MaxRepairs > 1 {
		return bad()
	}
	allowed := false
	resumingRead := p.readCompleted && stage == p.last
	if p.readCompleted && !resumingRead {
		return bad()
	}
	if p.pendingRead {
		return bad()
	}
	if p.context.Mode == "ask" {
		allowed = p.last == "" && stage == "answer" || p.last == "answer" && stage == "review"
	} else {
		switch stage {
		case "memory":
			allowed = p.last == ""
		case "actor":
			allowed = (p.last == "memory" || p.last == "actor") && len(p.seen) < p.context.Pipeline.MaxActors
		case "plan":
			allowed = (p.last == "memory" || p.last == "actor") && len(p.seen) == len(p.actors)
		case "evaluate":
			allowed = p.last == "plan"
		case "write":
			allowed = p.last == "evaluate"
		case "extract":
			allowed = p.last == "write" || p.last == "revise"
		case "repair_extract":
			allowed = p.last == "extract" && p.extractionInvalid && p.repairs < p.context.Pipeline.MaxRepairs
		case "review":
			allowed = (p.last == "extract" || p.last == "repair_extract" || p.last == "repair_state") && !p.extractionInvalid
		case "repair_review":
			allowed = p.last == "review" && p.reviewQuoteInvalid && p.repairs < p.context.Pipeline.MaxRepairs
		case "revise":
			allowed = p.last == "review" && p.approval != nil && !p.approval.Result.Approved && p.approval.Result.RepairScope != "candidate_state" && p.repairs < p.context.Pipeline.MaxRepairs
		case "repair_state":
			allowed = p.last == "review" && p.approval != nil && !p.approval.Result.Approved && p.approval.Result.RepairScope == "candidate_state" && p.repairs < p.context.Pipeline.MaxRepairs
		}
	}
	if resumingRead {
		allowed = stage != "actor" || call.NarrativeActorId == p.activeActor
	}
	if !allowed || stage != "actor" && call.NarrativeActorId != "" {
		return bad()
	}
	if p.remainingModelCalls >= 0 {
		required := map[string]int{"repair_state": 2, "revise": 3, "repair_extract": 2, "repair_review": 1}[stage]
		if p.remainingModelCalls < required {
			return false, fail("model_budget_exhausted")
		}
	}
	if err := p.bindRepairRequest(call); err != nil {
		return false, err
	}
	if stage == "actor" {
		id := call.NarrativeActorId
		trigger, ok := p.actors[id]
		if !ok || p.seen[id] && !resumingRead {
			return bad()
		}
		originalBudget := p.materialBudget
		if p.stageInputBudget > 0 {
			available := p.stageInputBudget - len(call.SchemaJson) - len(narrativeActorInstruction) - 2048
			if available <= 0 {
				return false, fail("context_budget_exceeded")
			}
			p.materialBudget = min(defaultMaterialBudget, available)
			if originalBudget > 0 {
				p.materialBudget = min(p.materialBudget, originalBudget)
			}
		}
		user, err := p.actorProjection(trigger)
		p.materialBudget = originalBudget
		if err != nil {
			return false, err
		}
		// Never forward algorithm-supplied assistant/user messages into actor scope.
		call.Messages = []*pb.ModelMessage{{Role: "system", Content: narrativeActorInstruction}, {Role: "user", Content: string(user)}}
		p.seen[id] = true
		p.activeActor = id
	}
	if stage != "actor" && p.context.Mode != "ask" && p.evidenceV2 {
		if err := rejectSuppliedMemoryEvidence(call); err != nil {
			return false, err
		}
		for _, message := range call.Messages {
			if message == nil || message.Role != "user" {
				continue
			}
			var body map[string]json.RawMessage
			if StrictJSON([]byte(message.Content), &body) != nil {
				return bad()
			}
			if err := p.validateOriginalMemoryPages(body); err != nil {
				return false, err
			}
		}
	}
	if stage == "review" || stage == "repair_review" {
		p.reviewed = nil
		p.approval = nil
		p.evidenceCall, p.evidencePacket = nil, nil
		if err := rejectSuppliedMemoryEvidence(call); err != nil {
			return false, err
		}
		systemSeen := false
		for _, m := range call.Messages {
			if m == nil || m.Role != "system" && m.Role != "user" {
				return bad()
			}
			if m.Role == "system" {
				if systemSeen {
					return bad()
				}
				systemSeen = true
				continue
			}
			var v map[string]json.RawMessage
			if StrictJSON([]byte(m.Content), &v) != nil || v["candidate"] == nil {
				return bad()
			}
			if p.reviewed != nil {
				return bad()
			}
			var candidate Candidate
			if StrictJSON(v["candidate"], &candidate) != nil {
				return bad()
			}
			if candidate.MemoryDelta != nil {
				if err := p.validateOriginalMemoryPages(v); err != nil {
					return false, err
				}
			}
			p.reviewed, _ = canonicalCandidate(candidate)
			if p.extracted == nil || !bytes.Equal(p.reviewed, p.extracted) {
				return bad()
			}
			changed, err := p.hydrateReviewEvidence(v, candidate)
			if err != nil {
				return false, err
			}
			if changed {
				raw, err := json.Marshal(v)
				if err != nil {
					return bad()
				}
				m.Content = string(raw)
			}
		}
		if p.reviewed == nil || p.extracted == nil || !bytes.Equal(p.reviewed, p.extracted) {
			return bad()
		}
		p.reviewQuoteInvalid = false
	}
	// Validate the original review pin and evidence before reassembling its
	// working set. Replacing state first could erase a forged record or scope.
	if stage != "actor" && (p.materialBudget > 0 || p.stageInputBudget > 0 || p.evidenceV2) {
		if err := p.compileStageCall(call, stage); err != nil {
			return false, err
		}
	}
	if p.stageInputBudget > 0 && narrativeCallBytes(call) > p.stageInputBudget {
		return false, fail("context_budget_exceeded")
	}
	if stage == "plan" || stage == "evaluate" {
		if err := p.recordStageReferences(call); err != nil {
			return false, err
		}
	}
	if !resumingRead && (stage == "revise" || stage == "repair_extract" || stage == "repair_review" || stage == "repair_state") {
		p.repairs++
	}
	if stage == "extract" && !resumingRead {
		p.extractionInvalid = false
		p.extracted = nil
	}
	p.last = stage
	p.readCompleted = false
	if p.context.Progress != nil {
		phase := map[string]string{"memory": "remembering", "actor": "characters", "plan": "planning", "evaluate": "evaluating", "write": "writing", "answer": "writing", "extract": "extracting", "repair_extract": "extracting", "repair_state": "extracting", "review": "checking", "repair_review": "checking", "revise": "revising"}[stage]
		if err := p.context.Progress(phase); err != nil {
			return false, err
		}
	}
	return stage != "actor" && p.context.Mode != "ask", nil
}

const narrativeActorInstruction = `You propose one fictional character's next intention. The user JSON contains only this character's authorized known facts and an optional directly addressed attempted utterance. Let the person's ongoing concerns, relationship with the interlocutor, previous choices and present situation shape what they want and how much they say. A current task is not their whole personality. A belief or statement is not necessarily objective truth; newly choosing or feeling something now does not require inventing a past. Speech is an editable draft for the writer, not a recital of the evidence or a list of operational safeguards. Ordinary warmth, hesitation, brevity or humor may fit, but none is a quota. Do not force a catchphrase or flashback. A conditional_attempt has not happened yet and grants no success or knowledge change. No omniscience; do not invent unseen facts. Only list supplied fact IDs in used_fact_ids. Selection coverage is partial, never proof that an omitted experience does not exist. If an essential known detail is missing, you may request one bounded source read using the supplied handle. Only current-revision fact selectors are available; never request entities, threads, pages or historical snapshots. This grants no access to other characters' knowledge. Otherwise return JSON {"result":{"actor_id":"same id","intent":"goal","action":"attempt","speech":"optional speech","conditions":[],"used_fact_ids":[]}}. You cannot commit events or change world state.`

// An actor's evidence does not expose who else knows it, whether the reader
// knows it, or any reader-only display payload. Fact is authority storage and
// must not double as this audience's wire DTO.
type narrativeActorFact struct {
	ID             string `json:"id"`
	Kind           string `json:"kind"`
	Text           string `json:"text"`
	SubjectID      string `json:"subject_id"`
	SourceRevision int64  `json:"source_revision"`
}

func (p *narrativeRun) actorProjection(t narrativeTrigger) (json.RawMessage, error) {
	state := p.authority()
	var entity *Entity
	for i := range state.Entities {
		if state.Entities[i].ID == t.ActorID {
			entity = &state.Entities[i]
			break
		}
	}
	if entity == nil || entity.Kind != "character" && entity.Kind != "person" {
		return nil, fail("narrative_actor_invalid")
	}
	needs := ContextNeeds{ParticipantIDs: []string{t.ActorID}, FactIDs: append([]string{}, t.FactIDs...)}
	// An explicit same-stage read is a request to materialize these current,
	// authorized facts. Historical replies never become actor evidence.
	if p.readCompleted && p.activeActor == t.ActorID && len(p.context.Recalls) > 0 {
		r := p.context.Recalls[len(p.context.Recalls)-1]
		for _, obj := range r.Objects {
			if obj.Type == "fact" && obj.AsOfRevision == p.context.Revision {
				var f narrativeActorFact
				if json.Unmarshal(obj.Body, &f) == nil && f.ID != "" && !containsID(needs.FactIDs, f.ID) {
					needs.FactIDs = append(needs.FactIDs, f.ID)
				}
			}
		}
	}
	bundle, err := p.prepareMaterials("actor", t.ActorID, needs, p.materialBudget)
	if err != nil {
		if err.Error() == "narrative_material_reference_invalid" {
			return nil, fail("narrative_actor_invalid")
		}
		return nil, err
	}
	facts := bundle.ActorFacts
	if facts == nil {
		facts = []narrativeActorFact{}
	}
	known := map[string]narrativeActorFact{}
	for _, f := range facts {
		known[f.ID] = f
	}
	observed := []string{}
	selected := map[string]bool{}
	for _, id := range t.FactIDs {
		f, ok := known[id]
		if !ok || selected[id] {
			return nil, fail("narrative_actor_invalid")
		}
		observed = append(observed, f.Text)
		selected[id] = true
	}
	factIDs := []string{}
	p.actorFacts = map[string]bool{}
	for _, f := range facts {
		factIDs = append(factIDs, f.ID)
		p.actorFacts[f.ID] = true
	}
	// The director's notebook is derived with world-wide visibility. Its free
	// text (including goals, voice and relationship stance) has no actor-scoped
	// provenance, even if its optional fact references happen to be visible.
	// Forwarding it would bypass known_by. Character motives and beliefs reach
	// this stage through their authorized formal facts instead.
	attempt := ""
	input := strings.TrimSpace(p.context.Input)
	prefix := "我对" + entity.Name + "说：“"
	if t.Trigger != "" && strings.Contains(input, t.Trigger) && strings.HasPrefix(input, prefix) && strings.HasSuffix(input, "”") {
		body := strings.TrimSuffix(strings.TrimPrefix(input, prefix), "”")
		if !strings.ContainsAny(body, "“”") && body == t.Trigger {
			attempt = body
		}
	}
	return json.Marshal(struct {
		ActorID            string               `json:"actor_id"`
		Name               string               `json:"name"`
		Trigger            string               `json:"trigger"`
		FactIDs            []string             `json:"fact_ids"`
		Facts              []narrativeActorFact `json:"facts"`
		ConditionalAttempt string               `json:"conditional_attempt,omitempty"`
		Coverage           MaterialCoverage     `json:"coverage"`
		SourceHandle       string               `json:"source_handle"`
		ReadBudget         ReadBudget           `json:"read_budget"`
	}{t.ActorID, entity.Name, strings.Join(observed, "\n"), factIDs, facts, attempt, bundle.Coverage, p.context.StateCoverage.SourceHandle, p.context.ReadBudget})
}

func (p *narrativeRun) after(result *pb.ModelCallResult) error {
	if result.ErrorCode != "" {
		return nil
	}
	var wrapped struct {
		Result json.RawMessage `json:"result"`
	}
	if StrictJSON([]byte(result.Text), &wrapped) != nil || len(wrapped.Result) == 0 {
		if p.last == "extract" || p.last == "repair_extract" || p.last == "repair_state" {
			return p.extractionShapeFailure()
		}
		return fail("invalid_model_response")
	}
	{
		var shape map[string]json.RawMessage
		if json.Unmarshal(wrapped.Result, &shape) == nil && shape["selector"] != nil {
			if _, err := DecodeReadRequest(wrapped.Result); err != nil {
				return err
			}
			readStage := p.last
			if p.last == "actor" {
				readStage += ":" + p.activeActor
			}
			if p.readStages == nil {
				p.readStages = map[string]bool{}
			}
			if p.readStages[readStage] {
				return fail("recall_budget_exhausted")
			}
			p.readStages[readStage] = true
			p.pendingRead = true
			return nil
		}
	}
	switch p.last {
	case "plan":
		var plans struct {
			Candidates []struct {
				ID        string   `json:"id"`
				FactIDs   []string `json:"fact_ids"`
				ThreadIDs []string `json:"thread_ids"`
			} `json:"candidates"`
		}
		if json.Unmarshal(wrapped.Result, &plans) != nil || plans.Candidates == nil {
			return fail("narrative_plan_rejected")
		}
		p.planFactIDs, p.planThreadIDs = []string{}, []string{}
		p.plans = map[string]narrativePlanReferences{}
		for _, plan := range plans.Candidates {
			if plan.FactIDs == nil || plan.ThreadIDs == nil {
				return fail("narrative_plan_rejected")
			}
			if _, duplicate := p.plans[plan.ID]; !textOK(plan.ID) || duplicate {
				return fail("narrative_plan_rejected")
			}
			for _, id := range plan.FactIDs {
				if !p.stageFacts[id] {
					return fail("narrative_material_reference_invalid")
				}
				if !containsID(p.planFactIDs, id) {
					p.planFactIDs = append(p.planFactIDs, id)
				}
			}
			for _, id := range plan.ThreadIDs {
				if !p.stageThreads[id] {
					return fail("narrative_material_reference_invalid")
				}
				if !containsID(p.planThreadIDs, id) {
					p.planThreadIDs = append(p.planThreadIDs, id)
				}
			}
			p.plans[plan.ID] = narrativePlanReferences{FactIDs: append([]string{}, plan.FactIDs...), ThreadIDs: append([]string{}, plan.ThreadIDs...)}
		}
	case "evaluate":
		var scores struct {
			Evaluations []struct {
				EvidenceFactIDs []string `json:"evidence_fact_ids"`
			} `json:"evaluations"`
		}
		if json.Unmarshal(wrapped.Result, &scores) != nil || scores.Evaluations == nil {
			return fail("narrative_plan_rejected")
		}
		for _, score := range scores.Evaluations {
			if score.EvidenceFactIDs == nil {
				return fail("narrative_plan_rejected")
			}
			for _, id := range score.EvidenceFactIDs {
				if !p.stageFacts[id] {
					return fail("narrative_material_reference_invalid")
				}
			}
		}
	case "actor":
		var actor struct {
			ActorID     string   `json:"actor_id"`
			Intent      string   `json:"intent"`
			Action      string   `json:"action"`
			Speech      string   `json:"speech"`
			Conditions  []string `json:"conditions"`
			UsedFactIDs []string `json:"used_fact_ids"`
		}
		if StrictJSON(wrapped.Result, &actor) != nil || actor.ActorID != p.activeActor || actor.UsedFactIDs == nil {
			return fail("narrative_actor_invalid")
		}
		for _, id := range actor.UsedFactIDs {
			if !p.actorFacts[id] {
				return fail("narrative_actor_invalid")
			}
			if !containsID(p.actorUsedFactIDs, id) {
				p.actorUsedFactIDs = append(p.actorUsedFactIDs, id)
			}
		}
	case "write", "revise", "answer":
		var draft narrativeDraft
		if RequiredJSON(wrapped.Result, "title", "passage", "story_time", "outcome", "suggestions") != nil || StrictJSON(wrapped.Result, &draft) != nil || !textOK(draft.Passage) || draft.Suggestions == nil {
			return fail("invalid_candidate")
		}
		p.draft = &draft
		p.extracted = nil
		if p.last == "answer" {
			c := Candidate{Title: draft.Title, Passage: draft.Passage, StoryTime: draft.StoryTime, Outcome: draft.Outcome, Suggestions: draft.Suggestions, NewFacts: []Fact{}, NewEntities: []Entity{}, NewThreads: []Thread{}, RevealEntityIDs: []string{}, RevealThreadIDs: []string{}, RevealFactIDs: []string{}, ResolveThreadIDs: []string{}, KnowledgeChanges: []KnowledgeChange{}}
			p.extracted, _ = canonicalCandidate(c)
		}
	case "extract", "repair_extract", "repair_state":
		var extracted struct {
			Candidate json.RawMessage `json:"candidate"`
		}
		if StrictJSON(wrapped.Result, &extracted) != nil {
			return p.extractionShapeFailure()
		}
		candidateRaw, err := hydrateNarrativeExtraction(extracted.Candidate, p.draft)
		if err != nil {
			if err.Error() == "model_output_capacity" || err.Error() == "narrative_extraction_mismatch" {
				return err
			}
			return p.extractionShapeFailure()
		}
		// Keep the model's object bytes until the shared contract validates them.
		// Re-encoding a map first could erase duplicate keys or other wire faults.
		c, err := DecodeCandidate(candidateRaw)
		if err != nil || c.NarrativeUpdate == nil && c.MemoryChanges == nil && c.MemoryDelta == nil ||
			p.evidenceV2 && (c.MemoryDelta == nil || c.MemoryChanges != nil || c.NarrativeUpdate != nil) {
			return p.extractionShapeFailure()
		}
		if p.draft == nil || c.Title != p.draft.Title || c.Passage != p.draft.Passage || c.StoryTime != p.draft.StoryTime || c.Outcome != p.draft.Outcome || !bytes.Equal(narrativeMarshal(c.Suggestions), narrativeMarshal(p.draft.Suggestions)) {
			return fail("narrative_extraction_mismatch")
		}
		p.extracted, _ = canonicalCandidate(c)
		p.extractionInvalid = false
	case "memory":
		if len(wrapped.Result) > 2<<10 {
			return fail("context_budget_exceeded")
		}
		var m struct {
			Actors          []narrativeTrigger `json:"actors"`
			RelevantFactIDs []string           `json:"relevant_fact_ids"`
			Objective       string             `json:"objective"`
			ContextNeeds    *ContextNeeds      `json:"context_needs,omitempty"`
		}
		if StrictJSON(wrapped.Result, &m) != nil || m.Actors == nil || len(m.Actors) > p.context.Pipeline.MaxActors {
			return fail("narrative_actor_invalid")
		}
		if m.ContextNeeds != nil {
			if err := m.ContextNeeds.validate(); err != nil {
				return err
			}
			authorityEntities := map[string]bool{}
			for _, entity := range p.authority().Entities {
				authorityEntities[entity.ID] = true
			}
			// These fields name entity IDs in the pinned world, even when the
			// entry view omitted them. Descriptions and IDs of other record types
			// are not entity references and must not become retrieval scope.
			for _, ids := range [][]string{m.ContextNeeds.ParticipantIDs, m.ContextNeeds.RelationshipTargets} {
				for _, id := range ids {
					if !authorityEntities[id] {
						return fail("narrative_material_reference_invalid")
					}
				}
			}
			p.needs = *m.ContextNeeds
		}
		p.needs.FactIDs = append(p.needs.FactIDs, m.RelevantFactIDs...)
		authorityFacts := map[string]bool{}
		for _, f := range p.authority().Facts {
			if f.SourceRevision <= p.context.Revision {
				authorityFacts[f.ID] = true
			}
		}
		for _, id := range p.needs.FactIDs {
			if !authorityFacts[id] {
				return fail("narrative_material_reference_invalid")
			}
		}
		for _, v := range m.Actors {
			if _, ok := p.actors[v.ActorID]; ok {
				return fail("narrative_actor_invalid")
			}
			if _, err := p.actorProjection(v); err != nil {
				return err
			}
			p.actors[v.ActorID] = v
		}
	case "review", "repair_review":
		var review NarrativeReview
		if RequiredJSON(wrapped.Result, "approved", "issues", "supports", "knowledge_supports") != nil || StrictJSON(wrapped.Result, &review) != nil || review.Issues == nil || review.Supports == nil || review.KnowledgeSupports == nil || len(review.Issues) > 12 {
			return fail("narrative_review_rejected")
		}
		for _, issue := range review.Issues {
			if strings.TrimSpace(issue.Code) == "" || strings.TrimSpace(issue.Detail) == "" {
				return fail("narrative_review_rejected")
			}
		}
		var reviewFields map[string]json.RawMessage
		_ = json.Unmarshal(wrapped.Result, &reviewFields)
		if raw, supplied := reviewFields["repair_scope"]; supplied && (bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || review.RepairScope == "") {
			return fail("narrative_review_rejected")
		}
		if !validNarrativeRepairScope(review.RepairScope, review.Approved) || !review.Approved && len(review.Issues) == 0 {
			return fail("narrative_review_rejected")
		}
		p.approval = &NarrativeApproval{Engine: narrativeEngineVersion, Candidate: p.reviewed, Result: review, Evidence: p.evidenceCall}
		if len(narrativeMarshal(review.Issues)) > 2<<10 {
			return fail("context_budget_exceeded")
		}
		if !review.Approved && p.repairs == 0 {
			p.repairSource = &narrativeRepairBinding{
				Candidate: append(json.RawMessage(nil), p.reviewed...),
				Issues:    append([]NarrativeIssue(nil), review.Issues...), Scope: review.RepairScope,
			}
		}
		if review.Approved {
			var c Candidate
			_ = json.Unmarshal(p.reviewed, &c)
			if c.MemoryDelta != nil {
				if err := narrativeReviewEvidenceShape(c, review); err != nil {
					return err
				}
				resolved, err := resolveMemoryEvidence(c, p.approval)
				if err != nil {
					return err
				}
				p.approval.Evidence.Resolved = resolved
			}
			if err := verifyNarrativeApproval(c, p.approval); err != nil {
				// Only a quote mismatch with otherwise complete, unique and valid
				// references may reach one independent review of the frozen candidate.
				if err.Error() == "narrative_evidence_missing" && p.last == "review" && p.context.Mode != "ask" && p.repairs < p.context.Pipeline.MaxRepairs && narrativeReviewEvidenceShape(c, review) == nil {
					p.approval = nil
					p.reviewQuoteInvalid = true
					return nil
				}
				return err
			}
		}
	}
	return nil
}

// Let Rust observe the original malformed extraction only when the shared
// repair budget remains. No candidate/approval is retained or manufactured.
func (p *narrativeRun) extractionShapeFailure() error {
	p.extracted = nil
	p.extractionInvalid = true
	if p.last == "extract" && p.context.Pipeline != nil && p.repairs < p.context.Pipeline.MaxRepairs {
		return nil
	}
	return fail("invalid_candidate")
}
func narrativeMarshal(v any) []byte { raw, _ := json.Marshal(v); return raw }
func (p *narrativeRun) finish(c Candidate) (Candidate, error) {
	if p.last != "review" && p.last != "repair_review" {
		return Candidate{}, fail("narrative_review_rejected")
	}
	if err := verifyNarrativeApproval(c, p.approval); err != nil {
		return Candidate{}, err
	}
	c.Review = p.approval
	return c, nil
}
