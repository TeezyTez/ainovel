package experience

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strconv"
	"strings"

	pb "elselife/backend/internal/contract/generated/algorithm/v1"
)

// This directory describes bytes in one particular author request. It is not a
// memory index, a read receipt, or a grant of character knowledge.
type memoryEvidenceSource struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"`
	Location     string `json:"location"`
	Revision     int64  `json:"revision,omitempty"`
	TextSHA256   string `json:"text_sha256,omitempty"`
	FactID       string `json:"fact_id,omitempty"`
	AsOfRevision int64  `json:"as_of_revision,omitempty"`
	RecordSHA256 string `json:"record_sha256,omitempty"`
}

type memoryRequiredPage struct {
	MemoryID string `json:"memory_id"`
	Revision int64  `json:"revision"`
	Loaded   bool   `json:"loaded"`
}

type memoryEvidencePacket struct {
	Version       int                    `json:"version"`
	Sources       []memoryEvidenceSource `json:"sources"`
	RequiredPages []memoryRequiredPage   `json:"required_pages"`
}

func memoryFactSHA256(f Fact) (string, error) { return receiptHash(f) }

func memoryEvidenceRequirements(candidate Candidate, state State) []memoryRequiredPage {
	out := []memoryRequiredPage{}
	if candidate.MemoryDelta == nil || state.LiteraryMemory == nil {
		return out
	}
	existing := map[string]MemoryEntry{}
	for _, entry := range state.LiteraryMemory.Entries {
		existing[entry.ID] = entry
	}
	for _, entry := range candidate.MemoryDelta.Entries {
		if old, ok := existing[entry.ID]; ok {
			out = append(out, memoryRequiredPage{MemoryID: entry.ID, Revision: latestMemoryRevision(old)})
		}
	}
	return out
}

// Algorithm-originated Go fields are rejected before rebuilding any material.
func rejectSuppliedMemoryEvidence(call *pb.ModelCallRequest) error {
	for _, message := range call.Messages {
		if message == nil || message.Role != "user" {
			continue
		}
		var body map[string]json.RawMessage
		if StrictJSON([]byte(message.Content), &body) != nil {
			return fail("narrative_stage_invalid")
		}
		for _, key := range []string{"memory_evidence", "evidence_pages", "evidence_objects"} {
			if _, supplied := body[key]; supplied {
				return fail("narrative_memory_evidence_invalid")
			}
		}
		// Reserve the earlier fact-only projection name as well.
		if _, supplied := body["evidence_facts"]; supplied {
			return fail("narrative_memory_evidence_invalid")
		}
	}
	return nil
}

func (p *narrativeRun) validatedEvidenceCache() (map[int64]HistoryPage, []ReadObject, error) {
	pages := map[int64]HistoryPage{}
	objects := []ReadObject{}
	addPage := func(page HistoryPage) error {
		if page.Revision < 1 || page.Revision > p.context.Revision {
			return fail("narrative_memory_evidence_invalid")
		}
		if old, exists := pages[page.Revision]; exists && !reflect.DeepEqual(old, page) {
			return fail("narrative_memory_evidence_invalid")
		}
		pages[page.Revision] = page
		return nil
	}
	for _, page := range p.context.History {
		if err := addPage(page); err != nil {
			return nil, nil, err
		}
	}
	for _, reply := range p.context.Recalls {
		if reply.SourceHandle != p.context.StateCoverage.SourceHandle ||
			reply.ExperienceID != p.context.ExperienceID || reply.BranchID != p.context.BranchID ||
			reply.BaseRevision != p.context.Revision || reply.Audience != "author" {
			return nil, nil, fail("narrative_memory_evidence_invalid")
		}
		hash, err := replyBodyHash(reply)
		if err != nil || hash != reply.Receipt.BodySHA256 || !memoryHashOK(reply.Receipt.QuerySHA256) {
			return nil, nil, fail("narrative_memory_evidence_invalid")
		}
		for _, page := range reply.Pages {
			if err := addPage(page); err != nil {
				return nil, nil, err
			}
		}
		for _, object := range reply.Objects {
			if object.AsOfRevision < 1 || object.AsOfRevision > p.context.Revision {
				return nil, nil, fail("narrative_memory_evidence_invalid")
			}
			objects = append(objects, object)
		}
	}
	return pages, objects, nil
}

