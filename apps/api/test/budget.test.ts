import { describe, expect, it } from "vitest";
import {
  actualCostMicroUsd,
  budgetLimitMicroUsd,
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
});
