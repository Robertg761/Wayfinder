import { describe, expect, it } from "vitest";
import {
  actualCostMicroUsd,
  budgetLimitMicroUsd,
  expireStaleReservations,
  normalizeLedger,
  RESERVATION_TTL_MS,
  reserveBudget,
  reserveCostMicroUsd,
  settleBudget,
  type ModelBudgetLedger,
} from "../src/budget";

const emptyLedger: ModelBudgetLedger = {
  spentMicroUsd: 0,
  reservedMicroUsd: 0,
  reservations: {},
};

describe("model budget", () => {
  it("defaults to the full event credit balance", () => {
    expect(budgetLimitMicroUsd()).toBe(100_000_000);
    expect(budgetLimitMicroUsd("2.5")).toBe(2_500_000);
    expect(budgetLimitMicroUsd("invalid")).toBe(100_000_000);
  });

  it("reserves a conservative amount before a request", () => {
    const reservation = reserveCostMicroUsd("x".repeat(2_000));
    expect(reservation).toBeGreaterThan(2_000 + 800 * 6);
  });

  it("rejects a reservation that would exceed the global limit", () => {
    const nearlySpent: ModelBudgetLedger = { ...emptyLedger, spentMicroUsd: 4_990_000 };
    const result = reserveBudget(nearlySpent, "request-1", 20_000, 5_000_000);
    expect(result.success).toBe(false);
    expect(result.ledger).toBe(nearlySpent);
  });

  it("reconciles a reservation to actual Luna usage", () => {
    const reserved = reserveBudget(emptyLedger, "request-1", 50_000, 5_000_000);
    const settled = settleBudget(reserved.ledger, "request-1", 4_188);
    expect(settled).toEqual({
      spentMicroUsd: 4_188,
      reservedMicroUsd: 0,
      reservations: {},
    });
  });

  it("releases a reservation when the model API rejects a request before usage", () => {
    const reserved = reserveBudget(emptyLedger, "request-1", 50_000, 5_000_000);
    expect(settleBudget(reserved.ledger, "request-1", 0)).toEqual(emptyLedger);
  });

  it("calculates actual Luna cost with cached input", () => {
    expect(actualCostMicroUsd({
      usage: {
        input_tokens: 2_000,
        output_tokens: 300,
        input_tokens_details: { cached_tokens: 1_000 },
      },
    })).toBe(2_900);
    expect(actualCostMicroUsd({})).toBeNull();
  });

  it("timestamps new reservations", () => {
    const nowMs = Date.parse("2026-07-20T12:00:00.000Z");
    const reserved = reserveBudget(emptyLedger, "request-1", 50_000, 5_000_000, nowMs);
    expect(reserved.ledger.reservations["request-1"]).toEqual({
      amountMicroUsd: 50_000,
      createdAt: "2026-07-20T12:00:00.000Z",
    });
  });
});

describe("stranded reservation recovery", () => {
  const nowMs = Date.parse("2026-07-20T12:00:00.000Z");

  it("converts reservations older than the TTL into conservative spend", () => {
    const ledger: ModelBudgetLedger = {
      spentMicroUsd: 100,
      reservedMicroUsd: 80_000,
      reservations: {
        stale: { amountMicroUsd: 30_000, createdAt: new Date(nowMs - RESERVATION_TTL_MS - 1_000).toISOString() },
        fresh: { amountMicroUsd: 50_000, createdAt: new Date(nowMs - 5_000).toISOString() },
      },
    };

    expect(expireStaleReservations(ledger, nowMs)).toEqual({
      spentMicroUsd: 30_100,
      reservedMicroUsd: 50_000,
      reservations: {
        fresh: { amountMicroUsd: 50_000, createdAt: new Date(nowMs - 5_000).toISOString() },
      },
    });
  });

  it("leaves a ledger with only fresh reservations untouched", () => {
    const ledger: ModelBudgetLedger = {
      spentMicroUsd: 0,
      reservedMicroUsd: 10,
      reservations: { fresh: { amountMicroUsd: 10, createdAt: new Date(nowMs).toISOString() } },
    };
    expect(expireStaleReservations(ledger, nowMs)).toBe(ledger);
  });

  it("migrates legacy bare-amount reservations so the next expiry sweeps them", () => {
    const legacy = normalizeLedger({
      spentMicroUsd: 69_517,
      reservedMicroUsd: 30_782,
      reservations: { stranded: 30_782 },
    });
    expect(legacy.reservations.stranded).toEqual({
      amountMicroUsd: 30_782,
      createdAt: new Date(0).toISOString(),
    });

    expect(expireStaleReservations(legacy, nowMs)).toEqual({
      spentMicroUsd: 100_299,
      reservedMicroUsd: 0,
      reservations: {},
    });
  });

  it("normalizes malformed stored ledgers to the safe baseline", () => {
    expect(normalizeLedger(undefined).spentMicroUsd).toBeGreaterThan(0);
    expect(normalizeLedger({ reservations: { bad: "junk" } }).reservations).toEqual({});
  });

  it("settles against the timestamped reservation shape", () => {
    const reserved = reserveBudget(emptyLedger, "request-1", 50_000, 5_000_000, nowMs);
    expect(settleBudget(reserved.ledger, "request-1", 4_188)).toEqual({
      spentMicroUsd: 4_188,
      reservedMicroUsd: 0,
      reservations: {},
    });
  });
});
