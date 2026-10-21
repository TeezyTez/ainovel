//go:build integration

package experience

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"reflect"
	"sync/atomic"
	"testing"

	"elselife/backend/internal/capability/model"
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"elselife/backend/internal/sqlc/pgq"
	"google.golang.org/protobuf/proto"
)

// Fixed provider results drive the real compiler, binding, review, Apply and
// SQL commit. This is an engineering control, not semantic approval or a model
// call. Private approval fields are never manufactured or edited by this test.
type memoryCommitRecheckGenerator struct {
	kind         string
	calls        atomic.Int64
	reply        ReadReply
	approved     bool
	beforeReturn func(Context, Candidate, MemoryEvidenceRef) error
}

func (g *memoryCommitRecheckGenerator) Generate(context.Context, Context, string) (Candidate, error) {
	return Candidate{}, fail("test_requires_source_reader")
}

func (g *memoryCommitRecheckGenerator) GenerateWithReads(ctx context.Context, c Context, _ string, reader Reader) (Candidate, error) {
	g.calls.Add(1)
	source, ok := reader.(*sourceReader)
	if !ok {
		return Candidate{}, fail("test_requires_actual_source_reader")
	}
	origin, err := source.MemoryEvidenceOrigin(ctx)
	if err != nil {
		return Candidate{}, err
	}
	oldRevision := int64(1)
	request := ReadRequest{RequestID: "commit-source", SourceHandle: c.StateCoverage.SourceHandle,
		MaxReplyBytes: 8192}
	switch g.kind {
	case "page":
		request.Selector = ReadSelector{Kind: "pages", FromRevision: &oldRevision, ToRevision: &oldRevision}
	case "fact":
		request.Selector = ReadSelector{Kind: "objects", Objects: []ReadTarget{
			{Type: "fact", ID: "known", AtRevision: &oldRevision},
		}}
	default:
		return Candidate{}, fail("test_unknown_source_kind")
	}
	v := candidate(c)
	v.Passage = "The visitor returned the borrowed book."
	v.MemoryDelta = &MemoryDelta{Version: 2, Entries: []MemoryInterpretation{{
		ID: "commit-return", Kind: "episode", SubjectIDs: []string{"npc"}, TargetIDs: []string{},
		Cue: "returned book", Summary: v.Passage, Status: "resolved",
		RetrievalKeys: []string{"book"}, FactIDs: []string{},
	}}}
	if g.kind == "fact" {
		v.MemoryDelta.Entries[0].FactIDs = []string{"known"}
	}
	p := newNarrativeRun(c)
	p.evidenceV2, p.evidenceOrigin = true, &origin
	p.last = "extract"
	p.extracted, err = canonicalCandidate(v)
	if err != nil {
		return Candidate{}, err
	}
	p.materialBudget, p.stageInputBudget = 12<<10, 64<<10
	newReviewCall := func() *pb.ModelCallRequest {
		return &pb.ModelCallRequest{NarrativeStage: "review", Model: "fixed", SchemaJson: `{"type":"object"}`, MaxOutputBytes: 8192,
			Messages: []*pb.ModelMessage{{Role: "system", Content: "Synthetic protocol reviewer."}, {
				Role: "user", Content: string(narrativeMarshal(map[string]any{
					"context": reviewHydrationWireContext(p.context, p.context.State), "candidate": v,
				})),
			}}}
	}
	recordAndBind := func(call *pb.ModelCallRequest, sequence int) error {
		provider := model.Request{Model: "fixed", Schema: json.RawMessage(call.SchemaJson), MaxOutputTokens: 8192}
		for _, message := range call.Messages {
			provider.Messages = append(provider.Messages, model.Message{Role: message.Role, Content: message.Content})
		}
		raw, err := proto.Marshal(call)
		if err != nil {
			return err
		}
		if err = reader.RecordModel(ctx, p.context, sequence, raw); err != nil {
			return err
		}
		return p.bindMemoryEvidenceRequest(sequence, raw, provider)
	}
	call := newReviewCall()
	if _, err = p.before(call); err != nil {
		return Candidate{}, err
	}
	if err = recordAndBind(call, 1); err != nil {
		return Candidate{}, err
	}
	// The reviewer explicitly asks for the old version in this stage.
	// Reading it during an earlier stage would not entitle a new memory to
	// reinstall arbitrary cached historical versions.
	if err = p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": request}))}); err != nil {
		return Candidate{}, err
	}
	if !p.pendingRead || !p.readStages["review"] {
		return Candidate{}, fail("test_review_did_not_request_source")
	}
	g.reply, err = reader.Read(ctx, request)
	if err != nil {
		return Candidate{}, err
	}
	if !g.reply.Complete || g.reply.BaseRevision != c.Revision || source.reads != 1 {
		return Candidate{}, fail("test_incomplete_actual_read")
	}
	// Exactly the Algorithm transition after a successful Reader.Read.
	// Keep the original receipt, and let the real same-stage compiler
	// install its source bytes in the resumed request.
	p.context.Recalls = append(p.context.Recalls, g.reply)
	p.pendingRead, p.readCompleted = false, true
	call = newReviewCall()
	if _, err = p.before(call); err != nil {
		return Candidate{}, err
	}
	if p.pendingRead || p.readCompleted || !p.readStages["review"] || p.repairs != 0 {
		return Candidate{}, fail("test_review_source_resume_changed_budget")
	}
	currentID, dependencyID := "", ""
	var dependency MemoryEvidenceRef
	for _, item := range p.evidencePacket.Sources {
		if item.Kind == "candidate" {
			currentID = item.ID
		}
		if g.kind == "page" && item.Kind == "formal_page" && item.Revision == oldRevision {
			dependencyID = item.ID
			dependency = MemoryEvidenceRef{Kind: "formal_page", Revision: item.Revision, TextSHA256: item.TextSHA256}
		}
		if g.kind == "fact" && item.Kind == "authority_fact" && item.FactID == "known" && item.AsOfRevision == oldRevision {
			dependencyID = item.ID
			dependency = MemoryEvidenceRef{Kind: "authority_fact", FactID: item.FactID,
				AsOfRevision: item.AsOfRevision, RecordSHA256: item.RecordSHA256}
		}
	}
	if currentID == "" || dependencyID == "" {
		return Candidate{}, fail("test_requested_dependency_not_in_actual_registry")
	}
	if err = recordAndBind(call, 2); err != nil {
		return Candidate{}, err
	}
	review := NarrativeReview{Approved: true, RepairScope: "none", Issues: []NarrativeIssue{},
		Supports: []NarrativeSupport{}, KnowledgeSupports: []NarrativeKnowledgeSupport{},
		MemorySupports: []NarrativeMemorySupport{{MemoryID: "commit-return", SourceIDs: []string{currentID, dependencyID}}}}
	if err = p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": review}))}); err != nil {
		return Candidate{}, err
	}
	v, err = p.finish(v)
	if err != nil {
		return Candidate{}, err
	}
	if v.Review.Evidence == nil || v.Review.Evidence.Sequence != 2 {
		return Candidate{}, fail("test_approval_not_bound_to_resumed_review")
	}
	refs, err := verifyMemoryDeltaApproval(c, v)
	if err != nil {
		return Candidate{}, err
	}
	found := false
	for _, ref := range refs["commit-return"] {
		found = found || ref == dependency
	}
	if !found {
		return Candidate{}, fail("test_approval_lost_selected_dependency")
	}
	g.approved = true
	if g.beforeReturn != nil {
		if err = g.beforeReturn(c, v, dependency); err != nil {
			return Candidate{}, err
		}
	}
	return v, nil
}

