/**
 * OpenTable reservation stub.
 *
 * OpenTable's developer API is partner-gated — there is no self-serve
 * sign-up, every integration requires affiliate approval. We can't ship
 * the live client today, so this module implements the exact interface
 * we want once approval lands, against an in-memory catalog of
 * fictional restaurants. The shell and the rest of the orchestrator
 * don't know the difference.
 *
 * Shapes here are designed to be a superset of the partner API we'll
 * most likely get:
 *
 *   - `restaurant_id` / `reservation_id` / `confirmation_code` are the
 *     three opaque handles we surface. The first two are internal; the
 *     confirmation_code is what users type at the host stand.
 *   - money is stringified ("25.00"), never a number, so swapping in a
 *     Stripe-ish deposit flow later doesn't hit float drift.
 *   - times are full ISO-8601 with the restaurant's local offset so the
 *     client never has to guess a timezone (learned this the hard way
 *     on the flight itinerary card — see ItineraryConfirmationCard.tsx).
 *
 * Swap plan: add a sibling `opentable-real.ts` that exports the same
 * functions, wire env detection in `opentable.ts`, and the route files
 * stay untouched. Same pattern as Flight Agent → Duffel.
 */

import { hashSummary } from "@lumo/agent-sdk";
import { randomBytes } from "node:crypto";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface Restaurant {
  restaurant_id: string;
  name: string;
  cuisine: string;
  city: string;
  neighborhood: string;
  address: string;
  price_tier: 1 | 2 | 3 | 4; // $, $$, $$$, $$$$
  rating: number; // 0..5, one decimal
  review_count: number;
  // Free-form short description shown in the radio card.
  blurb: string;
}

export interface TimeSlot {
  /** Opaque handle carried from availability → reserve. */
  slot_id: string;
  /** ISO 8601 with local offset, e.g. "2026-05-15T19:30:00-07:00". */
  seated_at: string;
  /** Party size this slot fits. */
  party_size: number;
  /**
   * Typically empty. Non-null when the restaurant requires a deposit or
   * prix-fixe prepayment. Decimal string to avoid float drift.
   */
  deposit_amount: string | null;
  deposit_currency: string | null;
  /** Short capability hints for the client ("Outdoor", "Counter seating"). */
  seating_area?: string;
}

export interface Reservation {
  reservation_id: string;
  confirmation_code: string; // 6-char alphanumeric, e.g. "7K4Q2M"
  restaurant_id: string;
  restaurant_name: string;
  seated_at: string; // ISO 8601 local
  party_size: number;
  guest_name: string;
  guest_email: string;
  guest_phone: string | null;
  special_requests: string | null;
  status: "confirmed" | "cancelled";
  deposit_amount: string | null;
  deposit_currency: string | null;
  booked_at: string; // ISO 8601 UTC
}

export interface SearchParams {
  city: string;
  /** Optional free-text, matched against name + cuisine + blurb. */
  query?: string;
  party_size: number;
  /** ISO date YYYY-MM-DD. If provided, restrict to restaurants that
   *  have at least one slot that day; soft-filter only in the stub. */
  date?: string;
  /** Optional shortlist of cuisines to narrow to. */
  cuisines?: string[];
}

// ──────────────────────────────────────────────────────────────────────────
// In-memory catalog
// ──────────────────────────────────────────────────────────────────────────

