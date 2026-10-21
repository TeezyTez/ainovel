//go:build integration && codexlive

package experience

import (
	"encoding/json"
	"fmt"
	"reflect"
)

type deepEditorialSourceRequest struct {
	Step        deepStep             `json:"step"`
	Request     AssistRequest        `json:"request"`
	Before      State                `json:"before"`
	View        View                 `json:"public_view"`
	Original    Page                 `json:"original_page"`
	Preferences []PreferenceSnapshot `json:"before_preferences"`
}
type deepEditorialSourceResult struct {
	Result      AssistResult         `json:"result"`
	Snapshot    State                `json:"snapshot"`
	View        View                 `json:"public_view"`
	Original    Page                 `json:"original_page"`
	Preferences []PreferenceSnapshot `json:"after_preferences"`
	Calls       *int                 `json:"model_calls"`
	Elapsed     int64                `json:"elapsed_ms"`
	Applied     *bool                `json:"applied"`
	ReadOnly    *bool                `json:"read_only_verified"`
	Error       *string              `json:"error"`
}
type deepEditorialPending struct {
	entry   deepReplayEditorial
	request deepEditorialSourceRequest
	calls   map[int]bool
	results map[int]string
}

func deepReplayPageMatches(page Page, original deepReplayPage) bool {
	if reflect.DeepEqual(page, original.Page) {
		return true
	}
	migrated, err := deepMigrateInformationPage(original.Page, original.State)
	return err == nil && reflect.DeepEqual(page, migrated)
}

func deepReplayViewMatches(view View, pages []deepReplayPage) bool {
	if len(pages) == 0 || view.Revision != int64(len(pages)) || len(view.Pages) != len(pages) ||
		view.Title != deepReplayTitle(pages[len(pages)-1]) {
		return false
	}
	for i, prior := range pages {
		if !deepReplayPageMatches(view.Pages[i], prior) {
			return false
		}
	}
	return true
}

func deepStartEditorialReplay(raw json.RawMessage, step deepStep, seq int, root string, pages []deepReplayPage) (*deepEditorialPending, error) {
	var request deepEditorialSourceRequest
	if err := StrictJSON(raw, &request); err != nil {
		return nil, fmt.Errorf("unsupported editorial request evidence: %w", err)
	}
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(raw, &fields)
	if len(pages) == 0 || fields["before_preferences"] == nil || request.Preferences == nil ||
		step.Mode != "editorial_request" || !reflect.DeepEqual(request.Step, step) ||
		request.Request.Kind != "polish" || request.Request.Request != step.Input || request.Request.RequestID == "" ||
		request.Request.ExpectedRevision != int64(len(pages)) || request.Request.BranchID == "" ||
		request.Request.BranchID != request.View.BranchID || !deepReplayViewMatches(request.View, pages) ||
		!reflect.DeepEqual(request.Before, pages[len(pages)-1].State) ||
		!reflect.DeepEqual(request.Original, request.View.Pages[len(pages)-1]) {
		return nil, fmt.Errorf("editorial request changed its original target, state or registered input")
	}
	return &deepEditorialPending{
		entry:   deepReplayEditorial{Step: step.ID, SourceRoot: root, RequestEventSeq: seq, RequestData: append(json.RawMessage(nil), raw...)},
		request: request, calls: map[int]bool{}, results: map[int]string{},
	}, nil
}

func (p *deepEditorialPending) modelEvent(kind string, raw json.RawMessage) error {
	var event struct {
		Call    int             `json:"call"`
		Request json.RawMessage `json:"request"`
		Result  struct {
			Text string `json:"text"`
		} `json:"result"`
		Error string `json:"error"`
	}
	if json.Unmarshal(raw, &event) != nil || event.Call < 1 {
		return fmt.Errorf("invalid editorial model event")
	}
	if kind == "model_request" {
		if p.calls[event.Call] {
			return fmt.Errorf("duplicate editorial model request")
		}
		var request struct {
			Messages []struct {
				Role, Content string
			} `json:"messages"`
		}
		if json.Unmarshal(event.Request, &request) != nil {
			return fmt.Errorf("invalid original editorial model request")
		}
		users := 0
		for _, message := range request.Messages {
			if message.Role != "user" {
				continue
			}
			users++
			var input map[string]string
			if StrictJSON([]byte(message.Content), &input) != nil || len(input) != 2 ||
				input["original"] != p.request.Original.Text || input["request"] != p.request.Request.Request {
				return fmt.Errorf("editorial model request retargeted the original paragraph or instruction")
			}
		}
		if users != 1 {
			return fmt.Errorf("editorial source requires its exact original user input")
		}
		p.calls[event.Call] = true
	} else {
		if !p.calls[event.Call] {
			return fmt.Errorf("editorial model result lacks request")
		}
		if _, duplicate := p.results[event.Call]; duplicate || event.Error != "" {
			return fmt.Errorf("duplicate or failed editorial model result")
		}
		var proposal struct {
			Text string `json:"text"`
		}
		if StrictJSON([]byte(event.Result.Text), &proposal) != nil || !textOK(proposal.Text) {
			return fmt.Errorf("editorial model result is not the original polish proposal")
		}
		p.results[event.Call] = proposal.Text
	}
	return nil
}

func (p *deepEditorialPending) finish(raw json.RawMessage, seq int, pages []deepReplayPage) (deepReplayEditorial, error) {
	var result deepEditorialSourceResult
	if err := StrictJSON(raw, &result); err != nil {
		return deepReplayEditorial{}, fmt.Errorf("unsupported editorial result evidence: %w", err)
	}
	if result.Applied == nil || *result.Applied || result.ReadOnly == nil || !*result.ReadOnly ||
		result.Error == nil || *result.Error != "" || result.Calls == nil || *result.Calls < 1 ||
		*result.Calls != len(p.calls) || len(p.calls) != len(p.results) ||
		!reflect.DeepEqual(result.Snapshot, p.request.Before) || !reflect.DeepEqual(result.View, p.request.View) ||
		!reflect.DeepEqual(result.Original, p.request.Original) || !reflect.DeepEqual(result.Preferences, p.request.Preferences) ||
		!deepReplayViewMatches(result.View, pages) || result.Result.Kind != "polish" ||
		result.Result.BranchID != p.request.Request.BranchID || result.Result.BaseRevision != p.request.Request.ExpectedRevision ||
		result.Result.Proposal != nil || !textOK(result.Result.Text) {
		return deepReplayEditorial{}, fmt.Errorf("editorial result was applied, unverified, failed or changed formal data")
	}
	matches := false
	for _, text := range p.results {
		matches = matches || result.Result.Text == text
	}
	if !matches {
		return deepReplayEditorial{}, fmt.Errorf("editorial proposal differs from captured model output")
	}
	p.entry.ResultEventSeq = seq
	p.entry.ResultData = append(json.RawMessage(nil), raw...)
	return p.entry, nil
}
