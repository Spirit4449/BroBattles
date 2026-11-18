function createFakeDb(runQuery, { connection = null } = {}) {
  return {
    runQuery,
    withTransaction: fn => fn(connection, runQuery),
  };
}

function createTransactionalDb({ state: initialState, query, clone = structuredClone }) {
  let state = initialState;
  let pending = Promise.resolve();
  const calls = [];
  function runQuery(sql, params = []) {
    calls.push({ sql, params });
    return query(state, sql, params);
  }
  function withTransaction(fn) {
    const transaction = pending.then(async () => {
      const before = clone(state);
      try {
        return await fn(null, runQuery);
      } catch (error) {
        state = before;
        throw error;
      }
    });
    // Release the next transaction after either a commit or a rollback.
    pending = transaction.then(() => {}, () => {});
    return transaction;
  }
  return { get state() { return state; }, calls, runQuery, withTransaction };
}

module.exports = { createFakeDb, createTransactionalDb };
