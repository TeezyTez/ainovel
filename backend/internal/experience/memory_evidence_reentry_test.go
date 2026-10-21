package experience

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"

	pb "elselife/backend/internal/contract/generated/algorithm/v1"
)

// Synthetic protocol/receipt controls only. These do not call a provider,
// issue trusted database approvals, or establish semantic memory quality.
func TestMemoryEvidenceMissingRequiredHonorsGlobalReadLimit(t *testing.T) {
	for _, remaining := range []bool{false, true} {
		t.Run(fmt.Sprintf("remaining-%t", remaining), func(t *testing.T) {
			p, _ := memoryEvidenceCallFixture(t)
			p.context.History = []HistoryPage{}
			p.context.ReadBudget.MaxReads = 1
			if remaining {
				p.context.ReadBudget.MaxReads = 2
			}
			p.context.AuthorityState.LiteraryMemory = &LiteraryMemory{Version: 1, Entries: []MemoryEntry{
				memoryBoundaryOld("returned", 1, "Required original."),
			}}
			_, reply := memoryBoundaryReply(t, p, 2, 2, []HistoryPage{
				{Revision: 2, Mode: "read", Text: "An unrelated page."},
			}, true)
			p.context.Recalls = []ReadReply{reply}
			call := memoryBoundaryCall(p, memoryBoundaryCandidate(t, p))
			_, err := p.before(call)
			if remaining && err != nil || !remaining && (err == nil || err.Error() != "narrative_memory_acquisition_limit") {
				t.Fatalf("remaining=%v error=%v", remaining, err)
			}
		})
	}
}

func TestMemoryEvidenceReentryAfterRepairKeepsReviewAcquisitionSpent(t *testing.T) {
	for _, route := range []string{"same-loaded-id", "different-cached-id", "different-missing-id"} {
		t.Run(route, func(t *testing.T) {
			p, _ := memoryEvidenceCallFixture(t)
			first := HistoryPage{Revision: 1, Mode: "read", Text: "First event source."}
			second := HistoryPage{Revision: 2, Mode: "read", Text: "Different event source."}
			p.context.History = []HistoryPage{}
			p.context.AuthorityState.LiteraryMemory = &LiteraryMemory{Version: 1, Entries: []MemoryEntry{
				memoryBoundaryOld("original-target", 1, first.Text),
				memoryBoundaryOld("other-target", 2, second.Text),
			}}
			if route == "different-cached-id" {
				_, reply := memoryBoundaryReply(t, p, 2, 2, []HistoryPage{second}, true)
				p.context.Recalls = []ReadReply{reply}
			}
			candidate := memoryBoundaryCandidate(t, p)
			candidate.MemoryDelta.Entries[0].ID = "original-target"
			p.extracted, _ = canonicalCandidate(candidate)
			p.draft = &narrativeDraft{Title: candidate.Title, Passage: candidate.Passage,
				StoryTime: candidate.StoryTime, Outcome: candidate.Outcome, Suggestions: candidate.Suggestions}
			call := memoryBoundaryCall(p, candidate)
			if _, err := p.before(call); err != nil {
				t.Fatal("first review lost its legitimate acquisition opportunity", err)
			}
			if required := memoryBoundaryPacket(t, call).RequiredPages; len(required) != 1 || required[0].Loaded {
				t.Fatal("first missing source was not declared")
			}
			request, reply := memoryBoundaryReply(t, p, 1, 1, []HistoryPage{first}, true)
			if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": request}))}); err != nil {
				t.Fatal(err)
			}
			if !p.pendingRead || !p.readStages["review"] {
				t.Fatal("first source acquisition did not consume the review stage allowance")
			}
			// Same state transition as Algorithm after a successful Reader.Read.
			p.context.Recalls = append(p.context.Recalls, reply)
			p.pendingRead, p.readCompleted = false, true
			call = memoryBoundaryCall(p, candidate)
			if _, err := p.before(call); err != nil {
				t.Fatal("first exact source could not resume review", err)
			}
			if required := memoryBoundaryPacket(t, call).RequiredPages; len(required) != 1 || !required[0].Loaded {
				t.Fatal("first acquired source was not actually installed")
			}
			issues := []NarrativeIssue{{Code: "synthetic-index-target", Detail: "Correct the intended index target."}}
			rejected := NarrativeReview{Approved: false, RepairScope: "candidate_state", Issues: issues,
				Supports: []NarrativeSupport{}, KnowledgeSupports: []NarrativeKnowledgeSupport{},
				MemorySupports: []NarrativeMemorySupport{}}
			if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": rejected}))}); err != nil {
				t.Fatal(err)
			}
			if _, err := p.before(stateRepairCall(p, candidate, issues)); err != nil {
				t.Fatal(err)
			}
			changed := candidate
			changed.MemoryDelta = &MemoryDelta{Version: 2, Entries: append([]MemoryInterpretation{}, candidate.MemoryDelta.Entries...)}
			if route != "same-loaded-id" {
				changed.MemoryDelta.Entries[0].ID = "other-target"
			}
			if err := p.after(&pb.ModelCallResult{Text: compactExtractionEnvelope(compactExtractionState(t, changed))}); err != nil {
				t.Fatal(err)
			}
			if p.last != "repair_state" || p.readCompleted || !p.readStages["review"] || p.repairs != 1 {
				t.Fatal("control did not reach repaired candidate with review acquisition already spent")
			}
			originalReceipts := narrativeMarshal(p.context.Recalls)
			final := memoryBoundaryCall(p, changed)
			_, err := p.before(final)
			if route == "different-missing-id" {
				if err == nil || err.Error() != "narrative_memory_acquisition_limit" {
					t.Fatalf("second review dispatched despite an unacquirable required old page: %v", err)
				}
			} else {
				if err != nil {
					t.Fatal("spent acquisition rejected an already-loaded required source", err)
				}
				required := memoryBoundaryPacket(t, final).RequiredPages
				if len(required) != 1 || !required[0].Loaded || required[0].MemoryID != changed.MemoryDelta.Entries[0].ID {
					t.Fatal("repaired candidate required pages were not recomputed", required)
				}
			}
			if !bytes.Equal(originalReceipts, narrativeMarshal(p.context.Recalls)) || p.pendingRead {
				t.Fatal("re-entry rewrote a source receipt or started another read")
			}
		})
	}
}

