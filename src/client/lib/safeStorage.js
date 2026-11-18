// Take a storage accessor so security errors from the browser getter are caught
// along with quota errors and malformed values.
function readJson(getStorage, key, fallback = null) {
  try {
    const value = getStorage().getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeJson(getStorage, key, value) {
  try {
    getStorage().setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(getStorage, key) {
  try {
    getStorage().removeItem(key);
    return true;
  } catch {
    return false;
  }
}

module.exports = { readJson, writeJson, remove };
