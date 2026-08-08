# Simulator

A crowd of phones is not a thing anyone has lying around. This workspace
emulates one: it seats an audience, gives everybody a receiver that lies about
where it is, and reports the results over the same sockets a real device would
use.

```bash
just simulate --event <uuid> --venue theater --clients 500   # --help lists every knob
```

The event has to be open — create one in the panel and pass its id. Nothing else
is needed: `GET /events/:eventId` is public, so the origin comes back without a
token.

## Why it exists

`apps/backend` speaks the whole protocol but has never seen more than a handful
of devices, and the worker that turns readings into positions is written by hand
against this bench. Before that worker exists there has to be something that
produces its input, and measures its output against a truth only the simulator
knows.

## The three venues

Pollo is not a stadium app. It runs wherever a crowd has phones, and the shape
of the crowd is the input to everything downstream — so `--venue` picks one:

| | |
|---|---|
| `square` | A flat square of standing people: a club, a hall, an open field. Flat, unstructured, and therefore the control. |
| `stands` | A raked block of rows around a pitch. Neighbours are close along a row and a step apart across one. |
| `theater` | Curved rows facing a stage, a gangway down the middle, and two balconies overhanging the back of the floor. |

Every venue sizes itself to `--clients` and carries a few spare seats, because
people move. What they look like, and what each one is for, is in
[`src/crowd/`](src/crowd).

## The noise

Anything can add a random number to a coordinate. A worker tuned against that
has been tuned for a world nobody lives in, so three things are modelled rather
than sampled:

**The error drifts.** A fix is not redrawn every second — it wanders and comes
back, on two time scales at once: it jitters over seconds and also slides across
the afternoon. Ornstein–Uhlenbeck, exact discrete form, so the same process
holds its σ whatever step size a thread hands it.

**The crowd is wrong together.** Phones standing five metres apart listen to the
same satellites through the same sky, so most of what they get wrong, they get
wrong *together* — `--common-mode` is that share, 0.8 by default. It matters
because a common offset slides the whole cloud without deforming it, which is
precisely the error a reconstruction from distances cannot see and raw GPS
suffers in full.

**The room decides the budget.** Each venue declares how wrong a fix is in that
kind of place — 4 m in the open, 15 m indoors — and every handset draws its own
quality around it. Not derived from geometry: what a phone can see of the sky
depends on the roof, the balcony, the body in front of it and the building next
door, none of which a simulator honestly knows.

On top of all that, people are never quite still, phones lose signal for a few
seconds, and people leave and come back. `--churn`, `--blackout` and
`--move-prob` are the rates, per minute.

## Reading a run

The chart carries **two lines**, and that is the whole point of it. On its own
the worker's error means nothing — there is no scale on which "4.2 m" is good or
bad. Raw GPS, given exactly the same treatment, is the control, and the gap
between the two lines is what the worker is worth. Before a worker exists, only
the control is drawn, and that is still the answer to a real question.

Both are RMSE after a Procrustes alignment. A reconstruction built from
distances has no idea which way north is, so scoring it against the truth
directly measures an ambiguity rather than a geometry — see
[`src/metrics/align.ts`](src/metrics/align.ts).

Every run prints its seed and replays exactly from it. `--json` swaps the
dashboard for NDJSON.

## Layout

```
src/
  crowd/    build an audience — the three venues, who sits where, who is close enough to hear whom
  noise/    the drift the crowd shares, the sway of standing still, what a radio measures
  io/       argv, the API, the socket each device holds, the terminal
  metrics/  Procrustes alignment, and the summaries the chart draws
  run/      threads, and the memory they share
```

They compose in one direction:

```mermaid
flowchart LR
  random["noise/random"] --> crowd
  random --> noise
  crowd --> device["io/device"]
  noise --> device
  config["io/config"] --> device
  device --> run --> metrics --> dashboard["io/dashboard"]
```

A device owns no timer: a shard ticks every one of its phones on a single clock,
because twenty thousand intervals is a scheduler benchmark rather than a crowd.
It does not own its socket either — `io/transport.ts` is a seam, so what a
device does when it joins, drifts, drops and comes back can be tested without
standing up a server. That is [`src/io/device.test.ts`](src/io/device.test.ts).
