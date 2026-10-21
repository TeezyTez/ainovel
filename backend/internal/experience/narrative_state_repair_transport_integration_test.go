//go:build integration

package experience

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/sqlc/pgq"
)

// Synthetic provider responses exercise the real Rust -> Go request path.
// They do not judge narrative quality, establish correct semantic classification,
// call a paid model, or alter any recorded benchmark evidence.
const stateRepairTransportPassage = "阿禾把杯子放在桌上。\n\n旁观者只看见杯子落在桌面，没有听见门后的事。\n\n  原字保留\"引号\"、字面\\n、反斜杠\\、<tag>🙂与\t制表符。"

type stateRepairTransportModel struct {
	base         syntheticPipelineModel
	mode         string
	override     string
	stages       []string
	requests     []model.Request
	initial      Candidate
	final        Candidate
	issues       []NarrativeIssue
	reviews      int
	extractions  int
	seenFeedback bool
	seenRepair   bool
	failure      error
}

func (*stateRepairTransportModel) Stream(context.Context, model.Request, func(model.Chunk) error) error {
	return fmt.Errorf("fixed state-repair control does not stream")
}

func stateRepairDraft(c Candidate) narrativeDraft {
	return narrativeDraft{c.Title, c.Passage, c.StoryTime, c.Outcome, c.Suggestions}
}

func stateRepairObject(c Candidate) map[string]json.RawMessage {
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(narrativeJSON(c), &fields)
	for _, key := range []string{"title", "passage", "story_time", "outcome", "suggestions"} {
		delete(fields, key)
	}
	return fields
}

// Rust and Go need not order JSON object members alike. Preserve all fields,
// array order and exact number spelling; reject duplicate keys before decoding.
func stateRepairJSONValue(raw []byte) (any, error) {
	var value any
	if err := StrictJSON(raw, &value); err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	return value, nil
}

