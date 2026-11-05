const test = require('node:test');
const assert = require('node:assert/strict');
const { makeAsyncWriter } = require('../src/server/lib/asyncConsole');

// A fake descriptor that accepts at most `limit` bytes per write and answers
// later, like a pipe whose reader (pm2) or a disk is slow.
function slowSink(limit = Infinity) {
  const pending = [];
  let output = '';
  const write = (fd, buffer, offset, length, position, callback) => {
    const take = Math.min(length, limit);
    pending.push(() => { output += buffer.subarray(offset, offset + take).toString(); callback(null, take); });
  };
  const drain = () => { while (pending.length) pending.shift()(); };
  return { write, drain, get output() { return output; } };
}

test('console writes return at once and reach the output in order, including partial writes', () => {
  const sink = slowSink(7);
  const writer = makeAsyncWriter({ fd: 1 }, { write: sink.write });
  for (let i = 0; i < 5; i++) writer.enqueue(`line ${i}\n`);
  assert.equal(sink.output, '', 'nothing waits on the descriptor inside the caller');
  sink.drain();
  assert.equal(sink.output, [0, 1, 2, 3, 4].map(i => `line ${i}\n`).join(''));
});

test('output queued behind a blocked descriptor is bounded and the loss is reported', () => {
  const sink = slowSink();
  const writer = makeAsyncWriter({ fd: 1 }, { write: sink.write, maxBufferedBytes: 16 });
  writer.enqueue('first\n');
  for (let i = 0; i < 10; i++) writer.enqueue('0123456789\n');
  sink.drain();
  assert.match(sink.output, /^first\n0123456789\n\[asyncConsole\] dropped 9 lines/);
});
