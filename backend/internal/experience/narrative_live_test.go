//go:build integration && codexlive

package experience

import (
    "bufio"
    "context"
    "os"
    "os/exec"
    "strings"
    "testing"
    "time"
    "elselife/backend/internal/algorithm/channel"
    "elselife/backend/internal/capability/model"
)

func TestNarrativeCodexLiveActionAndContinue(t *testing.T) {
    binary:=os.Getenv("ELSELIFE_TEST_RUST_RUNTIME")
    if binary=="" || os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH")=="" { t.Skip("explicit live configuration required") }
    cmd:=exec.Command(binary,"--listen","127.0.0.1:0","--insecure-plaintext")
    stdout,err:=cmd.StdoutPipe(); if err!=nil {t.Fatal(err)}
    if err=cmd.Start();err!=nil {t.Fatal(err)}
    t.Cleanup(func(){_ = cmd.Process.Kill();_ = cmd.Wait()})
    scanner:=bufio.NewScanner(stdout)
    if !scanner.Scan() {t.Fatal("runtime did not announce port")}
    addr:=strings.TrimPrefix(scanner.Text(),"listening ")
    link:=channel.NewLink(context.Background(),channel.ClientOptions{Addr:addr,Transport:channel.ClientTransportConfig{InsecurePlaintext:true}})
    defer link.Close()
    cli,err:=model.NewCodexCLI(os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH"),os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"),os.Getenv("ELSELIFE_DEV_CODEX_MODEL"),os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
    if err!=nil {t.Fatal(err)}
    cli.Proxy=os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
    algorithm:=&Algorithm{ProseFirst:true,Link:link,Model:cli,ModelName:os.Getenv("ELSELIFE_DEV_CODEX_MODEL"),Timeout:2*time.Minute,ModelContextTokens:65536,MaxOutputTokens:8192,ModelByteTokenBoundVerified:true,MaxModelCalls:5}
    s,_,_:=testService(t);s.ProseFirst=true;s.Generator=algorithm;s.MaxContextBytes=256<<10
    ctx:=context.Background()
    v,_,err:=s.Create(ctx,"live-test",CreateRequest{RequestID:"live-opening",Seed:"这是独立的小说功能测试：雨后书店，玩家是来取旧书的客人。每次写一段约150字的中文正文。"});must(t,err)
    must(t,s.GenerateAccepted(ctx,"live-test","live-opening"))
    v,err=s.Get(ctx,"live-test",v.ID,v.BranchID);must(t,err)
    if v.Revision!=1 {t.Fatalf("opening not committed: %+v",v.Operation)}
    t.Logf("real Codex opening committed: revision=%d, prose_bytes=%d",v.Revision,len(v.Pages[0].Text))
    for index,mode:=range []string{"act","read"} {
        input:="我走到柜台前，问店主是否替我留着那本旧书。";if mode=="read" {input=""}
        id:=[]string{"live-action","live-continue"}[index]
        _,_,err=s.Advance(ctx,"live-test",v.ID,AdvanceRequest{RequestID:id,BranchID:v.BranchID,ExpectedRevision:v.Revision,Mode:mode,Input:input});must(t,err)
        must(t,s.GenerateAccepted(ctx,"live-test",id))
        v,err=s.Get(ctx,"live-test",v.ID,v.BranchID);must(t,err)
        if v.Revision!=int64(index+2) || !textOK(v.Pages[len(v.Pages)-1].Text) {t.Fatalf("%s not committed: %+v",mode,v.Operation)}
        t.Logf("real Codex %s committed: revision=%d, prose_bytes=%d",mode,v.Revision,len(v.Pages[len(v.Pages)-1].Text))
    }
}
