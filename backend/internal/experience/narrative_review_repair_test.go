package experience

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	pb "elselife/backend/internal/contract/generated/algorithm/v1"
)

// Recorded responses from a synthetic benchmark establish exact byte and state
// machine behavior only; a corrected fixture quote is not narrative acceptance.
type recordedReviewFixture struct {
	Context Context `json:"context"`
	Outputs []struct {
		Stage string `json:"stage"`
		Raw   string `json:"raw"`
		SHA   string `json:"raw_sha256"`
	} `json:"outputs"`
}

func recordedReview(t *testing.T) (recordedReviewFixture, Candidate, NarrativeReview) {
	t.Helper()
	raw, err := os.ReadFile("../../../algorithms/tests/fixtures/benchmark-nar001-s01-review.json")
	if err != nil {
		t.Fatal(err)
	}
	var f recordedReviewFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	var c Candidate
	var r NarrativeReview
	for _, o := range f.Outputs {
		if fmt.Sprintf("%x", sha256.Sum256([]byte(o.Raw))) != o.SHA {
			t.Fatal("recorded output bytes changed")
		}
		var wrapper struct {
			Result json.RawMessage `json:"result"`
		}
		if err := json.Unmarshal([]byte(o.Raw), &wrapper); err != nil {
			t.Fatal(err)
		}
		if o.Stage == "extract" {
			var extracted struct {
				CandidateJSON string `json:"candidate_json"`
			}
			if err := json.Unmarshal(wrapper.Result, &extracted); err != nil {
				t.Fatal(err)
			}
			c, err = DecodeCandidate([]byte(extracted.CandidateJSON))
			if err != nil {
				t.Fatal(err)
			}
		}
		if o.Stage == "review" {
			if err := json.Unmarshal(wrapper.Result, &r); err != nil {
				t.Fatal(err)
			}
		}
	}
	return f, c, r
}

func reviewCall(stage string, c Candidate, ctx Context) *pb.ModelCallRequest {
	return &pb.ModelCallRequest{NarrativeStage: stage, Messages: []*pb.ModelMessage{{Role: "user", Content: string(narrativeMarshal(map[string]any{"candidate": c, "context": reviewHydrationWireContext(ctx, ctx.State)}))}}}
}

func TestRecordedReviewQuoteMismatchGetsOneFrozenReviewRepair(t *testing.T) {
	f, c, r := recordedReview(t)
	if !strings.Contains(c.Passage, "\n\n") || strings.Contains(c.Passage, `\n`) {
		t.Fatal("recorded draft did not contain real LF")
	}
	if !strings.Contains(r.Supports[1].Quote, `\n\n`) || strings.Contains(r.Supports[1].Quote, "\n") {
		t.Fatal("recorded quote no longer has literal slash-n")
	}
	a := &NarrativeApproval{Engine: narrativeEngineVersion, Candidate: narrativeJSON(c), Result: r}
	if err := verifyNarrativeApproval(c, a); err == nil || err.Error() != "narrative_evidence_missing" {
		t.Fatalf("bad quote accepted: %v", err)
	}
	p := newNarrativeRun(f.Context)
	p.last = "extract"
	p.extracted, _ = canonicalCandidate(c)
	if _, err := p.before(reviewCall("review", c, p.context)); err != nil {
		t.Fatal(err)
	}
	if err := p.after(&pb.ModelCallResult{Text: f.Outputs[len(f.Outputs)-1].Raw}); err != nil {
		t.Fatalf("quote-only failure did not reach bounded repair: %v", err)
	}
	if _, err := p.finish(c); err == nil {
		t.Fatal("invalid original review authorized finish")
	}
	if _, err := p.before(reviewCall("repair_review", c, p.context)); err != nil {
		t.Fatal(err)
	}
	// Choose an actual continuous span; production never normalizes a quote.
	r.Supports[1].Quote = c.Passage[strings.Index(c.Passage, "余叔蹲在船边"):strings.Index(c.Passage, "他盯了片刻")]
	if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": r}))}); err != nil {
		t.Fatal(err)
	}
	if _, err := p.finish(c); err != nil {
		t.Fatal(err)
	}
	if p.repairs != 1 {
		t.Fatalf("repair count=%d", p.repairs)
	}
	if _, err := p.before(reviewCall("repair_review", c, p.context)); err == nil {
		t.Fatal("second repair accepted")
	}
}

