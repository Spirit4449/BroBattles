const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

function formatCount(value, locale) {
  return (Number(value) || 0).toLocaleString(locale);
}

function formatUsd(cents) {
  return usd.format((Number(cents) || 0) / 100);
}

function formatFixed(value, digits = 1, fallback = "n/a") {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : fallback;
}

function formatDurationShort(ms) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)}m`;
}

function formatDurationLong(ms) {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  if (seconds <= 0) return "";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatCountdown(target, now = Date.now(), style = "clock") {
  const remaining = Math.max(0, new Date(target).getTime() - Number(now));
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (style === "compact") {
    if (!Number.isFinite(remaining)) return "--:--:--";
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  return [hours, minutes, seconds].map(part => String(part).padStart(2, "0")).join(":");
}

module.exports = {
  formatCount,
  formatCountdown,
  formatDurationLong,
  formatDurationShort,
  formatFixed,
  formatUsd,
};
