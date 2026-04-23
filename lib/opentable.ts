/**
 * OpenTable façade.
 *
 * Single import surface for the route files. Routes `searchRestaurants`
 * and `checkAvailability` through the real partner API when both
 * OPENTABLE_PARTNER_ID and OPENTABLE_API_KEY are present; everything
 * else (create/cancel reservation + the confirmation hash) stays on
 * the in-memory stub.
 *
 * Why the split?
 *   - Search + availability are reads and can tolerate a partial cutover
 *     — if the partner API is flaky, we can still serve the stub without
 *     touching booking paths.
 *   - Create/cancel move money (deposit holds) and must live behind a
 *     first-class persistence + idempotency layer before we swap from
 *     stub to live. Flight Agent takes the same stance on Duffel book.
 *
 * Same pattern as `lib/duffel.ts` in the Flight Agent.
 */

import {
  cancelReservation as stubCancel,
  checkAvailability as stubCheckAvailability,
  createReservation as stubCreateReservation,
  searchRestaurants as stubSearchRestaurants,
  type AvailabilityParams,
  type Restaurant,
  type SearchParams,
  type TimeSlot,
} from "./opentable-stub";

import {
  checkAvailabilityReal,
  opentableEnabled,
  searchRestaurantsReal,
} from "./opentable-real";

// Re-exports that never change regardless of real/stub.
export {
  canonicalReservationSummary,
  getRestaurant,
  getStoredReservation,
  getStoredSlot,
  reservationHash,
} from "./opentable-stub";
export type {
  AvailabilityParams,
  CancelInput,
  CancelResult,
  Reservation,
  ReserveInput,
  Restaurant,
  SearchParams,
  TimeSlot,
} from "./opentable-stub";

// ── Public API ────────────────────────────────────────────────────────

export async function searchRestaurants(
  params: SearchParams,
): Promise<Restaurant[]> {
  if (!opentableEnabled()) return stubSearchRestaurants(params);
  return searchRestaurantsReal(params);
}

export async function checkAvailability(
  params: AvailabilityParams,
): Promise<TimeSlot[]> {
  if (!opentableEnabled()) return stubCheckAvailability(params);
  return checkAvailabilityReal(params);
}

export function createReservation(
  input: Parameters<typeof stubCreateReservation>[0],
) {
  // TODO: real OpenTable booking once deposit/payment story + partner
  // onboarding are in place. Until then, stay on the stub — mixing a
  // real availability probe with a stub booking would break hash parity.
  return stubCreateReservation(input);
}

export function cancelReservation(
  input: Parameters<typeof stubCancel>[0],
) {
  return stubCancel(input);
}
