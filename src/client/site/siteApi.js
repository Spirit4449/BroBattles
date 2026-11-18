import { HttpError, requestJson } from "../lib/http.js";

async function api(url, body) {
  try {
    return await requestJson(url, {
      method: body ? "POST" : "GET",
      body,
      retries: 2,
      fallbackMessage: "Request failed.",
      invalidJsonMessage: "Service unavailable. Please retry.",
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new Error("Connection interrupted. Your progress is safe—please try again.");
  }
}

export { api };
