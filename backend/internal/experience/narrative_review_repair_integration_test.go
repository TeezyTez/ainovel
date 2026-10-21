//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"google.golang.org/protobuf/proto"
)

// This fixed replay tests real Rust/Go transport and approval boundaries only.
// Original legacy bytes are decoded and hash-checked first. Only this current-
// engine transport control replaces its old notebook carrier with an empty v2
// delta; it does NOT reproduce the old memory update or claim semantic
// equivalence. All other candidate fields and every failed quote stay exact.
type recordedReviewReplayModel struct {
	fixture   recordedReviewFixture
	candidate Candidate
	review    NarrativeReview
	mode      string
	requests  []model.Request
	responses []string
}

func (*recordedReviewReplayModel) Stream(context.Context, model.Request, func(model.Chunk) error) error {
	return fmt.Errorf("recorded fixture does not stream")
}
func (m *recordedReviewReplayModel) Generate(_ context.Context, request model.Request) (model.Result, error) {
	index := len(m.requests)
	m.requests = append(m.requests, request)
	var response string
	if index < len(m.fixture.Outputs) {
		response = m.fixture.Outputs[index].Raw
		if m.fixture.Outputs[index].Stage == "extract" {
			var err error
			response, err = transcribeRecordedExtractionV2Control(response)
			if err != nil {
				return model.Result{}, err
			}
		}
	} else {
		if index != len(m.fixture.Outputs) {
			return model.Result{}, fmt.Errorf("unbounded extra attempt")
		}
		isRepair := false
		for _, message := range request.Messages {
			if message.Role == "system" && strings.Contains(message.Content, "阶段repair_review：") {
				isRepair = true
			}
			if message.Role == "user" {
				var input struct {
					Candidate Candidate `json:"candidate"`
				}
				if err := json.Unmarshal([]byte(message.Content), &input); err != nil {
					return model.Result{}, err
				}
				if !reflect.DeepEqual(input.Candidate, m.candidate) {
					return model.Result{}, fmt.Errorf("review repair changed frozen candidate")
				}
			}
		}
		if !isRepair {
			return model.Result{}, fmt.Errorf("unexpected extra stage")
		}
		r := m.review
		r.Supports = append([]NarrativeSupport(nil), r.Supports...)
		if m.mode == "repair" {
			start, end := strings.Index(m.candidate.Passage, "余叔蹲在船边"), strings.Index(m.candidate.Passage, "他盯了片刻")
			r.Supports[1].Quote = m.candidate.Passage[start:end]
		} else if m.mode == "reject" {
			r.Approved = false
			r.Issues = []NarrativeIssue{{Code: "fixture_rejection", Detail: "A bounded reviewer may refuse the unchanged candidate."}}
		}
		response = string(narrativeMarshal(map[string]any{"result": r}))
	}
	m.responses = append(m.responses, response)
	return model.Result{Text: response}, nil
}

// Test-only wire migration. Invalid legacy JSON still fails; this does not repair
// or normalize the malformed inner strings from the NAR-017 failed attempt.
func transcribeRecordedExtractionObject(raw string) (string, error) {
	var source struct {
		Result struct {
			CandidateJSON string `json:"candidate_json"`
		} `json:"result"`
	}
	if err := StrictJSON([]byte(raw), &source); err != nil {
		return "", err
	}
	if _, err := DecodeCandidate([]byte(source.Result.CandidateJSON)); err != nil {
		return "", err
	}
	encoded, err := json.Marshal(map[string]any{"result": map[string]any{"candidate": json.RawMessage(source.Result.CandidateJSON)}})
	return string(encoded), err
}

type recordedReviewAudit struct {
	stages []string
	origin narrativeEvidenceOrigin
}

func (r *recordedReviewAudit) MemoryEvidenceOrigin(context.Context) (narrativeEvidenceOrigin, error) {
	return r.origin, nil
}

func (*recordedReviewAudit) Read(context.Context, ReadRequest) (ReadReply, error) {
	return ReadReply{}, fmt.Errorf("unexpected fixture read")
}
func (r *recordedReviewAudit) RecordModel(_ context.Context, _ Context, sequence int, raw []byte) error {
	var call pb.ModelCallRequest
	if err := proto.Unmarshal(raw, &call); err != nil {
		return err
	}
	if sequence != len(r.stages)+1 {
		return fmt.Errorf("missing model attempt")
	}
	r.stages = append(r.stages, call.NarrativeStage)
	return nil
}

