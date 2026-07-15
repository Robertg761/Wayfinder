export const DEFAULT_MODEL_BUDGET_USD = 100;
const MICRO_USD_PER_USD = 1_000_000;
const LUNA_INPUT_MICRO_USD_PER_TOKEN = 1;
const LUNA_CACHED_INPUT_MICRO_USD_PER_TOKEN = 0.1;
const LUNA_OUTPUT_MICRO_USD_PER_TOKEN = 6;
const MODEL_OUTPUT_TOKEN_LIMIT = 800;
const REQUEST_OVERHEAD_TOKEN_ALLOWANCE = 10_000;
const RESERVATION_SAFETY_MULTIPLIER = 1.25;
const VERIFIED_PRE_GUARD_SPEND_MICRO_USD = 21_542;

export interface ModelBudgetLedger {
  spentMicroUsd: number;
  reservedMicroUsd: number;
  reservations: Record<string, number>;
}

interface UsageBody {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
}

function emptyLedger(): ModelBudgetLedger {
  return { spentMicroUsd: VERIFIED_PRE_GUARD_SPEND_MICRO_USD, reservedMicroUsd: 0, reservations: {} };
}

export function budgetLimitMicroUsd(value?: string): number {
  const parsed = Number(value);
  const dollars = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MODEL_BUDGET_USD;
  return Math.floor(dollars * MICRO_USD_PER_USD);
}

export function reserveCostMicroUsd(requestBody: string): number {
  const requestBytes = new TextEncoder().encode(requestBody).byteLength;
  const conservativeInputTokens = requestBytes + REQUEST_OVERHEAD_TOKEN_ALLOWANCE;
  const conservativeCost =
    conservativeInputTokens * LUNA_INPUT_MICRO_USD_PER_TOKEN +
    MODEL_OUTPUT_TOKEN_LIMIT * LUNA_OUTPUT_MICRO_USD_PER_TOKEN;
  return Math.ceil(conservativeCost * RESERVATION_SAFETY_MULTIPLIER);
}

export function actualCostMicroUsd(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const usage = (body as UsageBody).usage;
  const inputTokens = usage?.input_tokens;
  const outputTokens = usage?.output_tokens;
  if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens) || inputTokens! < 0 || outputTokens! < 0) {
    return null;
  }

  const reportedCached = usage?.input_tokens_details?.cached_tokens ?? 0;
  const cachedTokens = Number.isSafeInteger(reportedCached)
    ? Math.min(Math.max(reportedCached, 0), inputTokens!)
    : 0;
  const uncachedTokens = inputTokens! - cachedTokens;
  return Math.ceil(
    uncachedTokens * LUNA_INPUT_MICRO_USD_PER_TOKEN +
    cachedTokens * LUNA_CACHED_INPUT_MICRO_USD_PER_TOKEN +
    outputTokens! * LUNA_OUTPUT_MICRO_USD_PER_TOKEN,
  );
}

export function reserveBudget(
  ledger: ModelBudgetLedger,
  reservationId: string,
  amountMicroUsd: number,
  limitMicroUsd: number,
): { success: boolean; ledger: ModelBudgetLedger } {
  if (!reservationId || !Number.isSafeInteger(amountMicroUsd) || amountMicroUsd <= 0) {
    return { success: false, ledger };
  }
  if (ledger.reservations[reservationId] !== undefined) return { success: false, ledger };
  if (ledger.spentMicroUsd + ledger.reservedMicroUsd + amountMicroUsd > limitMicroUsd) {
    return { success: false, ledger };
  }

  return {
    success: true,
    ledger: {
      ...ledger,
      reservedMicroUsd: ledger.reservedMicroUsd + amountMicroUsd,
      reservations: { ...ledger.reservations, [reservationId]: amountMicroUsd },
    },
  };
}

export function settleBudget(
  ledger: ModelBudgetLedger,
  reservationId: string,
  actualMicroUsd: number,
): ModelBudgetLedger {
  const reserved = ledger.reservations[reservationId];
  if (reserved === undefined || !Number.isSafeInteger(actualMicroUsd) || actualMicroUsd < 0) return ledger;
  const reservations = { ...ledger.reservations };
  delete reservations[reservationId];
  return {
    spentMicroUsd: ledger.spentMicroUsd + actualMicroUsd,
    reservedMicroUsd: Math.max(0, ledger.reservedMicroUsd - reserved),
    reservations,
  };
}

export class ModelBudget {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/status") {
      const limitMicroUsd = budgetLimitMicroUsd(url.searchParams.get("limitUsd") ?? undefined);
      const ledger = await this.state.storage.get<ModelBudgetLedger>("ledger") ?? emptyLedger();
      return Response.json({
        ...ledger,
        limitMicroUsd,
        remainingMicroUsd: Math.max(0, limitMicroUsd - ledger.spentMicroUsd - ledger.reservedMicroUsd),
      });
    }

    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    const input = await request.json() as Record<string, unknown>;
    const reservationId = typeof input.reservationId === "string" ? input.reservationId : "";

    if (url.pathname === "/reserve") {
      const amountMicroUsd = typeof input.amountMicroUsd === "number" ? input.amountMicroUsd : 0;
      const limitMicroUsd = typeof input.limitMicroUsd === "number" ? input.limitMicroUsd : 0;
      return this.state.storage.transaction(async (transaction) => {
        const ledger = await transaction.get<ModelBudgetLedger>("ledger") ?? emptyLedger();
        const result = reserveBudget(ledger, reservationId, amountMicroUsd, limitMicroUsd);
        if (result.success) await transaction.put("ledger", result.ledger);
        return Response.json({ success: result.success });
      });
    }

    if (url.pathname === "/settle") {
      const actualMicroUsd = typeof input.actualMicroUsd === "number" ? input.actualMicroUsd : -1;
      return this.state.storage.transaction(async (transaction) => {
        const ledger = await transaction.get<ModelBudgetLedger>("ledger") ?? emptyLedger();
        const settled = settleBudget(ledger, reservationId, actualMicroUsd);
        if (settled !== ledger) await transaction.put("ledger", settled);
        return Response.json({ success: settled !== ledger });
      });
    }

    return new Response("Not found", { status: 404 });
  }
}
