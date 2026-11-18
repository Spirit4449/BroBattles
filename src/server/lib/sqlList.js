function placeholders(count) {
  return Array(count).fill("?").join(",");
}

module.exports = { placeholders };
