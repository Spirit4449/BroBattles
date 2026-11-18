const { createScheduler } = require("./scheduler");
const { startCleanupJobs } = require("./cleanup");
const { deliverNotification } = require("../services/email/emailService");
const {
  syncMarketingContact,
  deliverMarketingEmail,
} = require("../services/email/marketingService");
const { createSiteSupportService } = require("../services/site/siteSupportService");

function startJobs({ db, io, matchResults, stripeShopService, socketApi }) {
  const scheduler = createScheduler();
  startCleanupJobs({ db, io, matchResults, getGameRoom: socketApi.getGameRoom, scheduler });
  scheduler.every("match results", 30000, matchResults.reconcile);
  scheduler.every("Stripe webhooks", 60000, stripeShopService.reconcileWebhooks);
  scheduler.every("support cleanup", 3600000, createSiteSupportService(db).cleanup);
  scheduler.every("support notification", 15000, () => deliverNotification(db));
  scheduler.every("marketing contact", 15000, () => syncMarketingContact(db));
  scheduler.every("welcome email", 15000, () => deliverMarketingEmail(db));
  return scheduler;
}
module.exports = { startJobs };
