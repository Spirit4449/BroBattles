const { BaseGameMode } = require("./BaseGameMode");

class DuelsGameMode extends BaseGameMode {
  buildModeState() {
    return {
      type: "duels",
      topology: "team-vs-team",
      respawns: false,
    };
  }

  evaluateVictoryState() {
    const room = this.room;
    if (!room || room.status !== "active") return null;

    const aliveByTeam = { team1: 0, team2: 0 };
    for (const p of room.players.values()) {
      if (!p?.isAlive) continue;
      if (p.team === "team1") aliveByTeam.team1 += 1;
      else if (p.team === "team2") aliveByTeam.team2 += 1;
    }

    const t1Alive = aliveByTeam.team1;
    const t2Alive = aliveByTeam.team2;
    let winnerTeam = null;
    if (t1Alive === 0 && t2Alive === 0) {
      winnerTeam = null;
    } else if (t1Alive === 0) {
      winnerTeam = "team2";
    } else if (t2Alive === 0) {
      winnerTeam = "team1";
    }

    const terminal =
      winnerTeam !== null || (winnerTeam === null && t1Alive === 0 && t2Alive === 0);

    return {
      terminal,
      winnerTeam,
      outcomeKey:
        winnerTeam !== null ? String(winnerTeam) : terminal ? "draw" : null,
      meta: { t1Alive, t2Alive },
    };
  }
}

module.exports = { DuelsGameMode };
