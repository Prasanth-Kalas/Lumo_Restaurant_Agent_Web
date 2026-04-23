/**
 * Real OpenTable partner API client — placeholder.
 *
 * Unlike Duffel (self-serve test API), OpenTable is partner-gated: the
 * public developer portal is marketing, and live credentials require
 * affiliate approval. Until that lands, this module is a deliberate
 * placeholder that reports "not enabled" and hands every call back to
 * the façade, which routes to the stub.
 *
 * When credentials arrive, fill out the two functions below against
 * OpenTable's Affiliate Restaurant Search + Booking APIs. The shapes
 * exported by `opentable-stub.ts` (Restaurant, TimeSlot, Reservation)
 * are already a careful subset of the partner response, so the mapping
 * layer should be narrow — same pattern as `duffel-real.ts`.
 *
 * Not covered — intentionally left on the stub for now:
 *   - `createReservation` — needs real deposit/payment flow; we don't
 *      wire Stripe on the Restaurant side until product scope is firm.
 *   - `cancelReservation` — idempotency + audit requirements demand a
 *      first-class persistence layer before touching the live API.
 */

import type {
  AvailabilityParams,
  Restaurant,
  SearchParams,
  TimeSlot,
} from "./opentable-stub";

/** Whether real OpenTable is wired up for this deploy. */
export function opentableEnabled(): boolean {
  const id = process.env.OPENTABLE_PARTNER_ID;
  const key = process.env.OPENTABLE_API_KEY;
  return (
    typeof id === "string" && id.length > 0 && typeof key === "string" && key.length > 0
  );
}

/**
 * Real partner search. Stub until credentials land.
 *
 * Planned endpoint (shape TBD once partner onboarding completes):
 *   GET https://platform.otqa.com/sync/restaurants?city=...&term=...
 */
export async function searchRestaurantsReal(
  _params: SearchParams,
): Promise<Restaurant[]> {
  throw new Error(
    "OpenTable real API not yet implemented. Set OPENTABLE_PARTNER_ID + " +
      "OPENTABLE_API_KEY only once the client fetch in opentable-real.ts is " +
      "wired against the partner endpoint.",
  );
}

/**
 * Real partner availability. Stub until credentials land.
 *
 * Planned endpoint:
 *   GET https://platform.otqa.com/sync/availability?rid=...&date=...&party_size=...
 */
export async function checkAvailabilityReal(
  _params: AvailabilityParams,
): Promise<TimeSlot[]> {
  throw new Error(
    "OpenTable real API not yet implemented. See opentable-real.ts.",
  );
}
