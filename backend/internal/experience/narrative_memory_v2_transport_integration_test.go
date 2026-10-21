//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/sqlc/pgq"
)

// Only protocol controls without a Service use this explicit synthetic origin.
// It is not a database-issued credential or proof of transactional lifecycle.
func syntheticPipelineOrigin(c Context) narrativeEvidenceOrigin {
	return narrativeEvidenceOrigin{Kind: "operation", ID: "synthetic-protocol-origin", ExperienceID: c.ExperienceID,
		BranchID: c.BranchID, BaseRevision: c.Revision, SourceHandle: c.StateCoverage.SourceHandle,
		Pin: memoryPageSHA256("synthetic protocol origin, not a persisted operation")}
}

// Preserve the actual Reader when a Service test wraps an Algorithm. A wrapper
// that implements only Generate would accidentally bypass the origin boundary.
type pipelineReaderGenerateFunc func(context.Context, Context, string, Reader) (Candidate, error)

func (f pipelineReaderGenerateFunc) Generate(context.Context, Context, string) (Candidate, error) {
	return Candidate{}, fmt.Errorf("fixed integration wrapper requires actual source reader")
}
func (f pipelineReaderGenerateFunc) GenerateWithReads(ctx context.Context, c Context, id string, reader Reader) (Candidate, error) {
	return f(ctx, c, id, reader)
}

// Native v2 synthetic outputs exercise real Rust, Go evidence registration and
// SQL commit. They make no claim about semantic review or literary quality.
type memoryV2TransportModel struct {
	syntheticPipelineModel
	priorRevision int64
	packet        memoryEvidencePacket
	request       model.Request
	failure       error
}

func (m *memoryV2TransportModel) Generate(ctx context.Context, request model.Request) (result model.Result, err error) {
	defer func() {
		if err != nil {
			m.failure = err
		}
	}()
	result, err = m.syntheticPipelineModel.Generate(ctx, request)
	if err != nil {
		return result, err
	}
	stage := m.stages[len(m.stages)-1]
	if stage == "memory" {
		m.current.Passage = "雨停后，阿禾把借来的书放回书柜。"
		m.current.MemoryDelta = &MemoryDelta{Version: 2, Entries: []MemoryInterpretation{{
			ID: "returned-book", Kind: "episode", SubjectIDs: []string{"npc"}, TargetIDs: []string{},
			Cue: "归还的书", Summary: m.current.Passage, Status: "resolved", RetrievalKeys: []string{"书柜"}, FactIDs: []string{},
		}}}
	}
	if stage != "review" {
		return result, nil
	}
	var body struct {
		Candidate      Candidate            `json:"candidate"`
		MemoryEvidence memoryEvidencePacket `json:"memory_evidence"`
	}
	users := 0
	for _, message := range request.Messages {
		if message.Role == "user" {
			users++
			if err = json.Unmarshal([]byte(message.Content), &body); err != nil {
				return model.Result{}, err
			}
		}
	}
	if users != 1 || !reflect.DeepEqual(body.Candidate, m.current) || body.MemoryEvidence.Version != 2 {
		return model.Result{}, fmt.Errorf("review lost full frozen candidate or actual registry")
	}
	ids := []string{}
	current, prior := false, false
	for _, source := range body.MemoryEvidence.Sources {
		if source.Kind == "candidate" && source.Location == "/candidate/passage" && source.TextSHA256 == memoryPageSHA256(m.current.Passage) {
			ids = append(ids, source.ID)
			current = true
		}
		if m.priorRevision > 0 && source.Kind == "formal_page" && source.Revision == m.priorRevision {
			if source.TextSHA256 != memoryPageSHA256(m.current.Passage) {
				return model.Result{}, fmt.Errorf("prior whole page hash changed")
			}
			ids = append(ids, source.ID)
			prior = true
		}
	}
	if !current || m.priorRevision > 0 && !prior {
		return model.Result{}, fmt.Errorf("expected whole sources were not in actual payload")
	}
	if m.priorRevision > 0 {
		if len(body.MemoryEvidence.RequiredPages) != 1 || body.MemoryEvidence.RequiredPages[0] != (memoryRequiredPage{MemoryID: "returned-book", Revision: m.priorRevision, Loaded: true}) {
			return model.Result{}, fmt.Errorf("existing identity did not require its latest formal page")
		}
	} else if len(body.MemoryEvidence.RequiredPages) != 0 {
		return model.Result{}, fmt.Errorf("new memory invented required history")
	}
	m.packet, m.request = body.MemoryEvidence, request
	review := NarrativeReview{Approved: true, RepairScope: "none", Issues: []NarrativeIssue{}, Supports: []NarrativeSupport{}, KnowledgeSupports: []NarrativeKnowledgeSupport{}, RevealSupports: []NarrativeRevealSupport{},
		MemorySupports: []NarrativeMemorySupport{{MemoryID: "returned-book", SourceIDs: ids}}}
	return model.Result{Text: string(narrativeJSON(map[string]any{"result": review}))}, nil
}

