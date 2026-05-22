/**
 * POST /api/tools/restaurant_cancel_reservation
 *
 * CANCEL TOOL (compensating action for restaurant_create_reservation).
 *
 * Invariants the shell's SDK validates at registry load (see
 * @orchet/agent-sdk/openapi validateCancellationProtocol):
 *
 *   - cost-tier: "free"                  — no net money movement the
 *                                          orchestrator pays for; the
 *                                          provider handles deposit
 *                                          refunds.
 *   - requires-confirmation: false       — CRITICAL. The Saga invokes
 *                                          this during rollback with no
 *                                          human in the loop. Gating on
 *                                          user confirmation here would
 *                                          deadlock the rollback.
 *   - x-orchet-cancel-for: restaurant_create_reservation
 *                                        — bidirectional link; the
 *                                          forward money tool sets
 *                                          x-orchet-cancels to point here.
 *   - compensation-kind: best-effort     — inside-window cancellations
 *                                          may have a non-refundable
 *                                          deposit; we still flip the
 *                                          reservation to cancelled, but
 *                                          refund_amount may be "0.00".
 *
 * Unlike restaurant_create_reservation this route does NOT require
 * `summary_hash` or `user_confirmed`. The reservation_id is the unique
 * thing to cancel; the forward confirmation has already authorised the
 * Saga's authority to roll it back.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { cancelReservation } from "@/lib/opentable";
import { badRequestFromZod, errorResponse, stripEnvelopeKeys } from "@/lib/http";

const BodySchema = z
  .object({
    reservation_id: z.string().min(1),
    // Free-form reason captured for the audit log. The Saga typically
    // passes something like "trip_rollback:leg_hotel_failed".
    reason: z.string().max(512).optional(),
  })
  .strict();

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // The Saga stamps an idempotency key per rollback attempt. Retries of
  // the same cancel must return the same terminal result — that's
  // enforced by `cancelReservation` returning `already_cancelled` on
  // the second call (we still 200 on the idempotent repeat below).
  const idempotency_key = req.headers.get("x-idempotency-key") ?? null;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse("bad_request", 400, "Body must be valid JSON.");
  }

  const parsed = BodySchema.safeParse(stripEnvelopeKeys(raw));
  if (!parsed.success) return badRequestFromZod(parsed.error);

  const result = cancelReservation({
    reservation_id: parsed.data.reservation_id,
    ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
  });

  if (!result.ok) {
    if (result.reason === "not_found") {
      return errorResponse(
        "reservation_not_found",
        404,
        "No reservation with that id exists on this agent.",
      );
    }
    if (result.reason === "already_cancelled") {
      // Idempotent repeat — the Saga considers this a successful
      // rollback step. Return 200 with a short envelope so the
      // orchestrator doesn't escalate to manual intervention.
      return NextResponse.json(
        {
          reservation_id: parsed.data.reservation_id,
          status: "cancelled",
          already_cancelled: true,
        },
        { status: 200, headers: { "cache-control": "no-store" } },
      );
    }
  }

  // TODO (prod): persist {idempotency_key -> cancel_result} so Saga
  // retries of the same key short-circuit without re-hitting OpenTable.
  void idempotency_key;

  return NextResponse.json(result.ok ? result.result : {}, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
