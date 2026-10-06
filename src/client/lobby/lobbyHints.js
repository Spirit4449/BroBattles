// Lobby tooltip hints: guest sign-up nudge, mode variety, featured sale and
// suggested public parties.
import { createLobbyHintController, getRecentModeStreak } from "./lobbyHintController.mjs";
import { fetchLobbyJson } from "./ui";
import { getDiscoveryModeLabel } from "./party/partyOverlays.js";
import { buildProfileIconUrl } from "../views/profileIconAssets.js";
import { resolveCharacterKey } from "../../shared/characters/characterStats.js";

async function loadLobbyHintData() {
  const profilePayload = await fetchLobbyJson("/profile/data").catch(() => ({
    profile: { totalMatches: 0, battles: [] },
  }));
  const profile = profilePayload?.profile || {};
  return {
    battleCount: Math.max(0, Number(profile.totalMatches) || 0),
    battles: Array.isArray(profile.battles) ? profile.battles : [],
  };
}

function getSaleHintPrice(price) {
  if (!price || price.type === "free") return { text: "FREE", icon: null };
  if (price.type === "money") {
    return {
      text: new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format((Number(price.amountCents) || 0) / 100),
      icon: null,
    };
  }
  const currency = price.currency === "coins" ? "coins" : "gems";
  return {
    text: Math.max(0, Number(price.amount) || 0).toLocaleString(),
    icon: `/assets/icons/${currency === "coins" ? "coin" : "gem"}.webp`,
  };
}

async function loadSuggestedParties(getExistingPartyId) {
  if (getExistingPartyId()) return [];
  const payload = await fetchLobbyJson("/party/discover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "" }),
  });
  return (Array.isArray(payload?.parties) ? payload.parties : []).filter(
    (party) => party?.suggestionEligible,
  );
}

function buildPartySuggestionHint(party) {
  const members = Array.isArray(party?.members) ? party.members : [];
  const partyName = String(
    party?.publicName ||
      (party?.ownerName ? `${party.ownerName}'s Party` : "Public Party"),
  );
  const partySize = Math.max(0, Number(party?.membersCount) || members.length);
  const capacity = Math.max(partySize, Number(party?.capacity) || partySize);
  const partyId = Number(party?.partyId);
  return {
    id: "party",
    instanceKey: `${partyId}:${members
      .map((member) => String(member?.name || ""))
      .sort()
      .join("|")}`,
    anchor: "#search-parties",
    variant: "party",
    icon: "/assets/icons/crown.webp",
    title: "Suggested Party",
    details: {
      name: partyName,
      mode: getDiscoveryModeLabel(party),
      playerCount: `${partySize}/${capacity} players`,
    },
    players: members.map((member) => ({
      name: String(member?.name || "Player"),
      icon: buildProfileIconUrl(
        String(member?.profile_icon_id || "") || null,
        resolveCharacterKey(member?.char_class),
      ),
      trophies: Math.max(0, Number(member?.trophies) || 0),
    })),
    actionLabel: "JOIN",
    actionVariant: "join",
    priority: Number(party?.suggestionScore) || 0,
    cooldownMs: 50_000,
    repeatMs: 3 * 60_000,
    onAction: () => {
      if (Number.isFinite(partyId) && partyId > 0) {
        window.location.assign(`/party/${partyId}`);
      }
    },
  };
}

function startPartySuggestionMonitor(controller, context, getExistingPartyId) {
  if (getExistingPartyId()) return;
  controller.repeat(
    async () => {
      try {
        const parties = await loadSuggestedParties(getExistingPartyId);
        controller.showTimedBest(
          parties.map(buildPartySuggestionHint),
          { ...context, minGapMs: 45_000 },
        );
      } catch (_) {}
    },
    {
      initialDelayMs: 6000 + Math.round(Math.random() * 4000),
      minIntervalMs: 18_000,
      maxIntervalMs: 32_000,
    },
  );
}

// `getExistingPartyId` is re-read on every suggestion tick: joining a party
// stops suggestions.
export async function initializeLobbyHints({ shop, userData, guest, newGuestCreated, getExistingPartyId }) {
  const controller = createLobbyHintController({
    storageKey: `bb_lobby_hints_v1:${userData?.user_id || userData?.name || "guest"}`,
  });

  if (guest && newGuestCreated) {
    controller.schedule(
      [
        {
          id: "guest",
          anchor: "#username-button",
          icon: "/assets/profile-icons/anonymous-guest.webp",
          title: "Playing as Guest",
          message: "Sign up to save your progress.",
          priority: 100,
          cooldownBattles: Number.MAX_SAFE_INTEGER,
        },
      ],
      { battleCount: 0 },
      2000,
    );
  }

  const startedAt = performance.now();
  const [hintData, featuredSale] = await Promise.all([
    loadLobbyHintData(),
    shop.getFeaturedSale().catch(() => null),
  ]);
  const modeStreak = getRecentModeStreak(hintData.battles);
  const saleOffer = featuredSale?.offer || null;
  const context = {
    ...hintData,
    modeStreak,
    inParty: !!getExistingPartyId(),
    hintGapBattles: 3,
  };
  const hints = [
    {
      id: "mode-variety",
      anchor: "#mode-picker-open",
      icon: "/assets/ui/switch-mode.webp",
      title: "Try something new!",
      message: "Switch modes to keep every battle fresh and exciting.",
      priority: 30,
      cooldownBattles: 10,
      when: ({ inParty, modeStreak: streak }) =>
        !inParty && Number(streak?.count) >= 5,
    },
    {
      id: "sales",
      anchor: "#shop-button",
      align: "end",
      variant: "sale",
      icon: "/assets/ui/sale-tag.webp",
      title: String(saleOffer?.name || "Featured Sale"),
      badge: "LIMITED SALE",
      price: getSaleHintPrice(saleOffer?.price),
      countdownTo: featuredSale?.nextRefreshAt || null,
      onClick: () => void shop.openOffer(saleOffer.id),
      priority: 10,
      cooldownBattles: 4,
      when: () => !!saleOffer,
    },
  ];

  if (!(guest && newGuestCreated)) {
    controller.schedule(
      hints,
      context,
      Math.max(0, 3000 - (performance.now() - startedAt)),
    );
  }
  startPartySuggestionMonitor(controller, context, getExistingPartyId);
}
