import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthProps } from "../../auth/api-keys";
import type { Config } from "../../config";
import {
  applyRefusal,
  PRICE_CHANGING_KINDS,
  revertRefusal,
  validateRatio,
  type ApplyCandidate,
  type CorporateActionKind,
} from "../../domain/adjust";
import { ADJUST_BATCH_OVERHEAD_ROWS } from "../../domain/budget";
import { toCairoIso, utcDay } from "../../domain/calendar";
import { CAPACITY_MESSAGE, capacityRetryAt, checkPersonalWrite } from "../../limits/usage";
import {
  applyAdjustment,
  countApplyCandidates,
  readApplyCandidates,
  revertAdjustment,
  type AdjustmentResult,
} from "../../store/d1/bars";
import { listCalendar, removeCalendarDay, upsertCalendarDay } from "../../store/d1/calendar";
import {
  listDiscrepancies,
  listNotices,
  markNoticesDone,
  type NoticeCursor,
  type NoticeStatus,
} from "../../store/d1/events";
import { insertManualAction, setActionRatio } from "../../store/d1/fundamentals";
import { upsertInflation } from "../../store/d1/inflation";
import { getProfile, setStatus } from "../../store/d1/symbols";
import { readGlobal, topUsers } from "../../store/d1/usage";
import { defineTool, type ToolContext } from "../define-tool";
import { fail, ok, type ErrorCode, type Meta } from "../envelope";
import { envelopeSchema } from "../output-schema";
import { MAX_SYMBOL_INPUT_LENGTH } from "../resolve";
import { counted, dateSchema, loadDirectory, resolveEach } from "../shared";

const FORBIDDEN_MESSAGE = "This tool is for the owner only.";
const ACTION_NOT_FOUND_MESSAGE = "Action not found.";
const ACTION_CHANGED_MESSAGE = "The action changed meanwhile. Read it again and retry.";
const NOT_NEEDS_RATIO_MESSAGE = "Only an action in needs_ratio takes a ratio.";
const NOT_REVERTIBLE_MESSAGE = "Only an applied bonus, split or reverse split can be reverted.";
const RATIO_REQUIRED_MESSAGE = "ratio is required for a bonus, split or reverse split.";
const DIVIDEND_FIELDS_MESSAGE = "amount and currency go together.";
const ACTION_EXISTS_MESSAGE = "An action with this symbol, kind and ex date already exists.";
const SYMBOL_NOT_TRACKED_MESSAGE = "The symbol is not tracked.";
const SYMBOL_NOT_PENDING_MESSAGE = "Only a pending symbol can be activated.";
const SPECIAL_HOURS_MESSAGE = "special_hours needs both openTime and closeTime.";
const CURSOR_MESSAGE = "cursor is not valid.";
const ACTION_VANISHED_MESSAGE = "corporate action vanished during an admin call";
const OWNER_SOURCE = "owner";
const OWNER_LABEL = "owner_entered";
const CASH_DIVIDEND = "cash_dividend";
const CURSOR_SEPARATOR = ":";
const CURSOR_PATTERN = /^(\d+):(\d+)$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const ACTION_KINDS = ["cash_dividend", "bonus", "split", "reverse_split", "rights", "name_change", "other"] as const;
const MAX_NOTICE_IDS = 50;
const MAX_NOTICES_LIMIT = 50;
const DEFAULT_NOTICES_LIMIT = 20;
const MAX_DISCREPANCIES_LIMIT = 200;
const DEFAULT_DISCREPANCIES_LIMIT = 50;
const MAX_APPLY_LIMIT = 3;
const TOP_USERS_LIMIT = 20;
const SINGLE_ROW = 1;
const MAX_CURRENCY_LENGTH = 8;
const MAX_NOTE_LENGTH = 200;
const MAX_SOURCE_LENGTH = 100;

type Args = z.infer<typeof inputSchema>;
type ActionArgs<K extends Args["action"]> = Extract<Args, { action: K }>;
type Outcome = { actionId: number; status: string; rowsAdjusted: number; refusedReason: string | null };
type Refusal = (candidate: ApplyCandidate, maxRowsPerDay: number) => string | null;

const idSchema = z.number().int().positive();
const timeSchema = z.string().regex(TIME_PATTERN);
const ratioSchema = z.number().positive();

