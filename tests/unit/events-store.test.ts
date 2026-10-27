import { describe, expect, it, vi } from "vitest";
import {
  insertDiscrepancies,
  insertEvents,
  listNotices,
  markNoticesDone,
  raiseNotices,
} from "../../src/store/d1/events";

const GIVEN_TIMESTAMP = 1_792_000_000;
const GIVEN_DONE_AT = 1_792_000_500;
const GIVEN_UTC_DATE = "2026-10-14";
const FAILED_JOB_SUBJECT = "eod/bars/tv";
const CHANGED_ROWS = 2;
const OLDER_NOTICE = { id: 1, createdAt: 100 };
const NEWER_NOTICE = { id: 3, createdAt: 300 };
const PAGE_SIZE = 2;
const OVER_MAX_PAGE_SIZE = 500;
const MAX_NOTICES_PAGE = 50;
const OPEN = "open";

function spyDb(statement: { run?: unknown; all?: unknown } = {}) {
  const bind = vi.fn().mockReturnValue(statement);
  const prepare = vi.fn().mockReturnValue({ bind });
  return { db: { prepare } as unknown as D1Database, prepare, bind };
}

function noticeRow(id: number, createdAt: number) {
  return { id, kind: "job_failed", subject: "s", details: "{}", created_at: createdAt, status: OPEN, done_at: null };
}

describe("events store", () => {
  it("issues no statement for an empty list", async () => {
    const { db, prepare } = spyDb();
    await raiseNotices(db, []);
    await insertEvents(db, []);
    await insertDiscrepancies(db, []);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("builds the dedupe key from kind, subject and UTC date in one statement", async () => {
    const { db, prepare, bind } = spyDb({ run: vi.fn().mockResolvedValue({}) });
    await raiseNotices(db, [{ kind: "job_failed", subject: FAILED_JOB_SUBJECT, details: {}, at: GIVEN_TIMESTAMP }]);
    expect(prepare).toHaveBeenCalledTimes(1);
    const rows = JSON.parse(bind.mock.calls[0]?.[0] as string) as { dedupe_key: string }[];
    expect(rows[0]?.dedupe_key).toBe(`job_failed|${FAILED_JOB_SUBJECT}|${GIVEN_UTC_DATE}`);
  });

  it("returns 0 for no ids without a statement", async () => {
    const { db, prepare } = spyDb();
    expect(await markNoticesDone(db, [], GIVEN_DONE_AT)).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("returns the number of changed rows", async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: CHANGED_ROWS } });
    const { db, bind } = spyDb({ run });
    expect(await markNoticesDone(db, [OLDER_NOTICE.id, NEWER_NOTICE.id], GIVEN_DONE_AT)).toBe(CHANGED_ROWS);
    expect(bind).toHaveBeenCalledWith(GIVEN_DONE_AT, JSON.stringify([OLDER_NOTICE.id, NEWER_NOTICE.id]));
  });

  it("binds the two part cursor and returns the next cursor of a full page", async () => {
    const all = vi.fn().mockResolvedValue({
      results: [noticeRow(NEWER_NOTICE.id, NEWER_NOTICE.createdAt), noticeRow(OLDER_NOTICE.id, OLDER_NOTICE.createdAt)],
    });
    const { db, bind } = spyDb({ all });
    const cursor = { createdAt: NEWER_NOTICE.createdAt + 1, id: NEWER_NOTICE.id };
    const page = await listNotices(db, OPEN, PAGE_SIZE, cursor);
    expect(bind).toHaveBeenCalledWith(OPEN, cursor.createdAt, cursor.id, PAGE_SIZE);
    expect(page.nextCursor).toEqual({ createdAt: OLDER_NOTICE.createdAt, id: OLDER_NOTICE.id });
  });

  it("has no next cursor on a short page and caps the page size", async () => {
    const all = vi.fn().mockResolvedValue({ results: [noticeRow(OLDER_NOTICE.id, OLDER_NOTICE.createdAt)] });
    const { db, bind } = spyDb({ all });
    const page = await listNotices(db, OPEN, OVER_MAX_PAGE_SIZE, null);
    expect(bind.mock.calls[0]?.[3]).toBe(MAX_NOTICES_PAGE);
    expect(page.nextCursor).toBeNull();
  });
});
