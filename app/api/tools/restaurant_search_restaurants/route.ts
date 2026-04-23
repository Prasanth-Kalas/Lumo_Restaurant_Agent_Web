/**
 * POST /api/tools/restaurant_search_restaurants
 *
 * Read-only tool. Returns up to 6 restaurants for a city + optional
 * filters. No PII enters this route; the orchestrator enforces empty
 * pii_grant for free-tier tools.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { searchRestaurants } from "@/lib/opentable";
import { badRequestFromZod, errorResponse, stripEnvelopeKeys } from "@/lib/http";

const BodySchema = z
  .object({
    city: z.string().min(1),
    query: z.string().max(120).optional(),
    party_size: z.number().int().min(1).max(20),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "ISO date (YYYY-MM-DD)" })
      .optional(),
    cuisines: z.array(z.string().min(1)).max(8).optional(),
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

  const restaurants = await searchRestaurants(parsed.data);

  // Intentionally NOT calling attachSummary here. Search returns N
  // candidate restaurants; a confirmation envelope must refer to the
  // specific reservation the user is about to book. We force the shell
  // to round-trip through restaurant_check_availability → user picks a
  // slot → restaurant_create_reservation (which is where the hash gate
  // lives). This mirrors the Flight Agent's search/price/book split.
  return NextResponse.json(
    { restaurants },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
