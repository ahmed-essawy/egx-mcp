export type LevelDirection = "above" | "below";

export type PriceLevelRow = {
  id: number;
  isin: string;
  direction: LevelDirection;
  level: number;
  armed: 0 | 1;
  lastCrossedAt: number | null;
};

export type CrossedLevel = {
  id: number;
  isin: string;
  direction: LevelDirection;
  level: number;
  lastCrossedAt: number;
};

export type LevelChange = {
  id: number;
  isin: string;
  direction: LevelDirection;
  level: number;
  armed: 0 | 1;
  lastCrossedAt: number | null;
};

export type LevelEvaluation = {
  crossed: CrossedLevel[];
  changes: LevelChange[];
};

function hasReached(row: PriceLevelRow, price: number): boolean {
  return row.direction === "below" ? price <= row.level : price >= row.level;
}

function isBackOnOtherSide(row: PriceLevelRow, price: number): boolean {
  return row.direction === "below" ? price > row.level : price < row.level;
}

export function evaluateLevels(
  levels: readonly PriceLevelRow[],
  priceByIsin: ReadonlyMap<string, number>,
  now: number,
): LevelEvaluation {
  const crossed: CrossedLevel[] = [];
  const changes: LevelChange[] = [];
  for (const row of levels) {
    const price = priceByIsin.get(row.isin);
    if (price === undefined) continue;
    if (row.armed === 1 && hasReached(row, price)) {
      crossed.push({
        id: row.id,
        isin: row.isin,
        direction: row.direction,
        level: row.level,
        lastCrossedAt: now,
      });
      changes.push({
        id: row.id,
        isin: row.isin,
        direction: row.direction,
        level: row.level,
        armed: 0,
        lastCrossedAt: now,
      });
    } else if (row.armed === 0 && isBackOnOtherSide(row, price)) {
      changes.push({
        id: row.id,
        isin: row.isin,
        direction: row.direction,
        level: row.level,
        armed: 1,
        lastCrossedAt: row.lastCrossedAt,
      });
    }
  }
  return { crossed, changes };
}
