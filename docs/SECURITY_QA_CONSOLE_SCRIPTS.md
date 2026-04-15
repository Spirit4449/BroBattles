# Security QA Console Scripts

These scripts are for defensive testing in your own environment so you can find weak validation points and harden them.

## Before You Start

1. Start your app and open it in the browser while authenticated.
2. Open DevTools Console.
3. Paste one script at a time and press Enter.
4. Watch both browser console output and server logs.
5. If a script says it cannot find the socket, run the socket helper first.

## Socket Helper

### What it does

Finds the active Socket.IO client if the app has already connected it, even when it is not exposed as `window.socket`.

### How to use

1. Paste this helper into the console once.
2. Run `window.__bbGetSocket()`.
3. If it prints a socket object, run the test script.
4. If it prints `null`, open the game or lobby page that actually creates the socket first.

```js
(function () {
  window.__bbGetSocket = function () {
    const direct = [
      window.socket,
      window.ioSocket,
      window.__socket,
      window.__bbSocket,
    ];
    for (const candidate of direct) {
      if (candidate && typeof candidate.emit === "function") {
        console.log("Found socket via window reference:", candidate);
        return candidate;
      }
    }

    const chunkKey = Object.keys(window).find(
      (key) => /^webpackChunk/.test(key) && Array.isArray(window[key]),
    );
    if (chunkKey) {
      try {
        const chunk = window[chunkKey];
        let webpackRequire = null;
        chunk.push([
          [Math.random()],
          {},
          (req) => {
            webpackRequire = req;
          },
        ]);

        if (webpackRequire && webpackRequire.c) {
          for (const moduleId of Object.keys(webpackRequire.c)) {
            const exports = webpackRequire.c[moduleId]?.exports;
            const candidate = exports?.default || exports;
            if (
              candidate &&
              typeof candidate.emit === "function" &&
              typeof candidate.on === "function"
            ) {
              console.log("Found socket via webpack module cache:", candidate);
              window.__bbSocket = candidate;
              return candidate;
            }
          }
        }
      } catch (error) {
        console.warn("Webpack socket lookup failed:", error?.message || error);
      }
    }

    console.warn(
      "No socket reference found. Open the lobby or game page after /status runs, then try again.",
    );
    return null;
  };

  console.log(
    "Socket helper installed. Use window.__bbGetSocket() to find the active socket.",
  );
})();
```

---

## 1) REST Boundary Tester

### What it does

Sends malformed or unusual payloads to economy, trophy, and selection endpoints and summarizes which were accepted or rejected.

### How to use

1. Open a page where your login cookies are active.
2. Paste the script below into console.
3. Check the table output. Any malformed payload returning success is worth reviewing.

