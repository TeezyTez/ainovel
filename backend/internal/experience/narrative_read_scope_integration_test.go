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

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
)

// Fixed-model transport/commit control, not evidence of chapter quality.
type boundedReadingModel struct {
	syntheticPipelineModel
	paragraphs     int
	readingRequest string
}

func (m *boundedReadingModel) Generate(ctx context.Context, request model.Request) (model.Result, error) {
	result, err := m.syntheticPipelineModel.Generate(ctx, request)
	if err != nil {
		return result, err
	}
	stage := m.stages[len(m.stages)-1]
	if stage == "memory" || stage == "answer" {
		for _, message := range request.Messages {
			if message.Role == "user" {
				var c struct {
					ReadingRequest string `json:"reading_request"`
				}
				if json.Unmarshal([]byte(message.Content), &c) == nil {
					m.readingRequest = c.ReadingRequest
				}
			}
		}
		parts := make([]string, m.paragraphs)
		for i := range parts {
			parts[i] = fmt.Sprintf("第%d处自然段。雨声渐轻，窗沿留下水珠。", i+1)
		}
		m.current.Passage = strings.Join(parts, "\n\n")
		if stage == "answer" {
			result.Text = string(narrativeJSON(map[string]any{"result": narrativeDraft{m.current.Title, m.current.Passage, m.current.StoryTime, m.current.Outcome, m.current.Suggestions}}))
		}
	}
	return result, nil
}

func TestActualRustReadingScopePreservesBoundedParagraphsAndOtherModes(t *testing.T) {
	address := actualReadRuntime(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: address, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	for _, tc := range []struct {
		name, mode string
		paragraphs int
		reject     bool
		commits    bool
		calls      int
	}{
		{"short_read_still_valid", "read", 3, false, true, 6},
		{"expanded_read", "read", 4, false, true, 6},
		{"maximum_read", "read", 24, false, true, 6},
		{"expanded_revision", "read", 4, true, true, 9},
		{"too_many_read_paragraphs", "read", 25, false, false, 4},
		{"act_keeps_three", "act", 4, false, false, 4},
		{"ask_keeps_three", "ask", 4, false, false, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _, _ := testService(t)
			before := begin(t, s, "read-scope", "begin")
			m := &boundedReadingModel{paragraphs: tc.paragraphs}
			m.rejectOnce = tc.reject
			s.NarrativeEngine = true
			s.Generator = &Algorithm{Link: link, Model: m, ModelName: "synthetic-reading-scope", Timeout: 5 * time.Second, MaxModelCalls: 12, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
			request := AdvanceRequest{RequestID: "bounded-read", BranchID: before.BranchID, ExpectedRevision: before.Revision, Mode: tc.mode, Input: "观察窗外。"}
			if tc.mode == "read" {
				request.Input = ""
				request.ReadingRequest = "请完整展开接下来这一节，保留自然的对白和段落。"
			}
			_, fresh, err := s.Advance(ctx, "read-scope", before.ID, request)
			must(t, err)
			if !fresh {
				t.Fatal("request not fresh")
			}
			must(t, s.GenerateAccepted(ctx, "read-scope", request.RequestID))
			after, err := s.Get(ctx, "read-scope", before.ID, before.BranchID)
			must(t, err)
			op, err := s.GetOperation(ctx, "read-scope", before.ID, request.RequestID)
			must(t, err)
			if m.calls != tc.calls {
				t.Fatalf("calls=%d want=%d stages=%v", m.calls, tc.calls, m.stages)
			}
			if m.readingRequest != request.ReadingRequest {
				t.Fatal("reading request changed before memory/answer")
			}
			if !reflect.DeepEqual(before.Pages, after.Pages[:len(before.Pages)]) {
				t.Fatal("earlier formal page changed")
			}
			if tc.commits {
				if after.Revision != before.Revision+1 || op.Status != "committed" || after.Pages[len(after.Pages)-1].Text != m.current.Passage {
					t.Fatalf("bounded passage failed exact commit: op=%+v rev=%d", op, after.Revision)
				}
			} else if after.Revision != before.Revision || op.Status != "failed" || op.CommittedRevision != nil || op.ErrorCode == nil || *op.ErrorCode != "narrative_stage_invalid" {
				t.Fatalf("out-of-scope passage not rejected: op=%+v rev=%d", op, after.Revision)
			}
		})
	}
}
