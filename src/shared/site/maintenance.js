const MAINTENANCE_MESSAGE = 'New matches currently disabled for maintenance.';
function maintenanceRemaining(until, now = Date.now()) {
  return Math.max(0, (Date.parse(until) || 0) - now);
}
function maintenanceClock(until, now = Date.now()) {
  const seconds = Math.ceil(maintenanceRemaining(until, now) / 1000);
  const hours = Math.floor(seconds / 3600);
  return `${String(hours).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
module.exports = { MAINTENANCE_MESSAGE, maintenanceRemaining, maintenanceClock };
