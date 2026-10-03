// Carries the occupied lobby platforms into their matchmaking seats.
// Ghost copies of each character and platform are measured in the lobby,
// flown onto the matching .mm-player, then removed once the real seat shows.
// Everything uses fixed-position ghosts so neither layout ever moves.
//
// Seats can still settle after the flight starts (platform grounding resolves
// once art loads), so each frame re-reads the seat and steers toward it.

const FLIGHT_MS = 760;
const FLIGHT_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const HANDOFF_MS = 160;
// The queue snapshot can arrive a moment after the overlay opens.
const SEAT_WAIT_MS = 1500;

const normalizeName = (value) => String(value || "").trim().toLowerCase();

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function visibleRect(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

// The box an <img> actually paints with object-fit: contain, so ghosts land on
// the drawn sprite rather than its (differently proportioned) element box.
function imageContentRect(img) {
  const box = visibleRect(img);
  if (!box || !img.naturalWidth || !img.naturalHeight) return box;
  const style = getComputedStyle(img);
  if (style.objectFit !== "contain") return box;
  const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
  const width = img.naturalWidth * scale;
  const height = img.naturalHeight * scale;
  const [x = "50%", y = "50%"] = style.objectPosition.split(" ");
  const offset = (position, free) =>
    position.endsWith("%") ? (free * parseFloat(position)) / 100 : parseFloat(position) || 0;
  const left = box.left + offset(x, box.width - width);
  const top = box.top + offset(y, box.height - height);
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function makeGhost(rect, decorate) {
  const ghost = document.createElement("div");
  ghost.className = "mm-flight-ghost";
  Object.assign(ghost.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  decorate(ghost);
  return ghost;
}

// Matches FLIGHT_EASING so the JS-driven path and the CSS filter tween agree.
function easeFlight(t) {
  const [x1, y1, x2, y2] = [0.2, 0.8, 0.2, 1];
  const bezier = (a, b, u) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  let u = t;
  for (let i = 0; i < 8; i += 1) {
    const x = bezier(x1, x2, u) - t;
    const dx = 3 * x1 * (1 - u) ** 2 + 6 * (x2 - x1) * u * (1 - u) + 3 * (1 - x2) * u * u;
    if (Math.abs(x) < 1e-4 || !dx) break;
    u = Math.min(1, Math.max(0, u - x / dx));
  }
  return bezier(y1, y2, u);
}

// Place `from` (scaled about its top-left) so its bottom-center sits on the
// point `progress` of the way to `to`'s bottom-center, at the matching width.
function flightTransform(from, to, progress) {
  const lerp = (a, b) => a + (b - a) * progress;
  const width = lerp(from.width, to.width);
  const scale = width / from.width;
  const centerX = lerp(from.left + from.width / 2, to.left + to.width / 2);
  const bottom = lerp(from.bottom, to.bottom);
  const dx = centerX - (from.left + width / 2);
  const dy = bottom - (from.top + from.height * scale);
  return `translate(${dx}px, ${dy}px) scale(${scale})`;
}

export function createPlatformFlight() {
  let sources = [];
  let layer = null;
  let pending = false;
  let pendingUntil = 0;
  let scheduled = false;
  let cleanupTimer = null;
  let frameId = 0;
  const inFlight = new Set();
  const flown = new Set();

  function clear() {
    window.clearTimeout(cleanupTimer);
    cleanupTimer = null;
    cancelAnimationFrame(frameId);
    frameId = 0;
    pending = false;
    scheduled = false;
    inFlight.clear();
    flown.clear();
    layer?.remove();
    layer = null;
    sources.forEach(({ platform }) => platform.classList.remove("mm-flown"));
    sources = [];
    document
      .querySelectorAll(".mm-player.mm-player-landing")
      .forEach((item) => item.classList.remove("mm-player-landing", "mm-player-flown"));
    document.getElementById("matchmaking-overlay")?.classList.remove("mm-has-flight");
  }

  /** Measure occupied lobby platforms before the lobby starts fading away. */
  function capture() {
    clear();
    if (prefersReducedMotion()) return;
    document.querySelectorAll("#lobby-area .platform").forEach((platform) => {
      const slot = platform.querySelector(".character-slot");
      if (!slot || slot.classList.contains("empty")) return;
      const sprite = platform.querySelector(".character-sprite");
      const base = platform.querySelector(".platform-image");
      const spriteRect = imageContentRect(sprite);
      const baseRect = visibleRect(base);
      const name = normalizeName(slot.querySelector(".username")?.textContent);
      if (!spriteRect || !baseRect || !name) return;
      sources.push({
        platform,
        name,
        spriteRect,
        spriteSrc: sprite.currentSrc || sprite.src,
        baseRect,
        baseImage: getComputedStyle(base).backgroundImage,
        baseFilter: getComputedStyle(base).filter,
        spriteFilter: getComputedStyle(sprite).filter,
      });
    });
    pending = sources.length > 0;
    pendingUntil = performance.now() + SEAT_WAIT_MS;
    if (pending) {
      // Seats appear in place instead of rising, so ghosts have fixed targets.
      document.getElementById("matchmaking-overlay")?.classList.add("mm-has-flight");
    }
  }

  function currentSeats() {
    const seats = new Map();
    document.querySelectorAll("#mm-players .mm-player:not(.placeholder)").forEach((item) => {
      const name = normalizeName(item.querySelector(".mm-name")?.textContent);
      if (name && !seats.has(name)) seats.set(name, item);
    });
    return seats;
  }

  /** Call after every grid render: starts the flight once seats exist and
      keeps re-rendered seats hidden until their ghost has landed. */
  function launch() {
    if (inFlight.size || flown.size) {
      currentSeats().forEach((item, name) => {
        if (inFlight.has(name)) item.classList.add("mm-player-landing");
        if (flown.has(name)) item.classList.add("mm-player-flown");
      });
    }
    if (!pending || scheduled) return;
    // A hidden page pauses animation frames; seats simply appear instead.
    if (document.visibilityState === "hidden") {
      clear();
      return;
    }
    const seats = currentSeats();
    if (!sources.some((source) => seats.has(source.name))) {
      if (performance.now() > pendingUntil) clear();
      return;
    }
    pending = false;
    scheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(prepareAndFly));
  }

  // Seat sprites need their natural size before they can be measured.
  async function prepareAndFly() {
    const images = [...document.querySelectorAll("#mm-players .mm-character")];
    const decoded = Promise.all(images.map((img) => img.decode?.().catch(() => {})));
    await Promise.race([decoded, new Promise((resolve) => setTimeout(resolve, 300))]);
    if (scheduled) fly();
  }

  function fly() {
    scheduled = false;
    const seats = currentSeats();
    // Settle matched seats first: no arrival burst, float held at rest.
    for (const source of sources) {
      const seat = seats.get(source.name);
      if (!seat) continue;
      seat.classList.remove("mm-player-arriving");
      seat.classList.add("mm-player-landing", "mm-player-flown");
    }

    layer = document.createElement("div");
    layer.className = "mm-flight-layer";
    layer.setAttribute("aria-hidden", "true");
    const pieces = [];
    const filterOptions = { duration: FLIGHT_MS, easing: FLIGHT_EASING, fill: "forwards" };

    for (const source of sources) {
      const seat = seats.get(source.name);
      const seatCharacter = seat?.querySelector(".mm-character");
      const seatPlatform = seat?.querySelector(".mm-platform");
      if (!seat || !imageContentRect(seatCharacter) || !visibleRect(seatPlatform)) {
        seat?.classList.remove("mm-player-landing", "mm-player-flown");
        continue;
      }

      inFlight.add(source.name);
      flown.add(source.name);
      source.platform.classList.add("mm-flown");

      const base = makeGhost(source.baseRect, (ghost) => {
        ghost.classList.add("mm-flight-platform");
        ghost.style.backgroundImage = source.baseImage;
      });
      const character = makeGhost(source.spriteRect, (ghost) => {
        const img = document.createElement("img");
        img.src = source.spriteSrc;
        img.alt = "";
        ghost.classList.add("mm-flight-character");
        ghost.appendChild(img);
      });
      layer.append(base, character);

      // Shadows travel with the flight: lobby shadow in, seat shadow and team glow out.
      base.animate([{ filter: source.baseFilter }, { filter: getComputedStyle(seatPlatform).filter }], filterOptions);
      character.animate([{ filter: source.spriteFilter }, { filter: getComputedStyle(seatCharacter).filter }], filterOptions);

      // Targets are looked up by name every frame: the seat may move or be re-rendered.
      const seatPart = (selector) => currentSeats().get(source.name)?.querySelector(selector);
      pieces.push(
        { ghost: base, from: source.baseRect, target: () => visibleRect(seatPart(".mm-platform")) },
        { ghost: character, from: source.spriteRect, target: () => imageContentRect(seatPart(".mm-character")) },
      );
    }

    if (!pieces.length) {
      clear();
      return;
    }
    document.body.appendChild(layer);

    const startedAt = performance.now();
    let landedAt = 0;
    const step = (now) => {
      if (!layer) return;
      const progress = easeFlight(Math.min(1, (now - startedAt) / FLIGHT_MS));
      for (const piece of pieces) {
        const to = piece.target();
        if (to) piece.ghost.style.transform = flightTransform(piece.from, to, progress);
      }
      if (progress >= 1 && !landedAt) {
        landedAt = now;
        land();
      }
      // Keep pinning the ghosts to their seats while they fade into them.
      if (!landedAt || now - landedAt < HANDOFF_MS) frameId = requestAnimationFrame(step);
    };
    frameId = requestAnimationFrame(step);
  }

  function land() {
    inFlight.clear();
    document
      .querySelectorAll(".mm-player.mm-player-landing")
      .forEach((item) => item.classList.remove("mm-player-landing"));
    layer.classList.add("is-landed");
    cleanupTimer = window.setTimeout(() => {
      layer?.remove();
      layer = null;
    }, HANDOFF_MS);
  }

  return { capture, launch, clear };
}
