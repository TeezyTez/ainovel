package experience

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

// ScriptedDemoGenerator is an opt-in, finite development substitute for a model.
// Its data is generated from the original demo's worlds.js and demo.js. It
// intentionally recognizes only the three unchanged preset seed strings (plus
// their exact formal-frontend seed aliases), never an arbitrary user seed.
type ScriptedDemoGenerator struct{}

//go:embed scripted_demo_fixture.json
var scriptedDemoFixture []byte

type scriptedEvent struct {
	Type   string `json:"type"`
	Value  string `json:"value"`
	Entity string `json:"entity"`
}

type scriptedOutcome struct {
	Prose  string          `json:"prose"`
	Events []scriptedEvent `json:"events"`
}

type scriptedChoice struct {
	ID       string            `json:"id"`
	Text     string            `json:"text"`
	Outcomes []scriptedOutcome `json:"outcomes"`
	Variants map[string]int    `json:"variants"`
}

type scriptedAction struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type scriptedScene struct {
	Actions []scriptedAction `json:"actions"`
	Choices []scriptedChoice `json:"choices"`
}

type scriptedCharacter struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Role   string `json:"role"`
	Public string `json:"public"`
}

type scriptedWorld struct {
	ID         string              `json:"id"`
	Title      string              `json:"title"`
	Opening    string              `json:"opening"`
	Location   string              `json:"location"`
	Seeds      []string            `json:"seeds"`
	Characters []scriptedCharacter `json:"characters"`
	Scenes     []scriptedScene     `json:"scenes"`
}

type scriptedFixture struct {
	Worlds []scriptedWorld `json:"worlds"`
}

var scriptedLoad struct {
	once   sync.Once
	bySeed map[string]*scriptedWorld
	err    error
}

func scriptedWorldForSeed(seed string) (*scriptedWorld, error) {
	scriptedLoad.once.Do(func() {
		var fixture scriptedFixture
		if err := json.Unmarshal(scriptedDemoFixture, &fixture); err != nil {
			scriptedLoad.err = err
			return
		}
		scriptedLoad.bySeed = make(map[string]*scriptedWorld)
		for i := range fixture.Worlds {
			world := &fixture.Worlds[i]
			if len(world.Scenes) != 8 || len(world.Seeds) != 2 {
				scriptedLoad.err = fmt.Errorf("invalid scripted demo fixture for %s", world.ID)
				return
			}
			for _, alias := range world.Seeds {
				if alias == "" || scriptedLoad.bySeed[alias] != nil {
					scriptedLoad.err = fmt.Errorf("duplicate or empty scripted demo seed")
					return
				}
				scriptedLoad.bySeed[alias] = world
			}
		}
	})
	return scriptedLoad.bySeed[seed], scriptedLoad.err
}

type scriptedProgress struct {
	approach string
	method   string
	bought   bool
}

func (p scriptedProgress) key() string {
	bought := "0"
	if p.bought {
		bought = "1"
	}
	return p.approach + "|" + p.method + "|" + bought
}

func (p *scriptedProgress) accept(world *scriptedWorld, outcome scriptedOutcome) {
	for _, event := range outcome.Events {
		switch {
		case event.Type == "flag" && event.Entity == world.ID+":approach":
			p.approach = event.Value
		case event.Type == "flag" && event.Entity == world.ID+":method":
			p.method = event.Value
		case world.ID == "thursday" && event.Type == "fact" && strings.Contains(event.Value, "自愿付款取走"):
			p.bought = true
		}
	}
}

func scriptedChoose(scene scriptedScene, mode, input string) (*scriptedChoice, error) {
	if mode == "read" || mode == "act" && (input == "继续" || input == "让当前场景自然继续。") {
		for i := range scene.Choices {
			if scene.Choices[i].ID == "continue" {
				return &scene.Choices[i], nil
			}
		}
	}
	if mode == "act" {
		for i := range scene.Choices {
			if scene.Choices[i].ID != "continue" && scene.Choices[i].Text == input {
				return &scene.Choices[i], nil
			}
		}
	}
	return nil, fail("model_unavailable")
}

func (choice *scriptedChoice) outcome(progress scriptedProgress) (scriptedOutcome, error) {
	index, ok := choice.Variants[progress.key()]
	if !ok || index < 0 || index >= len(choice.Outcomes) {
		return scriptedOutcome{}, fail("scripted_demo_unavailable")
	}
	return choice.Outcomes[index], nil
}

