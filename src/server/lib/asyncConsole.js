// Non-blocking process output for the game server.
//
// Node writes stdout/stderr synchronously when they are files or pipes (pm2,
// nohup). Any console line therefore blocks the game loop for as long as the
// disk is busy; on the production Pi the SD card is often saturated by swap,
// and a kill message or stall diagnostic held the loop for over two seconds.
// Here each stream's writes are queued and written from libuv's threadpool.
// Terminals keep Node's default. Output is bounded: past `maxBufferedBytes`
// lines are dropped and counted, and the queue is flushed synchronously on exit.
const fs = require("node:fs");

const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

function makeAsyncWriter(stream, { maxBufferedBytes = MAX_BUFFERED_BYTES, write = fs.write } = {}) {
  const fd = stream.fd;
  const queue = [];
  let queued = 0, writing = false, dropped = 0;

  function next() {
    if (writing || !queue.length) return;
    if (dropped) {
      queue.push(Buffer.from(`[asyncConsole] dropped ${dropped} lines while the output was blocked\n`));
      dropped = 0;
    }
    const chunk = queue.length === 1 ? queue[0] : Buffer.concat(queue);
    queue.length = 0;
    queued = 0;
    writing = true;
    write(fd, chunk, 0, chunk.length, null, (error, written) => {
      writing = false;
      // A partial write leaves the rest at the front; a failing descriptor
      // (closed pipe) drops what it could not take.
      if (!error && written < chunk.length) { const rest = chunk.subarray(written); queue.unshift(rest); queued += rest.length; }
      next();
    });
  }

  function enqueue(chunk, encoding) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === "string" ? encoding : "utf8");
    if (queued + buffer.length > maxBufferedBytes) { dropped++; return; }
    queue.push(buffer);
    queued += buffer.length;
    next();
  }

  function flushSync() {
    const chunks = queue.splice(0);
    queued = 0;
    for (const chunk of chunks) { try { fs.writeSync(fd, chunk); } catch (_) { return; } }
  }

  return { enqueue, flushSync, stats: () => ({ queued, writing, dropped }) };
}

function installAsyncConsole({ streams = [process.stdout, process.stderr], maxBufferedBytes } = {}) {
  const writers = [];
  for (const stream of streams) {
    if (!stream || stream.isTTY || !Number.isInteger(stream.fd) || stream._bbAsync) continue;
    const writer = makeAsyncWriter(stream, { maxBufferedBytes });
    stream._bbAsync = writer;
    stream.write = function asyncWrite(chunk, encoding, callback) {
      if (typeof encoding === "function") { callback = encoding; encoding = undefined; }
      writer.enqueue(chunk, encoding);
      if (typeof callback === "function") process.nextTick(callback);
      return true;
    };
    writers.push(writer);
  }
  if (writers.length) process.on("exit", () => { for (const writer of writers) writer.flushSync(); });
  return writers.length;
}

module.exports = { installAsyncConsole, makeAsyncWriter };
