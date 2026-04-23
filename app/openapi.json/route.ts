/**
 * GET /openapi.json
 *
 * OpenAPI 3.1 document for the Restaurant Agent. Four operations are
 * exposed as orchestrator tools via `x-lumo-tool: true`:
 *
 *   1. restaurant_search_restaurants — read, cheap, no PII
 *   2. restaurant_check_availability — read, cheap, no PII; returns N
 *                                      candidate time slots
 *   3. restaurant_create_reservation — money tool (deposit holds for
 *                                      prix-fixe restaurants). Requires
 *                                      confirmation gate
 *                                      (`structured-reservation`) + PII.
 *   4. restaurant_cancel_reservation — Saga rollback counterpart for #3.
 *
 * The `x-lumo-*` extensions are what the shell's orchestrator reads to
 * build the Claude tool list and the router's gating table. See
 * `@lumo/agent-sdk/openapi` for the full extension contract.
 *
 * Shape of the restaurant/slot/reservation objects mirrors what we
 * expect from the OpenTable Affiliate Booking API so that swapping the
 * stub for the real client later is a one-liner — same discipline as
 * Flight → Duffel.
 */

import { NextResponse } from "next/server";
import { publicBaseUrl } from "../../lib/public-base-url";

export const dynamic = "force-dynamic";