func scriptedOpening(world *scriptedWorld) Candidate {
	candidate := scriptedCandidate(world, world.Title, world.Opening, "awaits_player", world.Scenes[0].Actions)
	for _, person := range world.Characters {
		candidate.NewEntities = append(candidate.NewEntities, Entity{
			ID: "demo_" + world.ID + "_" + person.ID, Kind: "person", Name: person.Name,
			Description: person.Role + "。" + person.Public, Known: true, RelatedIDs: []string{},
		})
	}
	return candidate
}

func scriptedCandidate(world *scriptedWorld, title, prose, outcome string, actions []scriptedAction) Candidate {
	candidate := Candidate{
		Title: title, Passage: "【开发演示 · 固定预设脚本】\n\n" + prose,
		StoryTime: world.Location, Outcome: outcome,
		Suggestions: []string{}, NewFacts: []Fact{}, NewEntities: []Entity{}, NewThreads: []Thread{},
		RevealEntityIDs: []string{}, RevealThreadIDs: []string{}, RevealFactIDs: []string{},
		ResolveThreadIDs: []string{}, KnowledgeChanges: []KnowledgeChange{},
	}
	for _, action := range actions {
		candidate.Suggestions = append(candidate.Suggestions, action.Text)
	}
	return candidate
}

func scriptedTurn(world *scriptedWorld, revision int64, step int, output scriptedOutcome) Candidate {
	end := step+1 == len(world.Scenes)
	status := "awaits_player"
	actions := []scriptedAction{}
	if end {
		status = "ending"
	} else {
		actions = world.Scenes[step+1].Actions
	}
	candidate := scriptedCandidate(world, fmt.Sprintf("%s · 片刻 %d", world.Title, step+1), output.Prose, status, actions)
	for index, event := range output.Events {
		if event.Type == "flag" { // Branch state is reconstructed from formal page inputs.
			continue
		}
		fact := Fact{ID: fmt.Sprintf("demo_%s_r%d_e%d", world.ID, revision+1, index), Kind: "fact", Known: true, KnownBy: []string{}, SourceRevision: revision + 1}
		switch event.Type {
		case "fact":
			fact.Text = event.Value
		case "relation":
			fact.SubjectID = "demo_" + world.ID + "_" + event.Entity
			fact.Text = event.Value
		case "item-add":
			fact.Text = "获得物品：" + event.Value
		default:
			continue
		}
		candidate.NewFacts = append(candidate.NewFacts, fact)
	}
	return candidate
}

// Generate returns one finite scripted page. Service still applies/commits the
// candidate under its normal fence, state validation, and PostgreSQL transaction.
func (ScriptedDemoGenerator) Generate(_ context.Context, c Context, _ string) (Candidate, error) {
	world, err := scriptedWorldForSeed(c.Seed)
	if err != nil {
		return Candidate{}, fail("scripted_demo_unavailable")
	}
	if world == nil {
		return Candidate{}, fail("model_unavailable")
	}
	if c.Revision == 0 && c.Mode == "begin" && len(c.History) == 0 {
		return scriptedOpening(world), nil
	}
	if c.Revision <= 0 || c.Revision != int64(len(c.History)) || !c.HistoryComplete || len(c.History) == 0 {
		return Candidate{}, fail("scripted_demo_history_unavailable")
	}
	if c.History[0].Mode != "begin" || c.History[0].Text != scriptedOpening(world).Passage {
		return Candidate{}, fail("scripted_demo_history_unavailable")
	}
	progress := scriptedProgress{}
	for i := 1; i < len(c.History); i++ {
		step := i - 1
		if step >= len(world.Scenes) {
			return Candidate{}, fail("scripted_demo_history_unavailable")
		}
		page := c.History[i]
		choice, err := scriptedChoose(world.Scenes[step], page.Mode, page.Input)
		if err != nil {
			return Candidate{}, fail("scripted_demo_history_unavailable")
		}
		output, err := choice.outcome(progress)
		if err != nil || page.Text != scriptedTurn(world, int64(i), step, output).Passage {
			return Candidate{}, fail("scripted_demo_history_unavailable")
		}
		progress.accept(world, output)
	}
	step := int(c.Revision - 1)
	if step >= len(world.Scenes) {
		return Candidate{}, fail("scripted_demo_complete")
	}
	choice, err := scriptedChoose(world.Scenes[step], c.Mode, c.Input)
	if err != nil {
		return Candidate{}, err
	}
	output, err := choice.outcome(progress)
	if err != nil {
		return Candidate{}, err
	}
	return scriptedTurn(world, c.Revision, step, output), nil
}
