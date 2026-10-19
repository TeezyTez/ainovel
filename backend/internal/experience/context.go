package experience

import "encoding/json"

// boundedContext keeps authority state and every provenance relation intact.
// Only whole oldest presentation pages may be omitted. The resulting page
// history is a contiguous suffix, explicitly not the complete formal history.
// Formal PG pages/state snapshots are never changed by this projection.
// This does not claim that narrative details not captured as structured facts
// remain in the prompt, or that unbounded state fits every finite model window.
func boundedContext(c Context, max int) (Context, error) {
	original := c.History
	initialComplete := c.HistoryComplete
	fits := func(skip int) bool {
		c.History = original[skip:]
		c.HistoryComplete = initialComplete && skip == 0
		raw, err := json.Marshal(c)
		return err == nil && len(raw) <= max
	}
	if fits(0) {
		return c, nil
	}
	// The most recent page is necessary presentation continuity. Do not truncate
	// its raw text, or silently omit a state/seed/preference/input to make it fit.
	maximum := len(original) - 1
	if maximum < 0 || !fits(maximum) {
		return c, fail("context_capacity")
	}
	low, high := 1, maximum
	for low < high {
		mid := (low + high) / 2
		if fits(mid) {
			high = mid
		} else {
			low = mid + 1
		}
	}
	fits(low)
	return c, nil
}
