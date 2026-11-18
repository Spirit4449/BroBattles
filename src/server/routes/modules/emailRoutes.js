const { deliverReservedCode } = require("../../services/email/challengeDelivery");
const { readSubscription, setSubscription } = require("../../services/email/marketingService");
const { API_PATHS } = require("../../../shared/net/apiPaths.js");
const crypto = require("node:crypto");
const { isSameOrigin } = require("../../middleware/sameOrigin");
const { createRequestWindow } = require("../../lib/requestWindow");
const { hashCode } = require("../../services/email/emailService");
const failure = (error, status = 400) => ({ error, status });
const { VERIFICATION_CODE_PATTERN } = require("../../../shared/social/verificationCode");
const { VERIFICATION_CODE_TTL_MINUTES, VERIFICATION_CODE_MAX_ATTEMPTS, generateVerificationCode } = require("../../services/email/verificationCode");
const { EMAIL_RESEND_SECONDS, emailResendRemaining, emailCooldown } = require("../../services/email/emailCooldown");
const { escapeHtml } = require("../../../shared/site/html.cjs");
const preferencesPage = (title, content) =>
  `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Bro Battles</title><body style="margin:0;background:#091324;color:#eef5ff;font-family:system-ui"><main style="max-width:440px;margin:10vh auto;padding:28px;background:#14233b;border:2px solid #45648b;border-radius:12px"><p style="color:#9bc7ff;font-size:12px;letter-spacing:.12em">BRO BATTLES</p><h1 style="font-size:24px">${title}</h1>${content}</main></body></html>`;