func TestReviewRepairPreservesReferencesAndSharedBudget(t *testing.T) {
	for _, name := range []string{"unknown_fact", "duplicate_fact", "missing_fact", "empty_quote", "unknown_knower", "duplicate_knower", "missing_knower", "late_bad_id_with_bad_quote", "missing_reveal", "wrong_reveal_type", "duplicate_reveal", "extraction_budget_used", "semantic_budget_used", "disabled"} {
		t.Run(name, func(t *testing.T) {
			f, c, r := recordedReview(t)
			p := newNarrativeRun(f.Context)
			switch name {
			case "unknown_fact":
				r.Supports[0].FactID = "not-a-fact"
			case "duplicate_fact":
				r.Supports[5] = r.Supports[0]
			case "missing_fact":
				r.Supports = r.Supports[:5]
			case "empty_quote":
				r.Supports[0].Quote = ""
			case "unknown_knower":
				r.KnowledgeSupports[0].SubjectID = "not-a-character"
			case "duplicate_knower":
				r.KnowledgeSupports[14] = r.KnowledgeSupports[0]
			case "missing_knower":
				r.KnowledgeSupports = r.KnowledgeSupports[:14]
			case "late_bad_id_with_bad_quote":
				r.KnowledgeSupports[14].FactID = "not-a-fact"
			case "missing_reveal", "wrong_reveal_type", "duplicate_reveal":
				c.RevealFactIDs = []string{"routes"}
				if name == "wrong_reveal_type" {
					r.RevealSupports = []NarrativeRevealSupport{{Type: "entity", ID: "routes", Quote: "顾岚"}}
				}
				if name == "duplicate_reveal" {
					r.RevealSupports = []NarrativeRevealSupport{{Type: "fact", ID: "routes", Quote: "顾岚"}, {Type: "fact", ID: "routes", Quote: "顾岚"}}
				}
			case "extraction_budget_used", "semantic_budget_used":
				p.repairs = 1
			case "disabled":
				p.context.Pipeline.MaxRepairs = 0
			}
			p.last = "extract"
			p.extracted, _ = canonicalCandidate(c)
			if _, err := p.before(reviewCall("review", c, p.context)); err != nil {
				t.Fatal(err)
			}
			if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": r}))}); err == nil {
				t.Fatal("invalid references or exhausted budget reached repair")
			}
			if _, err := p.before(reviewCall("repair_review", c, p.context)); err == nil {
				t.Fatal("repair granted after hard failure")
			}
		})
	}
}

func TestReviewRepairCannotChangeCandidateOrResampleAfterFailure(t *testing.T) {
	for _, name := range []string{"changed_candidate", "repeated_bad_quote", "semantic_rejection", "valid_review_does_not_grant_repair"} {
		t.Run(name, func(t *testing.T) {
			f, c, r := recordedReview(t)
			p := newNarrativeRun(f.Context)
			p.last = "extract"
			p.extracted, _ = canonicalCandidate(c)
			if name == "valid_review_does_not_grant_repair" {
				r.Supports[1].Quote = "余叔蹲在船边查看舱底，随后试了发动机"
			}
			if _, err := p.before(reviewCall("review", c, p.context)); err != nil {
				t.Fatal(err)
			}
			if err := p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": r}))}); err != nil {
				t.Fatal(err)
			}
			if name == "changed_candidate" {
				c.Passage += "Changed."
			}
			_, err := p.before(reviewCall("repair_review", c, p.context))
			if name == "changed_candidate" || name == "valid_review_does_not_grant_repair" {
				if err == nil {
					t.Fatal("unauthorized repair candidate accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if name == "semantic_rejection" {
				r.Approved = false
				r.Issues = []NarrativeIssue{{Code: "continuity", Detail: "Recorded fixture rejection, not a quality judgment."}}
			}
			err = p.after(&pb.ModelCallResult{Text: string(narrativeMarshal(map[string]any{"result": r}))})
			if name == "repeated_bad_quote" && err == nil {
				t.Fatal("second bad quote accepted")
			}
			if _, err := p.finish(c); err == nil {
				t.Fatal("failed repaired review committed")
			}
			for _, stage := range []string{"repair_review", "revise", "extract", "write", "review"} {
				if _, err := p.before(reviewCall(stage, c, p.context)); err == nil {
					t.Fatalf("failure granted %s", stage)
				}
			}
		})
	}
}

func TestReviewQuotesDistinguishLiteralBackslashNFromNewline(t *testing.T) {
	_, c, r := recordedReview(t)
	// Exact literal backslash-n is legal when it is really in the source text;
	// normalization in either direction would erase this distinction.
	c.Passage = strings.ReplaceAll(c.Passage, "\n", `\n`)
	a := &NarrativeApproval{Engine: narrativeEngineVersion, Candidate: narrativeJSON(c), Result: r}
	if err := verifyNarrativeApproval(c, a); err != nil {
		t.Fatal(err)
	}
	r.Supports[1].Quote = strings.ReplaceAll(r.Supports[1].Quote, `\n`, "\n")
	a.Result = r
	if verifyNarrativeApproval(c, a) == nil {
		t.Fatal("LF silently matched literal backslash-n")
	}
}