type memoryCommitStoredHistory struct {
	Branch pgq.ExperienceBranch
	Pages  []pgq.ExperiencePage
}

func memoryCommitStored(t *testing.T, db *sql.DB, account string, v View) memoryCommitStoredHistory {
	t.Helper()
	ctx := context.Background()
	q := pgq.New(db)
	branches, err := q.ExperienceBranches(ctx, pgq.ExperienceBranchesParams{AccountID: account, ExperienceID: v.ID})
	must(t, err)
	var result memoryCommitStoredHistory
	for _, branch := range branches {
		if branch.ID == v.BranchID {
			result.Branch = branch
		}
	}
	if result.Branch.ID == "" {
		t.Fatal("missing test branch")
	}
	result.Pages, err = q.ExperiencePages(ctx, pgq.ExperiencePagesParams{
		AccountID: account, ExperienceID: v.ID, BranchID: v.BranchID, ThroughRevision: result.Branch.Revision + 1,
	})
	must(t, err)
	return result
}

func TestMemoryEvidenceCommitRechecksPreviouslyApprovedDatabaseSources(t *testing.T) {
	for _, kind := range []string{"page", "fact"} {
		for _, tamper := range []bool{false, true} {
			name := kind + "/unchanged"
			if tamper {
				name = kind + "/changed-after-approval"
			}
			t.Run(name, func(t *testing.T) {
				s, admin, _ := testService(t)
				ctx, account := context.Background(), "commit-recheck"
				v := begin(t, s, account, "begin")
				v = advance(t, s, account, v, "second", "read")
				if v.Revision != 2 {
					t.Fatal("control requires an old source separate from the current branch")
				}
				g := &memoryCommitRecheckGenerator{kind: kind}
				var beforeCommit memoryCommitStoredHistory
				var beforeApproval []byte
				g.beforeReturn = func(c Context, approved Candidate, dependency MemoryEvidenceRef) error {
					// The actual source query and exact-request approval have
					// already succeeded, before any database mutation.
					_, err := Apply(c, approved)
					must(t, err)
					before := memoryCommitStored(t, admin, account, v)
					first := before.Pages[0]
					if first.Revision != 1 {
						t.Fatal("missing original source")
					}
					if kind == "page" {
						var page Page
						must(t, StrictJSON(first.Page, &page))
						if len(g.reply.Pages) != 1 || g.reply.Pages[0] != page.HistoryPage ||
							dependency.TextSHA256 != memoryPageSHA256(page.Text) {
							t.Fatal("approved page was not the actual unchanged SQL source")
						}
						if tamper {
							page.Text += "\nChanged after source read and approval."
							_, err = admin.ExecContext(ctx, `UPDATE experience_pages SET page=$1
WHERE account_id=$2 AND experience_id=$3 AND branch_id=$4 AND revision=1`,
								mustJSON(t, page), account, v.ID, v.BranchID)
							must(t, err)
						}
					} else {
						var state State
						must(t, StrictJSON(first.State, &state))
						index := -1
						for i, fact := range state.Facts {
							if fact.ID == "known" {
								index = i
							}
						}
						if index < 0 || len(g.reply.Objects) != 1 {
							t.Fatal("missing as-of fact control")
						}
						fact := state.Facts[index]
						hash, err := memoryFactSHA256(fact)
						must(t, err)
						var readFact Fact
						must(t, StrictJSON(g.reply.Objects[0].Body, &readFact))
						if !reflect.DeepEqual(readFact, fact) || dependency.RecordSHA256 != hash ||
							dependency.AsOfRevision != 1 || !reflect.DeepEqual(fact.KnownBy, []string{"npc"}) {
							t.Fatal("approved fact was not the complete original as-of record")
						}
						if tamper {
							state.Facts[index].KnownBy = []string{}
							// Text, ID and SourceRevision are unchanged: only
							// the complete record's knowledge edges differ.
							_, err = admin.ExecContext(ctx, `UPDATE experience_pages SET state=$1
WHERE account_id=$2 AND experience_id=$3 AND branch_id=$4 AND revision=1`,
								mustJSON(t, state), account, v.ID, v.BranchID)
							must(t, err)
						}
					}
					beforeCommit = memoryCommitStored(t, admin, account, v)
					if !reflect.DeepEqual(before.Branch, beforeCommit.Branch) ||
						!reflect.DeepEqual(before.Pages[1], beforeCommit.Pages[1]) {
						t.Fatal("control modified current authority rather than only the old source")
					}
					if reflect.DeepEqual(before.Pages[0], beforeCommit.Pages[0]) == tamper {
						t.Fatal("control did not make exactly the intended historical change")
					}
					// The frozen request and approved candidate still validate:
					// the later SQL source check must be what rejects tampering.
					_, err = Apply(c, approved)
					must(t, err)
					op, err := pgq.New(admin).ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{
						AccountID: account, RequestID: "next",
					})
					must(t, err)
					beforeApproval = append([]byte(nil), op.NarrativeApproval...)
					if len(beforeApproval) != 0 || op.Status != "generating" {
						t.Fatal("approval was persisted before the commit transaction")
					}
					return nil
				}
				s.NarrativeEngine, s.Generator = true, g
				_, _, err := s.Advance(ctx, account, v.ID, AdvanceRequest{
					RequestID: "next", BranchID: v.BranchID, ExpectedRevision: v.Revision, Mode: "read",
				})
				must(t, err)
				// failOperation records domain failure and may return nil.
				must(t, s.GenerateAccepted(ctx, account, "next"))
				if !g.approved || g.calls.Load() != 1 || beforeCommit.Branch.ID == "" {
					t.Fatal("test did not reach approved candidate followed by the commit boundary")
				}
				q := pgq.New(admin)
				op, err := q.ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: account, RequestID: "next"})
				must(t, err)
				reads, err := q.ExperienceReadAudit(ctx, pgq.ExperienceReadAuditParams{AccountID: account, OperationID: "next"})
				must(t, err)
				inputs, err := q.ExperienceModelInputAudit(ctx, pgq.ExperienceModelInputAuditParams{AccountID: account, OperationID: "next"})
				must(t, err)
				if len(reads) != 1 || len(inputs) != 2 || inputs[0].Sequence != 1 || inputs[1].Sequence != 2 ||
					op.ProgressPhase != "committing" {
					t.Fatal("did not execute actual source read, recorded binding and commit", op.ProgressPhase)
				}
				var recorded ReadReply
				must(t, StrictJSON(reads[0].Reply, &recorded))
				recordedHash, err := receiptHash(recorded)
				must(t, err)
				originalHash, err := receiptHash(g.reply)
				must(t, err)
				// SQL JSONB may reformat RawMessage bodies. Compare complete
				// canonical values and preserve both original receipt hashes.
				if recordedHash != originalHash || recorded.Receipt != g.reply.Receipt {
					t.Fatal("actual original read receipt changed after later DB mutation")
				}
				after := memoryCommitStored(t, admin, account, v)
				if tamper {
					if op.Status != "failed" || op.ErrorCode.String != "invalid_literary_memory" ||
						op.CommittedRevision.Valid || !bytes.Equal(beforeApproval, op.NarrativeApproval) ||
						len(op.Candidate) != 0 || !reflect.DeepEqual(beforeCommit, after) {
						t.Fatalf("changed approved dependency wrote formal page/state/index/approval: status=%s code=%s",
							op.Status, op.ErrorCode.String)
					}
				} else {
					if op.Status != "committed" || !op.CommittedRevision.Valid || op.CommittedRevision.Int64 != 3 ||
						after.Branch.Revision != 3 || len(after.Pages) != 3 || len(op.NarrativeApproval) == 0 ||
						!reflect.DeepEqual(beforeCommit.Pages, after.Pages[:2]) {
						t.Fatal("same-chain unchanged-source positive control did not commit", op.Status, op.ErrorCode)
					}
					var state State
					must(t, StrictJSON(after.Branch.State, &state))
					if state.LiteraryMemory == nil || state.LiteraryMemory.Version != 2 ||
						len(state.LiteraryMemory.Entries) != 1 || state.LiteraryMemory.Entries[0].ID != "commit-return" {
						t.Fatal("positive control did not persist the approved memory index")
					}
				}
			})
		}
	}
}
