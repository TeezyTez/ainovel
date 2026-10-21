//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode"
	"unicode/utf8"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
)

// This repeated text is deliberately synthetic. It tests transport, frozen prose,
// bounded model calls and formal approval, never narrative quality.
func readingEfficiencyPassage() string {
	paragraphs := make([]string, 10)
	for i := range paragraphs {
		paragraphs[i] = strings.Repeat("雨落青石，微光照在窗前。", 15)
	}
	paragraphs[0] = "  \t「原字」\\n<窗>🙂\n" + paragraphs[0]
	return strings.Join(paragraphs, "\n\n")
}

func readingEfficiencyTextCounts(text string) (characters, han, paragraphs int) {
	characters = utf8.RuneCountInString(text)
	for _, r := range text {
		if unicode.Is(unicode.Han, r) {
			han++
		}
	}
	for _, paragraph := range strings.Split(text, "\n\n") {
		if strings.TrimSpace(paragraph) != "" {
			paragraphs++
		}
	}
	return
}

func readingEfficiencyStage(request model.Request) string {
	for _, message := range request.Messages {
		if message.Role != "system" {
			continue
		}
		if strings.HasPrefix(message.Content, "You propose one fictional character's next intention.") {
			return "actor"
		}
		for _, stage := range []string{"memory", "actor", "plan", "evaluate", "write", "extract", "repair_extract", "review", "repair_review", "revise", "answer"} {
			if strings.Contains(message.Content, "阶段"+stage+"：") {
				return stage
			}
		}
	}
	return ""
}

type readingEfficiencyExtraction struct {
	Stage        string `json:"stage"`
	FullBytes    int    `json:"full_candidate_output_bytes"`
	CompactBytes int    `json:"compact_output_bytes"`
}

type readingEfficiencyModel struct {
	syntheticPipelineModel
	extractions []readingEfficiencyExtraction
	reviewed    []Candidate
}