const calendarDaySchema = z
  .object({
    action: z.literal("set_calendar_day"),
    date: dateSchema,
    kind: z.enum(["holiday", "special_hours"]),
    openTime: timeSchema.optional(),
    closeTime: timeSchema.optional(),
    note: z.string().max(MAX_NOTE_LENGTH).optional(),
  })
  .refine((day) => day.kind !== "special_hours" || (day.openTime !== undefined && day.closeTime !== undefined), {
    message: SPECIAL_HOURS_MESSAGE,
  });

const inputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list_notices"),
    status: z.enum(["open", "done"]).default("open"),
    limit: z.number().int().min(1).max(MAX_NOTICES_LIMIT).default(DEFAULT_NOTICES_LIMIT),
    cursor: z.string().nullish(),
  }),
  z.object({ action: z.literal("mark_notice_done"), ids: z.array(idSchema).min(1).max(MAX_NOTICE_IDS) }),
  calendarDaySchema,
  z.object({ action: z.literal("remove_calendar_day"), date: dateSchema }),
  z.object({ action: z.literal("list_calendar"), from: dateSchema, to: dateSchema }),
  z.object({
    action: z.literal("set_inflation"),
    month: z.string().regex(MONTH_PATTERN),
    cpiIndex: z.number().positive(),
    yoyPct: z.number().nullable().optional(),
    source: z.string().min(1).max(MAX_SOURCE_LENGTH),
  }),
  z.object({ action: z.literal("set_action_ratio"), actionId: idSchema, ratio: ratioSchema }),
  z.object({
    action: z.literal("add_corporate_action"),
    symbol: z.string().min(1).max(MAX_SYMBOL_INPUT_LENGTH),
    kind: z.enum(ACTION_KINDS),
    exDate: dateSchema,
    ratio: ratioSchema.optional(),
    amount: z.number().positive().optional(),
    currency: z.string().min(1).max(MAX_CURRENCY_LENGTH).optional(),
  }),
  z.object({
    action: z.literal("apply_queued_actions"),
    limit: z.number().int().min(1).max(MAX_APPLY_LIMIT).default(MAX_APPLY_LIMIT),
  }),
  z.object({ action: z.literal("revert_action"), actionId: idSchema }),
  z.object({
    action: z.literal("list_discrepancies"),
    from: dateSchema,
    to: dateSchema,
    limit: z.number().int().min(1).max(MAX_DISCREPANCIES_LIMIT).default(DEFAULT_DISCREPANCIES_LIMIT),
  }),
  z.object({ action: z.literal("usage_summary"), day: dateSchema.optional() }),
  z.object({ action: z.literal("activate_symbol"), isin: z.string().min(1).max(MAX_SYMBOL_INPUT_LENGTH) }),
]);

const outputSchema = envelopeSchema(z.record(z.string(), z.unknown()));

function ownerMeta(): Meta {
  return {
    label: OWNER_LABEL,
    dataTime: null,
    source: null,
    stale: false,
    staleReason: null,
    session: null,
    notAvailable: [],
    provenance: [],
  };
}

function refuse(code: ErrorCode, message: string, retryAt?: string): CallToolResult {
  return fail(code, message, { label: OWNER_LABEL, retryAt });
}

function invalid(message: string): CallToolResult {
  return refuse("invalid_input", message);
}

function served(data: object): CallToolResult {
  return ok(data, ownerMeta());
}

function isPriceChanging(kind: CorporateActionKind): boolean {
  return PRICE_CHANGING_KINDS.includes(kind);
}

async function readCandidate(ctx: ToolContext, actionId: number): Promise<ApplyCandidate | null> {
  const [candidate] = await readApplyCandidates(ctx.env.DB, { actionId }, utcDay(ctx.now));
  return candidate ?? null;
}

function applyOne(ctx: ToolContext, candidate: ApplyCandidate): Promise<AdjustmentResult> {
  return applyAdjustment(ctx.env.DB, candidate, ctx.cfg.adjustMaxRowsPerDay, utcDay(ctx.now), ctx.now);
}

async function outcomeAfter(
  ctx: ToolContext,
  actionId: number,
  result: AdjustmentResult,
  refusalOf: Refusal,
): Promise<Outcome> {
  const current = await readCandidate(ctx, actionId);
  if (current === null) throw new Error(ACTION_VANISHED_MESSAGE);
  const refusedReason =
    result.refusedReason === "concurrent_change"
      ? refusalOf(current, ctx.cfg.adjustMaxRowsPerDay)
      : result.refusedReason;
  return { actionId, status: current.status, rowsAdjusted: result.applied ? result.rows : 0, refusedReason };
}