export async function GET() {
  const base = publicBaseUrl();

  const doc = {
    openapi: "3.1.0",
    info: {
      title: "Lumo Restaurant Agent",
      version: "0.1.0",
      description:
        "Restaurant search, availability, and reservation booking. Service endpoint consumed by the Lumo orchestrator shell.",
    },
    servers: [{ url: base }],

    // ────────────────────────────────────────────────────────────────
    // Paths
    // ────────────────────────────────────────────────────────────────
    paths: {
      "/api/tools/restaurant_search_restaurants": {
        post: {
          operationId: "restaurant_search_restaurants",
          summary: "Search restaurants by city, cuisine, and free text",
          description:
            "Return up to 6 restaurants matching city + optional query/cuisine filters. No PII required. Results are NOT reservations — the LLM must call restaurant_check_availability on a specific restaurant_id before booking.",

          "x-lumo-tool": true,
          "x-lumo-cost-tier": "free",
          "x-lumo-requires-confirmation": false,
          "x-lumo-pii-required": [],
          "x-lumo-intent-tags": ["search_restaurants"],

          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RestaurantSearchRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Restaurants found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RestaurantSearchResponse" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },

      "/api/tools/restaurant_check_availability": {
        post: {
          operationId: "restaurant_check_availability",
          summary: "Check table availability for a restaurant on a date",
          description:
            "Given a restaurant_id, date, and party size, return candidate time slots. Each slot carries an opaque `slot_id` the LLM must hand to restaurant_create_reservation. Slots TTL in 15 minutes — after that, the shell must re-call this tool.",

          "x-lumo-tool": true,
          "x-lumo-cost-tier": "low",
          "x-lumo-requires-confirmation": false,
          "x-lumo-pii-required": [],
          "x-lumo-intent-tags": ["check_availability"],

          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AvailabilityRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Candidate slots (may be empty if fully booked)",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AvailabilityResponse" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "404": { $ref: "#/components/responses/RestaurantNotFound" },
          },
        },
      },

      "/api/tools/restaurant_create_reservation": {
        post: {
          operationId: "restaurant_create_reservation",
          summary: "Create a reservation for a selected time slot (money-moving)",
          description:
            "Books a table for the given slot_id. This is a money tool: high-end restaurants (price_tier 4) charge a deposit. The orchestrator MUST have the user's explicit confirmation of the reservation summary before calling. The request body must include `summary_hash` (sha256 of the reservation the user confirmed) and `user_confirmed: true`. If the hash doesn't match the server-computed hash, we return 409 and the shell must re-confirm.",

          "x-lumo-tool": true,
          "x-lumo-cost-tier": "money",
          "x-lumo-requires-confirmation": "structured-reservation",
          // Every money tool must declare its cancel counterpart. The
          // SDK's openApiToClaudeTools refuses to build the bridge if
          // this points at a non-existent op or is missing entirely.
          "x-lumo-cancels": "restaurant_cancel_reservation",
          // Intersection with the agent's `pii_scope` determines what
          // the router actually forwards. `payment_method_id` is only
          // needed for slots that carry a deposit (price-tier 4).
          "x-lumo-pii-required": ["name", "email", "phone"],
          "x-lumo-intent-tags": ["create_reservation"],

          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReservationCreateRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Reservation confirmed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Reservation" },
                },
              },
            },
            "402": { $ref: "#/components/responses/PaymentRequired" },
            "404": { $ref: "#/components/responses/SlotNotFound" },
            "409": { $ref: "#/components/responses/ConfirmationRequired" },
            "410": { $ref: "#/components/responses/SlotExpired" },
          },
        },
      },

      "/api/tools/restaurant_cancel_reservation": {
        post: {
          operationId: "restaurant_cancel_reservation",
          summary: "Cancel a prior reservation (Saga rollback)",
          description:
            "Cancel a reservation created by `restaurant_create_reservation`. This is the compensating action the Saga invokes during compound-booking rollback — it must NOT re-prompt the user. Idempotent: a repeat call with the same reservation_id returns 200 with `already_cancelled: true` instead of double-processing. For inside-window cancellations the deposit refund may be '0.00' — the tool is `compensation-kind: best-effort`, not `perfect`.",

          "x-lumo-tool": true,
          "x-lumo-cost-tier": "free",
          // MUST be literal false. The SDK's cancellation-protocol
          // validator rejects any cancel tool that would gate on
          // confirmation — the Saga has no user in the loop.
          "x-lumo-requires-confirmation": false,
          // Bidirectional link back to the forward money tool. Both
          // pointers must be present and agree; the SDK validator
          // rejects a one-sided link at registry boot.
          "x-lumo-cancel-for": "restaurant_create_reservation",
          "x-lumo-compensation-kind": "best-effort",
          "x-lumo-pii-required": [],
          "x-lumo-intent-tags": ["cancel_reservation"],

          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReservationCancelRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Reservation cancelled (or idempotent repeat)",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReservationCancelResponse" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "404": { $ref: "#/components/responses/ReservationNotFound" },
          },
        },
      },
    },

    // ────────────────────────────────────────────────────────────────
    // Components — schemas
    // ────────────────────────────────────────────────────────────────
    components: {
      schemas: {
        // Request shapes ────────────────────────────────────────────
        RestaurantSearchRequest: {
          type: "object",
          additionalProperties: false,
          required: ["city", "party_size"],
          properties: {
            city: {
              type: "string",
              description: "Restaurant city, e.g. 'San Francisco'.",
              minLength: 1,
            },
            query: {
              type: "string",
              description: "Free-text match against name, cuisine, blurb.",
              maxLength: 120,
            },
            party_size: { type: "integer", minimum: 1, maximum: 20 },
            date: {
              type: "string",
              format: "date",
              description: "ISO 8601 date (YYYY-MM-DD) the user wants to dine.",
            },
            cuisines: {
              type: "array",
              items: { type: "string" },
              maxItems: 8,
              description: "Optional cuisine shortlist to narrow by.",
            },
          },
        },

        AvailabilityRequest: {
          type: "object",
          additionalProperties: false,
          required: ["restaurant_id", "date", "party_size"],
          properties: {
            restaurant_id: { type: "string", minLength: 1 },
            date: {
              type: "string",
              format: "date",
              description: "ISO 8601 date local to the restaurant.",
            },
            party_size: { type: "integer", minimum: 1, maximum: 20 },
            window: {
              type: "string",
              enum: ["lunch", "dinner"],
              description: "Soft filter for the seating band.",
            },
          },
        },

        ReservationCreateRequest: {
          type: "object",
          additionalProperties: false,
          required: [
            "slot_id",
            "guest_name",
            "guest_email",
            "summary_hash",
            "user_confirmed",
          ],
          properties: {
            slot_id: { type: "string", minLength: 1 },
            guest_name: { type: "string", minLength: 1 },
            guest_email: { type: "string", format: "email" },
            guest_phone: { type: "string" },
            special_requests: { type: "string", maxLength: 512 },
            payment_method_id: {
              type: "string",
              description:
                "Stripe PaymentMethod id. Required only when the slot carries a deposit (price_tier 4 restaurants). The agent never sees card numbers.",
            },
            // Confirmation gate. The shell computes `summary_hash` from
            // the exact reservation summary the user said yes to. Server
            // re-hashes and compares.
            summary_hash: {
              type: "string",
              description: "sha256 hex of the confirmed reservation summary",
              minLength: 64,
              maxLength: 64,
            },
            user_confirmed: { type: "boolean", const: true },
          },
        },

        ReservationCancelRequest: {
          type: "object",
          additionalProperties: false,
          required: ["reservation_id"],
          properties: {
            reservation_id: {
              type: "string",
              minLength: 1,
              description:
                "reservation_id returned by a prior restaurant_create_reservation call",
            },
            reason: {
              type: "string",
              maxLength: 512,
              description:
                "Free-form context captured in the audit log. Saga rollbacks typically pass something like 'trip_rollback:hotel_leg_failed'.",
            },
          },
        },

        // Response shapes (partner-shaped so the real-API swap is local)
        RestaurantSearchResponse: {
          type: "object",
          additionalProperties: false,
          required: ["restaurants"],
          properties: {
            restaurants: {
              type: "array",
              items: { $ref: "#/components/schemas/Restaurant" },
            },
          },
        },
        Restaurant: {
          type: "object",
          additionalProperties: false,
          required: [
            "restaurant_id",
            "name",
            "cuisine",
            "city",
            "neighborhood",
            "address",
            "price_tier",
            "rating",
            "review_count",
          ],
          properties: {
            restaurant_id: { type: "string" },
            name: { type: "string" },
            cuisine: { type: "string" },
            city: { type: "string" },
            neighborhood: { type: "string" },
            address: { type: "string" },
            price_tier: {
              type: "integer",
              minimum: 1,
              maximum: 4,
              description: "1 = $, 2 = $$, 3 = $$$, 4 = $$$$ (deposit likely).",
            },
            rating: { type: "number", minimum: 0, maximum: 5 },
            review_count: { type: "integer", minimum: 0 },
            blurb: { type: "string" },
          },
        },

        AvailabilityResponse: {
          type: "object",
          additionalProperties: false,
          required: ["restaurant_id", "slots"],
          properties: {
            restaurant_id: { type: "string" },
            slots: {
              type: "array",
              items: { $ref: "#/components/schemas/TimeSlot" },
            },
          },
        },
        TimeSlot: {
          type: "object",
          additionalProperties: false,
          required: ["slot_id", "seated_at", "party_size"],
          properties: {
            slot_id: { type: "string" },
            seated_at: {
              type: "string",
              format: "date-time",
              description:
                "ISO 8601 with local offset, e.g. '2026-05-15T19:30:00-07:00'.",
            },
            party_size: { type: "integer", minimum: 1, maximum: 20 },
            deposit_amount: {
              type: ["string", "null"],
              description:
                "Decimal string, e.g. '50.00'. Null when no deposit is required.",
            },
            deposit_currency: {
              type: ["string", "null"],
              minLength: 3,
              maxLength: 3,
            },
            seating_area: {
              type: "string",
              description: "Optional capability hint (Patio, Counter, Bar).",
            },
          },
        },

        Reservation: {
          type: "object",
          additionalProperties: false,
          required: [
            "reservation_id",
            "confirmation_code",
            "restaurant_id",
            "restaurant_name",
            "seated_at",
            "party_size",
            "guest_name",
            "guest_email",
            "status",
            "booked_at",
          ],
          properties: {
            reservation_id: { type: "string" },
            confirmation_code: {
              type: "string",
              description:
                "Short alphanumeric the user presents at the host stand, e.g. '7K4Q2M'.",
            },
            restaurant_id: { type: "string" },
            restaurant_name: { type: "string" },
            seated_at: { type: "string", format: "date-time" },
            party_size: { type: "integer" },
            guest_name: { type: "string" },
            guest_email: { type: "string", format: "email" },
            guest_phone: { type: ["string", "null"] },
            special_requests: { type: ["string", "null"] },
            status: { type: "string", enum: ["confirmed", "cancelled"] },
            deposit_amount: { type: ["string", "null"] },
            deposit_currency: { type: ["string", "null"] },
            booked_at: { type: "string", format: "date-time" },
          },
        },

        ReservationCancelResponse: {
          type: "object",
          additionalProperties: true,
          required: ["reservation_id", "status"],
          properties: {
            reservation_id: { type: "string" },
            status: { type: "string", enum: ["cancelled"] },
            refund_amount: {
              type: "string",
              description:
                "Decimal string. May be '0.00' for inside-window cancellations (compensation-kind is best-effort).",
            },
            refund_currency: { type: "string", minLength: 3, maxLength: 3 },
            cancelled_at: { type: "string", format: "date-time" },
            already_cancelled: {
              type: "boolean",
              description:
                "Present and true when this is an idempotent repeat of a prior cancel.",
            },
          },
        },

        // Error envelope — stable across all tool routes.
        ErrorEnvelope: {
          type: "object",
          additionalProperties: false,
          required: ["error"],
          properties: {
            error: { type: "string" },
            message: { type: "string" },
            details: { type: "object", additionalProperties: true },
          },
        },
      },

      responses: {
        BadRequest: {
          description: "Request body failed validation",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            },
          },
        },
        RateLimited: {
          description: "Too many requests",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            },
          },
        },
        RestaurantNotFound: {
          description: "Unknown restaurant_id",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            },
          },
        },
        SlotNotFound: {
          description: "Unknown slot_id",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            },
          },
        },
        SlotExpired: {
          description: "Slot TTL expired; re-check availability required",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            },
          },
        },
        PaymentRequired: {
          description:
            "Slot requires a deposit but no payment_method_id was provided",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            },
          },
        },
        ConfirmationRequired: {
          description:
            "summary_hash did not match server-computed hash; user must re-confirm.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            },
          },
        },
        ReservationNotFound: {
          description: "Unknown reservation_id on this agent.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            },
          },
        },
      },
    },
  } as const;

  return NextResponse.json(doc, {
    status: 200,
    headers: {
      "cache-control": "public, max-age=60, s-maxage=300",
      "access-control-allow-origin": "*",
    },
  });
}
