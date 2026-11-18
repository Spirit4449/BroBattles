import { BROWSER_GLOBALS, getPageScope } from "./globals.cjs";
import { SOCKET_EVENTS } from "../../shared/net/socketEvents.js";
// Minimal singleton Socket.IO client (bundled)
import { io } from "socket.io-client";
import { readNetTraceSpec } from "./netTraceSpec";
import { readNetFlags } from "./netFlags";

function getSocketDebugMeta(socket) {
  const location =
    typeof window !== "undefined" && window.location
      ? {
          href: window.location.href,
          origin: window.location.origin,
          host: window.location.host,
          hostname: window.location.hostname,
          protocol: window.location.protocol,
        }
      : null;
  return {
    connected: socket.connected,
    active: socket.active,
    socketId: socket.id || null,
    location,
  };
}

// Use normal autoConnect so matchmaking/game listeners work immediately.
// Party code can optionally await ensureSocketConnected() if it wants to
// guarantee the handshake finished after /status completed.
const editorSession = window.location.pathname === '/map-editor/playtest' ? new URLSearchParams(window.location.search).get('session') : null;
const netTraceSpec = editorSession ? null : readNetTraceSpec();
// Keeps any net* A/B flag on this page's URL for the rest of the tab (netFlags.js).
readNetFlags();
const socket = io(editorSession ? '/map-playtest' : '/', {
  ...(editorSession ? {auth:{session:editorSession}} : {}),
  ...(netTraceSpec ? { auth: { netTrace: netTraceSpec } } : {}),
  withCredentials: true,
  autoConnect: false,
  transports: ["websocket"],
  upgrade: false,
  forceNew: false,
});

// A restriction ends lobby/game access while keeping the HTTP support session.
socket.on(SOCKET_EVENTS.AUTH_BANNED, () => window.location.replace("/banned"));
socket.on(SOCKET_EVENTS.CONNECT_ERROR, error => {
  if (error?.message === "Account banned") window.location.replace("/banned");
});

// Traced debug tabs expose the socket so the headless probe can drive the
// lobby through the same events the UI emits.
if (netTraceSpec) window[BROWSER_GLOBALS.netTraceSocket] = socket;

// A soft navigation mounts a fresh bundle; retire this screen's connection
// before the next screen authenticates and joins its room.
getPageScope()?.onDispose(() => {
  socket.removeAllListeners();
  socket.disconnect();
});

// Utility: call this once after /status finishes
export function ensureSocketConnected() {
  if (socket.connected || socket.connecting) {
    return false;
  }
  socket.connect();
  return true;
}

// Optional: expose a promise for “connected”
export function waitForConnect(timeoutMs = 10000) {
  if (socket.connected) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let done = false;

    const cleanup = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      socket.off(SOCKET_EVENTS.CONNECT, onConnect);
      socket.off(SOCKET_EVENTS.RECONNECT, onConnect);
      socket.off(SOCKET_EVENTS.CONNECT_ERROR, onError);
      socket.off(SOCKET_EVENTS.RECONNECT_ERROR, onError);
    };

    const onConnect = () => {
      if (done) return;
      cleanup();
      resolve();
    };

    const onError = (err) => {
      // don’t reject immediately, just log
      console.warn("[waitForConnect] error", err?.message || err);
      // we keep listening in case a later reconnect succeeds
    };

    const t = setTimeout(() => {
      if (done) return;
      console.warn("[socket] waitForConnect timeout", {
        timeoutMs,
        ...getSocketDebugMeta(socket),
      });
      cleanup();
      reject(new Error("waitForConnect timeout after " + timeoutMs + "ms"));
    }, timeoutMs);

    socket.once(SOCKET_EVENTS.CONNECT, onConnect);
    socket.once(SOCKET_EVENTS.RECONNECT, onConnect);
    socket.on(SOCKET_EVENTS.CONNECT_ERROR, onError);
    socket.on(SOCKET_EVENTS.RECONNECT_ERROR, onError);

    // Important: if not already connecting, start handshake now
    if (!socket.connected) {
      socket.connect();
    }
  });
}




export default socket;
