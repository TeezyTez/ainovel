//go:build integration

package experience

import (
	"context"
	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

// Actual Rust transport with an explicitly synthetic model. These fixtures
// measure stage order, approval and cache/commit behavior, never prose quality.
type syntheticPipelineModel struct {
	calls          int
	current        Candidate
	revision       int64
	rejectOnce     bool
	rejected       bool
	stages         []string
	extractFault   string
	extractFaulted bool
}

func (*syntheticPipelineModel) Stream(context.Context, model.Request, func(model.Chunk) error) error {
	return fmt.Errorf("synthetic fixture does not stream")
}

func (m *syntheticPipelineModel) Generate(_ context.Context, req model.Request) (model.Result, error) {
	stage := ""
	for _, message := range req.Messages {
		if message.Role == "system" {
			for _, name := range []string{"memory", "plan", "evaluate", "write", "extract", "repair_extract", "review", "revise", "answer"} {
				if strings.Contains(message.Content, "阶段"+name+"：") {
					stage = name
				}
			}
		}
	}
	if stage == "" {
		return model.Result{}, fmt.Errorf("synthetic fixture cannot identify stage")
	}
	m.calls++
	m.stages = append(m.stages, stage)
	var result any
	plan := func(id string) any {
		return map[string]any{"id": id, "purpose": "观察雨势变化", "beats": []string{"雨停"}, "causes": []string{"雨势变小"}, "costs": []string{"等待"}, "consequences": []string{"街道安静"}, "thread_ids": []string{}, "fact_ids": []string{}}
	}
	switch stage {
	case "memory", "answer":
		for _, message := range req.Messages {
			if message.Role == "user" {
				var c struct {
					Revision int64  `json:"revision"`
					Mode     string `json:"mode"`
					State    State  `json:"state"`
				}
				if json.Unmarshal([]byte(message.Content), &c) == nil && c.Mode != "" {
					m.revision = c.Revision
					m.current = candidate(Context{State: c.State})
					if stage == "memory" {
						// Native v2 fixture: no rewrite or conversion of a legacy notebook.
						m.current.MemoryDelta = &MemoryDelta{Version: 2, Entries: []MemoryInterpretation{}}
					}
				}
			}
		}
		if stage == "memory" {
			result = map[string]any{"actors": []any{}, "relevant_fact_ids": []string{}, "objective": "观察雨势"}
		} else {
			result = narrativeDraft{m.current.Title, m.current.Passage, m.current.StoryTime, m.current.Outcome, m.current.Suggestions}
		}
	case "plan":
		result = map[string]any{"candidates": []any{plan("p1"), plan("p2")}}
	case "evaluate":
		evaluations := []any{}
		for _, id := range []string{"p1", "p2"} {
			evaluations = append(evaluations, map[string]any{"candidate_id": id, "continuity": 5, "agency": 5, "causality": 5, "consequence": 5, "pacing": 5, "interest": 5, "blocking_issues": []string{}, "evidence_fact_ids": []string{}})
		}
		result = map[string]any{"evaluations": evaluations}
	case "write", "revise":
		result = narrativeDraft{m.current.Title, m.current.Passage, m.current.StoryTime, m.current.Outcome, m.current.Suggestions}
	case "extract", "repair_extract":
		result = map[string]any{"candidate": m.current}
		if m.extractFault == "always_shape" || m.extractFault == "shape_once" && !m.extractFaulted {
			result = map[string]any{"candidate": "{"}
			m.extractFaulted = true
		}
		if m.extractFault == "semantic_reference" {
			invalid := m.current
			invalid.RevealFactIDs = []string{"nonexistent"}
			result = map[string]any{"candidate": invalid}
		}
	case "review":
		review := NarrativeReview{Approved: true, Issues: []NarrativeIssue{}, Supports: []NarrativeSupport{}, KnowledgeSupports: []NarrativeKnowledgeSupport{}, RevealSupports: []NarrativeRevealSupport{}, MemorySupports: []NarrativeMemorySupport{}}
		if m.rejectOnce && !m.rejected {
			review.Approved = false
			review.Issues = []NarrativeIssue{{Code: "style", Detail: "synthetic bounded revision test"}}
			m.rejected = true
		}
		result = review
	}
	raw, err := json.Marshal(map[string]any{"result": result})
	return model.Result{Text: string(raw)}, err
}

func TestActualRustNarrativeExtractionRepairAndFailureClassification(t *testing.T) {
	addr := actualReadRuntime(t)
	ctx := context.Background()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: addr, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	for _, tc := range []struct {
		name, fault, wantError string
		reject                 bool
		calls                  int
	}{
		{"shape_repaired", "shape_once", "", false, 7},
		{"second_shape_fails", "always_shape", "invalid_candidate", false, 6},
		{"no_second_budget_for_review", "shape_once", "narrative_review_rejected", true, 7},
		{"semantic_reference_not_protocol", "semantic_reference", "invalid_candidate", false, 5},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _, _ := testService(t)
			m := &syntheticPipelineModel{extractFault: tc.fault, rejectOnce: tc.reject}
			s.NarrativeEngine = true
			s.Generator = &Algorithm{Link: link, Model: m, ModelName: "synthetic-pipeline", MaxModelCalls: 12, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
			v := begin(t, s, "account", "begin")
			op, err := s.GetOperation(ctx, "account", v.ID, "begin")
			must(t, err)
			if m.calls != tc.calls {
				t.Fatalf("calls=%d want=%d stages=%v", m.calls, tc.calls, m.stages)
			}
			if tc.wantError != "" {
				if op.Status != "failed" || op.ErrorCode == nil || *op.ErrorCode != tc.wantError || v.Revision != 0 {
					t.Fatalf("unexpected failure state %+v revision=%d", op, v.Revision)
				}
			} else if op.Status != "committed" || v.Revision != 1 {
				t.Fatalf("repaired page did not commit after review: %+v revision=%d", op, v.Revision)
			}
		})
	}
}

