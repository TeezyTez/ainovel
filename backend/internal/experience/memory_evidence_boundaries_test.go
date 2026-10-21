package experience

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"elselife/backend/internal/capability/model"
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"google.golang.org/protobuf/proto"
)

// Fixed engineering controls only: valid synthetic receipt hashes do not
// certify semantic entailment, nor simulate the database reader's pagination.
func memoryBoundaryReply(t *testing.T, p *narrativeRun, from, to int64, pages []HistoryPage, complete bool) (ReadRequest, ReadReply) {
	t.Helper()
	request := ReadRequest{RequestID: fmt.Sprintf("pages-%d-%d", from, to), SourceHandle: p.context.StateCoverage.SourceHandle,
		Selector: ReadSelector{Kind: "pages", FromRevision: &from, ToRevision: &to}, MaxReplyBytes: 8192}
	if _, err := DecodeReadRequest(narrativeMarshal(request)); err != nil {
		t.Fatal("invalid control read request", err)
	}
	reply := ReadReply{RequestID: request.RequestID, SourceHandle: request.SourceHandle,
		ExperienceID: p.context.ExperienceID, BranchID: p.context.BranchID, BaseRevision: p.context.Revision,
		Audience: "author", Objects: []ReadObject{}, Pages: pages, Complete: complete}
	if !complete {
		cursor := "synthetic-next-page"
		reply.NextCursor = &cursor
	}
	var err error
	reply.Receipt.QuerySHA256, err = receiptHash(request)
	if err != nil {
		t.Fatal(err)
	}
	reply.Receipt.BodySHA256, err = replyBodyHash(reply)
	if err != nil || validateContract(narrativeMarshal(reply), "read_reply") != nil {
		t.Fatal("invalid control receipt/reply", err)
	}
	return request, reply
}

func memoryBoundaryOld(id string, revision int64, passage string) MemoryEntry {
	return MemoryEntry{MemoryChange: MemoryChange{ID: id, Kind: "episode", SubjectIDs: []string{"speaker"},
		TargetIDs: []string{}, Cue: "earlier event", Summary: "An earlier event was recorded.", Status: "active",
		RetrievalKeys: []string{"book"}, FactIDs: []string{}, Quote: passage},
		SourceRevision: revision, UpdatedRevision: revision, SourceSHA256: memoryPageSHA256(passage)}
}

func memoryBoundaryCandidate(t *testing.T, p *narrativeRun) Candidate {
	t.Helper()
	var candidate Candidate
	if err := StrictJSON(p.extracted, &candidate); err != nil {
		t.Fatal(err)
	}
	return candidate
}

func memoryBoundaryCall(p *narrativeRun, candidate Candidate) *pb.ModelCallRequest {
	return &pb.ModelCallRequest{NarrativeStage: "review", Model: "fixture", SchemaJson: `{"type":"object"}`,
		MaxOutputBytes: 8192, Messages: []*pb.ModelMessage{
			{Role: "system", Content: "Synthetic source boundary review."},
			{Role: "user", Content: string(narrativeMarshal(map[string]any{
				"context": reviewHydrationWireContext(p.context, p.context.State), "candidate": candidate,
			}))},
		}}
}

func memoryBoundaryPacket(t *testing.T, call *pb.ModelCallRequest) memoryEvidencePacket {
	t.Helper()
	var packet memoryEvidencePacket
	if err := StrictJSON(memoryEvidenceWire(t, call)["memory_evidence"], &packet); err != nil {
		t.Fatal(err)
	}
	return packet
}

