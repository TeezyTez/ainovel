# Local development only; no account, production installation or publishing.
GO ?= go
CARGO ?= cargo
FLUTTER ?= flutter
PYTHON ?= python3
NODE ?= node
API_BASE ?= http://127.0.0.1:18081

.PHONY: test test-contract test-backend test-algorithms test-frontend build

test: test-contract test-backend test-algorithms test-frontend

test-contract:
	$(PYTHON) -B -m unittest discover -s tests -p 'test_*.py' -v

test-backend:
	cd backend && GOWORK=off $(GO) test ./...

test-algorithms:
	cd algorithms && $(CARGO) test --locked

test-frontend:
	$(NODE) --test frontend/assets/portal_scene/*.test.mjs
	cd frontend && $(FLUTTER) test --no-pub

# First resolve dependencies with: (cd frontend && flutter pub get)
# Go/Cargo resolve only dependencies declared in the bundled manifests/locks.
build:
	cd algorithms && $(CARGO) build --locked --bin algorithm-runtime
	cd backend && GOWORK=off $(GO) build -o bin/product-dev ./cmd/product-dev
	cd frontend && $(FLUTTER) build web --release --no-pub --no-web-resources-cdn --dart-define=ELSELIFE_API_BASE="$(API_BASE)"