async function attemptApply(ctx: ToolContext, candidate: ApplyCandidate): Promise<Outcome> {
  return outcomeAfter(ctx, candidate.id, await applyOne(ctx, candidate), applyRefusal);
}

async function withPersonalWrite(
  ctx: ToolContext,
  worstCaseRows: number,
  write: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  if (!checkPersonalWrite(ctx.usage, ctx.cfg, worstCaseRows)) {
    return refuse("capacity", CAPACITY_MESSAGE, capacityRetryAt(ctx.now));
  }
  return write();
}

function parseCursor(cursor: string | null | undefined): NoticeCursor | null | undefined {
  if (cursor === null || cursor === undefined) return null;
  const match = CURSOR_PATTERN.exec(cursor);
  if (match === null) return undefined;
  return { createdAt: Number(match[1]), id: Number(match[2]) };
}

function formatCursor(cursor: NoticeCursor | null): string | null {
  return cursor === null ? null : `${cursor.createdAt}${CURSOR_SEPARATOR}${cursor.id}`;
}

async function handleListNotices(args: ActionArgs<"list_notices">, ctx: ToolContext): Promise<CallToolResult> {
  const cursor = parseCursor(args.cursor);
  if (cursor === undefined) return invalid(CURSOR_MESSAGE);
  const page = await counted(ctx.rows, listNotices(ctx.env.DB, args.status as NoticeStatus, args.limit, cursor));
  const items = page.notices.map((notice) => ({
    id: notice.id,
    kind: notice.kind,
    subject: notice.subject,
    details: notice.details,
    createdAt: toCairoIso(notice.createdAt),
    status: notice.status,
  }));
  return served({ items, nextCursor: formatCursor(page.nextCursor) });
}

function handleMarkNoticeDone(args: ActionArgs<"mark_notice_done">, ctx: ToolContext): Promise<CallToolResult> {
  return withPersonalWrite(ctx, args.ids.length, async () => {
    const updated = await markNoticesDone(ctx.env.DB, args.ids, ctx.now);
    ctx.rows.add({ rows_written: updated });
    return served({ updated });
  });
}

function handleSetCalendarDay(args: ActionArgs<"set_calendar_day">, ctx: ToolContext): Promise<CallToolResult> {
  return withPersonalWrite(ctx, SINGLE_ROW, async () => {
    const written = await upsertCalendarDay(ctx.env.DB, {
      date: args.date,
      kind: args.kind,
      openTime: args.openTime ?? null,
      closeTime: args.closeTime ?? null,
      note: args.note ?? null,
    });
    ctx.rows.add({ rows_written: written.rowsWritten });
    return served({ date: args.date });
  });
}

function handleRemoveCalendarDay(args: ActionArgs<"remove_calendar_day">, ctx: ToolContext): Promise<CallToolResult> {
  return withPersonalWrite(ctx, SINGLE_ROW, async () => {
    const result = await removeCalendarDay(ctx.env.DB, args.date);
    ctx.rows.add({ rows_written: result.rowsWritten });
    return served({ removed: result.removed });
  });
}

async function handleListCalendar(args: ActionArgs<"list_calendar">, ctx: ToolContext): Promise<CallToolResult> {
  const items = await counted(ctx.rows, listCalendar(ctx.env.DB, args.from, args.to));
  return served({ items });
}

function handleSetInflation(args: ActionArgs<"set_inflation">, ctx: ToolContext): Promise<CallToolResult> {
  return withPersonalWrite(ctx, SINGLE_ROW, async () => {
    const written = await upsertInflation(ctx.env.DB, {
      month: args.month,
      cpiIndex: args.cpiIndex,
      yoyPct: args.yoyPct ?? null,
      source: args.source,
      enteredBy: ctx.auth.email,
      enteredAt: ctx.now,
    });
    ctx.rows.add({ rows_written: written.rowsWritten });
    return served({ month: args.month });
  });
}