````js
(function () {
  const tests = [
    {
      url: "/upgrade",
      body: { character: "" },
      label: "upgrade empty character",
    },
    {
      url: "/upgrade",
      body: { character: "../../etc/passwd" },
      label: "upgrade path-like character",
    },
    {
      url: "/upgrade",
      body: { character: "wizard<script>alert(1)</script>" },
      label: "upgrade script-like character",
    },
    {
      url: "/upgrade",
      body: { character: "ninja", extra: "unexpected-field" },
      label: "upgrade extra field",
    },
    { url: "/buy", body: { character: "" }, label: "buy empty character" },
    {
      url: "/buy",
      body: { character: "not_a_real_character_1234567890" },
      label: "buy unknown character",
    },
    { url: "/trophies/claim", body: { tierId: "" }, label: "claim empty tier" },
    {
      url: "/trophies/claim",
      body: { tierId: "tier_999999" },
      label: "claim fake tier",
    },
    {
      url: "/selection-preferences",
      body: {
        selection: {
          modeId: -999,
          mapId: "drop table",
          modeVariantId: "<bad>",
        },
      },
      label: "selection malformed values",
    },
  ];

  (async () => {
    const results = [];
    for (const t of tests) {
      const started = performance.now();
      try {
        const res = await fetch(t.url, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(t.body),
        });
        let json = null;
        try {
          json = await res.json();
        } catch (_) {}
        results.push({
          test: t.label,
          endpoint: t.url,
          status: res.status,
          ok: res.ok,
          ms: Math.round(performance.now() - started),
          successFlag: json && json.success,
          error: (json && (json.error || json.message)) || "",
        });
      } catch (e) {
        results.push({
          test: t.label,
          endpoint: t.url,
          status: "network-error",
          ok: false,
          ms: Math.round(performance.now() - started),
          successFlag: false,
              const direct = [
                window.socket,
                window.ioSocket,
                window.__socket,
                window.__bbSocket,
              ];
              for (const candidate of direct) {
                if (candidate && typeof candidate.emit === "function") {
                  console.log("Found socket via window reference:", candidate);
                  return candidate;
                }
              }

              const chunkKey = Object.keys(window).find(
                (key) => /^webpackChunk/.test(key) && Array.isArray(window[key]),
              );
              if (chunkKey) {
                try {
                  const chunk = window[chunkKey];
                  let webpackRequire = null;
                  chunk.push([[Math.random()], {}, (req) => {
                    webpackRequire = req;
                  }]);

                  if (webpackRequire && webpackRequire.c) {
                    for (const moduleId of Object.keys(webpackRequire.c)) {
                      const exports = webpackRequire.c[moduleId]?.exports;
                      const candidate = exports?.default || exports;
                      if (
                        candidate &&
                        typeof candidate.emit === "function" &&
                        typeof candidate.on === "function"
                      ) {
                        console.log("Found socket via webpack module cache:", candidate);
                        window.__bbSocket = candidate;
                        return candidate;
                      }
                    }
                  }
                } catch (error) {
                  console.warn("Webpack socket lookup failed:", error?.message || error);
                }
              }

              console.warn(
                "No socket reference found. Open the lobby or game page after /status runs, then try again.",
              );
              return null;
1. Make sure you have test account resources such as coins, gems, or a trophy tier.
2. Paste the script and run.
3. Check status distribution and sample responses.

```js
(function () {
  const runBurst = async (url, body, count = 20) => {
    const reqs = Array.from({ length: count }, () =>
      fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(async (r) => {
          let j = null;
          try {
            j = await r.json();
          } catch (_) {}
          return { status: r.status, ok: r.ok, body: j };
        })
        .catch((e) => ({
          status: "network-error",
          ok: false,
          body: { error: String(e) },
        })),
    );

    const out = await Promise.all(reqs);
    const grouped = out.reduce((acc, row) => {
      const key = String(row.status);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    console.log("Endpoint:", url, "Payload:", body);
    console.table(grouped);
    console.log("Sample responses:", out.slice(0, 8));
    return out;
  };

  (async () => {
    console.log("Starting race tests...");
    await runBurst("/trophies/claim", { tierId: "tier_1" }, 25);
    await runBurst("/buy", { character: "wizard" }, 25);
    await runBurst("/upgrade", { character: "ninja" }, 25);
    console.log("Race tests done.");
  })();
})();
````

---

## 3) Socket Tamper Tester

### What it does

Sends forged socket events to check whether server-side authorization and ownership checks block them.

### How to use

1. Open a page where your game socket is connected.
2. Paste and run.
3. Observe callback responses and server-side warnings or rejections.

```js
(function () {
  const s = window.__bbGetSocket ? window.__bbGetSocket() : null;
  if (!s || typeof s.emit !== "function") {
    console.warn(
      "No socket object found on window. Open a page where your game socket is initialized first, then run window.__bbGetSocket().",
    );
    return;
  }

  const safeAck = (label) => (ack) => {
    console.log(label, "ack:", ack);
  };

  const fakePartyId = Number(window.partyId || 999999);

  s.emit(
    "char-change",
    { partyId: fakePartyId, charClass: "wizard" },
    safeAck("char-change forged party"),
  );
  s.emit(
    "char-change",
    { partyId: fakePartyId, charClass: "admin_only_character" },
    safeAck("char-change invalid character"),
  );
  s.emit(
    "ready:status",
    { partyId: fakePartyId, ready: true },
    safeAck("ready status forged party"),
  );
  s.emit(
    "mode-change",
    { partyId: fakePartyId, modeId: "unknown_mode", modeVariantId: "x999" },
    safeAck("mode-change malformed"),
  );
  s.emit(
    "map-change",
    { partyId: fakePartyId, selectedValue: "999999" },
    safeAck("map-change malformed"),
  );
  s.emit(
    "game:action",
    { type: "wizard-fireball", id: "forged-" + Date.now() },
    safeAck("game action without state"),
  );
  s.emit(
    "hit",
    {
      attacker: "SomeOtherPlayer",
      target: "AnotherPlayer",
      attackType: "special",
      attackTime: Date.now() + 10000,
    },
    safeAck("forged hit"),
  );
  s.emit(
    "heal",
    { source: "SomeOtherPlayer", target: "AnotherPlayer" },
    safeAck("forged heal"),
  );
  console.log(
    "Socket tamper tests dispatched. Check console and server logs for rejects vs accepts.",
  );
})();
```

---

## 4) Live Fetch Audit Hook

### What it does

Hooks fetch and logs interesting endpoint responses while you manually use the UI.

### How to use

1. Paste this once per page load.
2. Use your UI normally.
3. Read AUDIT lines for fast insight into unexpected successes.
4. Refresh the page to remove the hook.

```js
(function () {
  if (window.__fetchAuditInstalled) {
    console.log("Fetch audit already installed.");
    return;
  }
  window.__fetchAuditInstalled = true;

  const originalFetch = window.fetch.bind(window);
  const watched = [
    "/upgrade",
    "/buy",
    "/trophies/claim",
    "/selection-preferences",
    "/status",
    "/gamedata",
  ];

  window.fetch = async function (...args) {
    const input = args[0];
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const match = watched.some((w) => url.includes(w));

    const res = await originalFetch(...args);

    if (match) {
      let payload = null;
      try {
        const clone = res.clone();
        payload = await clone.json();
      } catch (_) {}

      const entry = {
        ts: new Date().toISOString(),
        url,
        status: res.status,
        ok: res.ok,
        successFlag: payload && payload.success,
        error: (payload && (payload.error || payload.message)) || "",
      };

      console.log("AUDIT", entry);

      if (res.ok && payload && payload.error) {
        console.warn(
          "Suspicious shape: HTTP ok with error payload",
          entry,
          payload,
        );
      }
    }

    return res;
  };

  console.log("Fetch audit installed. To remove, refresh page.");
})();
```

---

## 5) Infinite Ammo QA Spoof Tester

### What it does

Wraps outgoing `game:input` emits and injects a fake boosted `ammoState` so you can verify whether the server incorrectly trusts client ammo values.

### How to use

1. Open a live lobby or game page where your socket is connected.
2. Paste the script in DevTools Console and press Enter.
3. Play normally and fire repeatedly.
4. Watch for suspicious behavior and check server logs.
5. Run `window.__bbAmmoSpoofStop()` to restore socket behavior.

```js
(function () {
  const s = window.__bbGetSocket ? window.__bbGetSocket() : null;
  if (!s || typeof s.emit !== "function") {
    console.warn(
      "No socket found. Open a page where the game socket is active, then run window.__bbGetSocket().",
    );
    return;
  }

  if (window.__bbAmmoSpoofActive) {
    console.log("Ammo spoof already active.");
    return;
  }

  const originalEmit = s.emit.bind(s);
  let seq = 1;

  s.emit = function (eventName, payload, ...rest) {
    if (eventName === "game:input") {
      const p = payload && typeof payload === "object" ? payload : {};
      const boosted = {
        ...p,
        sequence: Number.isFinite(Number(p.sequence))
          ? Number(p.sequence)
          : seq++,
        timestamp: Date.now(),
        ammoState: {
          capacity: 999,
          charges: 999,
          cooldownMs: 1,
          reloadMs: 1,
          reloadTimerMs: 0,
          nextFireInMs: 0,
        },
      };
      return originalEmit(eventName, boosted, ...rest);
    }

    if (eventName === "game:action") {
      const p = payload && typeof payload === "object" ? payload : {};
      const boosted = {
        ...p,
        id: String(
          p.id ||
            `qa-ammo-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        ),
      };
      return originalEmit(eventName, boosted, ...rest);
    }

    return originalEmit(eventName, payload, ...rest);
  };

  window.__bbAmmoSpoofActive = true;
  window.__bbAmmoSpoofStop = function () {
    s.emit = originalEmit;
    window.__bbAmmoSpoofActive = false;
    console.log("Ammo spoof stopped and socket.emit restored.");
  };

  console.log("Ammo spoof active. Run window.__bbAmmoSpoofStop() to restore.");
})();
```

---

## 6) Abnormal Movement / Teleport QA Tester

### What it does

Sends rapid, unrealistic position jumps so you can validate server clamp, rejection, and movement anomaly logging.

### How to use

1. Open a live game page where your socket is connected.
2. Paste and run the script.
3. Watch if server clamps, snaps, or rejects movement updates.
4. Check server logs for movement clamp warnings.
5. Run `window.__bbMoveAbuseStop()` to stop the test loop.

```js
(function () {
  const s = window.__bbGetSocket ? window.__bbGetSocket() : null;
  if (!s || typeof s.emit !== "function") {
    console.warn(
      "No socket found. Open a page where the game socket is active, then run window.__bbGetSocket().",
    );
    return;
  }

  if (window.__bbMoveAbuseActive) {
    console.log("Movement abuse test already active.");
    return;
  }

  let seq = 1;
  const points = [
    { x: 120, y: 120 },
    { x: 3400, y: 120 },
    { x: 3400, y: 900 },
    { x: 120, y: 900 },
    { x: 1800, y: 300 },
    { x: 2600, y: 700 },
    { x: 900, y: 250 },
  ];
  let i = 0;

  const sendJump = () => {
    const p = points[i % points.length];
    const next = points[(i + 1) % points.length];
    i += 1;

    const vx = (next.x - p.x) * 8;
    const vy = (next.y - p.y) * 8;

    s.emit("game:input", {
      x: p.x,
      y: p.y,
      vx,
      vy,
      grounded: false,
      loaded: true,
      animation: "run",
      flip: vx < 0,
      sequence: seq++,
      timestamp: Date.now(),
    });
  };

  const interval = setInterval(sendJump, 80);
  sendJump();

  window.__bbMoveAbuseActive = true;
  window.__bbMoveAbuseStop = function () {
    clearInterval(interval);
    window.__bbMoveAbuseActive = false;
    console.log("Movement abuse test stopped.");
  };

  console.log(
    "Movement abuse test active. Run window.__bbMoveAbuseStop() to stop.",
  );
})();
```

---

## Suggested Positive Workflow

1. Run the socket helper first if needed.
2. Run script 1 for input validation quality.
3. Run script 2 for concurrency safety.
4. Run script 3 for socket trust boundaries.
5. Keep script 4 active while doing normal gameplay flows to spot subtle server behavior.
6. Run script 5 to test whether ammo trust is truly server-authoritative.
7. Run script 6 to test movement clamp and reject hardening.

This gives you a fast, repeatable security QA pass you can run after each backend change.
