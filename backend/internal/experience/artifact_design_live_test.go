//go:build integration && codexlive

package experience

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"elselife/backend/internal/capability/model"
)

func TestArtifactDesignCodexLive(t *testing.T) {
	if os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH") == "" {
		t.Skip("explicit live model configuration required")
	}
	provider, err := model.NewCodexCLI(os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH"), os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), os.Getenv("ELSELIFE_DEV_CODEX_MODEL"), os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
	must(t, err)
	provider.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
	interpreter := artifactInterpreter(provider)
	interpreter.ModelName = os.Getenv("ELSELIFE_DEV_CODEX_MODEL")
	interpreter.Timeout = 2 * time.Minute
	service, _, _ := testService(t)
	service.Artifacts = artifactRuntimeForTest(t)
	for _, scenario := range []struct {
		name, prose, intent, priorInput, currentInput string
		allowed                                       []string
		interactive                                   bool
	}{
		{name: "quiet-dialogue", prose: "你笑着说了声谢谢。店主点点头，把书轻轻放到柜台上。窗外雨声渐小，你们又聊起昨夜的天气。"},
		{name: "ordinary-conversation-with-details", prose: "你靠在柜台边，听大家闲聊。林岚说自己在旧书店工作，周衡笑着提起他教过的学生许宁，许宁说顾青今天去了码头。话题又转到饮食：林岚喜欢清茶，周衡爱喝热牛奶，许宁常点桂花水。你笑着听他们讲各自的口味，店主收好杯子，又问起昨夜的雨。"},
		{name: "old-request-is-not-current", priorInput: "把几个人的关系整理一下。", prose: "上一段的关系已经看完了。你合上笔记，说先不谈这些，坐下陪店主喝茶。店主给你续上热水，讲起儿时听雨的记忆。"},
		{name: "automatic-useful-comparison", currentInput: "我还没决定怎么走，想同时看清费用、时间、搬运行李和雨天的取舍，再选适合我的路线。", prose: "去旧书店有四条路线。沿河步道需四十分钟、免费、需要自己搬行李、雨天泥泞；渡船需二十分钟、八枚铜币、船工帮搬行李、大雨停航；山坡小径需三十分钟、免费、需要自己搬行李、全程有石阶且雨天滑；驿站马车需二十五分钟、十二枚铜币、车夫帮搬行李、有顶棚且雨天照常。此处都是路牌公布的信息，还没有选定或出发。", allowed: []string{"table", "chart", "diagram", "interactive", "react"}},
		{name: "ascii-is-not-rendered", currentInput: "我跟着店主进去。", prose: "你从南门进入前院。店主指着院内说，工坊在前院西侧，库房在东侧，两间房各自只有门通向前院，彼此不直接相连。前院北侧的楼梯通往二层回廊，沿回廊向西走，再下西端楼梯才能到后院。前院直通后院的地面门道已经封闭。\n```text\n南门 --> 前院 --> 北楼梯 --> 二层回廊 --> 西端楼梯 --> 后院\n          |                                          ^\n          +--> 工坊                                  |\n          +--> 库房                                  |\n          +------------ 地面门道[封闭] ---------------+\n```\n你停在前院，店主正等着带你去后院。", allowed: []string{"diagram", "illustration", "interactive", "react"}},
		{name: "relationships", prose: "林岚是周衡的姐姐。周衡是许宁的老师。许宁替顾青管理书店。顾青与林岚是儿时好友。", intent: "帮我看清他们之间怎么联系的，名字之间的关联要一眼能看懂。", allowed: []string{"diagram", "interactive", "react"}},
		{name: "sequence", prose: "早上八点，店主收到来信。九点，周衡来到书店。十点，林岚交回钥匙。十一点，店主锁上后门。", intent: "帮我把这几件事的先后顺序理清。", allowed: []string{"timeline", "interactive", "react"}},
		{name: "calculator", prose: "书店准备茶会。每位客人需要两块点心，每块点心三枚铜币。现有预算六十枚铜币，预计六位客人参加。", intent: "做一个茶会试算工具，让我能改人数和每人点心数，实时看到总数量、花费和预算余额。只是试算。", interactive: true},
		{name: "mechanism", prose: "小水车由引水槽、水轮和磨盘构成。水从引水槽流向水轮，水轮带动磨盘。同一负载下，示意模型约定水流速度加倍，水轮与磨盘的转速都加倍。", intent: "做一个可点击部件切换解释的水车示意，再用滑块改变水流速度，让我看到各部件如何一起转动。", allowed: []string{"interactive", "react"}, interactive: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			t.Log("synthetic narrative fixture; only presentation generation uses the live model")
			service.Generator = generateFunc(func(_ context.Context, _ Context, _ string) (Candidate, error) {
				candidate := sampleCandidate()
				candidate.Title = "智能界面验证"
				candidate.Passage = scenario.prose
				return candidate, nil
			})
			ctx := context.Background()
			view := begin(t, service, scenario.name, scenario.name+"-begin")
			if scenario.priorInput != "" {
				_, _, err := service.Advance(ctx, scenario.name, view.ID, AdvanceRequest{RequestID: "prior-" + scenario.name, BranchID: view.BranchID, ExpectedRevision: view.Revision, Mode: "ask", Input: scenario.priorInput})
				must(t, err)
				must(t, service.GenerateAccepted(ctx, scenario.name, "prior-"+scenario.name))
				view, err = service.Get(ctx, scenario.name, view.ID, view.BranchID)
				must(t, err)
				view = advance(t, service, scenario.name, view, "continue-"+scenario.name, "read")
			}
			if scenario.currentInput != "" {
				requestID := "question-" + scenario.name
				_, _, err := service.Advance(ctx, scenario.name, view.ID, AdvanceRequest{RequestID: requestID, BranchID: view.BranchID, ExpectedRevision: view.Revision, Mode: "ask", Input: scenario.currentInput})
				must(t, err)
				must(t, service.GenerateAccepted(ctx, scenario.name, requestID))
				view, err = service.Get(ctx, scenario.name, view.ID, view.BranchID)
				must(t, err)
			}
			started := time.Now()
			result, err := service.PrepareArtifact(ctx, scenario.name, view.ID, ArtifactPrepareRequest{RequestID: "prepare-" + scenario.name, BranchID: view.BranchID, ExpectedRevision: view.Revision, Intent: scenario.intent}, interpreter)
			must(t, err)
			if result.Artifact == nil {
				t.Fatal("missing durable presentation decision")
			}
			var payload struct {
				Definition *struct {
					Fields []map[string]any `json:"fields"`
					View   []map[string]any `json:"view"`
				} `json:"definition"`
				State struct {
					Game map[string]any `json:"game"`
				} `json:"state"`
				SourceGame map[string]any `json:"sourceGame"`
				Reason     string         `json:"reason"`
			}
			must(t, json.Unmarshal(result.Artifact.Payload, &payload))
			types := map[string]bool{}
			var walk func([]map[string]any)
			walk = func(nodes []map[string]any) {
				for _, node := range nodes {
					if kind, ok := node["type"].(string); ok {
						types[kind] = true
					}
					if children, ok := node["children"].([]any); ok {
						for _, child := range children {
							if object, ok := child.(map[string]any); ok {
								walk([]map[string]any{object})
							}
						}
					}
				}
			}
			if payload.Definition != nil {
				walk(payload.Definition.View)
			}
			nativeVisual := contentLiveGameHasViews(payload.State.Game) && (payload.SourceGame == nil || contentLiveGameHasViews(payload.SourceGame))
			if directory := os.Getenv("ELSELIFE_ARTIFACT_EVAL_DIR"); directory != "" {
				must(t, os.MkdirAll(directory, 0700))
				encoded, err := json.MarshalIndent(result, "", "  ")
				must(t, err)
				must(t, os.WriteFile(filepath.Join(directory, scenario.name+".json"), encoded, 0600))
			}
			t.Logf("elapsed=%s types=%v reason=%s", time.Since(started).Round(time.Millisecond), types, payload.Reason)
			if scenario.intent == "" && len(scenario.allowed) == 0 && !scenario.interactive {
				if payload.Definition != nil || nativeVisual {
					t.Fatal("ordinary narrative received an unsolicited interface")
				}
			} else {
				if payload.Definition == nil && !nativeVisual {
					t.Fatal("requested useful interface was omitted")
				}
				if len(scenario.allowed) > 0 {
					matched := nativeVisual
					for _, kind := range scenario.allowed {
						matched = matched || types[kind]
					}
					if !matched {
						t.Errorf("presentation does not support the requested task: %v", types)
					}
				}
				if scenario.interactive && (payload.Definition == nil || len(payload.Definition.Fields) == 0) && !types["interactive"] && !types["react"] {
					t.Error("interactive request was reduced to static text or a table")
				}
			}
			if scenario.name == "mechanism" {
				t.Run("natural-refinement-retains-input", func(t *testing.T) {
					var local map[string]any
					must(t, json.Unmarshal(result.Artifact.State, &local))
					slots, ok := local["artifacts"].(map[string]any)
					if !ok || len(slots) != 1 {
						t.Fatal("executable interface state is not initialized in its renderer slot")
					}
					var expected map[string]any
					for _, slot := range slots {
						expected, ok = slot.(map[string]any)
						if !ok {
							t.Fatal("mechanism has no persistable parameter object")
						}
					}
					changed := false
					for key, value := range expected {
						if _, numeric := value.(float64); numeric {
							expected[key] = float64(0)
							changed = true
						}
					}
					if !changed {
						t.Fatal("mechanism does not persist its numeric parameter")
					}
					state, err := json.Marshal(local)
					must(t, err)
					_, err = service.SaveArtifactState(ctx, scenario.name, view.ID, result.Artifact.ArtifactID, ArtifactStateRequest{RequestID: "state-mechanism", BranchID: view.BranchID, ExpectedRevision: view.Revision, RevisionID: result.Artifact.RevisionID, ExpectedStateRevision: result.Artifact.StateRevision, State: state})
					must(t, err)
					started := time.Now()
					refined, err := service.PrepareArtifact(ctx, scenario.name, view.ID, ArtifactPrepareRequest{InputRouting: true, RequestID: "refine-mechanism", BranchID: view.BranchID, ExpectedRevision: view.Revision, Intent: "把这个讲解改得更清楚些：图中轮子要有清晰的辐条和转动标记，手机上部件名称也要完整显示。保留当前所有参数键名和数值，不重置我的输入，只修改讲解与排版。"}, interpreter)
					must(t, err)
					if refined.IntentDecision == nil || refined.IntentDecision.Kind != "edit" || refined.Artifact == nil {
						t.Fatal("natural refinement was not routed to the current interface")
					}
					var updated struct {
						Artifacts map[string]map[string]any `json:"artifacts"`
					}
					must(t, json.Unmarshal(refined.Artifact.State, &updated))
					if len(updated.Artifacts) != 1 {
						t.Fatal("refined executable state has no unique current slot")
					}
					for _, values := range updated.Artifacts {
						for key, value := range expected {
							if !reflect.DeepEqual(values[key], value) {
								t.Errorf("saved parameter %s changed: got %v, want %v", key, values[key], value)
							}
						}
					}
					if directory := os.Getenv("ELSELIFE_ARTIFACT_EVAL_DIR"); directory != "" {
						encoded, err := json.MarshalIndent(refined, "", "  ")
						must(t, err)
						must(t, os.WriteFile(filepath.Join(directory, "mechanism-refined.json"), encoded, 0600))
					}
					t.Logf("natural refinement elapsed=%s retained=%v", time.Since(started).Round(time.Millisecond), expected)
				})
			}
			after, err := service.Get(ctx, scenario.name, view.ID, view.BranchID)
			must(t, err)
			if after.Revision != view.Revision || len(after.Pages) != len(view.Pages) {
				t.Fatal("presentation generation changed story history")
			}
		})
	}
}
