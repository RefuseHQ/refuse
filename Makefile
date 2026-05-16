.PHONY: install build test typecheck dev clean docker docker-run docker-shell audit help

PNPM ?= pnpm
IMAGE ?= ghcr.io/refusehq/refuse
TAG ?= dev

help:
	@echo "Common targets:"
	@echo "  install      install workspace deps"
	@echo "  build        compile TS"
	@echo "  test         run tests"
	@echo "  typecheck    tsc --noEmit"
	@echo "  dev          run the server with hot reload"
	@echo "  docker       build the Docker image (\$$IMAGE:\$$TAG)"
	@echo "  docker-run   docker run with a local ./data volume"
	@echo "  audit        run the OSS-independence audit greps"
	@echo "  clean        remove node_modules + dist"

install:
	$(PNPM) install

build:
	$(PNPM) -r run build

test:
	$(PNPM) -r run test

typecheck:
	$(PNPM) -r run typecheck

dev:
	$(PNPM) --filter @refuse-oss/server dev

docker:
	docker buildx build -t $(IMAGE):$(TAG) -f docker/Dockerfile .

docker-run:
	mkdir -p data
	docker run --rm -p 8080:8080 -v "$$PWD/data:/data" $(IMAGE):$(TAG)

docker-shell:
	docker run --rm -it --entrypoint /bin/sh $(IMAGE):$(TAG)

audit:
	@./scripts/audit.sh

clean:
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/*/dist packages/*/dist
