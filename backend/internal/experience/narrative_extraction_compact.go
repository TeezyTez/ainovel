package experience

import (
	"bytes"
	"encoding/json"
)

// hydrateNarrativeExtraction supplies only the five frozen draft fields.
// State bytes remain untouched until DecodeCandidate validates the complete
// object, including duplicate keys at every nesting level.
func hydrateNarrativeExtraction(raw []byte, draft *narrativeDraft) ([]byte, error) {
	const maxCandidateBytes = 24 << 10
	if len(raw) > maxCandidateBytes {
		return nil, fail("model_output_capacity")
	}
	if draft == nil {
		return nil, fail("narrative_extraction_mismatch")
	}
	var object map[string]json.RawMessage
	if StrictJSON(raw, &object) != nil || object == nil {
		return nil, fail("invalid_candidate")
	}
	present := 0
	for _, field := range []string{"title", "passage", "story_time", "outcome", "suggestions"} {
		if _, ok := object[field]; ok {
			present++
		}
	}
	if present == 5 {
		// Recorded full candidates still pass the existing exact-draft check.
		return raw, nil
	}
	if present != 0 {
		return nil, fail("narrative_extraction_mismatch")
	}
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(draft); err != nil {
		return nil, fail("narrative_extraction_mismatch")
	}
	// Match Rust's composition encoding: HTML is literal, while actual U+2028
	// and U+2029 are escaped. Encoder contributes one trailing newline only.
	frozen := bytes.TrimSuffix(encoded.Bytes(), []byte("\n"))
	state := bytes.TrimSpace(raw)
	composed := make([]byte, 0, len(state)+len(frozen))
	composed = append(composed, state[:len(state)-1]...)
	if len(object) > 0 {
		composed = append(composed, ',')
	}
	composed = append(composed, frozen[1:]...)
	if len(composed) > maxCandidateBytes {
		return nil, fail("model_output_capacity")
	}
	return composed, nil
}
