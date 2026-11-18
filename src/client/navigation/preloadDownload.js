// Discard asset chunks after they warm the HTTP cache. Only templates,
// manifests, and player-card animation need the downloaded bytes.
export async function downloadPreload(job, { signal, transfer, spendBudget, maxBytes }) {
  const response = await fetch(job.url, { credentials: 'same-origin', priority: 'low', signal });
  if (!response.ok || !response.body) {
    transfer.retryable = response.status >= 500 || response.status === 408 || response.status === 429;
    await response.body?.cancel();
    throw new Error('Preload unavailable');
  }
  const reader = response.body.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (signal.aborted) throw new DOMException('Preload stopped', 'AbortError');
    if (done) return chunks;
    transfer.bytes += value.byteLength;
    if (!spendBudget(value.byteLength)) {
      await reader.cancel();
      throw new Error('Preload budget exhausted');
    }
    if (transfer.bytes > maxBytes) {
      transfer.retryable = false;
      await reader.cancel();
      throw new Error('Card animation exceeds declared size');
    }
    if (job.kind !== 'asset') chunks.push(value);
  }
}
