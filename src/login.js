// login.js
import "./styles/accounts.css";

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
    const resp = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin", // include cookies
      body: JSON.stringify({ username, password }),
    });

    let data = null;
    try {
      data = await resp.json();
    } catch {
      // non-JSON or empty; let fallbacks below handle it
    }

    if (resp.ok && data?.success) {
      showSuccess("Logged in! Redirecting…");
      // quick pause so cookies settle and users see feedback
      setTimeout(() => {
        window.location.href = "/";
      }, 500);
      return;
    }

    if (resp.status === 403 && (data?.banned || data?.redirect === "/banned")) {
      window.location.href = "/banned";
      return;
    }

    // Map server errors → friendly message
    let msg =
      data?.error ||
      (resp.status === 401
        ? "Invalid username or password."
        : "Login failed. Please try again.");

    showError(msg);
  } catch {
    showError("Network error. Please check your connection and try again.");
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