func memoryBoundaryBind(t *testing.T, p *narrativeRun, call *pb.ModelCallRequest) {
	t.Helper()
	p.evidenceOrigin = &narrativeEvidenceOrigin{Kind: "operation", ID: "boundary-request",
		ExperienceID: p.context.ExperienceID, BranchID: p.context.BranchID, BaseRevision: p.context.Revision,
		BaseFence: 5, SourceHandle: p.context.StateCoverage.SourceHandle, Pin: memoryPageSHA256("fixed boundary pin")}
	request := model.Request{Model: "fixture", Schema: json.RawMessage(call.SchemaJson), MaxOutputTokens: 8192}
	for _, message := range call.Messages {
		request.Messages = append(request.Messages, model.Message{Role: message.Role, Content: message.Content})
	}
	raw, err := proto.Marshal(call)
	if err != nil {
		t.Fatal(err)
	}
	if err = p.bindMemoryEvidenceRequest(7, raw, request); err != nil {
		t.Fatal(err)
	}
}

func TestMemoryEvidenceBoundariesDeduplicateHistoryAndRecallWithoutRewritingReceipt(t *testing.T) {
	p, _ := memoryEvidenceCallFixture(t)
	page := HistoryPage{Revision: 1, Mode: "read", Text: "Unique original page."}
	_, reply := memoryBoundaryReply(t, p, 1, 1, []HistoryPage{page}, true)
	p.context.History, p.context.Recalls = []HistoryPage{page}, []ReadReply{reply}
	original := narrativeMarshal(p.context.Recalls)
	call := memoryBoundaryCall(p, memoryBoundaryCandidate(t, p))
	if err := p.compileMemoryEvidence(call); err != nil {
		t.Fatal(err)
	}
	pages := 0
	for _, source := range memoryBoundaryPacket(t, call).Sources {
		if source.Kind == "formal_page" {
			pages++
			if source.Revision != 1 || source.Location != "/context/history/0" {
				t.Fatal("exact duplicate changed source identity", source)
			}
		}
	}
	if pages != 1 || strings.Count(call.Messages[1].Content, page.Text) != 1 ||
		!bytes.Equal(original, narrativeMarshal(p.context.Recalls)) {
		t.Fatal("duplicate source bytes survived or original receipt was rewritten")
	}
	hash, err := replyBodyHash(p.context.Recalls[0])
	if err != nil || hash != reply.Receipt.BodySHA256 {
		t.Fatal("source receipt no longer verifies")
	}
}

func TestMemoryEvidenceBoundariesRejectConflictingDuplicateAndChangedReceipt(t *testing.T) {
	for _, variant := range []string{"conflicting-resealed-page", "changed-body-old-receipt"} {
		t.Run(variant, func(t *testing.T) {
			p, _ := memoryEvidenceCallFixture(t)
			page := HistoryPage{Revision: 1, Mode: "read", Text: "Original page."}
			_, reply := memoryBoundaryReply(t, p, 1, 1, []HistoryPage{page}, true)
			reply.Pages[0].Text = "Conflicting page."
			if variant == "conflicting-resealed-page" {
				reply.Receipt.BodySHA256, _ = replyBodyHash(reply)
			}
			p.context.History, p.context.Recalls = []HistoryPage{page}, []ReadReply{reply}
			if _, err := p.before(memoryBoundaryCall(p, memoryBoundaryCandidate(t, p))); err == nil {
				t.Fatal("conflicting source or invalid original receipt reached review")
			}
		})
	}
}

func TestMemoryEvidenceBoundariesPriorReadMustActuallyBeReinstalled(t *testing.T) {
	for _, needed := range []bool{false, true} {
		t.Run(fmt.Sprintf("required-%t", needed), func(t *testing.T) {
			p, _ := memoryEvidenceCallFixture(t)
			page := HistoryPage{Revision: 1, Mode: "read", Text: "PRIOR-STAGE-ONLY-PAGE"}
			_, reply := memoryBoundaryReply(t, p, 1, 1, []HistoryPage{page}, true)
			p.context.Recalls = []ReadReply{reply}
			if needed {
				p.context.AuthorityState.LiteraryMemory = &LiteraryMemory{Version: 1, Entries: []MemoryEntry{
					memoryBoundaryOld("returned", 1, page.Text),
				}}
			}
			original := narrativeMarshal(p.context.Recalls)
			call := memoryBoundaryCall(p, memoryBoundaryCandidate(t, p))
			if _, err := p.before(call); err != nil {
				t.Fatal(err)
			}
			count := 0
			for _, source := range memoryBoundaryPacket(t, call).Sources {
				if source.Kind == "formal_page" && source.Revision == 1 {
					count++
				}
			}
			if count != map[bool]int{false: 0, true: 1}[needed] ||
				strings.Contains(call.Messages[1].Content, page.Text) != needed ||
				!bytes.Equal(original, narrativeMarshal(p.context.Recalls)) {
				t.Fatal("cached availability was confused with current request evidence")
			}
		})
	}
}

