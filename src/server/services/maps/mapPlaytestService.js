const {
  DUEL_DEFAULT_VARIANT,
  isDuelFormation,
  duelPlayersPerTeam,
} = require("../../../shared/maps/duelVariants.js");
const { isCompatibleClient } = require("../../core/socketEvents/clientCompatibility");
const { defineSocketHandler } = require("../../core/socketEvents/handler");
const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
const { roomChannel } = require("../../core/gameRoom/channels");
const { getSkinById, getDefaultSkinId } = require("../cosmetics/skinsCatalog");
const { randomUUID } = require("node:crypto");
const { GameRoom } = require("../../core/gameRoom");
const { createBotParticipants } = require("../match/bots/identity");
const { decorateParticipant } = require("../match/matchRosterService");
const {
  getAllCharacters,
  getHealth,
  getDamage,
  getSpecialDamage,
  DEFAULT_CHARACTER,
} = require("../../../shared/characters/characterStats.js");
const {
  clone,
  mapSummary,
  validateDocument,
  upgradeDuelMap,
} = require("../../../shared/maps/mapDocument");
const { mapArena } = require("../../../shared/maps/arenas");
const { validateAssets } = require("./mapAssetValidation");
const { getParticipant } = require("../../core/gameRoom/participants");
const { respawnPlayer } = require("../../core/gameRoom/respawn");
const { correctPosition } = require("../../core/gameRoom/inputManager");
const characterCombat = require("../../../shared/combat/runtime/characterCombatRegistry");

