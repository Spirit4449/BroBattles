function describeKiller({ killedBy, cause } = {}) {
  const name = killedBy ? String(killedBy) : "";
  if (name) {
    const turret = name.match(/^(\w+)-turret$/);
    return { label: "Eliminated by", name: turret ? `${turret[1]} turret` : name };
  }
  if (cause === "fall") return { label: "You fell", name: "Out of bounds" };
  if (cause === "poison") return { label: "Eliminated by", name: "Poison" };
  return null;
}

function isLiveRoomStatus(status) {
  return status === "active" || status === "started" || status === "running";
}

module.exports = { describeKiller, isLiveRoomStatus };