func TestActualRustMemoryV2SourcesCommitAndIdentityUpdate(t *testing.T) {
	address := actualReadRuntime(t)
	ctx := context.Background()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: address, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	s, _, _ := testService(t)
	initialView := begin(t, s, "memory-v2-transport", "begin")
	q := pgq.New(s.DB)
	original, err := q.ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: "memory-v2-transport", ExperienceID: initialView.ID, BranchID: initialView.BranchID, Revision: 1})
	must(t, err)
	var initialState State
	must(t, json.Unmarshal(original, &initialState))
	view := initialView
	for _, prior := range []int64{0, 2} {
		producer := &memoryV2TransportModel{priorRevision: prior}
		s.NarrativeEngine = true
		s.Generator = &Algorithm{Link: link, Model: producer, ModelName: "synthetic-memory-v2", MaxModelCalls: 12, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
		id := fmt.Sprintf("memory-v2-%d", view.Revision+1)
		_, fresh, err := s.Advance(ctx, "memory-v2-transport", view.ID, AdvanceRequest{RequestID: id, BranchID: view.BranchID, ExpectedRevision: view.Revision, Mode: "read"})
		must(t, err)
		if !fresh {
			t.Fatal("fixed operation not accepted")
		}
		must(t, s.GenerateAccepted(ctx, "memory-v2-transport", id))
		next, err := s.Get(ctx, "memory-v2-transport", view.ID, view.BranchID)
		must(t, err)
		op, err := s.GetOperation(ctx, "memory-v2-transport", view.ID, id)
		must(t, err)
		if producer.failure != nil || op.Status != "committed" || next.Revision != view.Revision+1 || producer.calls != 6 {
			t.Fatalf("actual v2 path failed: operation=%+v spy=%v stages=%v", op, producer.failure, producer.stages)
		}
		if !reflect.DeepEqual(view.Pages, next.Pages[:len(view.Pages)]) || next.Pages[len(next.Pages)-1].Text != producer.current.Passage {
			t.Fatal("formal prose/prefix changed")
		}
		raw, err := q.ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: "memory-v2-transport", ExperienceID: view.ID, BranchID: view.BranchID, Revision: next.Revision})
		must(t, err)
		var state State
		must(t, json.Unmarshal(raw, &state))
		if !reflect.DeepEqual(state.Facts, initialState.Facts) || state.LiteraryMemory == nil || state.LiteraryMemory.Version != 2 || len(state.LiteraryMemory.Entries) != 1 {
			t.Fatal("memory changed fact permission or failed native v2 commit")
		}
		entry := state.LiteraryMemory.Entries[0]
		want := []MemoryEvidenceRef{}
		if prior > 0 {
			want = append(want, MemoryEvidenceRef{Kind: "formal_page", Revision: prior, TextSHA256: memoryPageSHA256(producer.current.Passage)})
		}
		want = append(want, MemoryEvidenceRef{Kind: "formal_page", Revision: next.Revision, TextSHA256: memoryPageSHA256(producer.current.Passage)})
		want, err = normalizeMemoryDependencies(want)
		must(t, err)
		if entry.ID != "returned-book" || entry.EvidenceKind != "source_refs_v2" || entry.UpdatedRevision != next.Revision || !reflect.DeepEqual(entry.EvidenceRefs, want) || entry.Quote != "" {
			t.Fatalf("source IDs did not resolve to exact durable refs: %+v", entry)
		}
		audits, err := q.ExperienceModelInputAudit(ctx, pgq.ExperienceModelInputAuditParams{AccountID: "memory-v2-transport", OperationID: id})
		must(t, err)
		if len(audits) != 6 {
			t.Fatal("actual model attempt audit missing", len(audits))
		}
		row, err := q.ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: "memory-v2-transport", RequestID: id})
		must(t, err)
		var approval NarrativeApproval
		must(t, StrictJSON(row.NarrativeApproval, &approval))
		if approval.Evidence == nil || approval.Evidence.Origin.ID != id || approval.Evidence.ProviderRequestSHA256 == "" || !reflect.DeepEqual(approval.Evidence.Registry, producer.packet) {
			t.Fatal("commit did not bind actual reviewed registry and operation")
		}
		t.Logf("native_v2 revision=%d calls=%d sources=%d required_pages=%d durable_refs=%d", next.Revision, producer.calls, len(producer.packet.Sources), len(producer.packet.RequiredPages), len(entry.EvidenceRefs))
		view = next
	}
	unchanged, err := q.ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: "memory-v2-transport", ExperienceID: initialView.ID, BranchID: initialView.BranchID, Revision: 1})
	must(t, err)
	if string(unchanged) != string(original) {
		t.Fatal("v2 writes changed the original formal snapshot")
	}
}
