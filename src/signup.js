import { getDisplayName } from "./lib/cookies.js";
import "./styles/accounts.css";

// -----------------------------
// Config (mirror server rules)
// -----------------------------
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,14}$/;
const MIN_PW = 6;
const MAX_PW = 32;

// -----------------------------
// DOM
// -----------------------------
const form = document.getElementById("signupForm");
const signupBtn = document.getElementById("signupBtn");
const loading = document.getElementById("loading");
const buttonText = document.getElementById("buttonText");
const errorMessage = document.getElementById("errorMessage");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");

// Display current guest name (server uses "display_name")
document.getElementById("guestName").textContent = getDisplayName();

// Accessibility hint for errors
errorMessage.setAttribute("role", "alert");
errorMessage.setAttribute("aria-live", "polite");

// -----------------------------
// Helpers
// -----------------------------
function setLoading(isLoading) {
  signupBtn.disabled = isLoading;
  loading.style.display = isLoading ? "block" : "none";
  buttonText.textContent = isLoading ? "Creating..." : "Create Account";
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = "block";
}

function hideError() {
  errorMessage.textContent = "";
  errorMessage.style.display = "none";
}

function clientValidate(username, password) {
  if (!username || !password) {
    return "Username and password are required.";
  }
  if (!USERNAME_RE.test(username)) {
    return "Username must be 3–14 chars: letters, numbers, _ . - only.";
  }
  if (password.length < MIN_PW || password.length > MAX_PW) {
    return `Password must be ${MIN_PW}–${MAX_PW} characters.`;
  }
  return null;
}

// Optional: inline validation UX
function markValidity() {
  // Username
  const u = usernameInput.value.trim();
  if (!u || !USERNAME_RE.test(u)) {
    usernameInput.setCustomValidity("Username must be 3–14 chars: letters, numbers, _ . - only.");
  } else {
    usernameInput.setCustomValidity("");
  }
  // Password
  const p = passwordInput.value;
  if (!p || p.length < MIN_PW || p.length > MAX_PW) {
    passwordInput.setCustomValidity(`Password must be ${MIN_PW}–${MAX_PW} characters.`);
  } else {
    passwordInput.setCustomValidity("");
  }
}
usernameInput.addEventListener("input", markValidity);
passwordInput.addEventListener("input", markValidity);

// -----------------------------
// Submit
// -----------------------------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  const validationError = clientValidate(username, password);
  if (validationError) {
    showError(validationError);
    return;
  }

  setLoading(true);

  try {
    const response = await fetch("/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Server only expects username/password; guest session comes from cookies.
      body: JSON.stringify({ username, password }),
      credentials: "same-origin",
    });

    // Attempt to parse body even on non-2xx (server returns JSON errors)
    let data = null;
    try {
      data = await response.json();
    } catch {
      // keep null if not JSON
    }

    if (response.ok && data?.success) {
      buttonText.textContent = "Account Created!";
      // Give cookies a tick to update, then go home
      setTimeout(() => {
        window.location.href = "/";
      }, 600);
      return;
    }

    if (
      response.status === 403 &&
      (data?.banned || data?.redirect === "/banned")
    ) {
      window.location.href = "/banned";
      return;
    }

    // Map known server responses to user-friendly messages
    // Status-driven defaults:
    let msg =
      data?.error ||
      (response.status === 409
        ? "That username is taken. Try another."
        : response.status === 400
        ? "Invalid signup request."
        : "Failed to create account.");

    // Fine-grained messages from your server’s /signup code
    switch (data?.error) {
      case "Username and password are required.":
        msg = "Username and password are required.";
        break;
      case "Username must be 3-14 chars: letters, numbers, _ . - only.":
        msg = "Username must be 3–14 chars: letters, numbers, _ . - only.";
        break;
      case `Password must be ${MIN_PW}-${MAX_PW} characters.`:
        msg = `Password must be ${MIN_PW}–${MAX_PW} characters.`;
        break;
      case "Guest session not found.":
        msg = "Guest session not found. Go to the main page and try again.";
        break;
      case "This account is already permanent.":
        msg = "This account is already permanent. You can log in instead.";
        break;
      case "Username is already taken.":
        msg = "That username is taken. Try another.";
        break;
      case "Unable to complete signup. Please try again.":
        msg = "Could not complete signup. Please try again.";
        break;
      default:
        // keep msg as computed above
        break;
    }

    showError(msg);
  } catch {
    showError("Network error. Please check your connection and try again.");
  } finally {
    setLoading(false);
  }
});

// Auto-focus username field
usernameInput.focus();