const CATALOG: Restaurant[] = [
  {
    restaurant_id: "rst_sf_nopa",
    name: "Nopa",
    cuisine: "California",
    city: "San Francisco",
    neighborhood: "NoPa",
    address: "560 Divisadero St, San Francisco, CA 94117",
    price_tier: 3,
    rating: 4.6,
    review_count: 3812,
    blurb: "Wood-fired California classics and a dependable late kitchen.",
  },
  {
    restaurant_id: "rst_sf_statebird",
    name: "State Bird Provisions",
    cuisine: "American",
    city: "San Francisco",
    neighborhood: "Fillmore",
    address: "1529 Fillmore St, San Francisco, CA 94115",
    price_tier: 3,
    rating: 4.5,
    review_count: 2410,
    blurb: "Dim-sum-style cart service for inventive American small plates.",
  },
  {
    restaurant_id: "rst_sf_zuni",
    name: "Zuni Café",
    cuisine: "Mediterranean",
    city: "San Francisco",
    neighborhood: "Hayes Valley",
    address: "1658 Market St, San Francisco, CA 94102",
    price_tier: 3,
    rating: 4.4,
    review_count: 5127,
    blurb: "Legendary roast chicken, an oyster bar, and a room that hums.",
  },
  {
    restaurant_id: "rst_nyc_misi",
    name: "Misi",
    cuisine: "Italian",
    city: "New York",
    neighborhood: "Williamsburg",
    address: "329 Kent Ave, Brooklyn, NY 11249",
    price_tier: 3,
    rating: 4.7,
    review_count: 1892,
    blurb: "Fresh pasta by Missy Robbins overlooking the East River.",
  },
  {
    restaurant_id: "rst_nyc_via_carota",
    name: "Via Carota",
    cuisine: "Italian",
    city: "New York",
    neighborhood: "West Village",
    address: "51 Grove St, New York, NY 10014",
    price_tier: 3,
    rating: 4.6,
    review_count: 4032,
    blurb: "Trattoria from Rita Sodi and Jody Williams — walk-in purgatory, worth the booking.",
  },
  {
    restaurant_id: "rst_nyc_le_bernardin",
    name: "Le Bernardin",
    cuisine: "French",
    city: "New York",
    neighborhood: "Midtown",
    address: "155 W 51st St, New York, NY 10019",
    price_tier: 4,
    rating: 4.8,
    review_count: 2764,
    blurb: "Eric Ripert's three-star temple to seafood. Jackets encouraged.",
  },
  {
    restaurant_id: "rst_las_bazaar",
    name: "Bazaar Meat by José Andrés",
    cuisine: "Spanish",
    city: "Las Vegas",
    neighborhood: "The Strip",
    address: "2535 Las Vegas Blvd S, Las Vegas, NV 89109",
    price_tier: 4,
    rating: 4.5,
    review_count: 3207,
    blurb: "Theatrical carnivore's playground inside SLS — go hungry.",
  },
  {
    restaurant_id: "rst_las_lotus",
    name: "Lotus of Siam",
    cuisine: "Thai",
    city: "Las Vegas",
    neighborhood: "Chinatown",
    address: "620 E Flamingo Rd, Las Vegas, NV 89119",
    price_tier: 2,
    rating: 4.6,
    review_count: 4988,
    blurb: "Northern Thai heavyweights — crispy rice, khao soi, and ice-cold Singha.",
  },
  {
    restaurant_id: "rst_aus_franklin",
    name: "Franklin Barbecue",
    cuisine: "Barbecue",
    city: "Austin",
    neighborhood: "East Austin",
    address: "900 E 11th St, Austin, TX 78702",
    price_tier: 2,
    rating: 4.8,
    review_count: 6210,
    blurb: "The brisket you've heard about. Reserve to skip the line.",
  },
  {
    restaurant_id: "rst_aus_uchi",
    name: "Uchi",
    cuisine: "Japanese",
    city: "Austin",
    neighborhood: "South Lamar",
    address: "801 S Lamar Blvd, Austin, TX 78704",
    price_tier: 4,
    rating: 4.7,
    review_count: 3102,
    blurb: "Tyson Cole's sushi landmark — order the omakase, trust the chef.",
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Slot + reservation stores
// ──────────────────────────────────────────────────────────────────────────

const SLOT_TTL_MS = 15 * 60 * 1000; // 15 min mirrors the Duffel offer TTL

interface StoredSlot {
  slot: TimeSlot & { restaurant_id: string };
  stored_at: number;
}

const slotStore = new Map<string, StoredSlot>();

function sweepExpiredSlots(now: number) {
  for (const [id, entry] of slotStore) {
    if (now - entry.stored_at > SLOT_TTL_MS) slotStore.delete(id);
  }
}

interface StoredReservation {
  reservation: Reservation;
  booked_at: number;
  cancelled_at: number | null;
}

const reservationStore = new Map<string, StoredReservation>();

// ──────────────────────────────────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────────────────────────────────

export function searchRestaurants(params: SearchParams): Restaurant[] {
  const city = params.city.trim().toLowerCase();
  const q = params.query?.trim().toLowerCase() ?? "";
  const cuisines = params.cuisines?.map((c) => c.toLowerCase()) ?? [];

  return CATALOG.filter((r) => {
    if (r.city.toLowerCase() !== city) return false;
    if (cuisines.length && !cuisines.includes(r.cuisine.toLowerCase())) return false;
    if (!q) return true;
    const hay = `${r.name} ${r.cuisine} ${r.neighborhood} ${r.blurb}`.toLowerCase();
    return hay.includes(q);
  }).slice(0, 6); // top 6 is plenty for a chat card
}

export function getRestaurant(restaurant_id: string): Restaurant | null {
  return CATALOG.find((r) => r.restaurant_id === restaurant_id) ?? null;
}

// ──────────────────────────────────────────────────────────────────────────
// Availability
// ──────────────────────────────────────────────────────────────────────────

export interface AvailabilityParams {
  restaurant_id: string;
  date: string; // YYYY-MM-DD, local to the restaurant
  party_size: number;
  /** Optional preferred seating window ("dinner" | "lunch"). Soft filter. */
  window?: "lunch" | "dinner";
}

// Restaurants in our catalog have a simple local offset table; keep it
// deterministic so hashes are stable across calls.
const CITY_OFFSET: Record<string, string> = {
  "San Francisco": "-07:00",
  "New York": "-04:00",
  "Las Vegas": "-07:00",
  Austin: "-05:00",
};

function offsetFor(city: string): string {
  return CITY_OFFSET[city] ?? "-07:00";
}

/**
 * Generate a spread of slots for a given date. Deterministic per
 * (restaurant_id, date, party_size) so the same search returns the
 * same slot_ids until TTL expiry — lets the chat re-render without
 * invalidating the user's selection.
 */
export function checkAvailability(params: AvailabilityParams): TimeSlot[] {
  const restaurant = getRestaurant(params.restaurant_id);
  if (!restaurant) return [];
  const now = Date.now();
  sweepExpiredSlots(now);

  const offset = offsetFor(restaurant.city);

  // Base time set — lunch if requested, else the dinner band.
  const lunchTimes = ["11:45:00", "12:15:00", "13:00:00", "13:30:00"];
  const dinnerTimes = [
    "17:30:00",
    "18:00:00",
    "18:30:00",
    "19:00:00",
    "19:30:00",
    "20:00:00",
    "20:30:00",
    "21:15:00",
  ];
  const base = params.window === "lunch" ? lunchTimes : dinnerTimes;

  // Simulate real-world scarcity: deterministically drop ~30% of slots
  // based on a cheap hash of (restaurant_id + date), so the same call
  // returns the same subset across retries.
  const seed = [...`${restaurant.restaurant_id}:${params.date}`].reduce(
    (a, c) => a + c.charCodeAt(0),
    0,
  );
  const slots: TimeSlot[] = [];
  for (let i = 0; i < base.length; i += 1) {
    if ((seed + i * 7) % 10 < 3) continue; // dropped — "booked"
    const time = base[i]!;
    const seated_at = `${params.date}T${time}${offset}`;
    const slot_id = `slot_stub_${randomBytes(5).toString("hex")}`;

    // Price-tier 4 restaurants charge a deposit. Simulates OpenTable's
    // ExperiOS "Ticketed" reservations for the same hash-stability
    // reasons Flight uses total_amount strings.
    const needsDeposit = restaurant.price_tier === 4;
    const depositAmount = needsDeposit
      ? (25 * params.party_size).toFixed(2)
      : null;

    const slot: TimeSlot = {
      slot_id,
      seated_at,
      party_size: params.party_size,
      deposit_amount: depositAmount,
      deposit_currency: needsDeposit ? "USD" : null,
      seating_area: i % 4 === 0 ? "Patio" : undefined,
    };

    slotStore.set(slot_id, {
      slot: { ...slot, restaurant_id: restaurant.restaurant_id },
      stored_at: now,
    });
    slots.push(slot);
  }

  return slots;
}

export function getStoredSlot(
  slot_id: string,
): (TimeSlot & { restaurant_id: string }) | null {
  const entry = slotStore.get(slot_id);
  if (!entry) return null;
  if (Date.now() - entry.stored_at > SLOT_TTL_MS) {
    slotStore.delete(slot_id);
    return null;
  }
  return entry.slot;
}

// ──────────────────────────────────────────────────────────────────────────
// Reservation create
// ──────────────────────────────────────────────────────────────────────────

export interface ReserveInput {
  slot_id: string;
  guest_name: string;
  guest_email: string;
  guest_phone?: string;
  special_requests?: string;
  /** Opaque handle if the slot required a deposit. Ignored otherwise. */
  payment_method_id?: string;
}

export function createReservation(
  input: ReserveInput,
):
  | { ok: true; result: Reservation }
  | {
      ok: false;
      reason: "slot_not_found" | "slot_expired" | "payment_required";
    } {
  const stored = slotStore.get(input.slot_id);
  if (!stored) return { ok: false, reason: "slot_not_found" };
  if (Date.now() - stored.stored_at > SLOT_TTL_MS) {
    slotStore.delete(input.slot_id);
    return { ok: false, reason: "slot_expired" };
  }

  const slot = stored.slot;
  if (slot.deposit_amount && !input.payment_method_id) {
    // Real OpenTable enforces this server-side too — we echo it so the
    // contract is consistent with live.
    return { ok: false, reason: "payment_required" };
  }

  const restaurant = getRestaurant(slot.restaurant_id);
  const reservation_id = `res_stub_${randomBytes(8).toString("hex")}`;
  const confirmation_code = randomBytes(3).toString("hex").toUpperCase();

  const reservation: Reservation = {
    reservation_id,
    confirmation_code,
    restaurant_id: slot.restaurant_id,
    restaurant_name: restaurant?.name ?? "Unknown restaurant",
    seated_at: slot.seated_at,
    party_size: slot.party_size,
    guest_name: input.guest_name,
    guest_email: input.guest_email,
    guest_phone: input.guest_phone ?? null,
    special_requests: input.special_requests ?? null,
    status: "confirmed",
    deposit_amount: slot.deposit_amount,
    deposit_currency: slot.deposit_currency,
    booked_at: new Date().toISOString(),
  };

  reservationStore.set(reservation_id, {
    reservation,
    booked_at: Date.now(),
    cancelled_at: null,
  });

  // Consume the slot so a retried create with the same slot_id (but a
  // different idempotency key) doesn't book twice. Real OpenTable
  // behaves this way; the shell's router retries on transient failures.
  slotStore.delete(input.slot_id);

  return { ok: true, result: reservation };
}

export function getStoredReservation(reservation_id: string): Reservation | null {
  return reservationStore.get(reservation_id)?.reservation ?? null;
}

// ──────────────────────────────────────────────────────────────────────────
// Reservation cancel
//
// Contract (matches `x-lumo-cancel-for: restaurant_create_reservation` in
// openapi.json):
//   - cost-tier: free  (no money moves at the agent/tool layer; any
//     deposit refund is provider-side and we surface the amount)
//   - requires-confirmation: false  (Saga must not re-prompt during
//     rollback — SDK validator enforces)
//   - compensation-kind: best-effort  (some deposits are non-refundable
//     within N hours; we still cancel the booking but refund_amount may
//     be "0.00")
//
// Idempotency: calling cancel twice on the same reservation_id returns
// `already_cancelled: true` instead of double-refunding.
// ──────────────────────────────────────────────────────────────────────────

export interface CancelInput {
  reservation_id: string;
  reason?: string;
}

export interface CancelResult {
  reservation_id: string;
  status: "cancelled";
  refund_amount: string;
  refund_currency: string;
  cancelled_at: string;
}

export function cancelReservation(
  input: CancelInput,
):
  | { ok: true; result: CancelResult }
  | { ok: false; reason: "not_found" | "already_cancelled" } {
  const entry = reservationStore.get(input.reservation_id);
  if (!entry) return { ok: false, reason: "not_found" };
  if (entry.reservation.status === "cancelled") {
    return { ok: false, reason: "already_cancelled" };
  }

  const cancelled_at = new Date();
  entry.reservation = { ...entry.reservation, status: "cancelled" };
  entry.cancelled_at = cancelled_at.getTime();
  reservationStore.set(input.reservation_id, entry);

  void input.reason; // captured for audit in prod

  return {
    ok: true,
    result: {
      reservation_id: input.reservation_id,
      status: "cancelled",
      // Stub policy: deposits refund in full. Real OpenTable distinguishes
      // inside-N-hours cancellations and may return "0.00"; that's where
      // "best-effort" kicks in when we wire the live API.
      refund_amount: entry.reservation.deposit_amount ?? "0.00",
      refund_currency: entry.reservation.deposit_currency ?? "USD",
      cancelled_at: cancelled_at.toISOString(),
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Confirmation gate payload
// ──────────────────────────────────────────────────────────────────────────

/**
 * Canonical reservation summary the confirmation-hash is computed over.
 * MUST be identical on server and shell — the shell hashes this shape
 * when it renders the "Confirm reservation?" card, and the server
 * re-hashes here to compare.
 *
 * Keep append-only. Any field change invalidates every in-flight
 * confirmation across both sides. Mirrors the Flight Agent's
 * `canonicalItinerarySummary` discipline.
 */
export function canonicalReservationSummary(args: {
  slot: TimeSlot & { restaurant_id: string };
  restaurant: Restaurant;
  party_size: number;
}) {
  return {
    kind: "structured-reservation" as const,
    slot_id: args.slot.slot_id,
    restaurant_id: args.restaurant.restaurant_id,
    restaurant_name: args.restaurant.name,
    city: args.restaurant.city,
    neighborhood: args.restaurant.neighborhood,
    seated_at: args.slot.seated_at,
    party_size: args.party_size,
    deposit_amount: args.slot.deposit_amount,
    deposit_currency: args.slot.deposit_currency,
  };
}

export function reservationHash(args: {
  slot: TimeSlot & { restaurant_id: string };
  restaurant: Restaurant;
  party_size: number;
}): string {
  return hashSummary(canonicalReservationSummary(args));
}
