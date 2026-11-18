import { API_PATHS } from "../../shared/net/apiPaths.js";
import config from "../../shared/site/siteConfig.json";
import { api } from "./siteApi";
import { element } from "../ui/dom";
import { openDialog } from "./dialog";

async function openLegal(kind) {
  const { body } = openDialog(kind === "terms" ? "Terms of Service" : "Privacy Policy");
  body.textContent = "Loading…";
  try {
    const item = await api(`/api/site/legal/${kind}`);
    body.classList.add("site-prose");
    body.innerHTML = item.html;
    body
      .querySelectorAll('a[href="/terms"],a[href="/privacy"]')
      .forEach((link) => (link.dataset.legal = link.getAttribute("href").slice(1)));
  } catch (error) {
    body.textContent = error.message;
  }
}

let acceptancePromise;

function ensureLegalAcceptance() {
  if (acceptancePromise) return acceptancePromise;
  acceptancePromise = (async () => {
    let current;
    try {
      current = await api(API_PATHS.API_LEGAL_STATUS);
    } catch (_) {
      current = { accepted: false };
    }
    if (current.accepted) return;
    await new Promise((resolve, reject) => {
      let accepted = false;
      const { dialog, body } = openDialog("Before you battle");
      dialog.classList.add("site-battle-consent-dialog");
      dialog.addEventListener(
        "close",
        () => {
          if (!accepted)
            reject(Object.assign(new Error("Ready cancelled."), { code: "CONSENT_CANCELLED" }));
        },
        { once: true },
      );
      body.innerHTML =
        '<div class="battle-consent"><div class="battle-legal-cards"><a class="battle-legal-card" href="/terms" data-legal="terms"><img src="/assets/ui/terms-scroll-pixel.webp" alt="Terms of Service" width="72" height="72"/><strong>Terms of Service</strong></a><a class="battle-legal-card" href="/privacy" data-legal="privacy"><img src="/assets/ui/privacy-shield-pixel.webp" alt="Privacy Policy" width="72" height="72"/><strong>Privacy Policy</strong></a></div><label class="site-consent"><input type="checkbox"/><span>I agree to the <a href="/terms" data-legal="terms">Terms of Service</a> and <a href="/privacy" data-legal="privacy">Privacy Policy</a>.</span></label></div>';
      const error = element("p", null, "site-error");
      error.setAttribute("role", "alert");
      const button = element("button", "Continue", "pixel-menu-button");
      button.disabled = true;
      body.querySelector("input").onchange = (event) => (button.disabled = !event.target.checked);
      button.onclick = async () => {
        button.disabled = true;
        try {
          await api(API_PATHS.API_LEGAL_ACCEPT, {
            accepted: true,
            termsVersion: config.termsVersion,
            privacyVersion: config.privacyVersion,
          });
          accepted = true;
          dialog.close();
          resolve();
        } catch (e) {
          error.textContent = e.message;
          button.disabled = false;
        }
      };
      body.append(error, button);
    });
  })().catch((error) => {
    acceptancePromise = null;
    throw error;
  });
  return acceptancePromise;
}

export { openLegal, ensureLegalAcceptance };
