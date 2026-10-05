// Shared Express handler plumbing for signed-in JSON routes.

// Wraps a handler that needs the current user: answers 401 when signed out
// and 500 on unexpected errors. `onError(error, res)` may answer known errors
// first by returning a truthy value.
function authedRoute(requireCurrentUser, label, handler, { onError } = {}) {
  return async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }
      return await handler(req, res, user);
    } catch (error) {
      console.error(`${label} error`, error);
      if (onError?.(error, res)) return undefined;
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  };
}

// Shop failures carry an HTTP status, a code and sometimes the wallet.
function sendShopError(res, error, fallbackMessage) {
  if (!(Number(error?.status) >= 400 && Number(error?.status) < 600)) return false;
  res.status(Number(error.status)).json({
    success: false,
    code: error.code || "shop_error",
    error: error.message || fallbackMessage,
    wallet: error.wallet || undefined,
  });
  return true;
}

// Legacy per-item "buy" endpoints route through the Shop's matching offer.
// Returns null when the Shop has no offer that grants this item.
async function purchaseGrantFromShop({ shopService, req, user, grantType, grantId, idempotencyPrefix }) {
  const shopOffer = shopService?.findOfferForGrant?.(grantType, grantId);
  if (!shopOffer) return null;
  const idempotencyKey =
    String(req.body?.idempotencyKey || "").trim() ||
    `${idempotencyPrefix}:${user.user_id}:${grantId}:${Date.now()}`;
  const result = await shopService.purchaseVirtual({
    userId: user.user_id,
    offerId: shopOffer.id,
    idempotencyKey,
  });
  return {
    ...result,
    owned: true,
    coins: result?.wallet?.coins,
    gems: result?.wallet?.gems,
  };
}

module.exports = { authedRoute, sendShopError, purchaseGrantFromShop };
