import { sonner } from '../lib/sonner.js';

// Owns the requester/owner overlays, pending requests and their expiry timers.
export function createJoinRequestController({ socket, checkIfInParty, getActivePartyId }) {
  let __joinRequestProfilePopup = null;
  let __joinRequestRequesterState = {
    partyId: null,
    payload: null,
    visible: false,
    autoJoinTimer: null,
    pendingTimer: null,
  };
  let __joinRequestOwnerState = {
    partyId: null,
    requests: [],
    visible: false,
    expiryTimer: null,
  };
  const JOIN_REQUEST_TIMEOUT_MS = 15_000;

  function getJoinRequestElements() {
    const requesterOverlay = document.getElementById(
      "party-join-request-overlay",
    );
    const ownerOverlay = document.getElementById(
      "party-join-request-owner-overlay",
    );
    return {
      requesterOverlay,
      requesterTitle: document.getElementById("party-join-request-title"),
      requesterBanner: document.getElementById("party-join-request-banner"),
      requesterOwnerName: document.getElementById("party-join-request-owner"),
      requesterPlayers: document.getElementById("party-join-request-players"),
      requesterSubmit: document.getElementById("party-join-request-submit"),
      requesterReturn: document.getElementById("party-join-request-return"),
      ownerOverlay,
      ownerTitle: document.getElementById("party-join-request-owner-title"),
      ownerList: document.getElementById("party-join-request-owner-list"),
      ownerIgnore: document.getElementById("party-join-request-owner-ignore"),
    };
  }

  function updateJoinRequestChatVisibility() {
    const hasOverlay =
      !!__joinRequestRequesterState.visible || !!__joinRequestOwnerState.visible;
    document.body.classList.toggle("join-request-overlay-open", hasOverlay);
  }

  function getRequesterPartyLabel(payload) {
    const party = payload?.party || {};
    const publicName = String(
      party?.public_name || party?.publicName || "",
    ).trim();
    const ownerName = String(payload?.ownerName || "").trim();
    return (
      publicName ||
      (ownerName ? `${ownerName}'s Party` : `Party ${payload?.partyId || ""}`)
    );
  }

  function clearRequesterAutoJoinTimer() {
    if (__joinRequestRequesterState.autoJoinTimer) {
      clearTimeout(__joinRequestRequesterState.autoJoinTimer);
      clearInterval(__joinRequestRequesterState.autoJoinTimer);
      __joinRequestRequesterState.autoJoinTimer = null;
    }
  }

  function clearRequesterPendingTimer() {
    if (__joinRequestRequesterState.pendingTimer) {
      clearTimeout(__joinRequestRequesterState.pendingTimer);
      __joinRequestRequesterState.pendingTimer = null;
    }
  }

  function setRequesterOverlayVisible(visible) {
    const { requesterOverlay } = getJoinRequestElements();
    if (!requesterOverlay) return;
    requesterOverlay.classList.toggle("hidden", !visible);
    requesterOverlay.setAttribute("aria-hidden", visible ? "false" : "true");
    updateJoinRequestChatVisibility();
  }

  function setOwnerOverlayVisible(visible) {
    const { ownerOverlay } = getJoinRequestElements();
    if (!ownerOverlay) return;
    ownerOverlay.classList.toggle("hidden", !visible);
    ownerOverlay.setAttribute("aria-hidden", visible ? "false" : "true");
    updateJoinRequestChatVisibility();
  }

  function clearOwnerExpiryTimer() {
    if (__joinRequestOwnerState.expiryTimer) {
      clearTimeout(__joinRequestOwnerState.expiryTimer);
      __joinRequestOwnerState.expiryTimer = null;
    }
  }

  function buildRequesterBannerText(payload, state) {
    const status = String(
      state?.status || payload?.status || "none",
    ).toLowerCase();
    if (status === "pending")
      return "Your request is waiting for the party owner.";
    if (status === "accepted") return "Your request was accepted.";
    if (Number(state?.attemptsRemaining) <= 0) {
      return "Please request later or ask the owner to invite you.";
    }
    return "This party is private. Request access to continue.";
  }

  function renderRequesterJoinRequestScreen(payload) {
    const {
      requesterTitle,
      requesterBanner,
      requesterOwnerName,
      requesterPlayers,
      requesterSubmit,
    } = getJoinRequestElements();

    const requestState = payload?.requestState || {};
    const state = {
      ...requestState,
      requestCount: Math.max(0, Number(requestState.requestCount) || 0),
      attemptsRemaining:
        requestState.attemptsRemaining == null
          ? 4
          : Math.max(0, Number(requestState.attemptsRemaining) || 0),
      canRequest:
        typeof requestState.canRequest === "boolean"
          ? requestState.canRequest
          : true,
      status: String(
        requestState.status || payload?.status || "none",
      ).toLowerCase(),
    };

    if (requesterTitle) {
      requesterTitle.textContent = getRequesterPartyLabel(payload);
    }
    if (requesterBanner) {
      requesterBanner.textContent = buildRequesterBannerText(payload, state);
      requesterBanner.dataset.status = state.status || "none";
    }
    if (requesterOwnerName) {
      requesterOwnerName.textContent = String(payload?.ownerName || "Unknown");
    }
    if (requesterPlayers) {
      const memberCount = Number(payload?.memberCount) || 0;
      const capacity = Number(payload?.capacity?.total) || 0;
      requesterPlayers.textContent =
        capacity > 0 ? `${memberCount}/${capacity}` : String(memberCount);
    }
    if (requesterSubmit) {
      const canRequest =
        state.status !== "pending" &&
        state.canRequest &&
        state.status !== "accepted";
      requesterSubmit.disabled = !canRequest;
      requesterSubmit.textContent =
        state.status === "accepted"
          ? "Accepted"
          : state.status === "pending"
            ? "Request Sent"
            : state.attemptsRemaining <= 0
              ? "Request Unavailable"
              : "Request to Join";
    }

    clearRequesterPendingTimer();
    if (state.status === "pending") {
      const requestedAtMs = payload?.requestState?.requestedAt
        ? new Date(payload.requestState.requestedAt).getTime()
        : Date.now();
      const msUntilTimeout = Math.max(
        0,
        JOIN_REQUEST_TIMEOUT_MS - (Date.now() - requestedAtMs),
      );
      __joinRequestRequesterState.pendingTimer = window.setTimeout(() => {
        const currentPayload = __joinRequestRequesterState.payload || {};
        renderRequesterJoinRequestScreen({
          ...currentPayload,
          requestState: {
            ...(currentPayload.requestState || {}),
            status: "none",
            canRequest: true,
          },
          status: "none",
        });
      }, msUntilTimeout || 0);
    }

    __joinRequestRequesterState.partyId =
      Number(
        payload?.party?.party_id || payload?.party?.partyId || payload?.partyId,
      ) || null;
    __joinRequestRequesterState.payload = payload || null;
    __joinRequestRequesterState.visible = true;
    setRequesterOverlayVisible(true);
  }

  async function submitJoinRequestForCurrentParty() {
    const partyId = Number(
      __joinRequestRequesterState.partyId || checkIfInParty(),
    );
    if (!partyId) return;
    const submitBtn = document.getElementById("party-join-request-submit");
    if (submitBtn) submitBtn.disabled = true;
    try {
      const response = await fetch("/party/join-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ partyId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 429 || response.status === 409) {
          renderRequesterJoinRequestScreen({
            ...(__joinRequestRequesterState.payload || {}),
            requestState: data?.requestState || {
              status: "none",
              attemptsRemaining: 0,
              requestCount: 4,
            },
            status: "none",
            message: data?.error || "Unable to request to join.",
          });
          return;
        }
        throw new Error(data?.error || "Unable to request to join.");
      }
      if (String(data?.requestState?.status || "").toLowerCase() === "accepted") {
        handleRequesterJoinRequestUpdate({
          partyId,
          requesterName: String(
            document.getElementById("username-text")?.textContent || "",
          ),
          status: "accepted",
          requestState: data.requestState,
          message: data?.message || "Your request was accepted.",
        });
      } else {
        renderRequesterJoinRequestScreen({
          ...(__joinRequestRequesterState.payload || {}),
          requestState: data?.requestState || {
            status: "pending",
            attemptsRemaining: 3,
            requestCount: 1,
          },
          status: data?.requestState?.status || "pending",
        });
      }
    } catch (error) {
      console.error("[party] submitJoinRequestForCurrentParty failed", error);
      sonner(
        "Join request",
        error?.message || "Unable to send request.",
        "error",
      );
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function handleRequesterJoinRequestUpdate(payload) {
    const currentPartyId = Number(
      __joinRequestRequesterState.partyId || checkIfInParty(),
    );
    const payloadPartyId = Number(payload?.partyId || payload?.party_id || 0);
    const currentUserName = String(
      document.getElementById("username-text")?.textContent || "",
    );
    const targetName = String(
      payload?.requesterName || payload?.requester_name || "",
    );
    if (!payloadPartyId || (currentPartyId && payloadPartyId !== currentPartyId))
      return;
    if (targetName && currentUserName && targetName !== currentUserName) return;

    clearRequesterAutoJoinTimer();
    const nextState = {
      ...(payload?.requestState || {}),
      status: String(
        payload?.status || payload?.requestState?.status || "accepted",
      ).toLowerCase(),
    };
    const nextPayload = {
      ...(__joinRequestRequesterState.payload || {}),
      partyId: payloadPartyId,
      requestState: nextState,
      status: nextState.status,
      message: payload?.message || null,
    };
    if (nextState.status === "rejected") {
      nextPayload.requestState = {
        ...nextState,
        status: "none",
      };
      nextPayload.status = "none";
    }
    renderRequesterJoinRequestScreen(nextPayload);
    if (nextState.status === "accepted") {
      const banner = document.getElementById("party-join-request-banner");
      if (banner) {
        let secondsLeft = 3;
        banner.textContent = `Accepted. Joining in ${secondsLeft} seconds.`;
        __joinRequestRequesterState.autoJoinTimer = window.setInterval(() => {
          secondsLeft -= 1;
          if (secondsLeft <= 0) {
            clearRequesterAutoJoinTimer();
            window.location.reload();
            return;
          }
          banner.textContent = `Accepted. Joining in ${secondsLeft} seconds.`;
        }, 1000);
      } else {
        __joinRequestRequesterState.autoJoinTimer = window.setTimeout(() => {
          window.location.reload();
        }, 3000);
      }
    }
  }

  function buildOwnerJoinRequestCard(request) {
    const card = document.createElement("article");
    card.className = "party-request-card";
    card.dataset.requestId = String(request.requestId || "");

    const header = document.createElement("div");
    header.className = "party-request-card-head";

    const copy = document.createElement("div");
    copy.className = "party-request-card-copy";
    const name = document.createElement("strong");
    name.textContent = String(request.requesterName || "Player");
    const meta = document.createElement("span");
    meta.textContent = "Wants to join your party.";
    copy.appendChild(name);
    copy.appendChild(meta);

    const status = document.createElement("div");
    status.className = "party-request-pill";
    status.textContent = String(request.userStatus || "online");

    header.appendChild(copy);
    header.appendChild(status);
    card.appendChild(header);

    const actions = document.createElement("div");
    actions.className = "party-request-card-actions";

    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "pixel-menu-button party-request-button";
    viewBtn.textContent = "View Profile";
    viewBtn.addEventListener("click", () => {
      if (__joinRequestProfilePopup?.open) {
        __joinRequestProfilePopup.open({
          username: String(request.requesterName || ""),
        });
      }
    });

    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className =
      "pixel-menu-button party-request-button party-request-accept";
    acceptBtn.textContent = "Accept";
    acceptBtn.addEventListener("click", async () => {
      await respondToJoinRequest(request.requestId, "accept");
    });

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className =
      "pixel-menu-button party-request-button party-request-reject";
    rejectBtn.textContent = "Reject";
    rejectBtn.addEventListener("click", async () => {
      await respondToJoinRequest(request.requestId, "reject");
    });

    actions.appendChild(viewBtn);
    actions.appendChild(acceptBtn);
    actions.appendChild(rejectBtn);
    card.appendChild(actions);

    return card;
  }

  function renderOwnerJoinRequestOverlay() {
    const { ownerList } = getJoinRequestElements();
    clearOwnerExpiryTimer();
    const requests = (
      Array.isArray(__joinRequestOwnerState.requests)
        ? __joinRequestOwnerState.requests
        : []
    ).filter((request) => {
      const requestedAtMs = request?.requestedAt
        ? new Date(request.requestedAt).getTime()
        : 0;
      return (
        !requestedAtMs || Date.now() - requestedAtMs < JOIN_REQUEST_TIMEOUT_MS
      );
    });
    __joinRequestOwnerState.requests = requests;
    const currentRequest = requests[0] || null;
    if (ownerList) {
      ownerList.innerHTML = "";
      if (currentRequest) {
        ownerList.appendChild(buildOwnerJoinRequestCard(currentRequest));
      }
    }

    if (currentRequest?.requestedAt) {
      const requestedAtMs = new Date(currentRequest.requestedAt).getTime();
      const msUntilExpiry = Math.max(
        0,
        JOIN_REQUEST_TIMEOUT_MS - (Date.now() - requestedAtMs),
      );
      __joinRequestOwnerState.expiryTimer = window.setTimeout(() => {
        renderOwnerJoinRequestOverlay();
      }, msUntilExpiry || 0);
    }

    __joinRequestOwnerState.visible = !!currentRequest;
    setOwnerOverlayVisible(!!currentRequest);
  }

  async function loadPendingJoinRequests(partyId) {
    const currentPartyId = Number(
      partyId || __joinRequestOwnerState.partyId || checkIfInParty(),
    );
    if (!currentPartyId) return;
    try {
      const response = await fetch("/party/join-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ partyId: currentPartyId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return;
      __joinRequestOwnerState.partyId = currentPartyId;
      __joinRequestOwnerState.requests = Array.isArray(data?.requests)
        ? data.requests
        : [];
      renderOwnerJoinRequestOverlay();
    } catch (error) {
      console.warn(
        "[party] loadPendingJoinRequests failed",
        error?.message || error,
      );
    }
  }

  async function respondToJoinRequest(requestId, response) {
    const partyId = Number(__joinRequestOwnerState.partyId || checkIfInParty());
    if (!partyId || !requestId) return;

    const existingRequest = __joinRequestOwnerState.requests.find(
      (request) => Number(request.requestId) === Number(requestId),
    );
    const existingRequestedAtMs = existingRequest?.requestedAt
      ? new Date(existingRequest.requestedAt).getTime()
      : 0;
    if (
      existingRequestedAtMs &&
      Date.now() - existingRequestedAtMs >= JOIN_REQUEST_TIMEOUT_MS
    ) {
      __joinRequestOwnerState.requests = __joinRequestOwnerState.requests.filter(
        (request) => Number(request.requestId) !== Number(requestId),
      );
      renderOwnerJoinRequestOverlay();
      return;
    }

    try {
      const result = await fetch("/party/join-request/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ partyId, requestId, response }),
      });
      const data = await result.json().catch(() => ({}));
      if (!result.ok) {
        if (result.status === 409) {
          __joinRequestOwnerState.requests =
            __joinRequestOwnerState.requests.filter(
              (request) => Number(request.requestId) !== Number(requestId),
            );
          renderOwnerJoinRequestOverlay();
          return;
        }
        throw new Error(data?.error || "Unable to update join request.");
      }
      __joinRequestOwnerState.requests = __joinRequestOwnerState.requests.filter(
        (request) => Number(request.requestId) !== Number(requestId),
      );
      renderOwnerJoinRequestOverlay();
    } catch (error) {
      sonner(
        "Join request",
        error?.message || "Unable to update join request.",
        "error",
      );
    }
  }

  function wireJoinRequestOverlayControls() {
    const { requesterSubmit, requesterReturn, ownerIgnore } =
      getJoinRequestElements();

    if (requesterSubmit && requesterSubmit.dataset.bound !== "1") {
      requesterSubmit.dataset.bound = "1";
      requesterSubmit.addEventListener("click", () => {
        void submitJoinRequestForCurrentParty();
      });
    }

    if (requesterReturn && requesterReturn.dataset.bound !== "1") {
      requesterReturn.dataset.bound = "1";
      requesterReturn.addEventListener("click", () => {
        hidePartyJoinRequestScreen();
        window.location.href = "/";
      });
    }

    if (ownerIgnore && ownerIgnore.dataset.bound !== "1") {
      ownerIgnore.dataset.bound = "1";
      ownerIgnore.addEventListener("click", () => {
        __joinRequestOwnerState.requests =
          __joinRequestOwnerState.requests.slice(1);
        renderOwnerJoinRequestOverlay();
      });
    }
  }

  function showPartyJoinRequestScreen(payload) {
    clearRequesterAutoJoinTimer();
    __joinRequestRequesterState.partyId =
      Number(
        payload?.party?.party_id ||
          payload?.party?.partyId ||
          payload?.partyId ||
          checkIfInParty(),
      ) || null;
    __joinRequestRequesterState.payload = payload || null;
    renderRequesterJoinRequestScreen(payload || {});
  }

  function hidePartyJoinRequestScreen() {
    clearRequesterAutoJoinTimer();
    clearRequesterPendingTimer();
    __joinRequestRequesterState.visible = false;
    setRequesterOverlayVisible(false);
  }


  function initialize(profilePopup) {
    __joinRequestProfilePopup = profilePopup || null;
    wireJoinRequestOverlayControls();
  }
  function registerEvents() {
    socket.on("party:join-request", (request) => {
      const currentPartyId = getActivePartyId();
      const requestPartyId = Number(request?.partyId || request?.party_id || 0);
      if (
        !requestPartyId ||
        (currentPartyId && requestPartyId !== Number(currentPartyId))
      ) {
        return;
      }

      const requesterName = String(
        request?.requesterName || request?.requester_name || "",
      );
      if (!requesterName) return;

      const normalizedRequest = {
        requestId: Number(request?.requestId || request?.request_id) || null,
        partyId: requestPartyId,
        requesterUserId:
          Number(request?.requesterUserId || request?.requester_user_id) || null,
        requesterName,
        userStatus: String(
          request?.userStatus || request?.user_status || "online",
        ),
        status: String(request?.status || "pending"),
        requestedAt: request?.requestedAt || request?.requested_at || null,
        respondedAt: request?.respondedAt || request?.responded_at || null,
      };

      const existingIndex = __joinRequestOwnerState.requests.findIndex(
        (item) => Number(item.requestId) === Number(normalizedRequest.requestId),
      );
      if (existingIndex >= 0) {
        __joinRequestOwnerState.requests[existingIndex] = normalizedRequest;
      } else {
        __joinRequestOwnerState.requests = [
          normalizedRequest,
          ...__joinRequestOwnerState.requests,
        ];
      }

      __joinRequestOwnerState.partyId = requestPartyId;
      renderOwnerJoinRequestOverlay();
    });

    socket.on("party:join-request:status", (payload) => {
      handleRequesterJoinRequestUpdate(payload);
      const partyId = Number(payload?.partyId || 0);
      if (partyId && __joinRequestOwnerState.partyId === partyId) {
        __joinRequestOwnerState.requests =
          __joinRequestOwnerState.requests.filter(
            (request) => Number(request.requestId) !== Number(payload?.requestId),
          );
        renderOwnerJoinRequestOverlay();
      }
    });


  }
  return { initialize, registerEvents, showPartyJoinRequestScreen, hidePartyJoinRequestScreen, loadPendingJoinRequests };
}
