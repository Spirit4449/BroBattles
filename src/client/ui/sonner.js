import { maintenanceClock } from "../../shared/site/maintenance";
import { playSound } from "./uiSounds.js";
// Exported function: sonner(header, message, buttonText = "OK", onClick?, options?)
// Pass null for the header, or layout: "description", for a description-only toast.
// options: { duration?: number, persistent?: boolean, containerId?: string, tone?: "info"|"success"|"error", layout?: "description" }
export function friendlyToastMessage(value) {
  const message = String(value ?? "").trim();
  if (/^(?:TypeError: )?(?:failed to fetch|fetch failed|network ?error|network request failed|load failed)/i.test(message)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (/^(?:unauthorized|not authenticated|authentication required)\.?$/i.test(message)) {
    return "Please sign in again to continue.";
  }
  if (message === "New matches currently disabled for maintenance.") {
    return "Matchmaking is paused for maintenance. Please try again later.";
  }
  if (/^(?:iconId is required|Unknown iconId)\.?$/i.test(message)) {
    return "This profile icon is unavailable. Refresh the page and choose another icon.";
  }
  if (/^(?:cardId is required|Unknown cardId)\.?$/i.test(message)) {
    return "This player card is unavailable. Refresh the page and choose another card.";
  }
  if (message === "Card is not owned by this user") {
    return "Unlock this player card before equipping it.";
  }
  if (message === "Queue ticket not found.") {
    return "You're no longer in matchmaking. Please ready up again.";
  }
  if (/^(?:party not found|join request not found|join request expired)\.?$/i.test(message)) {
    return /party not found/i.test(message)
      ? "This party is no longer available. Join or create another party."
      : "This join request is no longer available.";
  }
  // Catch implementation details without replacing useful gameplay restrictions,
  // names, wait times, or instructions supplied by the server.
  if (/^(?:ER_[A-Z_]+(?::|$)|SQL(?:STATE|:|\s+(?:error|syntax|query|failed))|(?:ECONN\w+|ETIMEDOUT)(?::|$)|(?:TypeError|ReferenceError|SyntaxError):)|\bsqlMessage\b|\b(?:apply|run)\b.*\bmigration\b|Unexpected token|not valid JSON|Cannot (?:read|set) propert|Unknown column|columns? (?:are |is )?missing/i.test(message)) {
    return "Something went wrong. Please try again in a moment.";
  }
  if (/^(?:request failed|internal server error|server error|HTTP \d{3}|queue join failed|invalid ready state|unsupported join request response|missing party action data|party ID.*required|card action failed|profile icon action failed)\.?$/i.test(message)) {
    return "Please try again. If this keeps happening, refresh the page.";
  }
  return message;
}
export function sonner(
  header,
  message,
  buttonText = "OK",
  onClick,
  options = {}
) {
  // Older call sites passed the toast tone as the third argument. Treat those
  // values as tone metadata rather than exposing them as a confusing action.
  const legacyTone = ["success", "error"].includes(String(buttonText))
    ? String(buttonText)
    : null;
  if (legacyTone) buttonText = "OK";

  // A few legacy calls also supplied the options object in the fourth slot.
  // Keep their notification settings while normalizing the action label.
  if (
    onClick &&
    typeof onClick === "object" &&
    !Array.isArray(onClick) &&
    (!options || Object.keys(options).length === 0)
  ) {
    options = onClick;
    onClick = undefined;
  }

  const persistent = options.persistent === true;
  const duration = Math.max(800, Number(options.duration || 5000));
  const containerId = options.containerId || "sonner-wrap";
  const tone = ["info", "success", "error"].includes(
    String(options.tone || legacyTone || ""),
  )
    ? String(options.tone || legacyTone)
    : "info";
  let title = String(header ?? "").trim();
  let description = tone === "error"
    ? friendlyToastMessage(message)
    : String(message ?? "").trim();
  // One-sentence notices use the same readable body style, even at older
  // call sites that only passed the first argument.
  if (options.layout === "description" || !description) {
    description = description || (tone === "error" ? friendlyToastMessage(title) : title);
    title = "";
  }

  // Ensure container exists (top center)
  let wrap = document.getElementById(containerId);
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = containerId;
    wrap.className = "sonner-wrap";
    document.body.appendChild(wrap);
  }

  const el = document.createElement("div");
  const shortMessage = !title && description.length <= 90 && !description.includes("\n") && !options.maintenanceUntil;
  el.className = `sonner sonner--${tone}${title ? "" : " sonner--description"}${shortMessage ? " sonner--short" : ""}`;
  el.setAttribute("role", "alert");
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `
    <div class="sonner__content">
      <div class="sonner__hdr"></div>
      <div class="sonner__msg"></div>
    </div>
    <div class="sonner__actions"></div>
    <div class="sonner__progress"></div>
  `;
  const headerNode = el.querySelector(".sonner__hdr");
  const messageNode = el.querySelector(".sonner__msg");
  if (title) headerNode.textContent = title;
  else headerNode.remove();
  if (description || options.maintenanceUntil) messageNode.textContent = description;
  else messageNode.remove();

  let countdownTimer;
  if (options.maintenanceUntil) {
    const updateCountdown = () => { messageNode.textContent = `${description} ◷ ${maintenanceClock(options.maintenanceUntil)} remaining`; };
    updateCountdown(); countdownTimer = setInterval(updateCountdown, 1000);
  }

  // Button
  const btn = document.createElement("button");
  btn.className = "sonner__btn";
  btn.textContent = String(buttonText ?? "OK");

  // Close logic
  let closed = false;
  let timer = null;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.remove("show");
    // remove after transition
    setTimeout(() => {
      el.remove();
      if (!wrap.children.length) wrap.remove();
    }, 280);
    if (timer) clearTimeout(timer);
    if (countdownTimer) clearInterval(countdownTimer);
  };

  btn.addEventListener("click", () => {
    try {
      if (typeof onClick === "function") onClick(close);
      else close(); // default: button closes
    } catch {
      close();
    }
  });

  el.querySelector(".sonner__actions").appendChild(btn);

  // Progress bar countdown
  const bar = el.querySelector(".sonner__progress");
  if (persistent) bar.remove();
  else bar.style.setProperty("--sonner-duration", duration + "ms");

  // Insert newest first
  wrap.insertBefore(el, wrap.firstChild || null);

  // Force initial styles to apply before toggling .show to ensure smooth transition
  // This avoids the first-toast jank when the container is created this frame.
  void el.offsetWidth; // style/layout flush
  // Animate in next frame for extra safety
  requestAnimationFrame(() => {
    el.classList.add("show");
    if (!persistent) bar.classList.add("anim");
  });

  // Auto-close
  if (!persistent) timer = setTimeout(close, duration);

  // Optional notification sound
  if (options.sound) {
    const volume = Number.isFinite(Number(options.soundVolume))
      ? Number(options.soundVolume)
      : 0.6;
    playSound(options.sound, volume);
  }

  // Click outside to dismiss (optional—comment out if undesired)
  // el.addEventListener("click", (e) => {
  //   if (e.target === el) close();
  // });

  return { close, el };
}