func (m *readingEfficiencyModel) Generate(ctx context.Context, request model.Request) (model.Result, error) {
	result, err := m.syntheticPipelineModel.Generate(ctx, request)
	if err != nil {
		return result, err
	}
	stage := m.stages[len(m.stages)-1]
	switch stage {
	case "write", "revise":
		m.current.Passage = readingEfficiencyPassage()
		result.Text = string(narrativeJSON(map[string]any{"result": narrativeDraft{
			m.current.Title, m.current.Passage, m.current.StoryTime, m.current.Outcome, m.current.Suggestions,
		}}))
	case "extract", "repair_extract":
		var wire struct {
			Result map[string]json.RawMessage `json:"result"`
		}
		if err := json.Unmarshal([]byte(result.Text), &wire); err != nil {
			return model.Result{}, err
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(wire.Result["candidate"], &fields); err != nil {
			// Keep the deliberate first malformed extraction; repair must consume
			// its one bounded attempt and still accept a compact response.
			return result, nil
		}
		fullBytes := len(result.Text)
		for _, field := range []string{"title", "passage", "story_time", "outcome", "suggestions"} {
			delete(fields, field)
		}
		result.Text = string(narrativeJSON(map[string]any{"result": map[string]any{"candidate": fields}}))
		m.extractions = append(m.extractions, readingEfficiencyExtraction{stage, fullBytes, len(result.Text)})
	case "review":
		found := false
		for _, message := range request.Messages {
			if message.Role != "user" {
				continue
			}
			var input struct {
				Candidate Candidate `json:"candidate"`
			}
			if err := json.Unmarshal([]byte(message.Content), &input); err != nil {
				return model.Result{}, err
			}
			if !reflect.DeepEqual(input.Candidate, m.current) {
				return model.Result{}, fmt.Errorf("independent review did not receive the complete frozen candidate")
			}
			m.reviewed = append(m.reviewed, input.Candidate)
			found = true
		}
		if !found {
			return model.Result{}, fmt.Errorf("independent review missing candidate")
		}
	}
	return result, nil
}

func TestActualRustReadingEfficiencyPreservesLongDraftAndApproval(t *testing.T) {
	address := actualReadRuntime(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: address, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	for _, tc := range []struct {
		name          string
		extractFault  string
		removeReview  bool
		wantStages    []string
		wantExtractAt string
	}{
		{"compact_commit", "", false, []string{"memory", "plan", "evaluate", "write", "extract", "review"}, "extract"},
		{"compact_repair", "shape_once", false, []string{"memory", "plan", "evaluate", "write", "extract", "repair_extract", "review"}, "repair_extract"},
		{"approval_removed", "", true, []string{"memory", "plan", "evaluate", "write", "extract", "review"}, "extract"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _, _ := testService(t)
			before := begin(t, s, "reading-efficiency", "synthetic-begin")
			m := &readingEfficiencyModel{syntheticPipelineModel: syntheticPipelineModel{extractFault: tc.extractFault}}
			algorithm := &Algorithm{Link: link, Model: m, ModelName: "synthetic-reading-efficiency", Timeout: 10 * time.Second, MaxModelCalls: 12, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
			s.NarrativeEngine, s.ProseFirst, s.Generator = true, false, algorithm
			approvalRemoved := false
			if tc.removeReview {
				s.Generator = pipelineReaderGenerateFunc(func(ctx context.Context, context Context, operation string, reader Reader) (Candidate, error) {
					candidate, err := algorithm.GenerateWithReads(ctx, context, operation, reader)
					if err == nil {
						if err = verifyNarrativeApproval(candidate, candidate.Review); err != nil {
							return Candidate{}, err
						}
						candidate.Review = nil
						approvalRemoved = true
					}
					return candidate, err
				})
			}
			request := AdvanceRequest{RequestID: "default-read", BranchID: before.BranchID, ExpectedRevision: before.Revision, Mode: "read"}
			_, fresh, err := s.Advance(ctx, "reading-efficiency", before.ID, request)
			must(t, err)
			if !fresh {
				t.Fatal("default read was not fresh")
			}
			must(t, s.GenerateAccepted(ctx, "reading-efficiency", request.RequestID))
			after, err := s.Get(ctx, "reading-efficiency", before.ID, before.BranchID)
			must(t, err)
			operation, err := s.GetOperation(ctx, "reading-efficiency", before.ID, request.RequestID)
			must(t, err)
			if !reflect.DeepEqual(m.stages, tc.wantStages) || m.calls != len(tc.wantStages) {
				t.Fatalf("unexpected retry/call path: calls=%d stages=%v operation=%s", m.calls, m.stages, narrativeJSON(operation))
			}
			if len(m.reviewed) != 1 || len(m.extractions) != 1 || m.extractions[0].Stage != tc.wantExtractAt {
				t.Fatalf("missing independent review/extraction evidence: reviews=%d extractions=%+v", len(m.reviewed), m.extractions)
			}
			extraction := m.extractions[0]
			if extraction.FullBytes-extraction.CompactBytes < len(m.current.Passage) {
				t.Fatalf("compact response retransmitted frozen prose: %+v passage_bytes=%d", extraction, len(m.current.Passage))
			}
			if !reflect.DeepEqual(before.Pages, after.Pages[:len(before.Pages)]) {
				t.Fatal("previous formal page changed")
			}
			if tc.removeReview {
				if !approvalRemoved || after.Revision != before.Revision || len(after.Pages) != len(before.Pages) || operation.Status != "failed" || operation.CommittedRevision != nil || operation.ErrorCode == nil || *operation.ErrorCode != "narrative_review_rejected" {
					t.Fatalf("candidate without independent approval reached commit: removed=%v revision=%d operation=%s", approvalRemoved, after.Revision, narrativeJSON(operation))
				}
			} else if after.Revision != before.Revision+1 || operation.Status != "committed" || after.Pages[len(after.Pages)-1].Text != readingEfficiencyPassage() {
				t.Fatalf("long frozen draft did not commit byte for byte: revision=%d operation=%s", after.Revision, narrativeJSON(operation))
			}
			characters, han, paragraphs := readingEfficiencyTextCounts(m.current.Passage)
			t.Logf("synthetic_only characters=%d han=%d paragraphs=%d calls=%d extract_full_bytes=%d extract_compact_bytes=%d saved_bytes=%d", characters, han, paragraphs, m.calls, extraction.FullBytes, extraction.CompactBytes, extraction.FullBytes-extraction.CompactBytes)
		})
	}
}
