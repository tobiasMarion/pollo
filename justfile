# Pollo — development shortcuts.  Usage: `just <target>` (install: brew install just)
set dotenv-load := true

# List available targets
default:
    @just --list

# Start the dev datastores (Postgres + Redis) in the background
up:
    docker compose -f infra/compose.dev.yaml up -d

# Stop the datastores
down:
    docker compose -f infra/compose.dev.yaml down

# Datastore logs
logs:
    docker compose -f infra/compose.dev.yaml logs -f

# Run the API on the host with hot-reload
dev:
    npm run dev --workspace=@pollo/backend

# Apply Prisma migrations (dev datastores must be up)
migrate:
    npm run db:migrate --workspace=@pollo/backend

# Tests for all packages
test:
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
