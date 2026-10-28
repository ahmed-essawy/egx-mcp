import type { LevelChange, LevelDirection, PriceLevelRow } from "../../domain/levels";

export const MAX_ITEMS_PER_USER = 50;
export const INSERT_WORST_ROWS = 2;
export const UPDATE_WORST_ROWS = 1;
export const REMOVE_WORST_ROWS = 2;
export const CROSSING_WORST_ROWS = 1;

export type Holding = {
  id: number;
  isin: string;
  quantity: number;
  costPerShare: number;
  acquiredOn: string;
};

export type PersonalData = { holdings: Holding[]; levels: PriceLevelRow[]; rowsRead: number };

export type HoldingInput = {
  id?: number;
  isin: string;
  quantity: number;
  costPerShare: number;
  acquiredOn: string;
  now: number;
};

export type LevelInput = {
  id?: number;
  isin: string;
  direction: LevelDirection;
  level: number;
  now: number;
};

export type SaveResult =
  | { status: "saved"; id: number; rowsWritten: number; rowsRead: number }
  | { status: "limit_reached" | "not_found"; rowsWritten: number; rowsRead: number };

export type RemoveResult = { status: "removed" | "not_found"; rowsWritten: number; rowsRead: number };

export type CrossingsResult = { changedIds: ReadonlySet<number>; rowsWritten: number; rowsRead: number };

type HoldingRow = {
  id: number;
  isin: string;
  quantity: number;
  cost_per_share: number;
  acquired_on: string;
};

type LevelRow = {
  id: number;
  isin: string;
  direction: LevelDirection;
  level: number;
  armed: 0 | 1;
  last_crossed_at: number | null;
};

export async function listHoldingsAndLevels(db: D1Database, userId: string): Promise<PersonalData> {
  const [holdingsResult, levelsResult] = await db.batch([
    db
      .prepare(
        "SELECT id, isin, quantity, cost_per_share, acquired_on FROM holdings WHERE user_id = ?1 ORDER BY id",
      )
      .bind(userId),
    db
      .prepare(
        "SELECT id, isin, direction, level, armed, last_crossed_at FROM price_levels WHERE user_id = ?1 ORDER BY id",
      )
      .bind(userId),
  ]);
  return {
    holdings: (holdingsResult!.results as HoldingRow[]).map((row) => ({
      id: row.id,
      isin: row.isin,
      quantity: row.quantity,
      costPerShare: row.cost_per_share,
      acquiredOn: row.acquired_on,
    })),
    levels: (levelsResult!.results as LevelRow[]).map((row) => ({
      id: row.id,
      isin: row.isin,
      direction: row.direction,
      level: row.level,
      armed: row.armed,
      lastCrossedAt: row.last_crossed_at,
    })),
    rowsRead: holdingsResult!.meta.rows_read + levelsResult!.meta.rows_read,
  };
}

export async function upsertHolding(db: D1Database, userId: string, holding: HoldingInput): Promise<SaveResult> {
  if (holding.id !== undefined) {
    const { meta } = await db
      .prepare(
        `UPDATE holdings SET isin = ?1, quantity = ?2, cost_per_share = ?3, acquired_on = ?4
         WHERE id = ?5 AND user_id = ?6`,
      )
      .bind(holding.isin, holding.quantity, holding.costPerShare, holding.acquiredOn, holding.id, userId)
      .run();
    return meta.changes === 0
      ? { status: "not_found", rowsWritten: meta.rows_written, rowsRead: meta.rows_read }
      : { status: "saved", id: holding.id, rowsWritten: meta.rows_written, rowsRead: meta.rows_read };
  }
  const { meta } = await db
    .prepare(
      `INSERT INTO holdings (user_id, isin, quantity, cost_per_share, acquired_on, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE (SELECT COUNT(*) FROM holdings WHERE user_id = ?1) < ?7`,
    )
    .bind(userId, holding.isin, holding.quantity, holding.costPerShare, holding.acquiredOn, holding.now, MAX_ITEMS_PER_USER)
    .run();
  return meta.changes === 0
    ? { status: "limit_reached", rowsWritten: meta.rows_written, rowsRead: meta.rows_read }
    : { status: "saved", id: meta.last_row_id, rowsWritten: meta.rows_written, rowsRead: meta.rows_read };
}