// Original history and recall bodies must match the trusted Go input BEFORE
// replacing or deduplicating them. A receipt's original body is never edited.
func (p *narrativeRun) validateOriginalMemoryPages(body map[string]json.RawMessage) error {
	var view struct {
		History []HistoryPage `json:"history"`
		Recalls []ReadReply   `json:"historical_recalls"`
	}
	raw := body["context"]
	if raw == nil {
		raw = narrativeMarshal(body)
	}
	if json.Unmarshal(raw, &view) != nil {
		return fail("narrative_memory_evidence_invalid")
	}
	pages, _, err := p.validatedEvidenceCache()
	if err != nil {
		return err
	}
	for _, page := range view.History {
		if known, ok := pages[page.Revision]; !ok || !reflect.DeepEqual(known, page) {
			return fail("narrative_memory_evidence_invalid")
		}
	}
	for _, reply := range view.Recalls {
		found := false
		for _, known := range p.context.Recalls {
			found = found || reflect.DeepEqual(known, reply)
		}
		if !found {
			return fail("narrative_memory_evidence_invalid")
		}
	}
	return nil
}

// This is run after the existing authority checks/reconciliation on EVERY
// compilation attempt. Registry entries cannot survive removal of their bytes.
func (p *narrativeRun) compileMemoryEvidence(call *pb.ModelCallRequest) error {
	p.evidencePacket = nil
	review := call.NarrativeStage == "review" || call.NarrativeStage == "repair_review"
	if p.context.Mode == "ask" || call.NarrativeStage == "actor" || !review && !p.evidenceV2 {
		return nil
	}
	seenContext := false
	for _, message := range call.Messages {
		if message == nil || message.Role != "user" {
			continue
		}
		var body map[string]json.RawMessage
		if StrictJSON([]byte(message.Content), &body) != nil {
			return fail("narrative_stage_invalid")
		}
		var candidate Candidate
		if review {
			if StrictJSON(body["candidate"], &candidate) != nil {
				return fail("narrative_stage_invalid")
			}
			if candidate.MemoryDelta == nil {
				continue
			}
		}
		packet := memoryEvidencePacket{Version: 2, Sources: []memoryEvidenceSource{}, RequiredPages: []memoryRequiredPage{}}
		if review {
			packet.RequiredPages = memoryEvidenceRequirements(candidate, p.authority())
		}
		var view map[string]json.RawMessage
		nested := body["context"] != nil
		if nested {
			if StrictJSON(body["context"], &view) != nil {
				return fail("narrative_memory_evidence_invalid")
			}
		} else {
			view = body
		}
		if view["state"] == nil {
			continue // Existing sparse protocol controls contain no author context.
		}
		if seenContext {
			return fail("narrative_memory_evidence_invalid")
		}
		seenContext = true
		contextPath := ""
		if nested {
			contextPath = "/context"
		}
		cachePages, cacheObjects, err := p.validatedEvidenceCache()
		if err != nil {
			return err
		}
		var history []HistoryPage
		var recalls []ReadReply
		var state State
		if json.Unmarshal(view["history"], &history) != nil || json.Unmarshal(view["historical_recalls"], &recalls) != nil ||
			json.Unmarshal(view["state"], &state) != nil {
			return fail("narrative_memory_evidence_invalid")
		}

		// Keep one original history copy. Same words at different revisions are
		// different sources; duplicates with conflicting metadata are invalid.
		loadedPages := map[int64]bool{}
		uniqueHistory := []HistoryPage{}
		for _, page := range history {
			known, ok := cachePages[page.Revision]
			if !ok || !reflect.DeepEqual(known, page) {
				return fail("narrative_memory_evidence_invalid")
			}
			if !loadedPages[page.Revision] {
				uniqueHistory = append(uniqueHistory, page)
				loadedPages[page.Revision] = true
			}
		}
		view["history"] = narrativeMarshal(uniqueHistory)
		projectedPages := []HistoryPage{}
		projectedObjects := []ReadObject{}
		addPage := func(page HistoryPage) error {
			known, ok := cachePages[page.Revision]
			if !ok || !reflect.DeepEqual(known, page) {
				return fail("narrative_memory_evidence_invalid")
			}
			if !loadedPages[page.Revision] {
				projectedPages = append(projectedPages, page)
				loadedPages[page.Revision] = true
			}
			return nil
		}
		for _, reply := range recalls {
			found := false
			for _, original := range p.context.Recalls {
				found = found || reflect.DeepEqual(original, reply)
			}
			if !found {
				return fail("narrative_memory_evidence_invalid")
			}
			for _, page := range reply.Pages {
				if err := addPage(page); err != nil {
					return err
				}
			}
			projectedObjects = append(projectedObjects, reply.Objects...)
		}
		for _, required := range packet.RequiredPages {
			if page, ok := cachePages[required.Revision]; ok {
				if err := addPage(page); err != nil {
					return err
				}
			}
		}
		// Reinstall only explicitly relevant fact versions from earlier validated
		// replies; database-only source verification is not in this cache.
		wantedFacts := map[string]string{}
		authorityFacts := map[string]Fact{}
		for _, fact := range p.authority().Facts {
			authorityFacts[fact.ID] = fact
		}
		wantFact := func(ref MemoryEvidenceRef) error {
			key, valid := memoryEvidenceIdentity(ref)
			if !valid {
				return fail("narrative_memory_evidence_invalid")
			}
			if prior, exists := wantedFacts[key]; exists && prior != ref.RecordSHA256 {
				return fail("narrative_memory_evidence_invalid")
			}
			wantedFacts[key] = ref.RecordSHA256
			return nil
		}
		entries := []MemoryInterpretation{}
		if review {
			entries = candidate.MemoryDelta.Entries
		}
		for _, entry := range entries {
			for _, id := range entry.FactIDs {
				// A plain fact ID requests its current authoritative record,
				// not every historical version seen earlier in this operation.
				if fact, ok := authorityFacts[id]; ok {
					hash, err := memoryFactSHA256(fact)
					if err != nil {
						return err
					}
					if err := wantFact(MemoryEvidenceRef{Kind: "authority_fact", FactID: id,
						AsOfRevision: p.context.Revision, RecordSHA256: hash}); err != nil {
						return err
					}
				}
			}
			if p.authority().LiteraryMemory != nil {
				for _, old := range p.authority().LiteraryMemory.Entries {
					if old.ID != entry.ID {
						continue
					}
					refs, err := memoryEntryDependencies(old)
					if err != nil {
						return err
					}
					for _, ref := range refs {
						if ref.Kind == "authority_fact" {
							if err := wantFact(ref); err != nil {
								return err
							}
						}
					}
				}
			}
		}
		for _, object := range cacheObjects {
			if object.Type != "fact" {
				continue
			}
			var fact Fact
			if StrictJSON(object.Body, &fact) != nil {
				return fail("narrative_memory_evidence_invalid")
			}
			hash, err := memoryFactSHA256(fact)
			if err != nil {
				return err
			}
			key, valid := memoryEvidenceIdentity(MemoryEvidenceRef{Kind: "authority_fact", FactID: fact.ID,
				AsOfRevision: object.AsOfRevision, RecordSHA256: hash})
			if expected, wanted := wantedFacts[key]; valid && wanted {
				if expected != hash {
					return fail("narrative_memory_evidence_invalid")
				}
				projectedObjects = append(projectedObjects, object)
			}
		}

		add := func(source memoryEvidenceSource) {
			source.ID = fmt.Sprintf("s%d", len(packet.Sources)+1)
			packet.Sources = append(packet.Sources, source)
		}
		if review {
			add(memoryEvidenceSource{Kind: "candidate", Location: "/candidate/passage", TextSHA256: memoryPageSHA256(candidate.Passage)})
		} else if raw := body["draft"]; raw != nil {
			var draft narrativeDraft
			if StrictJSON(raw, &draft) != nil {
				return fail("narrative_memory_evidence_invalid")
			}
			add(memoryEvidenceSource{Kind: "candidate", Location: "/draft/passage", TextSHA256: memoryPageSHA256(draft.Passage)})
		} else if call.NarrativeStage == "repair_state" {
			var frozen Candidate
			if StrictJSON(body["candidate"], &frozen) != nil {
				return fail("narrative_memory_evidence_invalid")
			}
			add(memoryEvidenceSource{Kind: "candidate", Location: "/candidate/passage", TextSHA256: memoryPageSHA256(frozen.Passage)})
		}
		for i, page := range uniqueHistory {
			add(memoryEvidenceSource{Kind: "formal_page", Location: fmt.Sprintf("%s/history/%d", contextPath, i), Revision: page.Revision, TextSHA256: memoryPageSHA256(page.Text)})
		}
		for i, page := range projectedPages {
			add(memoryEvidenceSource{Kind: "formal_page", Location: fmt.Sprintf("/evidence_pages/%d", i), Revision: page.Revision, TextSHA256: memoryPageSHA256(page.Text)})
		}
		factLocations := map[string]Fact{}
		addFact := func(fact Fact, revision int64, location string) error {
			hash, err := memoryFactSHA256(fact)
			if err != nil {
				return err
			}
			key := fact.ID + "\x00" + strconv.FormatInt(revision, 10)
			if previous, ok := factLocations[key]; ok {
				if !reflect.DeepEqual(previous, fact) {
					return fail("narrative_memory_evidence_invalid")
				}
				return nil
			}
			factLocations[key] = fact
			add(memoryEvidenceSource{Kind: "authority_fact", Location: location, FactID: fact.ID, AsOfRevision: revision, RecordSHA256: hash})
			return nil
		}
		for i, fact := range state.Facts {
			if original, ok := authorityFacts[fact.ID]; !ok || !reflect.DeepEqual(original, fact) {
				return fail("narrative_memory_evidence_invalid")
			}
			if err := addFact(fact, p.context.Revision, fmt.Sprintf("%s/state/facts/%d", contextPath, i)); err != nil {
				return err
			}
		}
		var sidecar narrativeReviewEvidence
		if raw, exists := body["review_evidence"]; exists {
			if StrictJSON(raw, &sidecar) != nil {
				return fail("narrative_memory_evidence_invalid")
			}
			for i, fact := range sidecar.KnowledgeTargets {
				if original, ok := authorityFacts[fact.ID]; !ok || !reflect.DeepEqual(original, fact) {
					return fail("narrative_memory_evidence_invalid")
				}
				if err := addFact(fact, p.context.Revision, fmt.Sprintf("/review_evidence/knowledge_targets/%d", i)); err != nil {
					return err
				}
			}
		}
		uniqueObjects := []ReadObject{}
		objectKeys := map[string]ReadObject{}
		for _, object := range projectedObjects {
			key := object.Type + "\x00" + objectID(object) + "\x00" + strconv.FormatInt(object.AsOfRevision, 10)
			if previous, ok := objectKeys[key]; ok {
				if !bytes.Equal(narrativeMarshal(previous), narrativeMarshal(object)) {
					return fail("narrative_memory_evidence_invalid")
				}
				continue
			}
			objectKeys[key] = object
			if object.Type == "fact" {
				var fact Fact
				if StrictJSON(object.Body, &fact) != nil {
					return fail("narrative_memory_evidence_invalid")
				}
				fkey := fact.ID + "\x00" + strconv.FormatInt(object.AsOfRevision, 10)
				if previous, ok := factLocations[fkey]; ok {
					if !reflect.DeepEqual(previous, fact) {
						return fail("narrative_memory_evidence_invalid")
					}
					continue
				}
				if err := addFact(fact, object.AsOfRevision, fmt.Sprintf("/evidence_objects/%d/body", len(uniqueObjects))); err != nil {
					return err
				}
			}
			uniqueObjects = append(uniqueObjects, object)
		}
		// These are explicit projections, never shortened/fabricated ReadReply.
		view["historical_recalls"] = json.RawMessage("[]")
		if nested {
			body["context"] = narrativeMarshal(view)
		}
		if len(projectedPages) > 0 {
			body["evidence_pages"] = narrativeMarshal(projectedPages)
		}
		if len(uniqueObjects) > 0 {
			body["evidence_objects"] = narrativeMarshal(uniqueObjects)
		}
		for i := range packet.RequiredPages {
			packet.RequiredPages[i].Loaded = loadedPages[packet.RequiredPages[i].Revision]
			readSpent := p.readCompleted || p.readStages[call.NarrativeStage] ||
				p.context.ReadBudget.MaxReads > 0 && len(p.context.Recalls) >= p.context.ReadBudget.MaxReads
			if readSpent && !packet.RequiredPages[i].Loaded {
				// A partial or differently selected reply did not acquire this
				// set. This is not evidence that the pages exceed byte capacity.
				return fail("narrative_memory_acquisition_limit")
			}
		}
		body["memory_evidence"] = narrativeMarshal(packet)
		if err := markMemoryMaterialLoaded(body, packet); err != nil {
			return err
		}
		message.Content = string(narrativeMarshal(body))
		if review {
			// Only the independent final review can bind an approval. Earlier
			// directories describe availability, including an uncommitted draft.
			p.evidencePacket = &packet
		}
	}
	return nil
}

