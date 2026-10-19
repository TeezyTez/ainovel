package experience

import "testing"

func TestMalformedOptionalShapeDoesNotDiscardProse(t *testing.T) {
    c,err:=decodeNarrativeCandidate([]byte(`{"title":"新页","passage":"门被推开了。","new_entities":123}`),sampleContext())
    if err!=nil || c.Passage!="门被推开了。" || !c.NarrativeOnly {t.Fatalf("%+v %v",c,err)}
}

func TestNarrativePreservesProseWhenOptionalFactsAreInvalid(t *testing.T) {
    ctx := sampleContext()
    c := sampleCandidate()
    c.Passage = "门被推开了。"
    c.NewFacts = []Fact{{ID:"bad", Text:"尚未归档的细节", SourceRevision:999}}
    got, state, err := applyNarrative(ctx,c)
    if err != nil || got.Passage != c.Passage || !got.NarrativeOnly { t.Fatalf("prose lost: %+v %v",got,err) }
    if len(state.Facts)!=len(ctx.State.Facts) || len(got.NewFacts)!=0 {t.Fatal("invalid metadata committed")}
}
func TestNarrativeNeverInventsMissingModelText(t *testing.T) {
    c:=sampleCandidate(); c.Passage=""
    if _,_,err:=applyNarrative(sampleContext(),c);err==nil {t.Fatal("empty prose accepted")}
}
func TestNarrativeRetainsValidMetadata(t *testing.T) {
    c:=sampleCandidate()
    got,_,err:=applyNarrative(sampleContext(),c)
    if err!=nil || got.NarrativeOnly || got.Passage!=c.Passage {t.Fatalf("valid candidate changed: %v",err)}
}
