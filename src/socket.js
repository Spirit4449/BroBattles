// Minimal singleton Socket.IO client (bundled)
import { io } from "socket.io-client";

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
const socket = io({
  withCredentials: true,
  autoConnect: false,
  transports: ["websocket"],
  upgrade: false,
  forceNew: false,
});

// Utility: call this once after /status finishes
export function ensureSocketConnected() {
  if (socket.connected || socket.connecting) {
    console.log("[socket] ensureSocketConnected skipped", getSocketDebugMeta(socket));
    return false;
  }
  console.log("[socket] ensureSocketConnected starting connect()", {
    ...getSocketDebugMeta(socket),
    withCredentials: true,
    transports: ["websocket"],
    upgrade: false,
  });
  socket.connect();
  return true;
}

// Optional: expose a promise for “connected”
export function waitForConnect(timeoutMs = 10000) {
  if (socket.connected) {
    console.log("[socket] waitForConnect immediate resolve", getSocketDebugMeta(socket));
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let done = false;

    const cleanup = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      socket.off("connect", onConnect);
      socket.off("reconnect", onConnect);
      socket.off("connect_error", onError);
      socket.off("reconnect_error", onError);
    };

    const onConnect = () => {
      if (done) return;
      console.log("[socket] waitForConnect resolved", getSocketDebugMeta(socket));
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

    socket.once("connect", onConnect);
    socket.once("reconnect", onConnect);
    socket.on("connect_error", onError);
    socket.on("reconnect_error", onError);

    // Important: if not already connecting, start handshake now
    if (!socket.connected) {
      console.log("[socket] waitForConnect forcing connect()", getSocketDebugMeta(socket));
      socket.connect();
    }
  });
}




export default socket;
