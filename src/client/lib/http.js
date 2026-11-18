export class HttpError extends Error {
  constructor(message, { status, payload = null, cause } = {}) {
    super(message, { cause });
    this.name = 'HttpError';
    this.status = status;
    this.payload = payload;
    for (const field of ['code', 'wallet', 'nextNameChangeAt', 'errors']) {
      if (payload?.[field] !== undefined) this[field] = payload[field];
    }
  }

  get statusCode() { return this.status; }
  get data() { return this.payload; }
}

export async function requestJson(url, {
  body,
  credentials = 'same-origin',
  headers,
  signal,
  retries = 0,
  fallbackMessage = 'Request failed',
  invalidJsonMessage = fallbackMessage,
  ...options
} = {}) {
  const request = { credentials, signal, ...options };
  if (body !== undefined) {
    request.headers = { 'Content-Type': 'application/json', ...headers };
    request.body = typeof body === 'string' ? body : JSON.stringify(body);
  } else if (headers) {
    request.headers = headers;
  }

  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetch(url, request);
    } catch (error) {
      if (attempt >= retries || signal?.aborted || error?.name === 'AbortError') throw error;
    }
    if (attempt < retries && (!response || response.status >= 500)) {
      await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
      signal?.throwIfAborted();
      continue;
    }

    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      const message = typeof invalidJsonMessage === 'function' ? invalidJsonMessage(response.status) : invalidJsonMessage;
      throw new HttpError(message, { status: response.status, cause });
    }
    if (!response.ok) {
      const message = typeof fallbackMessage === 'function' ? fallbackMessage(response.status) : fallbackMessage;
      throw new HttpError(payload?.error || message, { status: response.status, payload });
    }
    return payload;
  }
}

export function getJson(url, options) {
  return requestJson(url, { ...options, method: 'GET' });
}

export function postJson(url, body, options) {
  return requestJson(url, { ...options, method: 'POST', body });
}