func (m *stateRepairTransportModel) Generate(ctx context.Context, req model.Request) (result model.Result, err error) {
	defer func() {
		if err != nil {
			m.failure = err
		}
	}()
	stage := ""
	var body map[string]json.RawMessage
	users := 0
	for _, message := range req.Messages {
		if message.Role == "system" {
			for _, name := range []string{"memory", "plan", "evaluate", "write", "extract", "repair_extract", "review", "repair_review", "repair_state", "revise"} {
				if strings.Contains(message.Content, "阶段"+name+"：") {
					stage = name
				}
			}
		}
		if message.Role == "user" {
			users++
			if err := StrictJSON([]byte(message.Content), &body); err != nil {
				return model.Result{}, err
			}
		}
	}
	if stage == "" || users != 1 {
		return model.Result{}, fmt.Errorf("unknown stage or ambiguous user carrier")
	}
	m.stages = append(m.stages, stage)
	m.requests = append(m.requests, req)
	var output any
	switch stage {
	case "memory", "plan", "evaluate", "write":
		result, err = m.base.Generate(ctx, req)
		if err != nil {
			return result, err
		}
		if stage == "memory" {
			m.base.current.Title = "杯子与未传达的事"
			m.base.current.Passage = stateRepairTransportPassage
			m.base.current.Outcome = "awaits_player"
			m.base.current.Suggestions = []string{"留在桌旁", "看一眼杯子"}
			m.base.current.NarrativeUpdate = nil
			m.base.current.MemoryChanges = nil
			m.base.current.MemoryDelta = &MemoryDelta{Version: 2, Entries: []MemoryInterpretation{}}
			m.base.current.NewFacts = []Fact{{ID: "cup-r2", Kind: "fact", Text: "阿禾把杯子放在桌上。", SubjectID: "npc", Known: true, KnownBy: []string{"npc", "observer"}, SourceRevision: m.base.revision + 1}}
			m.base.current.KnowledgeChanges = []KnowledgeChange{{SubjectID: "observer", FactID: "hidden"}}
			m.initial = m.base.current
			m.final = m.initial
			m.final.KnowledgeChanges = []KnowledgeChange{}
			m.issues = []NarrativeIssue{{Code: "uncommunicated_record", Detail: "移除旁观者对未传达旧记录的整条授权；保留实际看到杯子的窄事实。"}}
		}
		return result, nil
	case "extract", "repair_extract":
		m.extractions++
		if stage == "extract" && m.extractions == 1 {
			if _, exists := body["repair_feedback"]; exists {
				return model.Result{}, fmt.Errorf("first extraction received stale repair feedback")
			}
			if m.mode == "shape_first" {
				output = map[string]any{"candidate": "{"}
				break
			}
			output = map[string]any{"candidate": stateRepairObject(m.initial)}
			break
		}
		if stage == "repair_extract" {
			output = map[string]any{"candidate": stateRepairObject(m.initial)}
			break
		}
		var feedback struct {
			CandidateState map[string]json.RawMessage `json:"candidate_state"`
			Issues         []NarrativeIssue           `json:"issues"`
		}
		if StrictJSON(body["repair_feedback"], &feedback) != nil {
			return model.Result{}, fmt.Errorf("revised extraction feedback is invalid")
		}
		actualState, actualErr := stateRepairJSONValue(narrativeJSON(feedback.CandidateState))
		expectedState, expectedErr := stateRepairJSONValue(narrativeJSON(stateRepairObject(m.initial)))
		if actualErr != nil || expectedErr != nil || !reflect.DeepEqual(actualState, expectedState) ||
			!reflect.DeepEqual(feedback.Issues, m.issues) {
			return model.Result{}, fmt.Errorf("revised extraction lost or changed rejected state/feedback")
		}
		var draft narrativeDraft
		if StrictJSON(body["draft"], &draft) != nil || !reflect.DeepEqual(draft, stateRepairDraft(m.final)) {
			return model.Result{}, fmt.Errorf("revised extraction did not receive current adopted draft")
		}
		m.seenFeedback = true
		output = map[string]any{"candidate": stateRepairObject(m.final)}
	case "repair_state":
		var rejected Candidate
		var issues []NarrativeIssue
		if StrictJSON(body["candidate"], &rejected) != nil || !reflect.DeepEqual(rejected, m.initial) ||
			StrictJSON(body["issues"], &issues) != nil || !reflect.DeepEqual(issues, m.issues) {
			return model.Result{}, fmt.Errorf("state repair changed frozen rejected candidate or issues")
		}
		if body["draft"] != nil || body["repair_feedback"] != nil {
			return model.Result{}, fmt.Errorf("state repair duplicated the frozen candidate carrier")
		}
		var source struct {
			State State `json:"state"`
		}
		if json.Unmarshal(body["context"], &source) != nil {
			return model.Result{}, fmt.Errorf("missing authoritative repair materials")
		}
		found := false
		for _, fact := range source.State.Facts {
			if fact.ID == "hidden" {
				found = fact.Text == "门后有暗井。" && reflect.DeepEqual(fact.KnownBy, []string{"npc"})
			}
			if fact.ID == "cup-r2" {
				return model.Result{}, fmt.Errorf("uncommitted candidate fact entered authority")
			}
		}
		if !found {
			return model.Result{}, fmt.Errorf("state repair lost original target and knowledge boundary")
		}
		m.seenRepair = true
		if m.mode == "state_bad_shape" {
			output = map[string]any{"candidate": "{"}
		} else if m.override != "" {
			full := map[string]any{}
			_ = json.Unmarshal(narrativeJSON(m.final), &full)
			switch m.override {
			case "suggestions":
				full[m.override] = []string{"另作决定"}
			case "outcome":
				full[m.override] = "continues"
			default:
				full[m.override] = "被修复器改写"
			}
			output = map[string]any{"candidate": full}
		} else {
			output = map[string]any{"candidate": stateRepairObject(m.final)}
		}
	case "revise":
		var draft narrativeDraft
		var issues []NarrativeIssue
		if StrictJSON(body["draft"], &draft) != nil || !reflect.DeepEqual(draft, stateRepairDraft(m.initial)) ||
			StrictJSON(body["issues"], &issues) != nil || !reflect.DeepEqual(issues, m.issues) {
			return model.Result{}, fmt.Errorf("draft revision lost original adopted draft or rejection")
		}
		m.final.Title += "·修订"
		m.final.Passage += "\n\n杯子仍在桌上。"
		m.final.Suggestions = []string{"继续坐着"}
		output = stateRepairDraft(m.final)
	case "review", "repair_review":
		m.reviews++
		var reviewed Candidate
		if StrictJSON(body["candidate"], &reviewed) != nil {
			return model.Result{}, fmt.Errorf("review candidate invalid")
		}
		want := m.initial
		if m.seenRepair || m.seenFeedback {
			want = m.final
		}
		if !reflect.DeepEqual(reviewed, want) {
			return model.Result{}, fmt.Errorf("review not bound to actual frozen candidate")
		}
		approve := m.reviews > 1 && m.mode != "reject_again" && m.mode != "quote_first"
		scope := any("candidate_state")
		if m.mode == "mixed" {
			scope = "mixed"
		}
		if approve {
			scope = "none"
		}
		issues := m.issues
		if approve {
			issues = []NarrativeIssue{}
		}
		outputMap := map[string]any{
			"approved": approve, "repair_scope": scope, "issues": issues,
			"supports": []NarrativeSupport{}, "knowledge_supports": []NarrativeKnowledgeSupport{},
			"reveal_supports": []NarrativeRevealSupport{}, "memory_supports": []NarrativeMemorySupport{},
		}
		if m.mode == "legacy" && m.reviews == 1 {
			delete(outputMap, "repair_scope")
		}
		if m.mode == "scope_null" {
			outputMap["repair_scope"] = nil
		}
		if m.mode == "scope_unknown" {
			outputMap["repair_scope"] = "free_form"
		}
		if approve || m.mode == "quote_first" && m.reviews == 1 {
			outputMap["approved"], outputMap["repair_scope"], outputMap["issues"] = true, "none", []NarrativeIssue{}
			quote := "阿禾把杯子放在桌上。"
			if m.mode == "state_bad_quote" || m.mode == "quote_first" {
				quote = "正文并没有出现的原句。"
			}
			outputMap["supports"] = []NarrativeSupport{{FactID: "cup-r2", Quote: quote}}
			supports := []NarrativeKnowledgeSupport{{SubjectID: "npc", FactID: "cup-r2", Quote: "阿禾把杯子放在桌上。"}, {SubjectID: "observer", FactID: "cup-r2", Quote: "旁观者只看见杯子落在桌面"}}
			if m.mode == "quote_first" {
				supports = append(supports, NarrativeKnowledgeSupport{SubjectID: "observer", FactID: "hidden", Quote: "没有听见门后的事"})
			}
			outputMap["knowledge_supports"] = supports
		}
		output = outputMap
	default:
		return model.Result{}, fmt.Errorf("unexpected fixed-control stage %s", stage)
	}
	raw, err := json.Marshal(map[string]any{"result": output})
	return model.Result{Text: string(raw)}, err
}

