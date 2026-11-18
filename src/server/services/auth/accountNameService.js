const NAME_CHANGE_COST = 50;

async function renameUser(q, { userId, oldName, newName, paid = false }) {
  if (paid) {
    await q(
      `UPDATE users SET name = ?, gems = gems - ?,
              next_name_change_at = DATE_ADD(NOW(3), INTERVAL 1 MONTH)
        WHERE user_id = ?`,
      [newName, NAME_CHANGE_COST, userId],
    );
  } else {
    await q("UPDATE users SET name = ?, updated_at = NOW() WHERE user_id = ?", [newName, userId]);
  }
  await q("UPDATE party_members SET name = ? WHERE name = ?", [newName, oldName]);
}

async function changeUsername(db, userId, next) {
  return db.withTransaction(async (_conn, q) => {
    // Lock the account before checking either balance or cooldown. Concurrent
    // renames and other wallet writes must see the committed account state.
    const [current] = await q(
      `SELECT name, gems, next_name_change_at,
              next_name_change_at > NOW(3) AS cooldown_active
         FROM users WHERE user_id = ? FOR UPDATE`,
      [userId],
    );
    if (!current) return { status: 401, error: "Not authenticated" };
    if (next === current.name) {
      return {
        success: true,
        username: current.name,
        gems: Number(current.gems) || 0,
        nextNameChangeAt: current.next_name_change_at || null,
      };
    }
    if (current.cooldown_active) {
      return {
        status: 429,
        error: "You can only change your name once per month.",
        nextNameChangeAt: current.next_name_change_at,
      };
    }
    if ((Number(current.gems) || 0) < NAME_CHANGE_COST) {
      return { status: 400, error: `You need ${NAME_CHANGE_COST} gems to change your name.` };
    }
    await renameUser(q, { userId, newName: next, oldName: current.name, paid: true });
    const [updated] = await q("SELECT gems, next_name_change_at FROM users WHERE user_id = ?", [
      userId,
    ]);
    return {
      success: true,
      username: next,
      gems: Number(updated.gems) || 0,
      nextNameChangeAt: updated.next_name_change_at,
    };
  });
}

module.exports = { NAME_CHANGE_COST, renameUser, changeUsername };
