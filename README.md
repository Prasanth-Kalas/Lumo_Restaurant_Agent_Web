# Lumo Restaurant Agent

OpenTable-style reservation search, availability, and booking. Speaks
the `@orchet/agent-sdk` contract so the Lumo shell can discover and
dispatch to it at `/.well-known/agent.json` + `/openapi.json`.

## Why mock-first

OpenTable's developer API is partner-gated — the self-serve dev portal
is marketing, and every live integration requires affiliate approval.
Rather than block the orchestrator roadmap on partner onboarding, we
ship the full reservation loop (search → availability → reserve →
cancel) against an in-memory catalog today, and swap in the real API
once approval lands.

The Flight Agent does the same dance with Duffel — see
`lib/opentable-stub.ts` for the in-memory implementation and
`lib/opentable-real.ts` for the placeholder that will carry the live
client. The façade in `lib/opentable.ts` routes between the two based
on whether `OPENTABLE_PARTNER_ID` + `OPENTABLE_API_KEY` are set.

## Tools exposed

| Tool                                | Cost tier | Confirmation             | Cancel counterpart                 |
| ----------------------------------- | --------- | ------------------------ | ---------------------------------- |
| `restaurant_search_restaurants`     | free      | —                        | —                                  |
| `restaurant_check_availability`     | low       | —                        | —                                  |
| `restaurant_create_reservation`     | money     | `structured-reservation` | `restaurant_cancel_reservation`    |
| `restaurant_cancel_reservation`     | free      | (none — Saga invokes)    | ← `restaurant_create_reservation`  |

## Confirmation hash gate

Parity with the Flight Agent: the shell computes a `summary_hash` over
the canonical reservation summary the user confirmed, the server
re-computes the same hash, and a mismatch returns 409
`confirmation_required`. The canonical shape lives in
`canonicalReservationSummary()` inside `lib/opentable-stub.ts` and MUST
be identical on both sides — any field change invalidates every
in-flight confirmation across the system. Append-only.

## Run locally

```sh
pnpm install
pnpm dev           # http://localhost:3003
curl http://localhost:3003/.well-known/agent.json
curl http://localhost:3003/openapi.json
curl http://localhost:3003/api/health
```

## Env

See `.env.example`. `OPENTABLE_PARTNER_ID` + `OPENTABLE_API_KEY` are
intentionally unset on this scaffold — the stub handles the whole
reservation loop without partner credentials. `PUBLIC_BASE_URL` is
baked into the manifest so downstream consumers can link back.

## Deploy

Standard Next.js app targeting Vercel. `vercel.json` bumps
`maxDuration` to 30s on the tool routes so the confirmation-gate
round-trip has headroom for real OpenTable latency when the live
client lands. Match the Flight Agent's deploy posture — one project
per agent, pinned to the git-SHA `@orchet/agent-sdk` dep.