export async function removeHolding(db: D1Database, userId: string, id: number): Promise<RemoveResult> {
  const { meta } = await db.prepare("DELETE FROM holdings WHERE id = ?1 AND user_id = ?2").bind(id, userId).run();
  return { status: meta.changes === 0 ? "not_found" : "removed", rowsWritten: meta.rows_written, rowsRead: meta.rows_read };
}

export async function upsertLevel(db: D1Database, userId: string, level: LevelInput): Promise<SaveResult> {
  if (level.id !== undefined) {
    const { meta } = await db
      .prepare(
        `UPDATE price_levels SET isin = ?1, direction = ?2, level = ?3, armed = 1, last_crossed_at = NULL
         WHERE id = ?4 AND user_id = ?5`,
      )
      .bind(level.isin, level.direction, level.level, level.id, userId)
      .run();
    return meta.changes === 0
      ? { status: "not_found", rowsWritten: meta.rows_written, rowsRead: meta.rows_read }
      : { status: "saved", id: level.id, rowsWritten: meta.rows_written, rowsRead: meta.rows_read };
  }
  const { meta } = await db
    .prepare(
      `INSERT INTO price_levels (user_id, isin, direction, level, armed, created_at)
       SELECT ?1, ?2, ?3, ?4, 1, ?5
       WHERE (SELECT COUNT(*) FROM price_levels WHERE user_id = ?1) < ?6`,
    )
    .bind(userId, level.isin, level.direction, level.level, level.now, MAX_ITEMS_PER_USER)
    .run();
  return meta.changes === 0
    ? { status: "limit_reached", rowsWritten: meta.rows_written, rowsRead: meta.rows_read }
    : { status: "saved", id: meta.last_row_id, rowsWritten: meta.rows_written, rowsRead: meta.rows_read };
}

export async function removeLevel(db: D1Database, userId: string, id: number): Promise<RemoveResult> {
  const { meta } = await db.prepare("DELETE FROM price_levels WHERE id = ?1 AND user_id = ?2").bind(id, userId).run();
  return { status: meta.changes === 0 ? "not_found" : "removed", rowsWritten: meta.rows_written, rowsRead: meta.rows_read };
}

export async function saveCrossings(db: D1Database, userId: string, changes: LevelChange[]): Promise<CrossingsResult> {
  if (changes.length === 0) return { changedIds: new Set(), rowsWritten: 0, rowsRead: 0 };
  const rows = changes.map((change) => ({
    id: change.id,
    isin: change.isin,
    direction: change.direction,
    level: change.level,
    armed: change.armed,
    last_crossed_at: change.lastCrossedAt,
  }));
  const { results, meta } = await db
    .prepare(
      `UPDATE price_levels SET armed = change.armed, last_crossed_at = change.last_crossed_at
       FROM (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.isin') AS isin,
                    json_extract(value, '$.direction') AS direction,
                    json_extract(value, '$.level') AS level, json_extract(value, '$.armed') AS armed,
                    json_extract(value, '$.last_crossed_at') AS last_crossed_at
             FROM json_each(?1)) AS change
       WHERE price_levels.id = change.id AND price_levels.user_id = ?2
         AND price_levels.isin = change.isin
         AND price_levels.level = change.level AND price_levels.direction = change.direction
         AND price_levels.armed = 1 - change.armed
       RETURNING price_levels.id`,
    )
    .bind(JSON.stringify(rows), userId)
    .run<{ id: number }>();
  return {
    changedIds: new Set(results.map((row) => row.id)),
    rowsWritten: meta.rows_written,
    rowsRead: meta.rows_read,
  };
}