func memoryReentryObjectsReply(t *testing.T, p *narrativeRun, objects []ReadObject) ReadReply {
	t.Helper()
	targets := make([]ReadTarget, 0, len(objects))
	for _, object := range objects {
		revision := object.AsOfRevision
		targets = append(targets, ReadTarget{Type: object.Type, ID: objectID(object), AtRevision: &revision})
	}
	request := ReadRequest{RequestID: "old-stage-versions", SourceHandle: p.context.StateCoverage.SourceHandle,
		Selector: ReadSelector{Kind: "objects", Objects: targets}, MaxReplyBytes: 8192}
	if _, err := DecodeReadRequest(narrativeMarshal(request)); err != nil {
		t.Fatal("invalid synthetic source query", err)
	}
	reply := ReadReply{RequestID: request.RequestID, SourceHandle: request.SourceHandle,
		ExperienceID: p.context.ExperienceID, BranchID: p.context.BranchID,
		BaseRevision: p.context.Revision, Audience: "author", Objects: objects,
		Pages: []HistoryPage{}, Complete: true}
	var err error
	reply.Receipt.QuerySHA256, err = receiptHash(request)
	if err != nil {
		t.Fatal(err)
	}
	reply.Receipt.BodySHA256, err = replyBodyHash(reply)
	if err != nil || validateContract(narrativeMarshal(reply), "read_reply") != nil {
		t.Fatal("invalid synthetic source receipt", err)
	}
	return reply
}

