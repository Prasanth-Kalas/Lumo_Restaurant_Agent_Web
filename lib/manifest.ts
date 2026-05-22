/**
 * Restaurant Agent manifest factory.
 *
 * The manifest is the single source of truth the shell reads at registry
 * boot (via `/.well-known/agent.json`). It describes *what* this agent
 * does — not *how* — and declares the PII scope and SLA the router will
 * enforce.
 *
 * URLs must be absolute (AgentManifestSchema enforces z.string().url()).
 * Base URL resolution lives in lib/public-base-url.ts so we share the
 * same fallback chain with app/openapi.json/route.ts.
 */

import { defineManifest, type AgentManifest } from "@orchet/agent-sdk";
import { publicBaseUrl } from "./public-base-url";

/**
 * Build the manifest at request time so `PUBLIC_BASE_URL` can be changed
 * without rebuilding (Vercel preview URLs, staging overlays, etc.).
 */
export function buildManifest(): AgentManifest {
  const base = publicBaseUrl();

  return defineManifest({
    agent_id: "restaurant",
    version: "0.1.0",
    domain: "restaurants",
    display_name: "Lumo Restaurants",
    one_liner: "Find restaurants and book reservations across US cities.",

    // Canonical intents the orchestrator maps utterances to. Keep these
    // stable — analytics joins on them.
    intents: [
      "search_restaurants",
      "check_availability",
      "create_reservation",
    ],

    example_utterances: [
      "book a table for 2 at Nopa on Friday",
      "find me an Italian spot in the West Village tomorrow night",
      "get me a reservation for 4 in Las Vegas Saturday at 7",
    ],

    openapi_url: `${base}/openapi.json`,

    ui: {
      // Registered component names the shell is allowed to render into
      // its canvas. These must also exist in the web shell's component
      // registry (module federation or a static allowlist).
      components: ["restaurant_time_slots_card", "restaurant_reservation_card"],
    },

    health_url: `${base}/api/health`,

    // SLA budgets. The shell's circuit breaker uses p95_latency_ms as
    // the "latency overshoot" denominator; availability_target feeds the
    // rolling score. Numbers below are aspirational — tune after real
    // OpenTable traffic.
    sla: {
      p50_latency_ms: 1200,
      p95_latency_ms: 3500,
      availability_target: 0.995,
    },

    // PII scope — the absolute max this agent may *ever* see. The router
    // intersects this with the per-tool `x-orchet-pii-required` so each
    // tool only gets what it strictly needs. Reservations are typically
    // name + email + phone; `payment_method_id` is only needed for
    // deposit-required (price-tier 4) slots.
    pii_scope: ["name", "email", "phone", "payment_method_id"],

    requires_payment: true,

    // US-only to start. OpenTable's affiliate footprint is global, but
    // we limit the manifest to jurisdictions where Lumo can settle
    // deposit refunds — same conservative stance as the Flight Agent.
    supported_regions: ["US"],

    // Contract self-declaration. Bump `sdk_version` when we rebuild
    // against a newer SDK — the shell's registry will warn if this
    // drifts from the package actually installed at runtime.
    // `implements_cancellation` is true because `restaurant_cancel_reservation`
    // is wired from day one; the SDK's openapi bridge enforces the
    // bidirectional link between create + cancel at registry load.
    capabilities: {
      sdk_version: "0.6.0",
      supports_compound_bookings: true,
      implements_cancellation: true,
    },

    owner_team: "agents-platform",
  });
}