async function handleSetActionRatio(args: ActionArgs<"set_action_ratio">, ctx: ToolContext): Promise<CallToolResult> {
  const candidate = await readCandidate(ctx, args.actionId);
  if (candidate === null) return invalid(ACTION_NOT_FOUND_MESSAGE);
  if (candidate.status !== "needs_ratio" || !isPriceChanging(candidate.kind)) return invalid(NOT_NEEDS_RATIO_MESSAGE);
  const ratioMessage = validateRatio(candidate.kind, args.ratio);
  if (ratioMessage !== null) return invalid(ratioMessage);
  const stored = await setActionRatio(ctx.env.DB, args.actionId, args.ratio, ctx.now);
  if (stored === null) return invalid(ACTION_CHANGED_MESSAGE);
  return served(await attemptApply(ctx, { ...candidate, status: "recorded", ratio: args.ratio }));
}

async function handleRevertAction(args: ActionArgs<"revert_action">, ctx: ToolContext): Promise<CallToolResult> {
  const candidate = await readCandidate(ctx, args.actionId);
  if (candidate === null) return invalid(ACTION_NOT_FOUND_MESSAGE);
  if (candidate.status !== "applied" || !isPriceChanging(candidate.kind)) return invalid(NOT_REVERTIBLE_MESSAGE);
  const result = await revertAdjustment(
    ctx.env.DB,
    candidate,
    ctx.cfg.adjustMaxRowsPerDay,
    utcDay(ctx.now),
    ctx.now,
  );
  return served(await outcomeAfter(ctx, args.actionId, result, revertRefusal));
}

async function handleApplyQueued(args: ActionArgs<"apply_queued_actions">, ctx: ToolContext): Promise<CallToolResult> {
  const candidates = await readApplyCandidates(ctx.env.DB, { limit: args.limit }, utcDay(ctx.now));
  const applied: { actionId: number; rowsAdjusted: number }[] = [];
  let rowsToday = 0;
  for (const candidate of candidates) {
    const result = await applyOne(ctx, { ...candidate, adjustRowsToday: candidate.adjustRowsToday + rowsToday });
    if (result.refusedReason === "daily_cap" || result.refusedReason === "concurrent_change") break;
    if (!result.applied) continue;
    rowsToday += result.rows + ADJUST_BATCH_OVERHEAD_ROWS;
    applied.push({ actionId: candidate.id, rowsAdjusted: result.rows });
  }
  const remaining = await countApplyCandidates(ctx.env.DB);
  return served({ applied, remaining });
}

function dividendFieldsAreValid(args: ActionArgs<"add_corporate_action">): boolean {
  if (args.kind !== CASH_DIVIDEND) return true;
  return (args.amount === undefined) === (args.currency === undefined);
}

function handleAddCorporateAction(args: ActionArgs<"add_corporate_action">, ctx: ToolContext): Promise<CallToolResult> {
  const priceChanging = isPriceChanging(args.kind);
  if (priceChanging && args.ratio === undefined) return Promise.resolve(invalid(RATIO_REQUIRED_MESSAGE));
  const ratioMessage = priceChanging ? validateRatio(args.kind, args.ratio ?? 0) : null;
  if (ratioMessage !== null) return Promise.resolve(invalid(ratioMessage));
  if (!dividendFieldsAreValid(args)) return Promise.resolve(invalid(DIVIDEND_FIELDS_MESSAGE));
  return withPersonalWrite(ctx, SINGLE_ROW, () => insertAndApply(args, ctx));
}

async function insertAndApply(args: ActionArgs<"add_corporate_action">, ctx: ToolContext): Promise<CallToolResult> {
  const directory = await loadDirectory(ctx.env, OWNER_LABEL);
  if (!directory.ok) return directory.result;
  const resolved = resolveEach(directory.value, [args.symbol], OWNER_LABEL);
  if ("failure" in resolved) return resolved.failure;
  const inserted = await insertManualAction(ctx.env.DB, {
    isin: resolved.entries[0]![0],
    kind: args.kind,
    announcedOn: null,
    exDate: args.exDate,
    ratio: isPriceChanging(args.kind) ? (args.ratio ?? null) : null,
    amount: args.kind === CASH_DIVIDEND ? (args.amount ?? null) : null,
    currency: args.kind === CASH_DIVIDEND ? (args.currency ?? null) : null,
    source: OWNER_SOURCE,
    sourceText: null,
    now: ctx.now,
  });
  if (inserted === null) return invalid(ACTION_EXISTS_MESSAGE);
  ctx.rows.add({ rows_written: SINGLE_ROW });
  if (!isPriceChanging(args.kind)) {
    return served({ actionId: inserted.id, status: inserted.status, rowsAdjusted: 0, refusedReason: null });
  }
  const candidate = await readCandidate(ctx, inserted.id);
  if (candidate === null) return invalid(SYMBOL_NOT_TRACKED_MESSAGE);
  return served(await attemptApply(ctx, candidate));
}

