export const DEFAULT_MODEL_BUDGET_USD = 100;
const MICRO_USD_PER_USD = 1_000_000;
const LUNA_INPUT_MICRO_USD_PER_TOKEN = 1;
const LUNA_CACHED_INPUT_MICRO_USD_PER_TOKEN = 0.1;
const LUNA_OUTPUT_MICRO_USD_PER_TOKEN = 6;
const MODEL_OUTPUT_TOKEN_LIMIT = 800;
const REQUEST_OVERHEAD_TOKEN_ALLOWANCE = 10_000;
const RESERVATION_SAFETY_MULTIPLIER = 1.25;
// Carry the complete v2 ledger forward: $0.069517 spent plus its stranded
// $0.030782 reservation. Treating both as spent keeps the lifetime cap conservative.
const VERIFIED_PRE_V3_SPEND_MICRO_USD = 100_299;

// A settlement should arrive well within one request lifetime (the model call
// itself times out at 30s). Anything older is stranded — its request died
// without settling — and is conservatively converted to spend.
export const RESERVATION_TTL_MS = 2 * 60 * 1_000;

export interface ModelBudgetReservation {
  amountMicroUsd: number;
  createdAt: string;
}

export interface ModelBudgetLedger {
  spentMicroUsd: number;
  reservedMicroUsd: number;
  reservations: Record<string, ModelBudgetReservation>;
}

// The v3 ledger stored reservations as bare amounts. Legacy entries get an
// epoch timestamp so the next expiry pass sweeps them into spend — this is
// the one-time migration for the known stranded reservation.
export function normalizeLedger(raw: unknown): ModelBudgetLedger {
  if (!raw || typeof raw !== "object") return emptyLedger();
  const candidate = raw as {
    spentMicroUsd?: unknown;
    reservedMicroUsd?: unknown;
    reservations?: Record<string, unknown>;
  };
  const reservations: Record<string, ModelBudgetReservation> = {};
  for (const [id, value] of Object.entries(candidate.reservations ?? {})) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
      reservations[id] = { amountMicroUsd: value, createdAt: new Date(0).toISOString() };
    } else if (
      value && typeof value === "object" &&
      Number.isSafeInteger((value as ModelBudgetReservation).amountMicroUsd) &&
      typeof (value as ModelBudgetReservation).createdAt === "string"
    ) {
      reservations[id] = value as ModelBudgetReservation;
    }
  }
  return {
    spentMicroUsd: typeof candidate.spentMicroUsd === "number" ? candidate.spentMicroUsd : VERIFIED_PRE_V3_SPEND_MICRO_USD,
    reservedMicroUsd: typeof candidate.reservedMicroUsd === "number" ? candidate.reservedMicroUsd : 0,
    reservations,
  };
}

// Stranded reservations (no settlement within the TTL) are charged as spend:
// the model call may have succeeded, so releasing them could under-count the
// lifetime cap. This mirrors how the ambiguous-disconnect path settles.
export function expireStaleReservations(ledger: ModelBudgetLedger, nowMs: number): ModelBudgetLedger {
  const stale = Object.entries(ledger.reservations)
    .filter(([, reservation]) => nowMs - Date.parse(reservation.createdAt) > RESERVATION_TTL_MS);
  if (stale.length === 0) return ledger;

  const reservations = { ...ledger.reservations };
  let expiredMicroUsd = 0;
  for (const [id, reservation] of stale) {
    expiredMicroUsd += reservation.amountMicroUsd;
    delete reservations[id];
  }
  return {
    spentMicroUsd: ledger.spentMicroUsd + expiredMicroUsd,
    reservedMicroUsd: Math.max(0, ledger.reservedMicroUsd - expiredMicroUsd),
    reservations,
  };
}

interface UsageBody {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
}

function emptyLedger(): ModelBudgetLedger {
  return { spentMicroUsd: VERIFIED_PRE_V3_SPEND_MICRO_USD, reservedMicroUsd: 0, reservations: {} };
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
  nowMs: number = Date.now(),
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
      reservations: {
        ...ledger.reservations,
        [reservationId]: { amountMicroUsd, createdAt: new Date(nowMs).toISOString() },
      },
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
    reservedMicroUsd: Math.max(0, ledger.reservedMicroUsd - reserved.amountMicroUsd),
    reservations,
  };
}

export class ModelBudget {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/status") {
      const limitMicroUsd = budgetLimitMicroUsd(url.searchParams.get("limitUsd") ?? undefined);
      return this.state.storage.transaction(async (transaction) => {
        const stored = normalizeLedger(await transaction.get("ledger"));
        const ledger = expireStaleReservations(stored, Date.now());
        if (ledger !== stored) await transaction.put("ledger", ledger);
        return Response.json({
          ...ledger,
          limitMicroUsd,
          remainingMicroUsd: Math.max(0, limitMicroUsd - ledger.spentMicroUsd - ledger.reservedMicroUsd),
        });
      });
    }

    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    const input = await request.json() as Record<string, unknown>;
    const reservationId = typeof input.reservationId === "string" ? input.reservationId : "";

    if (url.pathname === "/reserve") {
      const amountMicroUsd = typeof input.amountMicroUsd === "number" ? input.amountMicroUsd : 0;
      const limitMicroUsd = typeof input.limitMicroUsd === "number" ? input.limitMicroUsd : 0;
      return this.state.storage.transaction(async (transaction) => {
        const nowMs = Date.now();
        const stored = normalizeLedger(await transaction.get("ledger"));
        const ledger = expireStaleReservations(stored, nowMs);
        const result = reserveBudget(ledger, reservationId, amountMicroUsd, limitMicroUsd, nowMs);
        if (result.success || ledger !== stored) await transaction.put("ledger", result.ledger);
        return Response.json({ success: result.success });
      });
    }

    if (url.pathname === "/settle") {
      const actualMicroUsd = typeof input.actualMicroUsd === "number" ? input.actualMicroUsd : -1;
      return this.state.storage.transaction(async (transaction) => {
        const ledger = normalizeLedger(await transaction.get("ledger"));
        const settled = settleBudget(ledger, reservationId, actualMicroUsd);
        if (settled !== ledger) await transaction.put("ledger", settled);
        return Response.json({ success: settled !== ledger });
      });
    }

    return new Response("Not found", { status: 404 });
  }
}