function registerEmailRoutes({ app, db, requireCurrentUser }) {
  const limits = createRequestWindow();
  const wrap = (action) => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      if (req.method !== "GET" && !isSameOrigin(req))
        return res.status(403).json({ error: "Same-origin request required." });
      if (limits.count(req.ip, 3600000) > 60)
        return res.status(429).json({ error: "Too many attempts. Try again later." });
      const user = await requireCurrentUser(req, res);
      if (!user || user.expires_at)
        return res.status(403).json({ error: "Create an account or log in to add an email." });
      const result = await action(req, user);
      return res.status(result.status || 200).json(result);
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY")
        return res.status(409).json({ error: "This email cannot be added to this account." });
      console.warn("[email] Request failed:", error.code || error.message);
      return res.status(503).json({ error: "Email is temporarily unavailable. Please try again." });
    }
  };
  app.get(
    API_PATHS.PROFILE_EMAIL,
    wrap(async (_req, user) => {
      const rows = await db.runQuery(
        "SELECT email,verified_at,pending_email,sent_at,correction_used FROM account_emails WHERE user_id=?",
        [user.user_id],
      );
      const row = rows[0];
      return {
        email: row?.email || null,
        verified: !!row?.verified_at,
        pendingEmail: row?.pending_email || null,
        correctionUsed: !!row?.correction_used,
        resendAfter: emailResendRemaining(row?.sent_at),
      };
    }),
  );
  app.post(
    API_PATHS.PROFILE_EMAIL_SEND_CODE,
    wrap(async (req, user) => {
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      if (
        email.length > 254 ||
        !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
          email,
        )
      )
        return failure("Enter a valid email address.");
      const reserved = await db.withTransaction(async (_conn, q) => {
        await q("INSERT IGNORE INTO account_emails (user_id) VALUES (?)", [user.user_id]);
        const [row] = await q("SELECT * FROM account_emails WHERE user_id=? FOR UPDATE", [
          user.user_id,
        ]);
        const policy = emailCooldown(row, email, row.pending_email);
        if (policy.error) return failure(policy.error, 429);
        const { fresh } = policy;
        const code = generateVerificationCode();
        const digest = hashCode(user.user_id, email, code);
        await q(
          `UPDATE account_emails SET pending_email=?,code_hash=?,expires_at=TIMESTAMPADD(MINUTE,?,NOW(3)),attempts=0,sent_at=NOW(3),window_start=IF(?,NOW(3),window_start),send_count=?,correction_used=? WHERE user_id=?`,
          [
            email,
            digest,
            VERIFICATION_CODE_TTL_MINUTES,
            fresh,
            fresh ? 1 : row.send_count + 1,
            policy.correctionUsed,
            user.user_id,
          ],
        );
        return {
          delivery: { code, email, userId: user.user_id, token: digest, previous: row },
          response: { success: true, resendAfter: EMAIL_RESEND_SECONDS, correctionUsed: policy.correctionUsed },
        };
      });
      if (!reserved.delivery) return reserved;
      await deliverReservedCode(db, "profile", reserved.delivery, "Verify your email address",
        "Enter this code in your Bro Battles profile to verify your email address.");
      return reserved.response;
    }),
  );
  app.post(
    API_PATHS.PROFILE_EMAIL_VERIFY,
    wrap(async (req, user) => {
      const code = String(req.body?.code || "").trim();
      if (!VERIFICATION_CODE_PATTERN.test(code)) return failure("Enter the complete verification code.");
      return db.withTransaction(async (_conn, q) => {
        const [row] = await q("SELECT * FROM account_emails WHERE user_id=? FOR UPDATE", [
          user.user_id,
        ]);
        if (
          !row?.code_hash ||
          new Date(row.expires_at).getTime() <= Date.now() ||
          row.attempts >= VERIFICATION_CODE_MAX_ATTEMPTS
        )
          return failure("This code has expired. Request a new code.");
        if (
          !crypto.timingSafeEqual(
            Buffer.from(row.code_hash, "hex"),
            Buffer.from(hashCode(user.user_id, row.pending_email, code), "hex"),
          )
        ) {
          await q("UPDATE account_emails SET attempts=attempts+1 WHERE user_id=?", [user.user_id]);
          return failure("Incorrect code. Please try again.");
        }
        try {
          const [preference] = await q(
            "SELECT email,subscribed FROM email_marketing WHERE user_id=? FOR UPDATE",
            [user.user_id],
          );
          await q(
            "UPDATE account_emails SET email=pending_email,verified_at=NOW(3),pending_email=NULL,code_hash=NULL,expires_at=NULL WHERE user_id=?",
            [user.user_id],
          );
          if (preference?.email && preference.email !== row.pending_email) {
            await q(
              `INSERT INTO marketing_contact_sync (email,subscribed,next_attempt_at) VALUES (?,FALSE,NOW(3))
         ON DUPLICATE KEY UPDATE subscribed=FALSE,synced_at=NULL,next_attempt_at=NOW(3),attempts=0`,
              [preference.email],
            );
            await setSubscription(
              q,
              user.user_id,
              row.pending_email,
              !!preference.subscribed,
            );
          }
        } catch (error) {
          throw error;
        }
        return { success: true, email: row.pending_email };
      });
    }),
  );
  app.get(
    API_PATHS.PROFILE_EMAIL_MARKETING,
    wrap(async (_req, user) => {
      const subscribed = await readSubscription(db, user.user_id);
      return { subscribed };
    }),
  );
  app.post(
    API_PATHS.PROFILE_EMAIL_MARKETING,
    wrap(async (req, user) => {
      return db.withTransaction(async (_conn, q) => {
        const [email] = await q(
          "SELECT email FROM account_emails WHERE user_id=? AND verified_at IS NOT NULL FOR UPDATE",
          [user.user_id],
        );
        if (!email?.email)
          return failure("Verify an email address before changing email preferences.", 409);
        await setSubscription(
          q,
          user.user_id,
          email.email,
          req.body?.subscribed === true,
        );
        return { success: true, subscribed: req.body?.subscribed === true };
      });
    }),
  );
  const publicPage = (action) => async (req, res) => {
    res.set("Cache-Control", "no-store").set("Referrer-Policy", "no-referrer");
    try {
      await action(req, res);
    } catch (error) {
      console.warn("[email] Unsubscribe failed:", error.code || error.message);
      res
        .status(503)
        .send(
          preferencesPage(
            "Please try again",
            "<p>Email preferences are temporarily unavailable. Please reload this page.</p>",
          ),
        );
    }
  };
  app.get(
    "/email/unsubscribe/:id",
    publicPage(async (req, res) => {
      const id = String(req.params.id || "");
      const [row] = await db.runQuery("SELECT email FROM email_marketing WHERE unsubscribe_id=?", [
        id,
      ]);
      if (!row)
        return res
          .status(404)
          .send(
            preferencesPage(
              "Link unavailable",
              "<p>This email preference link is no longer active.</p>",
            ),
          );
      res.send(
        preferencesPage(
          "Email preferences",
          `<p style="overflow-wrap:anywhere">${escapeHtml(row.email)}</p><form method="post"><button type="submit" style="padding:14px;border:0;border-radius:6px;background:#337bdd;color:white;font:inherit;cursor:pointer">Unsubscribe from marketing emails</button></form>`,
        ),
      );
    }),
  );
  app.post(
    "/email/unsubscribe/:id",
    publicPage(async (req, res) => {
      const id = String(req.params.id || "");
      const found = await db.withTransaction(async (_conn, q) => {
        const [row] = await q(
          "SELECT user_id,email FROM email_marketing WHERE unsubscribe_id=? FOR UPDATE",
          [id],
        );
        if (!row) return false;
        await setSubscription(
          q,
          row.user_id,
          row.email,
          false,
        );
        await q(
          "UPDATE marketing_jobs SET cancelled_at=NOW(3) WHERE user_id=? AND sent_at IS NULL",
          [row.user_id],
        );
        return true;
      });
      if (!found)
        return res
          .status(404)
          .send(
            preferencesPage(
              "Link unavailable",
              "<p>This email preference link is no longer active.</p>",
            ),
          );
      return res
        .status(200)
        .send(
          preferencesPage(
            "You’re unsubscribed",
            "<p>You will no longer receive Bro Battles marketing updates.</p>",
          ),
        );
    }),
  );
}
module.exports = { registerEmailRoutes };
