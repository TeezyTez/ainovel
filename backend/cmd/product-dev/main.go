// product-dev is a loopback-only, fixed-workspace development composition root.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/experience"
	"elselife/backend/internal/experience/devhttp"
	"elselife/backend/internal/platform/database"
	"elselife/backend/schema"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}
func number(name string, fallback int) (int, error) {
	raw := os.Getenv("ELSELIFE_DEV_" + name)
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 || n > 4<<20 {
		return 0, fmt.Errorf("invalid %s", name)
	}
	return n, nil
}
func run() error {
	listen := flag.String("listen", "127.0.0.1:18081", "literal loopback HTTP address (development only)")
	static := flag.String("static-dir", "", "optional Flutter web build directory, served same-origin")
	migrateArtifacts := flag.Bool("migrate-artifacts", false, "add public presentation tables only and exit")
	flag.Parse()
	if !devhttp.LoopbackAddress(*listen) {
		return errors.New("listen must be a literal loopback IP:port")
	}
	if *static != "" {
		st, err := os.Stat(filepath.Join(*static, "index.html"))
		if err != nil || st.IsDir() {
			return errors.New("static-dir requires index.html")
		}
	}
	dsn := os.Getenv("ELSELIFE_DEV_DATABASE_URL")
	if dsn == "" {
		return errors.New("ELSELIFE_DEV_DATABASE_URL is required; apply schema/schema.sql to an empty local database first")
	}
	addr := os.Getenv("ELSELIFE_DEV_ALGORITHM_ADDR")
	if addr == "" {
		addr = "127.0.0.1:18083"
	}
	if !devhttp.LoopbackAddress(addr) {
		return errors.New("algorithm address must be literal loopback IP:port (plaintext development gRPC)")
	}
	tokens, err := number("MODEL_CONTEXT_TOKENS", 0)
	if err != nil {
		return err
	}
	output, err := number("MAX_OUTPUT_TOKENS", 8192)
	if err != nil || output == 0 {
		return errors.New("invalid MAX_OUTPUT_TOKENS")
	}
	verified := false
	if raw := os.Getenv("ELSELIFE_DEV_MODEL_BYTE_TOKEN_BOUND_VERIFIED"); raw != "" {
		verified, err = strconv.ParseBool(raw)
		if err != nil {
			return errors.New("invalid MODEL_BYTE_TOKEN_BOUND_VERIFIED")
		}
	}
	base, name, key := os.Getenv("ELSELIFE_DEV_MODEL_BASE_URL"), os.Getenv("ELSELIFE_DEV_MODEL_NAME"), os.Getenv("ELSELIFE_DEV_MODEL_API_KEY")
	provider := os.Getenv("ELSELIFE_DEV_MODEL_PROVIDER")
	if provider != "" && provider != "openai" && provider != "codex" {
		return errors.New("invalid MODEL_PROVIDER")
	}
	if provider != "codex" && (base != "" || name != "" || key != "") && (base == "" || name == "" || key == "") {
		return errors.New("incomplete model configuration: BASE_URL/NAME/API_KEY must all be explicit")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	connect, cancel := context.WithTimeout(ctx, 10*time.Second)
	db, err := database.OpenServing(connect, dsn)
	cancel()
	if err != nil {
		return errors.New("database unavailable or product schema missing")
	}
	defer db.Close()
	if *migrateArtifacts {
		if err := schema.ApplyArtifacts(ctx, db); err != nil {
			return err
		}
		return schema.ApplyGameplay(ctx, db)
	}
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: addr, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}, MaxPayloadBytes: 2 << 20})
	defer link.Close()
	timeout := 2 * time.Minute
	algorithm := &experience.Algorithm{ProseFirst: true, Link: link, ModelName: name, Timeout: timeout, MaxModelInputBytes: 512 << 10, MaxOutputBytes: 64 << 10, MaxOutputTokens: output, ModelContextTokens: tokens, ModelByteTokenBoundVerified: verified, MaxModelCalls: 5}
	if provider == "codex" {
		if base != "" || name != "" || key != "" {
			return errors.New("Codex provider conflicts with OpenAI-compatible model configuration")
		}
		if tokens == 0 || !verified {
			return errors.New("Codex provider requires explicit MODEL_CONTEXT_TOKENS and MODEL_BYTE_TOKEN_BOUND_VERIFIED=true")
		}
		name = os.Getenv("ELSELIFE_DEV_CODEX_MODEL")
		cli, cliErr := model.NewCodexCLI(os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH"), os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), name, os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
		if cliErr != nil {
			return errors.New("Codex CLI configuration invalid: set CLI_PATH, AUTH_HOME and shared TEMP_DIR")
		}
		cli.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
		cli.ReasoningEffort = os.Getenv("ELSELIFE_DEV_CODEX_REASONING_EFFORT")
		algorithm.Model = cli
		if name == "" {
			name = "codex"
		}
		algorithm.ModelName = name
		log.Print("DEVELOPMENT Codex CLI provider enabled; existing CLI login, no stored API key")
	} else if base != "" {
		algorithm.Model, err = model.NewOpenAIWithClient(base, key, name, &http.Client{Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }})
		if err != nil {
			return errors.New("model_config_invalid")
		}
	} else {
		log.Print("model_unavailable: no explicit model configuration; no external request will be made")
	}
	service := &experience.Service{ProseFirst: true, DB: db, Generator: algorithm, MaxContextBytes: 256 << 10, RecentRevisions: 16, ReadLimits: experience.ReadBudget{MaxReads: 4, MaxReplyBytes: 64 << 10, MaxTotalReplyBytes: 128 << 10}}
	service.Artifacts = &experience.ArtifactRuntime{NodePath: os.Getenv("ELSELIFE_DEV_ARTIFACT_NODE"), ValidatorPath: os.Getenv("ELSELIFE_DEV_ARTIFACT_VALIDATOR"), CompilerPath: os.Getenv("ELSELIFE_DEV_ARTIFACT_COMPILER")}
	if err := service.RecoverExpired(ctx); err != nil {
		return errors.New("product recovery unavailable; verify product schema")
	}
	var calls sync.WaitGroup
	var mu sync.Mutex
	closed := false
	dispatch := func(a, r string) {
		mu.Lock()
		defer mu.Unlock()
		if closed {
			return
		}
		calls.Add(1)
		go func() {
			defer calls.Done()
			if err := service.GenerateAccepted(ctx, a, r); err != nil {
				log.Print("accepted operation ended without commit; inspect operation error_code")
			}
		}()
	}
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if service.RecoverExpired(ctx) != nil {
					log.Print("product recovery unavailable")
				}
			}
		}
	}()
	api := devhttp.Handler{Service: service, Dispatch: dispatch, Feedback: &experience.FeedbackInterpreter{Model: algorithm.Model, ModelName: name, Timeout: timeout, ContextTokens: tokens, OutputTokens: output, MaxInputBytes: 512 << 10, MaxOutputBytes: 64 << 10, ByteTokenBoundVerified: verified}}.Routes()
	server := &http.Server{Addr: *listen, Handler: devhttp.Boundary(api, *static), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 150 * time.Second, IdleTimeout: time.Minute}
	// Bind before announcing readiness, never widening the requested address.
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		return errors.New("loopback listener unavailable")
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("ElseLife product-dev http://%s workspace=%s (no accounts; not production)", *listen, devhttp.Workspace)
	err = server.Serve(listener)
	mu.Lock()
	closed = true
	stop()
	mu.Unlock()
	calls.Wait()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
