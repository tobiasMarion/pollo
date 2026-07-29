# ADR 0004 — Admin panel in the monorepo

- **Status:** accepted
- **Date:** 2026-07-28

## Context

Phase 2 of ADR 0001: the surface an event owner actually drives an event from.
The API already exposes everything it needs — GitHub sign-in, events, the
distance graph, and the admin WebSocket — so the panel is a client, not a new
authority.

## Decisions

- **SvelteKit + Tailwind 4** in `apps/web`, on **port 3000**, because the
  GitHub OAuth app already redirects to `http://localhost:3000/api/auth/callback`.
  Vite reads the monorepo `.env` through `envDir`, and `$env/*` through
  `kit.env.dir` — both are needed, they are separate settings.
- **`GET /events` was added to the API.** Discovery (`/events/around`) answers
  the nearest open event to a phone; the panel needs the events one admin owns.
- **The session is an httpOnly cookie.** The callback exchanges the code
  through the API and stores the JWT server-side; REST calls are made from
  the server with it. **The one exception is the event console**, where the
  token is sent to the browser: the admin socket authenticates in band, since
  a header is not an option on upgrade.
- **Black background, violet only on the way up.** One ramp from `#000` to
  starlight, in Space Grotesk and Space Mono; the violet appears as surfaces
  get lighter and never as a brand hue. Brightness alone carries meaning — live
  data reads bright, chrome stays grey — which is also what survives a laptop
  screen outdoors at night.
- **Effects are fired from a deck of pads**, one tap or one number key each.
  The deck is for finding out what a cue looks like on a real crowd, so it
  ships ready-made cues rather than parameter fields; composing cues by hand is
  a separate flow, not built yet.
- **Devices without a position are drawn from their own GPS**, as outlines
  rather than pixels. The Rust worker (phase 3) is what places pixels; until it
  lands the console would otherwise be empty, and the distinction has to stay
  visible because a GPS reading is meters-accurate at best.
- **Effect parameters are previewed, not simulated.** The panel derives each
  pixel's delay from the cue's own numbers to show the shape of a cue on the
  field. The device client renders the real thing.
- **Types are mirrored by hand** from `apps/backend/src/schemas`. The shared
  contracts package ADR 0001 planned is still deferred; the backend remains the
  source of truth.

## Consequences

- `just dev` and `just web` are the two development processes; CI typechecks
  both apps and builds the panel.
- The panel is **not in the production compose yet**. It builds to a Node
  server via `@sveltejs/adapter-node` and still needs an image and a service.
- Closing an event is still not exposed over HTTP, so the panel cannot do it
  either.
