import { API_PATHS } from "../../shared/net/apiPaths.js";
import { requestJson } from "../lib/http.js";
import { postJson, showChatRequestError } from "../chat/presentation";

function getJson(url) {
  return requestJson(url, { fallbackMessage: "Something went wrong. Please try again." });
}

export const friendsApi = {
  load: () => getJson(API_PATHS.FRIENDS),
  suggestions: () => getJson(API_PATHS.FRIENDS_SUGGESTIONS),
  request: body => postJson(API_PATHS.FRIENDS_REQUEST, body),
  respond: body => postJson(API_PATHS.FRIENDS_RESPOND, body),
  cancel: body => postJson(API_PATHS.FRIENDS_CANCEL, body),
  remove: body => postJson(API_PATHS.FRIENDS_REMOVE, body),
  invite: body => postJson(API_PATHS.FRIENDS_PARTY_INVITE, body),
  react: body => postJson(API_PATHS.FRIENDS_MESSAGES_REACT, body),
  history: body => postJson(API_PATHS.FRIENDS_MESSAGES_HISTORY, body),
  read: body => postJson(API_PATHS.FRIENDS_MESSAGES_READ, body),
  send: body => postJson(API_PATHS.FRIENDS_MESSAGES_SEND, body),
};

export const showFriendError = (error, title) => showChatRequestError(error, title);