// Both playtest styles run the real simulation in an isolated, reward-free room.
class EditorGameRoom extends GameRoom {
  potentialStartGame(options) {
    if (this.matchData.editorFullBattle) super.potentialStartGame(options);
  }
  checkVictoryCondition() {
    if (this.matchData.editorFullBattle) super.checkVictoryCondition();
  }
  _tickTimerAndSuddenDeath() {
    if (this.matchData.editorFullBattle) super._tickTimerAndSuddenDeath();
  }
  async finishGame(winnerTeam, meta) {
    if (this.matchData.editorFullBattle) return super.finishGame(winnerTeam, meta);
  }
  async distributeMatchRewards() {
    return [];
  }
  async cancelMatchAsAbandoned() {
    this.cleanup();
  }
  _refillPlaytestSuper(player) {
    if (!this.matchData.editorInfiniteSupers || !player || player.isBot) return;
    player.superCharge = player.maxSuperCharge;
    this.broadcast(SOCKET_EVENTS.SUPER_UPDATE, {
      username: player.name,
      charge: player.superCharge,
      maxCharge: player.maxSuperCharge,
    });
  }
  async addPlayer(socket, user) {
    await super.addPlayer(socket, user);
    const player = [...this.players.values()].find(
      (p) => !p.isBot && Number(p.user_id) === Number(user?.user_id),
    );
    this._refillPlaytestSuper(player);
  }
  setupPlayerSocket(socket) {
    super.setupPlayerSocket(socket);
    if (this.matchData.editorFullBattle) return;
    this.onSocket(socket, SOCKET_EVENTS.GAME_READY, () => {
      if (!this._loopRunning) {
        this.gameMode?.onStart?.();
        this.startGameLoop();
      }
    });
    this.onSocket(socket, SOCKET_EVENTS.EDITOR_SELF_KILL, () => {
      this.resetToSpawn(this.players.get(socket.id));
    });
  }
  requestSpecial(id, payload = {}) {
    const used = super.requestSpecial(id, payload);
    if (used) this._refillPlaytestSuper(getParticipant(this, id));
    return used;
  }
  resetToSpawn(player) {
    if (!this.matchData.editorSoloPlaytest || this.status !== "active" || !player?.loaded) return;
    const position = this.spawnStateFor(player);
    if (!position) return;

    // There is only one fighter in a solo playtest, so all pending and active
    // combat in the room belongs to this reset.
    this._scheduledActions.length = 0;
    this.activeAttacks = [];
    characterCombat.dispose(this);
    this.damageHitboxes?.clear();
    player.flip = false;
    clearTimeout(player._respawnTimeout);
    player._respawnTimeout = null;
    respawnPlayer(this, player, { position, spawnReset: true });
    // Acknowledge the teleport so in-flight movement samples from the old
    // position cannot move the fighter back.
    correctPosition(this, player, player._lastPositionSeq, { reason: "spawn-reset", grounded: player.grounded });
    this.broadcastWorldState();
  }
}
class MapPlaytestService {
  constructor() {
    this.sessions = new Map();
    this.namespace = null;
  }
  attach(io, authenticate, isAdminUser, navigation = null) {
    this.navigation = navigation;
    const ns = io.of("/map-playtest");
    this.namespace = ns;
    ns.use(async (socket, next) => {
      try {
        const session = this.sessions.get(socket.handshake.auth?.session);
        const user = await authenticate(socket);
        if (
          !session ||
          Date.now() > session.expiresAt ||
          !user ||
          !isAdminUser(user) ||
          Number(user.user_id) !== session.ownerId
        )
          return next(Error("Admin playtest session required"));
        socket.data.user = user;
        socket.data.editorSession = session;
        next();
      } catch (e) {
        next(Error("Unable to authenticate playtest"));
      }
    });
    ns.on(SOCKET_EVENTS.CONNECTION, (socket) => {
      const session = socket.data.editorSession,
        room = session.room;
      socket.on(
        SOCKET_EVENTS.GAME_JOIN,
        defineSocketHandler(async (data, cb) => {
          try {
            if (Number(data?.matchId) !== room.matchId) throw Error("Wrong playtest room");
            if (!isCompatibleClient(room, data))
              throw Object.assign(Error("Reload the game client"), {
                code: "CLIENT_UPDATE_REQUIRED",
              });
            await room.addPlayer(socket, socket.data.user);
            if (!room.matchData.editorFullBattle) {
              room.initializeSpawnPositions();
              room.sendGameStateToPlayer(socket);
            }
            cb?.({ ok: true, matchId: room.matchId });
            socket.emit(SOCKET_EVENTS.GAME_JOINED, { ok: true, matchId: room.matchId });
          } catch (e) {
            cb?.({ ok: false, error: e.message });
            socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: e.message, code: e.code });
          }
        }),
      );
      socket.on(SOCKET_EVENTS.DISCONNECT, () => {
        if (!room._disposed) room.removePlayer(socket, socket.data.user).catch(() => {});
      });
    });
  }
  create(
    user,
    {
      document,
      bots = false,
      fullBattle = false,
      infiniteSupers = false,
      debugHitboxes = false,
      character = DEFAULT_CHARACTER,
      skinId = null,
      spawn = null,
      modeVariantId = null,
    },
  ) {
    fullBattle = fullBattle === true;
    const withBots = fullBattle || bots;
    document = upgradeDuelMap(document);
    const errors = validateDocument(document);
    if (!errors.length) errors.push(...validateAssets(document));
    if (errors.length) throw Object.assign(Error("Map validation failed"), { status: 422, errors });
    if (!this.namespace)
      throw Object.assign(Error("Playtest server is not initialized"), { status: 503 });
    if (!getAllCharacters().includes(character))
      throw Object.assign(Error("Unknown character"), { status: 400 });
    skinId = skinId || getDefaultSkinId(character);
    if (getSkinById(skinId)?.character !== character)
      throw Object.assign(Error("Unknown skin for character"), { status: 400 });
    for (const [token, session] of this.sessions)
      if (session.ownerId === Number(user.user_id) || Date.now() > session.expiresAt)
        this.remove(token);
    const arena = mapArena(document);
    if (arena.modeId === "duels" && modeVariantId != null && !isDuelFormation(modeVariantId))
      throw Object.assign(Error("Unknown duel formation"), { status: 400 });
    const variantId =
      arena.modeId === "duels" ? modeVariantId || DUEL_DEFAULT_VARIANT : arena.modeVariantId;
    const size = arena.modeId === "duels" ? duelPlayersPerTeam(variantId) : arena.playersPerTeam,
      { schemaVersion, ...map } = clone(document);
    // Play from a selected marker uses the same constrained spawn config as a normal match.
    if (spawn?.point) {
      const choices = Object.values(map.spawns.players).flat();
      if (!choices.some((p) => JSON.stringify(p) === JSON.stringify(spawn.point)))
        throw Object.assign(Error("Unknown spawn marker"), { status: 400 });
      map.spawns.players.team1[0] = clone(spawn.point);
    }
    const human = decorateParticipant({
      ...user,
      selected_skin_id_by_char: { [character]: skinId },
      team: "team1",
      char_class: character,
      level: 1,
      participantId: `user:${user.user_id}`,
    });
    const players = [
      human,
      ...(withBots ? createBotParticipants([human], size, { seed: 42 }).map(decorateParticipant) : []),
    ];
    const { modeId } = arena;
    modeVariantId = variantId;
    const matchId = Date.now();
    const snapshot = {
      mapId: document.id,
      revision: "editor-draft",
      metadata: mapSummary(document),
      map,
    };
    // Deliberately has no database capability: a playtest cannot award or persist anything.
    const database = {
      runQuery: async () => [],
      setUserStatus: async () => {},
      setPartiesStatus: async () => {},
    };
    const room = new EditorGameRoom(
      matchId,
      {
        mode: size,
        modeId,
        modeVariantId,
        map: document.id,
        players,
        editorMapSnapshot: snapshot,
        editorFullBattle: fullBattle,
        editorSoloPlaytest: !withBots,
        editorInfiniteSupers: !fullBattle && infiniteSupers === true,
        editorDebugHitboxes: debugHitboxes === true,
      },
      {
        io: {
          to: (...args) => this.namespace.to(...args),
          sockets: { sockets: this.namespace.sockets },
        },
        db: database,
        timingDiagnostics: false,
        navigation: this.navigation,
      },
    );
    if (!fullBattle) {
      room.status = "active";
      const normalPlan = room.gameMode.getRespawnPlan.bind(room.gameMode);
      room.gameMode.getRespawnPlan = (p, meta) => normalPlan(p, meta) || {
        enabled: true,
        delayMs: 1200,
        position: room.spawnStateFor(p),
      };
    }
    const token = randomUUID();
    const session = {
      token,
      ownerId: Number(user.user_id),
      room,
      expiresAt: Date.now() + 60 * 60 * 1000,
      gameData: {
        matchId,
        mode: size,
        modeId,
        modeVariantId,
        map: document.id,
        mapSnapshot: snapshot,
        editorPlaytest: true,
        editorFullBattle: fullBattle,
        editorDebugHitboxes: debugHitboxes === true,
        editorSoloPlaytest: !withBots,
        yourName: user.name,
        yourTeam: "team1",
        yourCharacter: character,
        isAdmin: true,
        isGuest: false,
        players: [],
      },
    };
    // Never expose the account row (password hashes, auth state) in a game roster.
    session.gameData.players = players.map((p) => ({
      name: p.name,
      user_id: p.user_id,
      participantId: p.participantId,
      isBot: p.isBot,
      team: p.team,
      char_class: p.char_class,
      level: p.level,
      selected_skin_id: p.selected_skin_id,
      selected_skin_asset_url: p.selected_skin_asset_url,
      selected_skin_game_assets: p.selected_skin_game_assets,
      stats: {
        health: getHealth(p.char_class, p.level),
        damage: getDamage(p.char_class, p.level),
        specialDamage: getSpecialDamage(p.char_class, p.level),
      },
    }));
    session.timer = setTimeout(() => this.remove(token), 60 * 60 * 1000);
    session.timer.unref?.();
    this.sessions.set(token, session);
    return { session: token, matchId };
  }
  get(token, user) {
    const s = this.sessions.get(token);
    if (!s || s.ownerId !== Number(user.user_id) || Date.now() > s.expiresAt)
      throw Object.assign(Error("Playtest not found"), { status: 404 });
    return s;
  }
  dispose() {
    for (const token of this.sessions.keys()) this.remove(token);
    this.namespace = null;
    this.navigation = null;
  }
  remove(token) {
    const s = this.sessions.get(token);
    if (!s) return;
    clearTimeout(s.timer);
    s.room.cleanup();
    this.namespace?.in(roomChannel(s.room.matchId)).disconnectSockets(true);
    this.sessions.delete(token);
  }
}
module.exports = { MapPlaytestService };
