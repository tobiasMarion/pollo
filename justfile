# Pollo — development shortcuts.  Usage: `just <target>` (install: brew install just)
set dotenv-load := true

# List available targets
default:
    @just --list

# The whole dev environment in one terminal: datastores, migrations, the
# contracts watch, the API and the panel. Logs interleave; Ctrl-C stops the
# host processes and leaves the datastores running (`just down` stops those).
[doc('Everything at once, with hot-reload — datastores, API and panel')]
all:
    #!/usr/bin/env bash
    set -euo pipefail
    docker compose -f infra/compose.dev.yaml up -d --wait
    npm run db:migrate --workspace=@pollo/backend
    npm run build --workspace=@pollo/contracts
    # Signal the whole process group on the way out: without this, Ctrl-C
    # leaves the API holding :3333 and the panel holding :3000, and the next
    # `just all` fails on a port that is taken. INT and TERM are trapped as
    # well as EXIT, and the trap disarms itself so `kill 0` does not re-enter.
    trap 'trap - INT TERM EXIT; kill 0' INT TERM EXIT
    # --preserveWatchOutput: tsc clears the screen on every rebuild otherwise,
    # taking the API and panel logs with it.
    npx tsc -w -p packages/contracts/tsconfig.build.json --preserveWatchOutput &
    npm run dev --workspace=@pollo/backend &
    npm run dev --workspace=@pollo/web &
    wait

# Start the dev datastores (Postgres + Redis) in the background
up:
    docker compose -f infra/compose.dev.yaml up -d

# Stop the datastores
down:
    docker compose -f infra/compose.dev.yaml down

# Datastore logs
logs:
    docker compose -f infra/compose.dev.yaml logs -f

# Compile the shared contracts (both apps import the build output, not the source)
contracts:
    npm run build --workspace=@pollo/contracts

# `dev` and `web` see the build output, and both watch it — the symlink resolves
# outside node_modules — so this is all it takes for a contract edit to reach
# them. `all` already runs it; this is for when `dev` and `web` are separate.
[doc('Recompile the contracts on every change')]
contracts-watch:
    npx tsc -w -p packages/contracts/tsconfig.build.json

# Run the API on the host with hot-reload
dev: contracts
    npm run dev --workspace=@pollo/backend

# Run the admin panel on the host with hot-reload (needs the API up)
web: contracts
    npm run dev --workspace=@pollo/web

# Emulate an audience against a live event. Every flag is passed straight
# through, so `just simulate --help` lists them.
[doc('Emulate an audience — `just simulate --event <uuid> --venue theater`')]
simulate *ARGS: contracts
    npm run -s start --workspace=@pollo/simulator -- {{ARGS}}

# Apply Prisma migrations (dev datastores must be up)
migrate:
    npm run db:migrate --workspace=@pollo/backend

# Tests for all packages
test: contracts
    npm run test --workspaces --if-present

# Format the whole repo with Biome
format:
    npm run format

# Format + lint + organize imports, applying fixes
check:
    npm run check

# Full dev environment reset (deletes volumes!)
reset:
    docker compose -f infra/compose.dev.yaml down -v

# Build the production images
prod-build:
    docker compose --env-file .env -f infra/compose.prod.yaml build

# Start the production stack (runs migrations first)
prod-up:
    docker compose --env-file .env -f infra/compose.prod.yaml up -d --wait

# Stop the production stack
prod-down:
    docker compose --env-file .env -f infra/compose.prod.yaml down

# Production stack logs
prod-logs:
    docker compose --env-file .env -f infra/compose.prod.yaml logs -f
