const { getConfig } = require("../config");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");

const webhookPath = "/api/payments/stripe/webhook";
const events = [
  "checkout.session.completed", "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed", "checkout.session.expired",
  "refund.created", "refund.failed", "charge.dispute.created",
  "charge.dispute.closed", "charge.dispute.funds_reinstated",
];

function createStripeListener({ stripe, secretKey, publicBaseUrl, configuredSecret, production = getConfig().isProd, spawnCli = spawn }) {
  let stopChild = null;
  let signingSecret = configuredSecret;
  let status = { state: "starting", message: "Waiting for the HTTP server." };

  function report(state, message) {
    status = { state, message };
    console[state === "error" ? "warn" : "log"](`[shop:stripe] ${message}`);
  }

  async function start(port) {
    if (stopChild) return;
    if (!stripe) return report("error", "Stripe listener unavailable. Check STRIPE_SECRET_KEY and the Stripe SDK.");
    if (production) {
      if (!configuredSecret || !publicBaseUrl.startsWith("https://")) {
        return report("error", "Production webhook needs STRIPE_WEBHOOK_SECRET and an HTTPS PUBLIC_BASE_URL.");
      }
      try {
        for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
          if (endpoint.url !== publicBaseUrl + webhookPath || endpoint.status !== "enabled") continue;
          if (endpoint.enabled_events.includes("*") || events.every(event => endpoint.enabled_events.includes(event))) {
            return report("listening", "Listening for payments. Stripe has an enabled webhook for this server.");
          }
        }
        report("error", "Stripe has no enabled webhook for this URL subscribed to all shop events.");
      } catch {
        report("unverified", "HTTP webhook listening. Could not verify the endpoint with Stripe.");
      }
      return;
    }

    if (!/^(sk|rk)_test_/.test(secretKey)) return report("error", "Local forwarding requires a Stripe test key.");
    signingSecret = "";
    const child = spawnCli("stripe", ["listen", "--skip-update", "--color", "off", "--events", events.join(","), "--forward-to", `http://127.0.0.1:${port}${webhookPath}`], {
      env: { ...process.env, STRIPE_API_KEY: secretKey },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stopping = false;
    let resolveClosed;
    const closed = new Promise(resolve => { resolveClosed = resolve; });
    // The application handles signals and drains this promise before exiting.
    // The synchronous exit hook is a last resort for abnormal process exits.
    const killOnExit = () => { child.kill("SIGKILL"); };
    process.once("exit", killOnExit);
    stopChild = () => {
      if (!stopping) {
        stopping = true;
        signingSecret = "";
        child.kill();
      }
      return closed;
    };
    const onLine = line => {
      // CLI output contains credentials. Only publish our own status messages.
      const ready = line.match(/Ready!.*?(whsec_[a-zA-Z0-9]+)/i);
      if (ready && !stopping) {
        signingSecret = ready[1];
        report("listening", "Listening for test payments through the Stripe CLI.");
      }
    };
    for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on("line", onLine);
    report("starting", "Connecting the Stripe CLI.");
    child.once("error", error => report("error", error.code === "ENOENT" ? "Stripe CLI missing. Install it and restart the server." : "Could not start the Stripe CLI."));
    child.once("close", code => {
      stopChild = null;
      process.removeListener("exit", killOnExit);
      resolveClosed();
      signingSecret = "";
      if (stopping) report("stopped", "Stripe CLI forwarding stopped.");
      else if (status.state !== "error") report("error", `Stripe CLI stopped (exit ${code ?? "signal"}). Check the test key and connection, then restart.`);
    });

  }

  return { start, stop: () => stopChild?.(), getStatus: () => status, getSigningSecret: () => signingSecret };
}

module.exports = { createStripeListener, webhookPath };
