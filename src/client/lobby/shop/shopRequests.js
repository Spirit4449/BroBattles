import { getJson, postJson } from "../../lib/http.js";

export function fetchShopJson(url) {
  return getJson(url, { fallbackMessage: "Shop request failed." });
}

export function postShopJson(url, body) {
  return postJson(url, body, { fallbackMessage: "Shop request failed." });
}

export function idempotencyKey(prefix) {
  const uuid = window.crypto?.randomUUID?.();
  return uuid ? `${prefix}:${uuid}` : `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
