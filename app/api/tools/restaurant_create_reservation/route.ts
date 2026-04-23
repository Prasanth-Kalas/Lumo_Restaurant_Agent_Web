/**
 * POST /api/tools/restaurant_create_reservation
 *
 * MONEY TOOL. Books the selected time slot (deposit held for
 * price-tier-4 restaurants). Gated on:
 *
 *   1. summary_hash present (64-hex sha256)
 *   2. user_confirmed === true
 *   3. server-computed hash of canonical reservation summary MATCHES
 *      summary_hash
 *   4. payment_method_id present IF the slot carries a deposit
 *
 * The shell ALSO enforces #1 and #2 before dispatching — we re-check
 * here because agent endpoints are individually addressable and must
 * never trust the caller to have gated correctly.
 *
 * On hash mismatch we return 409 `confirmation_required`. The
 * orchestrator treats that as a signal to re-render the reservation
 * summary card and re-prompt the user.
 *
 * On missing deposit we return 402 `payment_required` so the shell can
 * collect a payment method and retry.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  canonicalReservationSummary,
  createReservation,
  getRestaurant,
  getStoredSlot,
  reservationHash,
} from "@/lib/opentable";
import { badRequestFromZod, errorResponse, stripEnvelopeKeys } from "@/lib/http";

const BodySchema = z
  .object({
    slot_id: z.string().min(1),
    guest_name: z.string().min(1),
    guest_email: z.string().email(),
    guest_phone: z.string().optional(),
    special_requests: z.string().max(512).optional(),
    payment_method_id: z.string().min(1).optional(),
    // 64 hex chars = sha256 digest
    summary_hash: z
      .string()
      .length(64)
      .regex(/^[0-9a-f]{64}$/, { message: "summary_hash must be sha256 hex" }),
    user_confirmed: z.literal(true),
  })
  .strict();

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Orchestrator emits this header on every money-tool dispatch. Absence
  // is not fatal in the stub (dev curl doesn't send one), but we log for
  // audit. In prod, missing/duplicate idempotency keys become a 400.
  const idempotency_key = req.headers.get("x-idempotency-key") ?? null;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse("bad_request", 400, "Body must be valid JSON.");
  }

  const parsed = BodySchema.safeParse(stripEnvelopeKeys(raw));
  if (!parsed.success) return badRequestFromZod(parsed.error);

  const { slot_id, summary_hash } = parsed.data;

  // ── Gate A: slot must still exist and not have TTL-expired.
  const slot = getStoredSlot(slot_id);
  if (!slot) {
    return errorResponse(
      "slot_expired",
      410,
      "Slot no longer available; please re-check availability and re-confirm.",
    );
  }

  const restaurant = getRestaurant(slot.restaurant_id);
  if (!restaurant) {
    // Shouldn't happen — the slot was minted from a catalog restaurant.
    // Defensive because the stub and (future) real impl may diverge.
    return errorResponse(
      "restaurant_not_found",
      404,
      "The restaurant backing this slot is no longer in the catalog.",
    );
  }

  // ── Gate B: server-computed hash must match the one the user confirmed.
  const expected = reservationHash({
    slot,
    restaurant,
    party_size: slot.party_size,
  });
  if (expected !== summary_hash) {
    return errorResponse(
      "confirmation_required",
      409,
      "The confirmed reservation no longer matches the selected slot. Re-present the summary to the user.",
      {
        expected_summary_hash: expected,
        // Handy for debugging hash drift without leaking PII.
        canonical: canonicalReservationSummary({
          slot,
          restaurant,
          party_size: slot.party_size,
        }),
      },
    );
  }

  // ── All gates passed. Book.
  const result = createReservation({
    slot_id,
    guest_name: parsed.data.guest_name,
    guest_email: parsed.data.guest_email,
    ...(parsed.data.guest_phone !== undefined
      ? { guest_phone: parsed.data.guest_phone }
      : {}),
    ...(parsed.data.special_requests !== undefined
      ? { special_requests: parsed.data.special_requests }
      : {}),
    ...(parsed.data.payment_method_id !== undefined
      ? { payment_method_id: parsed.data.payment_method_id }
      : {}),
  });

  if (!result.ok) {
    if (result.reason === "slot_not_found") {
      return errorResponse("slot_not_found", 404, "Slot not found.");
    }
    if (result.reason === "slot_expired") {
      return errorResponse(
        "slot_expired",
        410,
        "Slot expired between confirm and book; please re-check availability.",
      );
    }
    if (result.reason === "payment_required") {
      return errorResponse(
        "payment_required",
        402,
        "This slot requires a deposit. Provide a payment_method_id and retry.",
        {
          deposit_amount: slot.deposit_amount,
          deposit_currency: slot.deposit_currency,
        },
      );
    }
  }

  // TODO (prod): persist {idempotency_key -> reservation_id} so retries
  // of the same key return the same reservation instead of double-booking.
  void idempotency_key;

  return NextResponse.json(result.ok ? result.result : {}, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
