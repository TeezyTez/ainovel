//go:build integration

package experience

import (
	"context"
	"strings"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/sqlc/pgq"
)

// The real Rust prompt/schema/envelope reaches the Go model guard; the model
// response is a fixed fixture and does not measure literary quality or speed.
func TestActualRustNarrativeCapacityTrimsBeforeFinalModelRequest(t *testing.T) {
	addr := actualReadRuntime(t)
	link := channel.NewLink(context.Background(), channel.ClientOptions{Addr: addr, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	m := &newtestsFeedbackModel{text: `{"result":{"narrative":"这是容量边界结构测试正文。","title":"测试","story_time":"","suggestions":[],"metadata_json":"{}"}}`}
	a := &Algorithm{ProseFirst: true, Link: link, Model: m, ModelName: "capacity-fixture", Timeout: 5 * time.Second, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
	s := &Service{ProseFirst: true, Generator: a}
	authority := longNarrativeCapacityContext()
	generation, err := s.buildGeneration(context.Background(), pgq.ExperienceOperation{BaseRevision: authority.Revision}, authority)
	if err != nil {
		t.Fatal(err)
	}
	if generation.HistoryComplete || len(generation.History) >= len(authority.History) || generation.History[len(generation.History)-1].Text != authority.History[len(authority.History)-1].Text {
		t.Fatal("history was not trimmed as whole old pages", generation.HistoryComplete, len(generation.History))
	}
	_, err = a.Generate(context.Background(), generation, "experience-capacity-fixture")
	if err != nil || len(m.requests) != 1 {
		t.Fatalf("trimmed context failed actual final model request: %v; calls=%d", err, len(m.requests))
	}
}

// This native-v2 synthetic producer retains a large adopted passage. The
// complete legacy notebook remains in commit authority, never re-emitted as a
// replacement. This measures current-engine transport, not legacy equivalence.
type pipelineCapacityModel struct {
	syntheticPipelineModel
}

func (m *pipelineCapacityModel) Generate(ctx context.Context, request model.Request) (model.Result, error) {
	result, err := m.syntheticPipelineModel.Generate(ctx, request)
	if err == nil && m.stages[len(m.stages)-1] == "memory" {
		m.current.Passage = strings.Repeat("雨", 2600)
	}
	return result, err
}

func TestActualRustPipelineCapacityRetainsLegacyAuthorityAndLargeReview(t *testing.T) {
	addr := actualReadRuntime(t)
	link := channel.NewLink(context.Background(), channel.ClientOptions{Addr: addr, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	authority := pipelineCapacityContext(t)
	beforeAuthority := string(narrativeJSON(authority.State))
	m := &pipelineCapacityModel{}
	a := &Algorithm{Link: link, Model: m, ModelName: "capacity-fixture", Timeout: 5 * time.Second, MaxModelCalls: 12, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
	s := &Service{NarrativeEngine: true, Generator: a}
	generation, err := s.buildGeneration(context.Background(), pgq.ExperienceOperation{BaseRevision: authority.Revision}, authority)
	if err != nil {
		t.Fatal(err)
	}
	candidate, err := a.GenerateWithReads(context.Background(), generation, "experience-pipeline-capacity-fixture", &recordedReviewAudit{origin: syntheticPipelineOrigin(generation)})
	if err != nil || m.calls != 6 {
		t.Fatalf("bounded current engine failed before full review: %v; stages=%v", err, m.stages)
	}
	after, err := Apply(authority, candidate)
	if err != nil {
		t.Fatal("large reviewed candidate invalid", err)
	}
	if len(candidate.Passage) != 7800 || candidate.NarrativeUpdate != nil || candidate.MemoryDelta == nil || len(candidate.MemoryDelta.Entries) != 0 ||
		len(narrativeJSON(authority.State.Narrative)) != 12<<10 || string(narrativeJSON(authority.State)) != beforeAuthority ||
		string(narrativeJSON(after.Narrative)) != string(narrativeJSON(authority.State.Narrative)) {
		t.Fatal("current transport truncated prose, replaced legacy authority, or invented a memory migration")
	}
}
