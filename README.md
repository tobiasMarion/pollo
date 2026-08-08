# 📌 Pollo

> Sync a million fireflies.

![Project status](https://img.shields.io/badge/status-in%20development-blue?style=flat-square)

---

## 📜 Table of Contents

- [About](#about)
- [Structure](#structure)
- [Requirements](#requirements)
- [Development](#development)
- [Tests](#tests)
- [Simulation](#simulation)
- [Production](#production)
- [Contact](#contact)

---

## 📖 About <a name="about"></a>

Pollo is inspired by the glowing bracelets handed out at Coldplay concerts. The
goal is the same effect with none of the hardware: no wristbands, nothing
installed in the venue — just the phones already in the crowd, each one treated
as a pixel, and a server.

An authenticated admin opens an event and anyone nearby joins it anonymously.
Phones report what they can sense: their own GPS reading, and how far away their
neighbours are. What the server keeps is therefore a **graph of distances**, not
a map of coordinates — GPS is metres-accurate at best, which says nothing useful
about a crowd where people stand centimetres apart. The distances are what make
the arrangement recoverable.

Turning that graph into positions is a simulation, and a simulation has no
business on an event loop. A Rust worker refines the graph into coordinates and
publishes them back; the API only does IO. Until the worker has placed a phone,
that phone is drawn from its own GPS — as an outline rather than a pixel,
because the difference between a measurement and an estimate should stay visible.

**Effects are cues, not frames.** The admin fires one — a pulse, a wave, a
rotating sweep, a spiral — and the server relays it untouched to every phone.
Each phone works out its own brightness from the cue's parameters and where it
is standing. Nothing is streamed per frame and nobody waits on a clock: phones
hear from the server only when the cue changes, and a phone that loses the
connection still finishes the cue it was given.

That is the constraint the whole system is shaped around. It is also why the
message contracts matter more than usual — every client, on every platform,
has to read a cue the same way, or the crowd falls out of step.

---

## 🧱 Structure <a name="structure"></a>

```
apps/
  backend/     Fastify + TypeScript API (REST + WebSockets, Prisma/Postgres, Redis)
  web/         admin panel (SvelteKit + Tailwind)
  simulator/   emulates an audience against a live event
  # worker/    position estimation (Rust)       — phase 3 (rewritten by hand)
  # mobile/    sensor client (SwiftUI/iOS)
packages/
  contracts/   the wire, as Zod schemas — every client validates against these
infra/         Docker Compose (dev + prod) and Dockerfiles
docs/adr/      architecture decision records
```

Everything that crosses a process boundary is defined once, in
`packages/contracts`. One Zod schema carries the runtime validation, the
TypeScript type inferred from it, and the description that becomes the API
reference — and the lists are derived from records, so adding an effect or a
message is a single entry rather than a hunt through every app that speaks the
protocol.

The reasoning behind the pieces lives in [`docs/adr/`](docs/adr): the
[monorepo](docs/adr/0001-greenfield-monorepo.md), the
[API rebuild](docs/adr/0002-api-rebuild.md),
[Prisma 7](docs/adr/0003-prisma-7.md), the
[admin panel](docs/adr/0004-admin-panel.md) and the
[contracts package](docs/adr/0005-shared-contracts.md). For the story around
them rather than the decisions themselves, see [`docs/articles.md`](docs/articles.md).

---

## ✅ Requirements <a name="requirements"></a>

- **Node ≥ 20** with npm — the repo is npm workspaces, no other package manager.
- **Docker** — Postgres and Redis run in containers even in development.
- **[`just`](https://github.com/casey/just)**, optional but assumed below.
  Without it, every command lives in the [`justfile`](justfile).
- A **GitHub OAuth app** — sign-in is GitHub-only, for the API and the panel
  alike.

---

## 🚀 Development <a name="development"></a>

```bash
npm install
cp .env.example .env          # fill JWT_SECRET and the GitHub OAuth credentials
just all                      # everything, one terminal  ->  :3333/docs and :3000
```

`just all` waits for Postgres and Redis, applies the migrations, then runs the
contracts watch, the API and the panel together. Logs interleave; Ctrl-C stops
the three host processes and leaves the datastores up (`just down` stops those).
Editing anything — `packages/contracts` included — reloads the side that needs
it, with no restart.

One process per shell still works if you prefer the logs apart:

```bash
just up && just migrate
just dev                      # API on the host with hot-reload  ->  http://localhost:3333/docs
just web                      # admin panel, in another shell    ->  http://localhost:3000
just contracts-watch          # only if you are editing packages/contracts
```

Every app imports the contracts package's **build output**, so it compiles
before they do — `just all`, `just dev`, `just web`, `just simulate` and
`just test` each take care of that on their own.

The panel signs in with the same GitHub OAuth app as the API, so the app's
**Authorization callback URL** must be exactly `GITHUB_OAUTH_CLIENT_REDIRECT_URI`
(`http://localhost:3000/api/auth/callback` in development). Port 3000 is part of
that contract — the dev server refuses to move.

---

## 🧪 Tests <a name="tests"></a>

```bash
just test                                      # every workspace suite, no external dependencies
npm run test:integration -w @pollo/backend     # needs `just up`
npm run test:e2e -w @pollo/backend             # needs `just up`
npm run test:all -w @pollo/backend             # all three backend tiers
```

Integration and e2e run against a dedicated `pollo_test` database and Redis
logical db 1 — they never touch dev data.

CI (GitHub Actions) runs the same pipeline on every PR: Biome, a typecheck of
every workspace, the panel build, migrations, every workspace suite and the two
backend tiers that need datastores — plus a job that builds the production
images and boots the full stack against its healthchecks.

---

## 🎛️ Simulation <a name="simulation"></a>

A crowd of phones is not a thing anyone has lying around. `apps/simulator`
emulates one: it seats an audience, gives everybody a receiver that lies about
where it is, and reports the results over the same sockets a real device would
use.

```bash
just simulate --event <uuid> --venue theater --clients 500   # --help lists every knob
```

The event has to be open — create one in the panel and pass its id. Nothing else
is needed: `GET /events/:eventId` is public, so the origin comes back without a
token.

**Where the crowd is standing is a choice**, because the shape of it decides
everything downstream. `--venue square` is a flat hall, `stands` a raked block
around a pitch, `theater` curved rows with two balconies overhanging the floor —
the only venue where people stand above other people, and the only one indoors.

**The noise is the product.** Anything can add a random number to a coordinate;
what comes of that is a worker tuned for a world nobody lives in. So the error
drifts on two time scales rather than resampling, the crowd shares most of its
mistakes rather than erring independently, the room decides how bad a fix is,
nobody stands perfectly still, and phones lose signal and come back. Each of
those is a decision with a cheaper, wrong alternative, and each is written up
next to the code that implements it.

**What comes out** is a chart of how far the crowd is from where it really is,
with two lines. On its own the worker's error means nothing; raw GPS, given
identical treatment, is the control, and the gap between them is what the worker
is worth. Both are RMSE after a Procrustes alignment, because a reconstruction
from distances alone has no idea which way north is and would otherwise be
scored on an ambiguity rather than on its geometry.

Every run prints its seed and replays exactly from it. `--json` swaps the
dashboard for NDJSON. The whole thing is written up in
[`apps/simulator`](apps/simulator).

---

## 📦 Production <a name="production"></a>

One VPS, one command. Fill the secrets in `.env`, then:

```bash
just prod-build
just prod-up                  # API on :3333, panel on :3000
```

Migrations are applied on boot and the panel waits for the API to be healthy.
Postgres and Redis stay internal to the compose network; only the API and the
panel are published. `just prod-logs` and `just prod-down` do what they say.

Two addresses matter and they are not the same one: `PUBLIC_POLLO_API_URL` is
what the operator's browser uses, WebSocket included, while the panel's own
server reaches the API inside the network at `http://api:3333`. `WEB_ORIGIN`
must be the address the panel is served from, or form posts are rejected.

---

## 📬 Contact <a name="contact"></a>

📧 Tobias Cadoná Marion — contato@tobiasmarion.com

Made with 🤍 by Tobias
