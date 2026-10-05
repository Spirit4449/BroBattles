export function createRuntimeId(prefix, ...parts) {
  const core = [prefix, Date.now(), Math.floor(Math.random() * 1e6)];
  if (Array.isArray(parts) && parts.length) {
    core.push(...parts);
  }
  return core
    .filter((part) => part !== undefined && part !== null && part !== "")
    .join("_");
}
