/**
 * POST /api/tools/restaurant_check_availability
 *
 * Returns candidate time slots for a given restaurant + date + party
 * size. The response body is the selection surface — the shell renders
 * a radio-style TimeSlotsSelectCard from the `slots` array.
 *
 * We do NOT attach a confirmation summary here. A "pick one of N" card
 * is not a confirmation — the user hasn't consented to any specific
 * slot yet. The hash gate lives on `restaurant_create_reservation`,
 * which re-computes the canonical summary from the chosen slot and
 * compares against `summary_hash`.
 *
 * Slots TTL at 15 minutes inside the stub (mirrors the Duffel offer
 * TTL). After expiry the shell must re-call this tool.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { checkAvailability, getRestaurant } from "@/lib/opentable";
import { badRequestFromZod, errorResponse, stripEnvelopeKeys } from "@/lib/http";

const BodySchema = z
  .object({
    restaurant_id: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: "ISO date (YYYY-MM-DD)",
    }),
    party_size: z.number().int().min(1).max(20),
    window: z.enum(["lunch", "dinner"]).optional(),
  })
  .strict();

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse("bad_request", 400, "Body must be valid JSON.");
  }

  const parsed = BodySchema.safeParse(stripEnvelopeKeys(raw));
  if (!parsed.success) return badRequestFromZod(parsed.error);

  // Fail fast on unknown restaurant_id. The stub's `checkAvailability`
  // also returns `[]` in this case, but a 404 is the clearer signal for
  // the orchestrator — it means "don't retry this restaurant", not
  // "this restaurant is just booked up".
  if (!getRestaurant(parsed.data.restaurant_id)) {
    return errorResponse(
      "restaurant_not_found",
      404,
      `No restaurant with id ${parsed.data.restaurant_id}.`,
    );
  }

  const slots = await checkAvailability(parsed.data);

  return NextResponse.json(
    { restaurant_id: parsed.data.restaurant_id, slots },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
