package experience

import (
 "encoding/json"
 "strings"
 "testing"
)

func TestGameplayContractClosedOptionalCarrier(t *testing.T) {
 c:=sampleCandidate()
 c.GameplayUpdate=&GameplayUpdate{SchemaVersion:1,Game:json.RawMessage(`null`),Experience:json.RawMessage(`null`),Events:[]GameplayEvent{}}
 raw,_:=json.Marshal(c)
 got,err:=DecodeCandidate(raw)
 if err!=nil || got.GameplayUpdate==nil { t.Fatalf("valid carrier: %v",err) }
 for _,bad:=range []string{
  strings.Replace(string(raw),`"schemaVersion":1`,`"schemaVersion":2`,1),
  strings.Replace(string(raw),`"events":[]`,`"events":[],"execute":true`,1),
  strings.Replace(string(raw),`"events":[]`,`"events":null`,1),
  strings.Replace(string(raw),`"game":null`,`"game":{"entities":[],"surfaces":[],"spatial":null,"journeys":null,"script":"bad"}`,1),
 } { if _,err:=DecodeCandidate([]byte(bad));err==nil {t.Fatal("accepted malformed gameplay carrier")} }
 ctx:=sampleContext();ctx.Mode="ask";ctx.State.StoryTime=c.StoryTime
 if _,err:=Apply(ctx,c);err==nil {t.Fatal("ask accepted empty gameplay mutation")}
}
func TestGameplayPublicProjectionPreservesWithoutAliasingOrRuntimeLeak(t *testing.T) {
 ctx:=sampleContext()
 ctx.State.Gameplay=&GameplayState{SchemaVersion:1,Game:json.RawMessage(`null`),Location:"茶铺",Inventory:[]string{"茶杯"},Experience:json.RawMessage(`null`)}
 ctx.GameplayRuntime=&ArtifactRuntime{NodePath:"private-runtime-path"}
 raw,_:=json.Marshal(ctx)
 if strings.Contains(string(raw),"private-runtime-path")||strings.Contains(string(raw),"GameplayRuntime") {t.Fatal("runtime leaked")}
 if err:=validateContract(raw,"context");err!=nil {t.Fatal(err)}
 projected:=ReaderState(ctx.State)
 if projected.Gameplay==nil||projected.Gameplay.Location!="茶铺" {t.Fatal("public gameplay omitted")}
 projected.Gameplay.Inventory[0]="changed"
 if ctx.State.Gameplay.Inventory[0]!="茶杯" {t.Fatal("projection shares authority slice")}
}
