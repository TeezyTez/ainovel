//go:build integration

package experience

import (
    "context"
    "testing"
)

func TestProseFirstCommitsAndContinuesDespiteInvalidOptionalMetadata(t *testing.T) {
    s,_,_:=testService(t)
    s.ProseFirst=true
    v:=begin(t,s,"prose-account","opening")
    s.Generator=generateFunc(func(_ context.Context,c Context,_ string)(Candidate,error){
        out:=candidate(c)
        out.Passage="这是测试夹具正文，不是真实模型输出。"
        out.NewFacts=[]Fact{{ID:"bad",Text:"invalid index",SourceRevision:999}}
        return out,nil
    })
    for i,mode:=range []string{"act","read"} {
        v=advance(t,s,"prose-account",v,[]string{"action","continue"}[i],mode)
        if v.Revision!=int64(i+2) || v.Pages[len(v.Pages)-1].Text!="这是测试夹具正文，不是真实模型输出。" {t.Fatalf("prose missing at %d: %+v",i,v)}
    }
}
