// hud/gameOverScreenController.js

export function createGameOverScreenController({
  getGameData,
  getUsername,
  rewardStorageKey,
}) {
  function isMobileDevice() {
    try {
      const coarsePointer =
        typeof window !== "undefined" &&
        window.matchMedia?.("(pointer: coarse)")?.matches;
      const touchPoints = Number(navigator?.maxTouchPoints || 0);
      const narrowViewport = Number(window?.innerWidth || 0) <= 980;
      return !!(coarsePointer || (touchPoints > 0 && narrowViewport));
    } catch (_) {
      return !!document?.body?.classList?.contains("mobile-game-ui");
    }
  }

  function showGameOverScreen(payload) {
    const gameData = getGameData();
    const username = getUsername();
    const isMobile = isMobileDevice();

    const existing = document.getElementById("game-over-overlay");
    if (existing) existing.remove();

    const div = document.createElement("div");
    div.id = "game-over-overlay";

    const winner = payload?.winnerTeam;
    let heading = "Game Over";
    if (winner === null) heading = "Draw";
    else if (winner === gameData?.yourTeam) heading = "Victory";
    else heading = "Defeat";

    const rewards = Array.isArray(payload?.meta?.rewards)
      ? payload.meta.rewards
      : [];
    const myReward = rewards.find((r) => r.username === username);

    try {
      if (myReward) {
        sessionStorage.setItem(
          rewardStorageKey,
          JSON.stringify({
            at: Date.now(),
            coinsAwarded: Number(myReward.coinsAwarded) || 0,
            gemsAwarded: Number(myReward.gemsAwarded) || 0,
            trophiesDelta: Number(myReward.trophiesDelta) || 0,
          }),
        );
      }
    } catch (_) {}

    const escapeHtml = (val) =>
      String(val ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const baseRowStyle =
      "display:grid;grid-template-columns:2fr 1.1fr repeat(3,1fr);gap:8px;align-items:center;padding:7px 10px;border-bottom:1px solid rgba(176,219,255,0.18);font-size:clamp(11px, 2.4vw, 13px);";

    const headerRow = `
      <div style="${baseRowStyle}font-weight:600;border-bottom:1px solid rgba(176,219,255,0.3);text-transform:uppercase;font-size:11px;color:#cce8ff;font-family: "Press Start 2P", "Lato", sans-serif;">
        <div style="text-align:left;">Player</div>
        <div>Team</div>
        <div>Hits</div>
        <div>Damage</div>
        <div>Kills</div>
      </div>`;

    const rewardRowsHtml = rewards
      .map((r) => {
        const isYou = r.username === username;
        const rowStyle = `${baseRowStyle}${
          isYou
            ? "background:rgba(88,157,226,0.2);border-bottom-color:rgba(126,194,255,0.45);"
            : ""
        }`;
        const label = `${escapeHtml(r.username)}${
          isYou
            ? ' <span style="font-size:11px;color:#c3e4ff;">(You)</span>'
            : ""
        }`;
        return `
          <div style="${rowStyle}">
            <div style="text-align:left;font-weight:${isYou ? 600 : 500};">${label}</div>
            <div>${escapeHtml(String(r.team || "-").toUpperCase())}</div>
            <div>${r.hits ?? 0}</div>
            <div>${r.damage ?? 0}</div>
            <div>${r.kills ?? 0}</div>
          </div>`;
      })
      .join("");

    const rewardSectionHtml =
      !isMobile && rewards.length
        ? `
        <div style="margin-top:28px;text-align:left;">
          <h2 style="margin:0 0 10px;font-size:18px;color:#e8f4ff;font-family: "Press Start 2P", "Lato", sans-serif;">Match Results</h2>
          <div style="border:1px solid rgba(123,191,255,0.35);border-radius:10px;overflow:hidden;background:rgba(14,34,58,0.75);">
            ${headerRow}
            ${rewardRowsHtml}
          </div>
        </div>`
        : "";

    const personalSummaryHtml =
      !isMobile && myReward
        ? `
        <div style="margin-top:16px;padding:16px 18px;border-radius:10px;background:rgba(76,146,214,0.16);border:1px solid rgba(125,189,255,0.45);text-align:center;">
          <div style="font-size:15px;font-weight:600;margin-bottom:10px;color:#d7eeff;">You Earned</div>
          <div style="display:flex;justify-content:center;gap:26px;align-items:center;font-size:20px;font-weight:600;">
            <span style="display:flex;align-items:center;gap:8px;color:#facc15;"><img src="/assets/coin.webp" width="18" height="18" alt="coins" />${
              myReward.coinsAwarded ?? 0
            }</span>
            <span style="display:flex;align-items:center;gap:8px;color:#67e8f9;"><img src="/assets/gem.webp" width="18" height="18" alt="gems" />${
              myReward.gemsAwarded ?? 0
            }</span>
            <span style="display:flex;align-items:center;gap:8px;color:${
              Number(myReward.trophiesDelta) >= 0 ? "#f7d567" : "#ff9aa9"
            };"><img src="/assets/trophy.webp" width="18" height="18" alt="trophies" />${
              Number(myReward.trophiesDelta) >= 0
                ? `+${Number(myReward.trophiesDelta) || 0}`
                : Number(myReward.trophiesDelta) || 0
            }</span>
          </div>
          <div style="margin-top:6px;font-size:13px;color:#c8e6ff;">
            ${myReward.hits ?? 0} hits | ${myReward.damage ?? 0} dmg | ${
              myReward.kills ?? 0
            } kills
          </div>
        </div>`
        : "";

    div.innerHTML = `
      <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:${isMobile ? "calc(env(safe-area-inset-top) + 8px) 10px calc(env(safe-area-inset-bottom) + 10px)" : "20px"};z-index:9999;overflow:auto;background:radial-gradient(circle at 12% 14%, rgba(146,205,255,0.22), transparent 38%), rgba(5,12,20,0.72);font-family: "Press Start 2P", "Lato", sans-serif;">
        <div style="position:relative;background:linear-gradient(180deg,#204874f2,#153357f2);padding:${isMobile ? "18px 16px 16px" : "32px 48px"};border:3px solid #78bdff;border-radius:14px;width:${isMobile ? "min(520px,96vw)" : "min(490px,92vw)"};max-width:${isMobile ? "96vw" : "min(490px,92vw)"};max-height:${isMobile ? "min(82vh,760px)" : "min(760px,92vh)"};overflow:auto;text-align:center;box-shadow:0 16px 38px rgba(0,0,0,0.5), inset 0 0 0 2px rgba(220,240,255,0.2);color:#fff;">
          <div style="position:absolute;inset:8px;border:1px dashed rgba(199,230,255,0.45);border-radius:10px;pointer-events:none;"></div>
          <h1 style="margin:0 0 ${isMobile ? "10px" : "16px"};font-size:${isMobile ? "clamp(22px, 7vw, 34px)" : "48px"};letter-spacing:2px;font-family:'Press Start 2P','Lato',sans-serif;line-height:1.24;text-transform:uppercase;${
            winner === gameData?.yourTeam ? "color:#9fffc3;" : ""
          }${winner && winner !== gameData?.yourTeam ? "color:#ff9a9a;" : ""}">${heading}</h1>
          ${personalSummaryHtml || ""}
          ${rewardSectionHtml || ""}
          <button id="go-lobby" style="background:linear-gradient(180deg,#5bb2ff,#3d87df);color:#fff;font-size:${isMobile ? "12px" : "16px"};font-family:'Press Start 2P','Lato',sans-serif;padding:${isMobile ? "12px 18px" : "18px 28px"};border:1px solid #d5ecff;border-radius:12px;box-shadow:0 5px 0 #1f4f83, 0 14px 24px rgba(0,0,0,0.24);cursor:pointer;margin-top:${isMobile ? "14px" : "24px"};min-width:${isMobile ? "min(240px,82vw)" : "300px"};min-height:${isMobile ? "48px" : "64px"};">Back to Lobby (10)</button>
        </div>
      </div>`;

    document.body.appendChild(div);

    let leaving = false;
    let countdown = 10;
    const button = document.getElementById("go-lobby");

    const goToLobby = async () => {
      if (leaving) return;
      leaving = true;
      try {
        const res = await fetch("/status", { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          const pid = Number(data?.party_id);
          if (Number.isFinite(pid) && pid > 0) {
            window.location.href = `/party/${pid}`;
            return;
          }
        }
      } catch (_) {}

      try {
        const myPartyId = Number(
          (gameData?.players || []).find((p) => p.name === username)?.party_id,
        );
        if (Number.isFinite(myPartyId) && myPartyId > 0) {
          window.location.href = `/party/${myPartyId}`;
          return;
        }
      } catch (_) {}

      window.location.href = "/";
    };

    const timer = setInterval(() => {
      countdown -= 1;
      if (button)
        button.textContent = `Back to Lobby (${Math.max(0, countdown)})`;
      if (countdown <= 0) {
        clearInterval(timer);
        goToLobby();
      }
    }, 1000);

    button?.addEventListener("click", async () => {
      clearInterval(timer);
      await goToLobby();
    });
  }

  return {
    showGameOverScreen,
  };
}