func TestMemoryEvidenceBoundariesMissingRequiredCanReadButCannotApprove(t *testing.T) {
	for _, action := range []string{"request-read", "approve-without-source"} {
		t.Run(action, func(t *testing.T) {
			p, _ := memoryEvidenceCallFixture(t)
			p.context.AuthorityState.LiteraryMemory = &LiteraryMemory{Version: 1, Entries: []MemoryEntry{
				memoryBoundaryOld("returned", 1, "An old condition."),
			}}
			candidate := memoryBoundaryCandidate(t, p)
			call := memoryBoundaryCall(p, candidate)
			if _, err := p.before(call); err != nil {
				t.Fatal("first review lost its opportunity to request evidence", err)
			}
			packet := memoryBoundaryPacket(t, call)
			if len(packet.RequiredPages) != 1 || packet.RequiredPages[0].Loaded {
				t.Fatal("a locator was promoted to a loaded formal page")
			}
			if action == "request-read" {
				request, _ := memoryBoundaryReply(t, p, 1, 1, []HistoryPage{}, true)
				if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": request}))}); err != nil ||
					!p.pendingRead || !p.readStages["review"] {
					t.Fatal("valid bounded source request was blocked", err)
				}
				return
			}
			memoryBoundaryBind(t, p, call)
			currentID := ""
			for _, source := range packet.Sources {
				if source.Kind == "candidate" {
					currentID = source.ID
				}
			}
			review := NarrativeReview{Approved: true, RepairScope: "none", Issues: []NarrativeIssue{},
				Supports: []NarrativeSupport{}, KnowledgeSupports: []NarrativeKnowledgeSupport{},
				MemorySupports: []NarrativeMemorySupport{{MemoryID: "returned", SourceIDs: []string{currentID}}}}
			err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": review}))})
			if err == nil || err.Error() != "narrative_memory_required_missing" {
				t.Fatalf("missing required source got approval or wrong failure: %v", err)
			}
			if _, err := p.finish(candidate); err == nil {
				t.Fatal("failed evidence approval became a commit credential")
			}
		})
	}
}