func TestActualRustNarrativePipelineApprovalPreparationAndAsk(t *testing.T) {
	addr := actualReadRuntime(t)
	ctx := context.Background()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: addr, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	for _, repair := range []bool{false, true} {
		t.Run(fmt.Sprintf("repair_%v", repair), func(t *testing.T) {
			s, _, _ := testService(t)
			m := &syntheticPipelineModel{rejectOnce: repair}
			s.NarrativeEngine = true
			s.Generator = &Algorithm{Link: link, Model: m, ModelName: "synthetic-pipeline", Timeout: 5 * time.Second, MaxModelCalls: 12, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
			v := begin(t, s, "account", "begin")
			if v.Revision != 1 {
				op, err := s.GetOperation(ctx, "account", v.ID, "begin")
				t.Fatalf("pipeline did not commit: %+v %v stages=%v", op, err, m.stages)
			}
			expected := 6
			if repair {
				expected = 9
			}
			if m.calls != expected {
				t.Fatalf("calls %d expected %d, stages %v", m.calls, expected, m.stages)
			}
			must(t, s.PrepareNext(ctx, "account", v.ID, v.BranchID, 1))
			calls := m.calls
			_, _, err := s.Advance(ctx, "account", v.ID, AdvanceRequest{RequestID: "read", BranchID: v.BranchID, ExpectedRevision: 1, Mode: "read"})
			must(t, err)
			must(t, s.GenerateAccepted(ctx, "account", "read"))
			if m.calls != calls {
				t.Fatal("ready read reran model")
			}
			v, err = s.Get(ctx, "account", v.ID, v.BranchID)
			must(t, err)
			if v.Revision != 2 {
				t.Fatal("cached scene not committed")
			}
			before, err := s.ExportArchive(ctx, "account")
			must(t, err)
			v = advance(t, s, "account", v, "ask", "ask")
			if v.Revision != 3 {
				t.Fatal("ask unavailable")
			}
			after, err := s.ExportArchive(ctx, "account")
			must(t, err)
			if string(narrativeJSON(before.Experiences[0].Branches[0].State)) != string(narrativeJSON(after.Experiences[0].Branches[0].State)) {
				t.Fatal("ask mutated private notebook or world")
			}
		})
	}
}