func memoryHashOK(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, r := range value {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f') {
			return false
		}
	}
	return true
}

// Resolve an RFC6901-style path into the exact JSON request body. All generated
// paths use fixed field names and numeric indexes, never model-controlled keys.
func memoryJSONAt(raw []byte, path string) (json.RawMessage, error) {
	value := json.RawMessage(raw)
	for _, part := range strings.Split(strings.TrimPrefix(path, "/"), "/") {
		if len(value) == 0 {
			return nil, fail("narrative_memory_evidence_invalid")
		}
		if value[0] == '[' {
			var values []json.RawMessage
			n, err := strconv.Atoi(part)
			if err != nil || json.Unmarshal(value, &values) != nil || n < 0 || n >= len(values) {
				return nil, fail("narrative_memory_evidence_invalid")
			}
			value = values[n]
		} else {
			var fields map[string]json.RawMessage
			if json.Unmarshal(value, &fields) != nil {
				return nil, fail("narrative_memory_evidence_invalid")
			}
			value = fields[part]
		}
	}
	if value == nil {
		return nil, fail("narrative_memory_evidence_invalid")
	}
	return value, nil
}

// Sorting is only a deterministic directory presentation; it grants no actor
// access and does not change the persisted dependency order or content.
func memorySourceDirectory(refs []MemoryEvidenceRef, latest int64) []memoryMaterialSource {
	sorted := append([]MemoryEvidenceRef(nil), refs...)
	sort.SliceStable(sorted, func(i, j int) bool {
		a, b := sorted[i], sorted[j]
		if (a.Kind == "formal_page" && a.Revision == latest) != (b.Kind == "formal_page" && b.Revision == latest) {
			return a.Kind == "formal_page" && a.Revision == latest
		}
		return string(narrativeMarshal(a)) < string(narrativeMarshal(b))
	})
	if len(sorted) > 32 {
		sorted = sorted[:32]
	}
	out := make([]memoryMaterialSource, 0, len(sorted))
	for _, ref := range sorted {
		out = append(out, memoryMaterialSource{Ref: ref})
	}
	return out
}