func TestMemoryEvidenceBoundariesDistantPagesAreAcquisitionNotCapacity(t *testing.T) {
	p, _ := memoryEvidenceCallFixture(t)
	p.context.Revision = 80
	first := HistoryPage{Revision: 3, Mode: "read", Text: "The initial condition."}
	last := HistoryPage{Revision: 80, Mode: "read", Text: "The latest update."}
	p.context.AuthorityState.LiteraryMemory = &LiteraryMemory{Version: 1, Entries: []MemoryEntry{
		memoryBoundaryOld("early-condition", 3, first.Text), memoryBoundaryOld("late-update", 80, last.Text),
	}}
	candidate := memoryBoundaryCandidate(t, p)
	entry := candidate.MemoryDelta.Entries[0]
	entry.ID = "early-condition"
	second := entry
	second.ID = "late-update"
	candidate.MemoryDelta.Entries = []MemoryInterpretation{entry, second}
	p.extracted, _ = canonicalCandidate(candidate)
	call := memoryBoundaryCall(p, candidate)
	if _, err := p.before(call); err != nil {
		t.Fatal(err)
	}
	// The two required pages fit a normal reply; the only existing page
	// selector spans every intervening page. This control does not run SQL
	// pagination: it supplies a valid bounded partial reply at that boundary.
	rangePages := []HistoryPage{first}
	for revision := int64(4); revision < 80; revision++ {
		rangePages = append(rangePages, HistoryPage{Revision: revision, Mode: "read", Text: strings.Repeat("intervening ", 40)})
	}
	rangePages = append(rangePages, last)
	if len(narrativeMarshal([]HistoryPage{first, last})) >= 8192 || len(narrativeMarshal(rangePages)) <= 8192 {
		t.Fatal("control does not distinguish useful-source size from acquisition range")
	}
	// Positive control: when earlier stages legitimately obtained both exact
	// single-page replies, this same compiler can install both in one request.
	available, _ := memoryEvidenceCallFixture(t)
	available.context = p.context
	available.extracted, _ = canonicalCandidate(candidate)
	_, startReply := memoryBoundaryReply(t, available, 3, 3, []HistoryPage{first}, true)
	_, endReply := memoryBoundaryReply(t, available, 80, 80, []HistoryPage{last}, true)
	available.context.Recalls = []ReadReply{startReply, endReply}
	availableCall := memoryBoundaryCall(available, candidate)
	if _, err := available.before(availableCall); err != nil {
		t.Fatal("the two actual sources could not fit when already acquired", err)
	}
	availablePacket := memoryBoundaryPacket(t, availableCall)
	if len(availablePacket.RequiredPages) != 2 || !availablePacket.RequiredPages[0].Loaded ||
		!availablePacket.RequiredPages[1].Loaded || narrativeCallBytes(availableCall) >= 8192 {
		t.Fatal("positive control did not establish a small complete request")
	}
	request, partial := memoryBoundaryReply(t, p, 3, 80, []HistoryPage{first}, false)
	if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": request}))}); err != nil {
		t.Fatal(err)
	}
	// Same transition used by Algorithm after a successful Reader.Read.
	p.context.Recalls = append(p.context.Recalls, partial)
	p.pendingRead, p.readCompleted = false, true
	beforeReceipt := narrativeMarshal(p.context.Recalls)
	_, err := p.before(memoryBoundaryCall(p, candidate))
	if err == nil || err.Error() != "narrative_memory_acquisition_limit" {
		t.Fatalf("partial acquisition was approved or mislabeled as byte overflow: %v", err)
	}
	if !bytes.Equal(beforeReceipt, narrativeMarshal(p.context.Recalls)) {
		t.Fatal("partial read was rewritten to fabricate a complete result")
	}
	if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": request}))}); err == nil ||
		err.Error() != "recall_budget_exhausted" {
		t.Fatal("one review gained a second source-read opportunity", err)
	}
}