async function handleListDiscrepancies(
  args: ActionArgs<"list_discrepancies">,
  ctx: ToolContext,
): Promise<CallToolResult> {
  const items = await counted(ctx.rows, listDiscrepancies(ctx.env.DB, args.from, args.to, args.limit));
  return served({ items });
}

function capsOf(cfg: Config) {
  return {
    globalDailyCalls: cfg.globalDailyCalls,
    globalDailyRowsRead: cfg.globalDailyRowsRead,
    oauthDailyKvWrites: cfg.oauthDailyKvWrites,
    userDailyCalls: cfg.userDailyCalls,
    backfillMaxRowsPerDay: cfg.backfillMaxRowsPerDay,
    adjustMaxRowsPerDay: cfg.adjustMaxRowsPerDay,
    personalDailyRows: cfg.personalDailyRows,
  };
}

async function handleUsageSummary(args: ActionArgs<"usage_summary">, ctx: ToolContext): Promise<CallToolResult> {
  const day = args.day ?? utcDay(ctx.now);
  const [global, users] = await Promise.all([
    counted(ctx.rows, readGlobal(ctx.env.DB, day)),
    counted(ctx.rows, topUsers(ctx.env.DB, day, TOP_USERS_LIMIT)),
  ]);
  return served({ global, caps: capsOf(ctx.cfg), topUsers: users });
}

function handleActivateSymbol(args: ActionArgs<"activate_symbol">, ctx: ToolContext): Promise<CallToolResult> {
  return withPersonalWrite(ctx, SINGLE_ROW, async () => {
    const profile = await counted(ctx.rows, getProfile(ctx.env.DB, args.isin));
    if (profile === null) return refuse("not_found", SYMBOL_NOT_TRACKED_MESSAGE);
    if (profile.status !== "pending") return invalid(SYMBOL_NOT_PENDING_MESSAGE);
    const written = await setStatus(ctx.env.DB, [args.isin], "active", ctx.now);
    ctx.rows.add({ rows_written: written.rowsWritten });
    return served({ isin: args.isin, status: "active" });
  });
}

function dispatch(args: Args, ctx: ToolContext): Promise<CallToolResult> {
  switch (args.action) {
    case "list_notices":
      return handleListNotices(args, ctx);
    case "mark_notice_done":
      return handleMarkNoticeDone(args, ctx);
    case "set_calendar_day":
      return handleSetCalendarDay(args, ctx);
    case "remove_calendar_day":
      return handleRemoveCalendarDay(args, ctx);
    case "list_calendar":
      return handleListCalendar(args, ctx);
    case "set_inflation":
      return handleSetInflation(args, ctx);
    case "set_action_ratio":
      return handleSetActionRatio(args, ctx);
    case "add_corporate_action":
      return handleAddCorporateAction(args, ctx);
    case "apply_queued_actions":
      return handleApplyQueued(args, ctx);
    case "revert_action":
      return handleRevertAction(args, ctx);
    case "list_discrepancies":
      return handleListDiscrepancies(args, ctx);
    case "usage_summary":
      return handleUsageSummary(args, ctx);
    case "activate_symbol":
      return handleActivateSymbol(args, ctx);
  }
}

function handleAdmin(args: Args, ctx: ToolContext): Promise<CallToolResult> {
  if (!ctx.cfg.ownerEmails.has(ctx.auth.email.toLowerCase())) {
    return Promise.resolve(refuse("forbidden", FORBIDDEN_MESSAGE));
  }
  return dispatch(args, ctx);
}

export function registerAdminTools(server: McpServer, env: Env, auth: AuthProps): void {
  defineTool(
    server,
    {
      name: "admin",
      description:
        "Owner only. Manage notices, the holiday and special hours table, inflation figures, corporate actions and bonus, split and reverse split ratios, usage and pending symbols. activate_symbol does not rewrite the symbol directory; the next end-of-day run does.",
      inputSchema,
      outputSchema,
      readOnly: false,
      label: OWNER_LABEL,
      handler: handleAdmin,
    },
    env,
    auth,
  );
}
