import "../styles/ui-system.css";
import { safeReturnPath } from "../account/emailVerificationUI.js";
import { API_PATHS } from "../../shared/net/apiPaths.js";
import { initSiteShell } from "../site/shell.js";
// login.js
import "../styles/accounts.css";
import { wireFullscreenToggles } from "../ui/fullscreen.js";
import { HttpError, postJson } from "../lib/http.js";
import "../styles/ui-components.css";

initSiteShell();

wireFullscreenToggles();

// -----------------------------
// DOM
// -----------------------------
const form = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const loading = document.getElementById("loading");
const buttonText = document.getElementById("buttonText");
const errorMessage = document.getElementById("errorMessage");
const successMessage = document.getElementById("successMessage");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const requestedNext = new URLSearchParams(window.location.search).get("next");
const safeNext = safeReturnPath(requestedNext, window.location.origin);

// Accessibility for live messages
errorMessage.setAttribute("role", "alert");
errorMessage.setAttribute("aria-live", "polite");
successMessage.setAttribute("role", "status");
successMessage.setAttribute("aria-live", "polite");

// -----------------------------
// Helpers
// -----------------------------
function setLoading(isLoading) {
  loginBtn.disabled = isLoading;
  loading.style.display = isLoading ? "block" : "none";
  buttonText.textContent = isLoading ? "Logging in..." : "Login";
}

function showError(msg) {
  errorMessage.textContent = msg;
  errorMessage.style.display = "block";
  successMessage.textContent = "";
  successMessage.style.display = "none";
}

function showSuccess(msg) {
  successMessage.textContent = msg;
  successMessage.style.display = "block";
  errorMessage.textContent = "";
  errorMessage.style.display = "none";
}

// Basic client validation (keep it light; server does the real check)
function validate(username, password) {
  if (!username || !password) return "Username and password are required.";
  return null;
}

// -----------------------------
// Submit
// -----------------------------
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  const v = validate(username, password);
  if (v) {
    showError(v);
    return;
  }

  setLoading(true);

  try {
    const data = await postJson(API_PATHS.LOGIN, { username, password }, {
      fallbackMessage: status => status === 401
        ? "Invalid username or password."
        : "Login failed. Please try again.",
    });

    if (data?.success) {
      showSuccess("Logged in! Redirecting…");
      // quick pause so cookies settle and users see feedback
      setTimeout(() => {
        window.location.href = data.banned && safeNext === "/" ? "/banned" : safeNext;
      }, 500);
      return;
    }

    showError(data?.error || "Login failed. Please try again.");
  } catch (error) {
    if (error.status === 403 && (error.payload?.banned || error.payload?.redirect === "/banned")) {
      window.location.href = "/banned";
      return;
    }

    showError(error instanceof HttpError ? error.message : "Network error. Please check your connection and try again.");
  } finally {
    setLoading(false);
  }
});

// Autofocus username for quicker entry
usernameInput.focus();

// Small UX touch: allow pressing Enter to submit even if focus is on button
loginBtn.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    form.requestSubmit();
  }
});