func TestMemoryEvidenceBoundariesRepairRecomputesChangedAndDeletedOldIDs(t *testing.T) {
	for _, deleteAll := range []bool{false, true} {
		t.Run(fmt.Sprintf("delete-all-%t", deleteAll), func(t *testing.T) {
			p, _ := memoryEvidenceCallFixture(t)
			p.context.History = []HistoryPage{
				{Revision: 1, Mode: "read", Text: "First original event."},
				{Revision: 2, Mode: "read", Text: "Second original event."},
			}
			p.context.AuthorityState.LiteraryMemory = &LiteraryMemory{Version: 1, Entries: []MemoryEntry{
				memoryBoundaryOld("arbitrary-a", 1, p.context.History[0].Text),
				memoryBoundaryOld("different-b", 2, p.context.History[1].Text),
			}}
			candidate := memoryBoundaryCandidate(t, p)
			candidate.MemoryDelta.Entries[0].ID = "arbitrary-a"
			p.extracted, _ = canonicalCandidate(candidate)
			p.draft = &narrativeDraft{Title: candidate.Title, Passage: candidate.Passage, StoryTime: candidate.StoryTime,
				Outcome: candidate.Outcome, Suggestions: candidate.Suggestions}
			call := memoryBoundaryCall(p, candidate)
			if _, err := p.before(call); err != nil {
				t.Fatal(err)
			}
			first := memoryBoundaryPacket(t, call)
			if len(first.RequiredPages) != 1 || first.RequiredPages[0].MemoryID != "arbitrary-a" || !first.RequiredPages[0].Loaded {
				t.Fatal("initial required page was not established")
			}
			issues := []NarrativeIssue{{Code: "synthetic-index-target", Detail: "Inspect the intended index update."}}
			rejection := NarrativeReview{Approved: false, RepairScope: "candidate_state", Issues: issues,
				Supports: []NarrativeSupport{}, KnowledgeSupports: []NarrativeKnowledgeSupport{}, MemorySupports: []NarrativeMemorySupport{}}
			if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": rejection}))}); err != nil {
				t.Fatal(err)
			}
			if _, err := p.before(stateRepairCall(p, candidate, issues)); err != nil {
				t.Fatal(err)
			}
			changed := candidate
			changed.MemoryDelta = &MemoryDelta{Version: 2, Entries: append([]MemoryInterpretation{}, candidate.MemoryDelta.Entries...)}
			if deleteAll {
				changed.MemoryDelta.Entries = []MemoryInterpretation{}
			} else {
				changed.MemoryDelta.Entries[0].ID = "different-b"
			}
			if err := p.after(&pb.ModelCallResult{Text: compactExtractionEnvelope(compactExtractionState(t, changed))}); err != nil {
				t.Fatal(err)
			}
			final := memoryBoundaryCall(p, changed)
			if _, err := p.before(final); err != nil {
				t.Fatal(err)
			}
			required := memoryBoundaryPacket(t, final).RequiredPages
			if deleteAll && len(required) != 0 || !deleteAll && (len(required) != 1 ||
				required[0].MemoryID != "different-b" || required[0].Revision != 2 || !required[0].Loaded) ||
				p.repairs != 1 {
				t.Fatal("repair retained stale required IDs or bypassed the shared repair count", required)
			}
		})
	}
}

func TestMemoryEvidenceBoundariesAuthorDirectoryNeverEntersActor(t *testing.T) {
	author, call := memoryEvidenceCallFixture(t)
	if _, err := author.before(call); err != nil {
		t.Fatal(err)
	}
	actor, _ := memoryEvidenceCallFixture(t)
	actor.last, actor.evidencePacket = "memory", author.evidencePacket
	old := memoryBoundaryOld("author-private-index", 1, "AUTHOR-ONLY-LOCATOR")
	old.Summary = "AUTHOR-ONLY-SUMMARY"
	actor.context.AuthorityState.LiteraryMemory = &LiteraryMemory{Version: 1, Entries: []MemoryEntry{old}}
	actor.actors = map[string]narrativeTrigger{"speaker": {ActorID: "speaker", FactIDs: []string{}}}
	before := narrativeMarshal(actor.authority())
	call.NarrativeStage, call.NarrativeActorId = "actor", "speaker"
	if _, err := actor.before(call); err != nil {
		t.Fatal(err)
	}
	var body map[string]json.RawMessage
	if err := StrictJSON([]byte(call.Messages[1].Content), &body); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"memory_evidence", "evidence_pages", "evidence_objects", "memories", "candidate"} {
		if _, exists := body[key]; exists {
			t.Fatal("author evidence reached the actor", key)
		}
	}
	if actor.evidencePacket != nil || strings.Contains(call.Messages[1].Content, "AUTHOR-ONLY-") ||
		!reflect.DeepEqual(before, narrativeMarshal(actor.authority())) {
		t.Fatal("actor gained author memory or changed authority")
	}
}