func stateRepairTransportContext(t *testing.T) Context {
	t.Helper()
	c := sampleContext()
	c.Revision, c.Mode, c.State.StoryTime = 1, "read", "午后"
	c.History = []HistoryPage{{Revision: 1, Mode: "begin", Input: c.Seed, Text: "阿禾和旁观者坐在桌旁，旧事尚未传达。"}}
	c.State.Entities = []Entity{
		{ID: "npc", Kind: "person", Name: "阿禾", Description: "在桌旁的人。", Known: true, RelatedIDs: []string{}},
		{ID: "observer", Kind: "person", Name: "旁观者", Description: "同桌的人。", Known: true, RelatedIDs: []string{}},
	}
	c.State.Facts = []Fact{{ID: "hidden", Kind: "secret", Text: "门后有暗井。", Known: false, KnownBy: []string{"npc"}, SourceRevision: 1}}
	c.Pipeline = &NarrativePipeline{Version: 1, MaxActors: 0, MaxRepairs: 1}
	view, err := compileGeneration(c, c.State, "state-repair-source", 1, ReadBudget{}, 32<<10)
	must(t, err)
	return view
}

// Fails if state-only rejection is sent to the writer, feedback disappears,
// frozen prose changes, a second repair is granted, or approval is transferable.
func TestActualRustStateRepairTransportFrozenDraftAndSingleBudget(t *testing.T) {
	address := actualReadRuntime(t)
	ctx := context.Background()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: address, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	for _, tc := range []struct {
		mode      string
		maxCalls  int
		wantCalls int
		wantError string
	}{
		{"state", 12, 8, ""},
		{"mixed", 12, 9, ""},
		{"legacy", 12, 9, ""},
		{"reject_again", 12, 8, "narrative_review_rejected"},
		{"state", 7, 6, "model_budget_exhausted"},
		{"mixed", 8, 6, "model_budget_exhausted"},
		{"shape_first", 12, 7, "narrative_review_rejected"},
		{"quote_first", 12, 7, "narrative_review_rejected"},
		{"state_bad_shape", 12, 7, "invalid_candidate"},
		{"state_bad_quote", 12, 8, "narrative_evidence_missing"},
		{"scope_null", 12, 6, "narrative_review_rejected"},
		{"scope_unknown", 12, 6, "narrative_review_rejected"},
	} {
		t.Run(fmt.Sprintf("%s_%d", tc.mode, tc.maxCalls), func(t *testing.T) {
			c := stateRepairTransportContext(t)
			before := string(narrativeJSON(c))
			m := &stateRepairTransportModel{mode: tc.mode}
			a := &Algorithm{Link: link, Model: m, ModelName: "synthetic-state-repair", MaxModelCalls: tc.maxCalls, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
			audit := &recordedReviewAudit{origin: syntheticPipelineOrigin(c)}
			out, err := a.GenerateWithReads(ctx, c, "state-repair-"+tc.mode+fmt.Sprint(tc.maxCalls), audit)
			if m.failure != nil {
				t.Fatalf("real outbound request violated control: %v stages=%v", m.failure, m.stages)
			}
			if len(m.requests) != tc.wantCalls || !reflect.DeepEqual(audit.stages, m.stages) {
				t.Fatalf("calls=%d want=%d audited=%v stages=%v error=%v", len(m.requests), tc.wantCalls, audit.stages, m.stages, err)
			}
			if string(narrativeJSON(c)) != before {
				t.Fatal("repair mutated its pinned authority/context")
			}
			if tc.wantError != "" {
				if err == nil || err.Error() != tc.wantError || out.Review != nil {
					t.Fatalf("error=%v want=%s approval=%v stages=%v", err, tc.wantError, out.Review, m.stages)
				}
				return
			}
			must(t, err)
			must(t, verifyNarrativeApproval(out, out.Review))
			if tc.mode == "state" && (!m.seenRepair || m.seenFeedback || !reflect.DeepEqual(stateRepairDraft(out), stateRepairDraft(m.initial))) {
				t.Fatal("state repair changed one of the five frozen draft fields")
			}
			if tc.mode != "state" && (!m.seenFeedback || m.seenRepair || !reflect.DeepEqual(stateRepairDraft(out), stateRepairDraft(m.final))) {
				t.Fatal("revised route lost feedback/current draft or used state-only route")
			}
			changed := out
			changed.KnowledgeChanges = append([]KnowledgeChange{}, m.initial.KnowledgeChanges...)
			if verifyNarrativeApproval(changed, out.Review) == nil {
				t.Fatal("approved repaired receipt authorized the rejected knowledge grant")
			}
			after, err := Apply(c, out)
			must(t, err)
			hiddenUnchanged := false
			for _, fact := range after.Facts {
				if fact.ID == "hidden" {
					hiddenUnchanged = reflect.DeepEqual(fact.KnownBy, []string{"npc"}) && fact.Text == "门后有暗井。"
				}
			}
			if len(after.Facts) != 2 || !hiddenUnchanged {
				t.Fatal("unapproved grant reached authority or valid narrow fact was discarded")
			}
		})
	}
	for _, field := range []string{"title", "passage", "story_time", "outcome", "suggestions"} {
		t.Run("reject_frozen_override_"+field, func(t *testing.T) {
			m := &stateRepairTransportModel{mode: "state", override: field}
			a := &Algorithm{Link: link, Model: m, ModelName: "synthetic-state-repair", MaxModelCalls: 12, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
			c := stateRepairTransportContext(t)
			out, err := a.GenerateWithReads(ctx, c, "state-override-"+field, &recordedReviewAudit{origin: syntheticPipelineOrigin(c)})
			if m.failure != nil || err == nil || err.Error() != "narrative_extraction_mismatch" || len(m.requests) != 7 || out.Review != nil {
				t.Fatalf("frozen field %s: error=%v spy=%v calls=%d", field, err, m.failure, len(m.requests))
			}
		})
	}
}

// Actual Service/SQL delivery must wait for the repaired candidate's independent
// approval. A later rejection preserves every original formal page/snapshot.
func TestActualRustStateRepairServiceCommitsOnlyApprovedCandidate(t *testing.T) {
	address := actualReadRuntime(t)
	ctx := context.Background()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: address, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	for _, reject := range []bool{false, true} {
		t.Run(fmt.Sprintf("reject_%v", reject), func(t *testing.T) {
			s, _, _ := testService(t)
			s.Generator = generateFunc(func(_ context.Context, c Context, _ string) (Candidate, error) {
				v := initial(c)
				v.NewEntities = append(v.NewEntities, Entity{ID: "observer", Kind: "person", Name: "旁观者", Description: "同桌的人。", Known: true, RelatedIDs: []string{}})
				v.NewFacts[1].Text = "门后有暗井。"
				return v, nil
			})
			v := begin(t, s, "state-repair-account", "initial")
			q := pgq.New(s.DB)
			before, err := q.ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: "state-repair-account", ExperienceID: v.ID, BranchID: v.BranchID, Revision: 1})
			must(t, err)
			mode := "state"
			if reject {
				mode = "reject_again"
			}
			m := &stateRepairTransportModel{mode: mode}
			s.NarrativeEngine = true
			s.Generator = &Algorithm{Link: link, Model: m, ModelName: "synthetic-state-repair", MaxModelCalls: 12, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
			_, fresh, err := s.Advance(ctx, "state-repair-account", v.ID, AdvanceRequest{RequestID: "next", BranchID: v.BranchID, ExpectedRevision: 1, Mode: "read"})
			must(t, err)
			if !fresh {
				t.Fatal("test operation was not accepted")
			}
			must(t, s.GenerateAccepted(ctx, "state-repair-account", "next"))
			current, err := s.Get(ctx, "state-repair-account", v.ID, v.BranchID)
			must(t, err)
			op, err := s.GetOperation(ctx, "state-repair-account", v.ID, "next")
			must(t, err)
			after, err := q.ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: "state-repair-account", ExperienceID: v.ID, BranchID: v.BranchID, Revision: 1})
			must(t, err)
			if string(before) != string(after) || len(current.Pages) < len(v.Pages) || !reflect.DeepEqual(current.Pages[:len(v.Pages)], v.Pages) || len(m.requests) != 8 || m.failure != nil {
				t.Fatalf("formal prefix changed or repair path incomplete: requests=%d spy=%v operation=%+v", len(m.requests), m.failure, op)
			}
			if reject {
				if op.Status != "failed" || op.ErrorCode == nil || *op.ErrorCode != "narrative_review_rejected" || current.Revision != 1 || len(current.Pages) != len(v.Pages) {
					t.Fatalf("rejected repair committed: operation=%+v view=%+v", op, current)
				}
			} else {
				if op.Status != "committed" || current.Revision != 2 || len(current.Pages) != len(v.Pages)+1 || current.Pages[len(current.Pages)-1].Text != stateRepairTransportPassage {
					t.Fatalf("approved repair did not commit exact frozen prose: operation=%+v revision=%d", op, current.Revision)
				}
				raw, err := q.ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: "state-repair-account", ExperienceID: v.ID, BranchID: v.BranchID, Revision: 2})
				must(t, err)
				var state State
				must(t, json.Unmarshal(raw, &state))
				narrowFact, oldPermission := false, false
				for _, fact := range state.Facts {
					if fact.ID == "cup-r2" {
						narrowFact = fact.Text == "阿禾把杯子放在桌上。" && reflect.DeepEqual(fact.KnownBy, []string{"npc", "observer"})
					}
					if fact.ID == "hidden" {
						oldPermission = reflect.DeepEqual(fact.KnownBy, []string{"npc"})
					}
				}
				if !narrowFact || !oldPermission {
					t.Fatal("SQL committed rejected grant or lost approved narrow fact")
				}
			}
		})
	}
}
