//go:build integration && codexlive

package experience

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
)

func TestArtifactContentCodexLive(t *testing.T) {
	binary := os.Getenv("ELSELIFE_TEST_RUST_RUNTIME")
	if binary == "" || os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH") == "" {
		t.Skip("explicit real narrative and presentation model configuration required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "--listen", "127.0.0.1:0", "--insecure-plaintext")
	stdout, err := command.StdoutPipe()
	must(t, err)
	must(t, command.Start())
	t.Cleanup(func() { _ = command.Process.Kill(); _ = command.Wait() })
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() || !strings.HasPrefix(scanner.Text(), "listening ") {
		t.Fatal("isolated narrative runtime did not announce its address")
	}
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: strings.TrimPrefix(scanner.Text(), "listening "), Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	provider, err := model.NewCodexCLI(os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH"), os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), os.Getenv("ELSELIFE_DEV_CODEX_MODEL"), os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
	must(t, err)
	provider.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
	interpreter := artifactInterpreter(provider)
	interpreter.ModelName = os.Getenv("ELSELIFE_DEV_CODEX_MODEL")
	interpreter.Timeout = 2 * time.Minute
	service, _, _ := testService(t)
	service.ProseFirst = true
	service.MaxContextBytes = 256 << 10
	service.Generator = &Algorithm{ProseFirst: true, Link: link, Model: provider, ModelName: interpreter.ModelName, Timeout: 2 * time.Minute, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true, MaxModelCalls: 5}
	service.Artifacts = artifactRuntimeForTest(t)
	for _, scenario := range []struct {
		name, seed, mode, input string
		visual                  bool
	}{
		{name: "natural-watermill", seed: "这是独立的虚构小说测试。玩家刚到河边磨坊。磨坊外有立式木水轮，河水推动轮缘叶板，轮轴穿墙入屋，齿轮带动屋里的石磨盘，粮斗位于磨盘上方。写作保持简洁，开场不提前介绍内部构造。", mode: "act", input: "水磨长什么样\n", visual: true},
		{name: "content-spatial", seed: "这是独立的虚构小说测试。玩家跟随工头进入旧矿，尚未选定深入路线。开场停在入口；继续时工头完整交代已勘查的通道供玩家判断，不能替玩家选路：入口向北到分岔厅；厅西接泵房，泵房北接上层栈道；厅东接矿车站，矿车站北接上层栈道；栈道向北到通风井；厅正北的下坡则通积水坑，坑与通风井之间塌方不通。没有已知距离或耗时。", mode: "read", visual: true},
		{name: "content-quiet", seed: "这是独立的虚构小说测试。玩家在旧书店柜台前歇雨，店主刚递来一杯热茶。继续时两人轻松聊几句昨夜的雨，随后安静听屋檐滴水，没有待办任务、复杂关系、参数或需要作出的选择。保持简洁自然。", mode: "read"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			started := time.Now()
			view, _, err := service.Create(ctx, scenario.name, CreateRequest{RequestID: scenario.name + "-begin", Seed: scenario.seed})
			must(t, err)
			must(t, service.GenerateAccepted(ctx, scenario.name, scenario.name+"-begin"))
			view, err = service.Get(ctx, scenario.name, view.ID, view.BranchID)
			must(t, err)
			if view.Revision != 1 {
				t.Fatalf("real opening was not committed: %+v", view.Operation)
			}
			requestID := scenario.name + "-continue"
			_, _, err = service.Advance(ctx, scenario.name, view.ID, AdvanceRequest{RequestID: requestID, BranchID: view.BranchID, ExpectedRevision: view.Revision, Mode: scenario.mode, Input: scenario.input})
			must(t, err)
			must(t, service.GenerateAccepted(ctx, scenario.name, requestID))
			view, err = service.Get(ctx, scenario.name, view.ID, view.BranchID)
			must(t, err)
			if view.Revision != 2 || len(view.Pages) != 2 || !textOK(view.Pages[1].Text) {
				t.Fatalf("real continuation was not committed: %+v", view.Operation)
			}
			prose := view.Pages[1].Text
			if strings.Contains(prose, "```") || strings.ContainsAny(prose, "┌┐└┘├┤┬┴│─") {
				t.Error("narrative substitutes raw fenced or character art for rendered content")
			}
			result, err := service.PrepareArtifact(ctx, scenario.name, view.ID, ArtifactPrepareRequest{RequestID: scenario.name + "-automatic", BranchID: view.BranchID, ExpectedRevision: view.Revision}, interpreter)
			must(t, err)
			if result.Artifact == nil {
				t.Fatal("missing durable automatic presentation decision")
			}
			var payload struct {
				Definition *struct {
					View []map[string]any `json:"view"`
				} `json:"definition"`
				State struct {
					Game map[string]any `json:"game"`
				} `json:"state"`
				SourceGame map[string]any `json:"sourceGame"`
				Reason     string         `json:"reason"`
			}
			must(t, json.Unmarshal(result.Artifact.Payload, &payload))
			types := map[string]bool{}
			var collect func([]map[string]any)
			collect = func(nodes []map[string]any) {
				for _, node := range nodes {
					if kind, ok := node["type"].(string); ok {
						types[kind] = true
					}
					children, _ := node["children"].([]any)
					for _, child := range children {
						if object, ok := child.(map[string]any); ok {
							collect([]map[string]any{object})
						}
					}
				}
			}
			if payload.Definition != nil {
				collect(payload.Definition.View)
			}
			if directory := os.Getenv("ELSELIFE_ARTIFACT_EVAL_DIR"); directory != "" {
				must(t, os.MkdirAll(directory, 0700))
				encoded, err := json.MarshalIndent(result, "", "  ")
				must(t, err)
				must(t, os.WriteFile(filepath.Join(directory, scenario.name+".json"), encoded, 0600))
				pages, err := json.MarshalIndent(view.Pages, "", "  ")
				must(t, err)
				must(t, os.WriteFile(filepath.Join(directory, scenario.name+"-narrative.json"), pages, 0600))
			}
			t.Logf("mode=%s input=%q elapsed=%s types=%v reason=%s", scenario.mode, scenario.input, time.Since(started).Round(time.Millisecond), types, payload.Reason)
			nativeVisual := contentLiveGameHasViews(payload.State.Game) && (payload.SourceGame == nil || contentLiveGameHasViews(payload.SourceGame))
			if scenario.visual && !nativeVisual && !types["illustration"] && !types["diagram"] && !types["interactive"] && !types["react"] {
				t.Error("spatial content was not expressed visually; prose or a table alone is insufficient")
			}
			if !scenario.visual && (payload.Definition != nil || nativeVisual) {
				t.Error("quiet narrative received an unnecessary interface")
			}
			after, err := service.Get(ctx, scenario.name, view.ID, view.BranchID)
			must(t, err)
			if after.Revision != view.Revision || !reflect.DeepEqual(after.Pages, view.Pages) || !reflect.DeepEqual(after.Information, view.Information) || !reflect.DeepEqual(after.Gameplay, view.Gameplay) {
				t.Error("presentation generation changed authoritative story content")
			}
		})
	}
}

func contentLiveGameHasViews(game map[string]any) bool {
	nonempty := func(value any) bool {
		items, ok := value.([]any)
		return ok && len(items) > 0
	}
	spatial, _ := game["spatial"].(map[string]any)
	journeys, _ := game["journeys"].(map[string]any)
	return nonempty(game["surfaces"]) || nonempty(spatial["sites"]) || nonempty(spatial["relations"]) || nonempty(journeys["routes"]) || journeys["transit"] != nil
}
