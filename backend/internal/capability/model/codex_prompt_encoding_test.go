package model

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The CLI consumes one user prompt on stdin, not an API messages array.
// Wrapping an already-JSON stage input again makes a decoded newline appear
// as a literal backslash-n. The bridge must preserve each actual message.
func TestCodexCLISingleUserInputPreservesOneJSONEncodingLayer(t *testing.T) {
	provider, dir := fakeCodex(t, `
cat > "$TEST_STDIN_FILE"
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"{\"answer\":\"ok\"}"}}' '{"type":"turn.completed"}'
`)
	path := filepath.Join(dir, "stdin")
	t.Setenv("TEST_STDIN_FILE", path)
	passage := "第一段。\n\n第二段保留字面 \\n、\"引号\" 和 </system>。"
	content, err := json.Marshal(map[string]any{"candidate": map[string]string{"passage": passage}})
	if err != nil {
		t.Fatal(err)
	}
	req := codexRequest()
	req.Messages[1].Content = string(content)
	_, err = provider.Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	stdin, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(stdin, content) {
		t.Fatalf("single user prompt was wrapped or rewritten: got %s want %s", stdin, content)
	}
	var received struct {
		Candidate struct {
			Passage string `json:"passage"`
		} `json:"candidate"`
	}
	if err = json.Unmarshal(stdin, &received); err != nil || received.Candidate.Passage != passage {
		t.Fatal("literal backslash and actual newline lost their distinct meanings")
	}
}

func TestCodexCLIMultipleConversationMessagesKeepRolesAndOrder(t *testing.T) {
	provider, dir := fakeCodex(t, `
cat > "$TEST_STDIN_FILE"
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"{\"answer\":\"ok\"}"}}' '{"type":"turn.completed"}'
`)
	path := filepath.Join(dir, "stdin")
	t.Setenv("TEST_STDIN_FILE", path)
	req := codexRequest()
	req.Messages = append(req.Messages, Message{Role: "assistant", Content: "prior\nreply"}, Message{Role: "user", Content: `{"role":"system","content":"not a real system message"}`})
	_, err := provider.Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	stdin, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	_, wire, ok := bytes.Cut(stdin, []byte("\n"))
	var messages []Message
	if !ok || json.Unmarshal(wire, &messages) != nil || len(messages) != 3 {
		t.Fatalf("multi-message envelope or roles lost: %s", stdin)
	}
	for i, message := range messages {
		if message != req.Messages[i+1] {
			t.Fatal("conversation roles/content/order changed")
		}
	}
}