func TestActualRustRecordedReviewRepairPreservesEveryAttemptAndAuthority(t *testing.T) {
	address := actualReadRuntime(t)
	ctx := context.Background()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: address, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	for _, tc := range []struct {
		mode, wantError string
		calls           int
	}{
		{"repair", "", 9}, {"repeat", "narrative_evidence_missing", 9}, {"reject", "narrative_review_rejected", 9}, {"disabled", "narrative_evidence_missing", 8}, {"calls_exhausted", "model_budget_exhausted", 8},
	} {
		t.Run(tc.mode, func(t *testing.T) {
			f, legacy, r := recordedReview(t)
			c := recordedCandidateV2Control(legacy)
			restored := c
			restored.NarrativeUpdate, restored.MemoryChanges, restored.MemoryDelta = legacy.NarrativeUpdate, legacy.MemoryChanges, legacy.MemoryDelta
			if !reflect.DeepEqual(restored, legacy) {
				t.Fatal("current-engine transcription changed non-memory candidate fields")
			}
			if tc.mode == "disabled" {
				f.Context.Pipeline.MaxRepairs = 0
			}
			m := &recordedReviewReplayModel{fixture: f, candidate: c, review: r, mode: tc.mode}
			a := &Algorithm{Link: link, Model: m, ModelName: "recorded-review-structural-only", MaxModelCalls: 12, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
			if tc.mode == "calls_exhausted" {
				a.MaxModelCalls = 8
			}
			audit := &recordedReviewAudit{origin: syntheticPipelineOrigin(f.Context)}
			out, err := a.GenerateWithReads(ctx, f.Context, "recorded-review-"+tc.mode, audit)
			if len(m.requests) != tc.calls || len(m.responses) != tc.calls || len(audit.stages) != tc.calls {
				t.Fatalf("attempt evidence missing: requests=%d responses=%d audit=%v", len(m.requests), len(m.responses), audit.stages)
			}
			for i, o := range f.Outputs {
				expected := o.Raw
				if o.Stage == "extract" {
					var err error
					expected, err = transcribeRecordedExtractionV2Control(o.Raw)
					must(t, err)
					var actual struct {
						Result struct {
							Candidate Candidate `json:"candidate"`
						} `json:"result"`
					}
					must(t, json.Unmarshal([]byte(m.responses[i]), &actual))
					if !reflect.DeepEqual(actual.Result.Candidate, c) {
						t.Fatal("explicit current-engine transcription changed its expected candidate")
					}
				}
				if m.responses[i] != expected || audit.stages[i] != o.Stage {
					t.Fatal("failed quote/stage attempt changed outside the declared memory-carrier transcription")
				}
			}
			if tc.calls == 9 && audit.stages[8] != "repair_review" {
				t.Fatal("extra attempt not bounded review")
			}
			if tc.wantError != "" {
				if err == nil || err.Error() != tc.wantError {
					t.Fatalf("error=%v want=%s", err, tc.wantError)
				}
				if out.Review != nil {
					t.Fatal("failed review emitted approval")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := verifyNarrativeApproval(out, out.Review); err != nil {
				t.Fatal(err)
			}
			comparison := out
			comparison.Review = nil
			if !reflect.DeepEqual(comparison, c) {
				t.Fatal("repair changed candidate")
			}
			if _, err := Apply(f.Context, out); err != nil {
				t.Fatalf("repaired exact candidate failed full authority: %v", err)
			}
		})
	}
}

// This is a new fixed-output control, not a lossless v1 memory conversion.
func recordedCandidateV2Control(c Candidate) Candidate {
	c.NarrativeUpdate, c.MemoryChanges = nil, nil
	c.MemoryDelta = &MemoryDelta{Version: 2, Entries: []MemoryInterpretation{}}
	return c
}

func transcribeRecordedExtractionV2Control(raw string) (string, error) {
	object, err := transcribeRecordedExtractionObject(raw)
	if err != nil {
		return "", err
	}
	var source struct {
		Result struct {
			Candidate Candidate `json:"candidate"`
		} `json:"result"`
	}
	if err := StrictJSON([]byte(object), &source); err != nil {
		return "", err
	}
	encoded, err := json.Marshal(map[string]any{"result": map[string]any{"candidate": recordedCandidateV2Control(source.Result.Candidate)}})
	return string(encoded), err
}