func TestMemoryEvidenceFactCacheReinstallsOnlyRequiredRecordVersions(t *testing.T) {
	for _, oldDependency := range []bool{false, true} {
		t.Run(fmt.Sprintf("exact-old-dependency-%t", oldDependency), func(t *testing.T) {
			old := Fact{ID: "versioned-record", Kind: "fact", Text: "The case remains closed.",
				SubjectID: "speaker", KnownBy: []string{"speaker"}, SourceRevision: 1}
			current := old
			current.KnownBy = []string{"speaker", "listener"}
			oldHash, err := memoryFactSHA256(old)
			if err != nil {
				t.Fatal(err)
			}
			currentHash, err := memoryFactSHA256(current)
			if err != nil || currentHash == oldHash {
				t.Fatal("control does not distinguish complete fact records", err)
			}
			// r2 and r3 deliberately have identical full record bytes. Their
			// as-of versions remain distinct and cannot be chosen by ID alone.
			allObjects := []ReadObject{
				{Type: "fact", AsOfRevision: 1, Body: narrativeMarshal(old)},
				{Type: "fact", AsOfRevision: 2, Body: narrativeMarshal(current)},
				{Type: "fact", AsOfRevision: 3, Body: narrativeMarshal(current)},
			}
			compile := func(objects []ReadObject) (*pb.ModelCallRequest, memoryEvidencePacket) {
				t.Helper()
				p, _ := memoryEvidenceCallFixture(t)
				p.context.Revision = 3
				p.context.AuthorityState.Facts = []Fact{current}
				p.context.State = *p.context.AuthorityState
				page := HistoryPage{Revision: 2, Mode: "read", Text: "The previous index update."}
				p.context.History = []HistoryPage{}
				if oldDependency {
					p.context.History = []HistoryPage{page}
					entry := MemoryEntry{MemoryChange: MemoryChange{
						ID: "returned", Kind: "episode", SubjectIDs: []string{"speaker"}, TargetIDs: []string{},
						Cue: "returned book", Summary: "The earlier return.", Status: "active",
						RetrievalKeys: []string{"book"}, FactIDs: []string{old.ID},
					}, EvidenceKind: "source_refs_v2", UpdatedRevision: 2, EvidenceRefs: []MemoryEvidenceRef{
						{Kind: "formal_page", Revision: 2, TextSHA256: memoryPageSHA256(page.Text)},
						{Kind: "authority_fact", FactID: old.ID, AsOfRevision: 1, RecordSHA256: oldHash},
					}}
					p.context.AuthorityState.LiteraryMemory = &LiteraryMemory{Version: 2, IndexedThroughRevision: 2, Entries: []MemoryEntry{entry}}
					p.context.State.LiteraryMemory = p.context.AuthorityState.LiteraryMemory
				}
				p.context.Recalls = []ReadReply{memoryReentryObjectsReply(t, p, objects)}
				originalReceipt := narrativeMarshal(p.context.Recalls)
				candidate := memoryBoundaryCandidate(t, p)
				candidate.MemoryDelta.Entries[0].FactIDs = []string{old.ID}
				call := memoryBoundaryCall(p, candidate)
				// Isolate the real compiler's prior-cache reinstatement path.
				// These are not explicit recalls in the current stage request.
				body := memoryEvidenceWire(t, call)
				var view map[string]json.RawMessage
				if err := StrictJSON(body["context"], &view); err != nil {
					t.Fatal(err)
				}
				view["historical_recalls"] = json.RawMessage("[]")
				body["context"] = narrativeMarshal(view)
				call.Messages[1].Content = string(narrativeMarshal(body))
				if err := p.compileMemoryEvidence(call); err != nil {
					t.Fatal(err)
				}
				if !bytes.Equal(originalReceipt, narrativeMarshal(p.context.Recalls)) {
					t.Fatal("compiler changed the source receipt to remove unnecessary versions")
				}
				return call, memoryBoundaryPacket(t, call)
			}
			neededObjects := allObjects[2:]
			if oldDependency {
				neededObjects = []ReadObject{allObjects[0], allObjects[2]}
			}
			baselineCall, baselinePacket := compile(neededObjects)
			fullCall, fullPacket := compile(allObjects)
			versions := func(packet memoryEvidencePacket) map[int64]int {
				result := map[int64]int{}
				for _, source := range packet.Sources {
					if source.Kind == "authority_fact" && source.FactID == old.ID {
						result[source.AsOfRevision]++
						expected := currentHash
						if source.AsOfRevision == 1 {
							expected = oldHash
						}
						if source.RecordSHA256 != expected {
							t.Fatal("reinstalled version no longer has its original complete record hash")
						}
					}
				}
				return result
			}
			want := map[int64]int{3: 1}
			if oldDependency {
				want[1] = 1
			}
			if !reflect.DeepEqual(versions(baselinePacket), want) {
				t.Fatal("minimal required-cache positive control is not valid", versions(baselinePacket))
			}
			t.Logf("recorded request bytes: required-cache=%d all-cache=%d delta=%d; no overflow/latency claim",
				narrativeCallBytes(baselineCall), narrativeCallBytes(fullCall),
				narrativeCallBytes(fullCall)-narrativeCallBytes(baselineCall))
			if !reflect.DeepEqual(versions(fullPacket), want) {
				t.Fatalf("fact-ID lookup reinstalled unnecessary historical versions: got=%v want=%v",
					versions(fullPacket), want)
			}
			if narrativeCallBytes(fullCall) != narrativeCallBytes(baselineCall) {
				t.Fatal("unselected cached versions still changed the actual request payload size")
			}
		})
	}
}
