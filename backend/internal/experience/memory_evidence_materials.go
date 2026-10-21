package experience

import "encoding/json"

type memoryMaterialSource struct {
	Ref    MemoryEvidenceRef `json:"ref"`
	Loaded bool              `json:"loaded"`
}

type memoryMaterialV2 struct {
	Version         int                    `json:"version"`
	ID              string                 `json:"id"`
	Kind            string                 `json:"kind"`
	SubjectIDs      []string               `json:"subject_ids"`
	TargetIDs       []string               `json:"target_ids"`
	Cue             string                 `json:"cue"`
	Summary         string                 `json:"summary,omitempty"`
	Status          string                 `json:"status"`
	FactIDs         []string               `json:"fact_ids"`
	UpdatedRevision int64                  `json:"updated_revision"`
	Granularity     string                 `json:"granularity"`
	EvidenceKind    string                 `json:"evidence_kind"`
	SourceCount     int                    `json:"source_count"`
	SourceOmitted   int                    `json:"source_omitted"`
	SourceDirectory []memoryMaterialSource `json:"source_directory"`
	LocatorQuote    *string                `json:"locator_quote,omitempty"`
}

func memoryV2Material(entry MemoryEntry, granularity string) (*memoryMaterialV2, error) {
	refs, err := memoryEntryDependencies(entry)
	if err != nil {
		return nil, err
	}
	if granularity == "source" {
		granularity = "summary"
	}
	kind := entry.EvidenceKind
	if kind == "" {
		kind = "legacy_v1"
	}
	out := &memoryMaterialV2{Version: 2, ID: entry.ID, Kind: entry.Kind, SubjectIDs: entry.SubjectIDs, TargetIDs: entry.TargetIDs,
		Cue: entry.Cue, Status: entry.Status, FactIDs: entry.FactIDs, UpdatedRevision: entry.UpdatedRevision,
		Granularity: granularity, EvidenceKind: kind, SourceCount: len(refs),
		SourceDirectory: memorySourceDirectory(refs, latestMemoryRevision(entry)), LocatorQuote: entry.LocatorQuote}
	out.SourceOmitted = out.SourceCount - len(out.SourceDirectory)
	if kind == "legacy_v1" && entry.Quote != "" {
		quote := entry.Quote
		out.LocatorQuote = &quote
	}
	if granularity == "summary" {
		out.Summary = entry.Summary
	}
	return out, nil
}

func (material MemoryMaterial) MarshalJSON() ([]byte, error) {
	if material.v2 != nil {
		return json.Marshal(material.v2)
	}
	type wire MemoryMaterial
	return json.Marshal(wire(material))
}

func markMemoryMaterialLoaded(body map[string]json.RawMessage, packet memoryEvidencePacket) error {
	raw, ok := body["context_materials"]
	if !ok {
		return nil
	}
	var bundle map[string]json.RawMessage
	if StrictJSON(raw, &bundle) != nil {
		return fail("narrative_memory_evidence_invalid")
	}
	var memories []map[string]json.RawMessage
	if raw, ok = bundle["memories"]; !ok {
		return nil
	}
	if StrictJSON(raw, &memories) != nil {
		return fail("narrative_memory_evidence_invalid")
	}
	for _, memory := range memories {
		if _, ok := memory["version"]; !ok {
			continue
		}
		var directory []memoryMaterialSource
		if StrictJSON(memory["source_directory"], &directory) != nil {
			return fail("narrative_memory_evidence_invalid")
		}
		for i := range directory {
			ref := directory[i].Ref
			for _, source := range packet.Sources {
				if ref.Kind == "formal_page" && source.Kind == ref.Kind && source.Revision == ref.Revision && source.TextSHA256 == ref.TextSHA256 ||
					ref.Kind == "authority_fact" && source.Kind == ref.Kind && source.FactID == ref.FactID && source.AsOfRevision == ref.AsOfRevision && source.RecordSHA256 == ref.RecordSHA256 {
					directory[i].Loaded = true
				}
			}
		}
		memory["source_directory"] = narrativeMarshal(directory)
	}
	bundle["memories"] = narrativeMarshal(memories)
	body["context_materials"] = narrativeMarshal(bundle)
	return nil
}
