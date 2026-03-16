const path = require("path");
const bcrypt = require("bcrypt");
const { capacityFromMode } = require("../helpers/utils");
const { selectPartyById, emitRoster } = require("../helpers/party");
const { getUserLiveMatch } = require("../helpers/match");
const { createPartyStateService } = require("../services/partyStateService");

function registerRoutes({ app, io, db, auth, pageRoot, distDir }) {
  const { getOrCreateCurrentUser, requireCurrentUser, isGuest } = auth;
  const partyState = createPartyStateService({ db, io });

  app.get("/partyfull", (req, res) => {
    res.sendFile(path.join(pageRoot, "Errors", "partyfull.html"));
  });
  app.get("/cannotjoin", (req, res) => {
    res.sendFile(path.join(pageRoot, "Errors", "cannotjoin.html"));
  });
  app.get("/partynotfound", (req, res) => {
    res.sendFile(path.join(pageRoot, "Errors", "partynotfound.html"));
  });
  app.get("/signed-out", (req, res) => {
    res.sendFile(path.join(pageRoot, "Errors", "signed-out.html"));
  });
  app.get("/signup", (req, res) => {
    res.sendFile(path.join(distDir, "signup.html"));
  });
  app.get("/login", (req, res) => {
    res.sendFile(path.join(distDir, "login.html"));
  });

  app.get("/", async (req, res) => {
    try {
      const [user] = await getOrCreateCurrentUser(req, res, {
        autoCreate: true,
      });

      const rows = await db.runQuery(
        "SELECT party_id FROM party_members WHERE name = ? LIMIT 1",
        [user?.name],
      );
      if (rows.length) return res.redirect(`/party/${rows[0].party_id}`);
    } catch (e) {
      console.error(e);
    }
    res.sendFile(path.join(pageRoot, "index.html"));
  });

  app.get("/party/:partyid", async (req, res) => {
    try {
      const [user] = await getOrCreateCurrentUser(req, res, {
        autoCreate: true,
      });

      const rows = await db.runQuery(
        "SELECT 1 FROM parties WHERE party_id = ? LIMIT 1",
        [req.params.partyid],
      );
      if (!rows.length)
        return res.sendFile(path.join(distDir, "Errors", "partynotfound.html"));
    } catch (e) {
      console.error(e);
    }
    res.sendFile(path.join(pageRoot, "index.html"));
  });

  app.get("/game/:matchid", async (req, res) => {
    try {
      const rows = await db.runQuery(
        "SELECT 1 FROM matches WHERE match_id = ? LIMIT 1",
        [req.params.matchid],
      );
      if (!rows.length)
        return res.sendFile(path.join(distDir, "Errors", "gamenotfound.html"));
    } catch (e) {
      console.error(e);
    }
    res.sendFile(path.join(pageRoot, "game.html"));
  });

  app.post("/status", async (req, res) => {
    try {
      const [user, userType] = await getOrCreateCurrentUser(req, res, {
        autoCreate: true,
      });
      // Normalize JSON fields for cross-environment consistency (e.g., MariaDB vs MySQL JSON)
      const userNormalized = user ? { ...user } : null;
      if (userNormalized && typeof userNormalized.char_levels === "string") {
        try {
          userNormalized.char_levels = JSON.parse(
            userNormalized.char_levels || "{}",
          );
        } catch (_) {
          userNormalized.char_levels = {};
        }
      }
      const partyRows = await db.runQuery(
        "SELECT party_id FROM party_members WHERE name = ? LIMIT 1",
        [userNormalized?.name],
      );

      // Check for live match
      const liveMatchId = await getUserLiveMatch(db, userNormalized?.user_id);

      res.json({
        success: true,
        userData: userNormalized,
        newlyCreated: userType === "new",
        guest: isGuest(userNormalized),
        party_id: partyRows[0]?.party_id ?? null,
        live_match_id: liveMatchId,
      });
    } catch (e) {
      console.error(e);
      res
        .status(500)
        .json({ success: false, message: "Internal server error" });
    }
  });

  // app.get("/me", async (req, res) => {
  //   try {
  //     const user = await requireCurrentUser(req, res);
  //     if (!user)
  //       return res.json({ authenticated: false, name: "Guest", isGuest: true });
  //     res.json({
  //       authenticated: true,
  //       name: user.name,
  //       isGuest: isGuest(user),
  //       userId: user.user_id,
  //     });
  //   } catch (e) {
  //     res.json({ authenticated: false, name: "Guest", isGuest: true });
  //   }
  // });

  app.post("/create-party", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const username = user.name;

      const partyId = await partyState.createPartyForUser(username);

      console.log(`[party] Party ${partyId} created by ${username}`);
      res.status(201).json({ partyId });
    } catch (err) {
      console.error(`[party] Failed to create party:`, err.message);
      if (err?.code === "ER_DUP_ENTRY")
        return res.status(409).json({ error: "Duplicate membership" });
      res.status(500).json({ error: "Failed to create party" });
    }
  });

  app.post("/partydata", async (req, res) => {
    const user = await requireCurrentUser(req, res);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const username = user.name;
    const partyIdRaw = req.body?.partyId;
    const partyId = Number(partyIdRaw);
    if (!Number.isFinite(partyId) || partyId <= 0) {
      return res.status(400).json({ error: "partyId is required" });
    }
    try {
      const result = await partyState.joinPartyAndGetData({
        partyId,
        username,
      });
      if (!result.ok) {
        return res.status(result.statusCode || 500).json(result.payload || {});
      }

      await req.app.locals.socketApi.moveUserSocketToParty(username, partyId);
      // If a new member joined, cancel any active matchmaking for this party (and their solo ticket if any)
      if (result.joinedNow) {
        try {
          await req.app.locals.socketApi.cancelPartyQueue(
            partyId,
            user.user_id,
          );
        } catch (_) {}
      }
      await emitRoster(io, partyId, result.party, result.members);

      res.json({
        party: result.party,
        capacity: result.capacity,
        members: result.members,
        viewer: username,
      });
    } catch (err) {
      console.error("[party] /partydata error", err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/party-members", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const { partyId } = req.body;
      if (!partyId) return res.status(400).json({ error: "Party ID required" });
      const membership = await db.runQuery(
        "SELECT 1 FROM party_members WHERE name = ? AND party_id = ? LIMIT 1",
        [user.name, partyId],
      );
      if (!membership.length)
        return res.status(403).json({ error: "Not a member of this party" });
      const party = await selectPartyById(db, partyId);
      if (!party) return res.status(404).json({ error: "Party not found" });
      const members = await db.fetchPartyMembersDetailed(partyId);
      res.json({
        partyId: party.party_id,
        mode: party.mode,
        map: party.map,
        members,
        membersCount: members.length,
        capacity: capacityFromMode(party.mode),
      });
    } catch (err) {
      console.error("[party] /party-members error", err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/leave-party", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const username = user.name;
      let partyId = req.body?.partyId;
      if (!partyId) {
        const rows = await db.runQuery(
          "SELECT party_id FROM party_members WHERE name = ? LIMIT 1",
          [username],
        );
        if (!rows.length)
          return res.json({ success: true, left: false, deleted: false });
        partyId = rows[0].party_id;
      }
      const leaveResult = await partyState.leaveParty({ partyId, username });
      if (!leaveResult.left)
        return res.json({ success: true, left: false, deleted: false });
      await req.app.locals.socketApi.moveUserSocketToLobby(username);
      console.log(
        `[party] ${username} left party ${partyId}, party deleted: ${leaveResult.deleted}`,
      );
      res.json({ success: true, left: true, deleted: leaveResult.deleted });
    } catch (e) {
      console.error("/leave-party", e);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // Game
  app.post("/gamedata", async (req, res) => {
    console.log("Fetching game data for match:", req.body);
    try {
      // Lazy import to avoid server startup circular deps
      const {
        getHealth,
        getDamage,
        getSpecialDamage,
      } = require("../../lib/characterStats.js");
      const user = await requireCurrentUser(req, res);
      if (!user) return;

      const { matchId } = req.body;
      if (!matchId) {
        return res.status(400).json({
          success: false,
          error: "Match ID required",
        });
      }

      // Verify user is participant in this match
      const participantRows = await db.runQuery(
        "SELECT mp.*, m.mode, m.map, m.status FROM match_participants mp JOIN matches m ON m.match_id = mp.match_id WHERE mp.match_id = ? AND mp.user_id = ?",
        [matchId, user.user_id],
      );

      if (!participantRows.length) {
        return res.status(403).json({
          success: false,
          error: "You are not a participant in this match",
        });
      }

      const participant = participantRows[0];

      // Check if match is live
      if (participant.status !== "live") {
        return res.status(400).json({
          success: false,
          error: "Match is not live yet",
        });
      }

      // Get all participants for this match; levels are stored per-character in users.char_levels (JSON)
      const allParticipants = await db.runQuery(
        `SELECT mp.user_id, mp.party_id, mp.team, mp.char_class, u.name, u.char_levels
           FROM match_participants mp
           JOIN users u ON u.user_id = mp.user_id
          WHERE mp.match_id = ?`,
        [matchId],
      );

      // Prepare game data
      const gameData = {
        matchId: Number(matchId),
        mode: participant.mode,
        map: participant.map,
        yourName: user.name,
        yourTeam: participant.team,
        yourCharacter: participant.char_class,
        players: allParticipants.map((p) => {
          let level = 1;
          try {
            const levels =
              typeof p.char_levels === "string"
                ? JSON.parse(p.char_levels || "{}")
                : p.char_levels || {};
            const lv = levels && levels[p.char_class];
            level = Number(lv) > 0 ? Number(lv) : 1;
          } catch (_) {
            level = 1;
          }
          return {
            user_id: p.user_id,
            name: p.name,
            team: p.team,
            char_class: p.char_class,
            level,
            stats: {
              health: getHealth(p.char_class, level),
              damage: getDamage(p.char_class, level),
              specialDamage: getSpecialDamage(p.char_class, level),
            },
          };
        }),
      };

      res.json({
        success: true,
        gameData,
      });
    } catch (error) {
      console.error("gamedata error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  });

  // Auth
  const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,14}$/;
  const MIN_PW = 6;
  const MAX_PW = 32;
  const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;

  app.post("/signup", async (req, res) => {
    try {
      let { username, password } = req.body || {};
      username = typeof username === "string" ? username.trim() : "";
      password = typeof password === "string" ? password : "";
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: "Username and password are required.",
        });
      }
      if (!USERNAME_RE.test(username)) {
        return res.status(400).json({
          success: false,
          error: "Username must be 3-14 chars: letters, numbers, _ . - only.",
        });
      }
      if (password.length < MIN_PW || password.length > MAX_PW) {
        return res.status(400).json({
          success: false,
          error: `Password must be ${MIN_PW}-${MAX_PW} characters.`,
        });
      }
      const user = await requireCurrentUser(req, res);
      if (!user)
        return res
          .status(400)
          .json({ success: false, error: "Guest session not found." });
      if (user.expires_at === null)
        return res.status(400).json({
          success: false,
          error: "This account is already permanent.",
        });
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      try {
        const result = await db.runQuery(
          `UPDATE users
             SET name = ?, password = ?, expires_at = NULL
           WHERE user_id = ?`,
          [username, hash, user.user_id],
        );
        if (!result || result.affectedRows !== 1) {
          return res.status(409).json({
            success: false,
            error: "Unable to complete signup. Please try again.",
          });
        }
      } catch (err) {
        if (err && (err.code === "ER_DUP_ENTRY" || err.errno === 1062)) {
          return res
            .status(409)
            .json({ success: false, error: "Username is already taken." });
        }
        throw err;
      }
      res.cookie(
        "display_name",
        username,
        app.locals?.DISPLAY_COOKIE_OPTS || {},
      );
      return res.status(201).json({ success: true, username });
    } catch (error) {
      console.error("[auth] signup error:", error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });

  app.post("/login", async (req, res) => {
    try {
      let { username, password } = req.body || {};
      username = typeof username === "string" ? username.trim() : "";
      password = typeof password === "string" ? password : "";
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: "Username and password are required.",
        });
      }
      const rows = await db.runQuery(
        "SELECT user_id, name, password FROM users WHERE name = ? AND expires_at IS NULL LIMIT 1",
        [username],
      );
      if (rows.length === 0) {
        return res
          .status(401)
          .json({ success: false, error: "Invalid username or password." });
      }
      const user = rows[0];
      const ok = await bcrypt.compare(password, user.password || "");
      if (!ok) {
        return res
          .status(401)
          .json({ success: false, error: "Invalid username or password." });
      }
      res.cookie("user_id", String(user.user_id), {
        ...(app.locals?.SIGNED_COOKIE_OPTS || {}),
        maxAge: 1000 * 60 * 60 * 24 * 20,
      });
      res.cookie(
        "display_name",
        user.name,
        app.locals?.DISPLAY_COOKIE_OPTS || {},
      );
      return res
        .status(200)
        .json({ success: true, userId: user.user_id, username: user.name });
    } catch (err) {
      console.error("[auth] login error:", err);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });

  app.post("/logout", (req, res) => {
    try {
      res.clearCookie("user_id", app.locals?.SIGNED_COOKIE_OPTS || {});
      res.clearCookie("display_name", app.locals?.DISPLAY_COOKIE_OPTS || {});
    } catch (_) {}
    return res.status(200).json({ success: true });
  });

  // Not found endpoint
  app.use((req, res) => {
    return res.sendFile(path.join(pageRoot, "Errors", "404.html"));
  });
}

module.exports = { registerRoutes };
