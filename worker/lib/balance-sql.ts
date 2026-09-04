export const SNAPSHOT_MARGIN_SECONDS = 5;

/** 可用余额 = 快照余额 + 快照边界之后的账本增量；三个 ? 都绑定 user_id。 */
export const AVAILABLE_BALANCE_SQL = `(
  COALESCE(
    (SELECT s.balance_usd_micros FROM balance_snapshots s WHERE s.user_id = ?),
    0
  ) + COALESCE(
    (SELECT SUM(l.delta_usd_micros)
     FROM balance_ledger l
     WHERE l.user_id = ?
       AND datetime(l.created_at) > datetime(
         COALESCE(
           (SELECT s2.through_created_at
            FROM balance_snapshots s2
            WHERE s2.user_id = ?),
           '1970-01-01 00:00:00'
         )
       )),
    0
  )
)`;

export function availableBalanceBindings(
  userId: string,
): [string, string, string] {
  return [userId, userId, userId];
}

/** 对最近一天有账本活动的用户重算快照；边界留出安全余量避免与并发写入竞争。 */
export const REFRESH_BALANCE_SNAPSHOTS_SQL = `
  INSERT INTO balance_snapshots
    (user_id, balance_usd_micros, through_created_at, updated_at)
  SELECT l.user_id,
         COALESCE(SUM(l.delta_usd_micros), 0),
         datetime('now', '-${SNAPSHOT_MARGIN_SECONDS} seconds'),
         CURRENT_TIMESTAMP
  FROM balance_ledger l
  WHERE datetime(l.created_at) <= datetime('now', '-${SNAPSHOT_MARGIN_SECONDS} seconds')
    AND l.user_id IN (
      SELECT DISTINCT user_id
      FROM balance_ledger
      WHERE datetime(created_at) > datetime('now', '-1 day')
    )
  GROUP BY l.user_id
  ON CONFLICT(user_id) DO UPDATE SET
    balance_usd_micros = excluded.balance_usd_micros,
    through_created_at = excluded.through_created_at,
    updated_at = CURRENT_TIMESTAMP`;
