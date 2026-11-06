#!/usr/bin/env bash
# Keeps one CPU core free for the game on the shared Raspberry Pi.
#
# Everything else that runs there is confined to the other cores and, except
# MariaDB (which the game queries), given a lower CPU priority: system services
# through persistent systemd properties, Docker containers through
# `docker update`, and the other pm2 apps by setting the affinity and niceness
# of their process trees, which children inherit. The game process tree is left
# on every core at normal priority. nginx and tailscaled stay unrestricted
# because player traffic passes through them.
#
# Idempotent; run as root from cron every minute so pm2 apps restarted since the
# last run are caught (see docs/operations/deployment.md).
set -u

GAME_APP="${BB_PM2_GAME_APP:-game}"
PM2_HOME="${PM2_HOME:-/home/nisch/.pm2}"
OTHER_CPUS="${BB_OTHER_CPUS:-0-2}"
OTHER_NICE="${BB_OTHER_NICE:-10}"
LOW_WEIGHT=25
GAME_WEIGHT=400
LOW_UNITS="docker.service containerd.service snapd.service cups.service cups-browsed.service colord.service smbd.service nmbd.service xrdp.service xrdp-sesman.service ModemManager.service bluetooth.service user.slice"

set_unit() { # unit property value
  [ "$(systemctl show -p "$2" --value "$1" 2>/dev/null)" = "$3" ] && return
  systemctl show -p LoadState --value "$1" 2>/dev/null | grep -qx loaded || return
  systemctl set-property "$1" "$2=$3"
}

for unit in $LOW_UNITS; do
  set_unit "$unit" AllowedCPUs "$OTHER_CPUS"
  set_unit "$unit" CPUWeight "$LOW_WEIGHT"
done
set_unit mariadb.service AllowedCPUs "$OTHER_CPUS"
set_unit pm2-nisch.service CPUWeight "$GAME_WEIGHT"

if command -v docker >/dev/null; then
  for id in $(docker ps -q); do
    [ "$(docker inspect -f '{{.HostConfig.CpusetCpus}}' "$id")" = "$OTHER_CPUS" ] ||
      docker update --cpuset-cpus "$OTHER_CPUS" --cpu-shares 256 "$id" >/dev/null
  done
fi

# Every pm2 app except the game, with all descendants and all their threads.
tree() {
  local pid
  for pid in "$@"; do
    echo "$pid"
    tree $(pgrep -P "$pid")
  done
}
roots=()
for file in "$PM2_HOME"/pids/*.pid; do
  case "$(basename "$file")" in "$GAME_APP"-[0-9]*.pid) continue ;; esac
  pid="$(cat "$file" 2>/dev/null)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && roots+=("$pid")
done
[ "${#roots[@]}" -gt 0 ] && for pid in $(tree "${roots[@]}"); do
  taskset -a -p -c "$OTHER_CPUS" "$pid" >/dev/null 2>&1
  for task in /proc/"$pid"/task/*; do
    tid="${task##*/}"
    [ "$(ps -o ni= -p "$tid" 2>/dev/null | tr -d ' ')" = "$OTHER_NICE" ] ||
      renice -n "$OTHER_NICE" -p "$tid" >/dev/null 2>&1
  done
done

# The game inherits pm2's cpuset; pm2 started from a login shell would put it in
# user.slice and so off the reserved core.
for file in "$PM2_HOME"/pids/"$GAME_APP"-[0-9]*.pid; do
  pid="$(cat "$file" 2>/dev/null)" || continue
  grep -q 'pm2-nisch.service' /proc/"$pid"/cgroup 2>/dev/null ||
    logger -t pi-cpu-reserve "game pid $pid is not under pm2-nisch.service; restart pm2 with systemctl restart pm2-nisch"
done
