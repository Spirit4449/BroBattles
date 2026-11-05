// Compact transfer form for navigation graphs.
//
// A built graph holds ~80k traversal frame objects. Structured-cloning them
// from the worker cost the game loop ~150 ms per graph on the production Pi.
// Packed, every frame lives in typed arrays that are transferred, not copied,
// and each edge rebuilds its frames the first time something reads them. The
// rebuilt frames are identical to buildGraph's: { direction, jumpPressed,
// [dash], x, y }.

// Flag byte per frame: bits 0-1 direction (0: -1, 1: 0, 2: 1, 3: -0),
// bit 2 jumpPressed, bit 3 has a dash vector.
function directionCode(direction) {
  if (direction === -1) return 0;
  if (direction === 1) return 2;
  if (Object.is(direction, -0)) return 3;
  if (direction === 0) return 1;
  return -1;
}
const DIRECTIONS = [-1, 0, 1, -0];

function eachEdge(graph, fn) {
  for (const lists of [graph.edges, graph.dashEdges]) {
    if (!lists) continue;
    for (const list of lists.values()) for (const edge of list) fn(edge);
  }
}

// Returns { graph, transfer } where graph is cloneable without its frames and
// transfer lists the buffers to move. Throws on a frame it cannot encode.
function packGraph(graph) {
  let count = 0, dashes = 0;
  eachEdge(graph, edge => {
    count += edge.frames.length;
    for (const f of edge.frames) if (f.dash) dashes++;
  });
  const xy = new Float64Array(count * 2), flags = new Uint8Array(count), dash = new Float64Array(dashes * 2);
  const spans = [];
  let i = 0, d = 0;
  const strip = (list) => list.map(edge => {
    spans.push(i, edge.frames.length);
    for (const f of edge.frames) {
      const code = directionCode(f.direction);
      const keys = Object.keys(f).length;
      if (code < 0 || typeof f.jumpPressed !== 'boolean' || keys !== (f.dash ? 5 : 4)) throw new Error('unpackable navigation frame');
      flags[i] = code | (f.jumpPressed ? 4 : 0) | (f.dash ? 8 : 0);
      if (f.dash) { dash[d * 2] = f.dash.x; dash[d * 2 + 1] = f.dash.y; d++; }
      xy[i * 2] = f.x; xy[i * 2 + 1] = f.y;
      i++;
    }
    const { frames, ...rest } = edge;
    return rest;
  });
  const mapOf = (lists) => lists ? [...lists].map(([id, list]) => [id, strip(list)]) : null;
  const edges = mapOf(graph.edges), dashEdges = mapOf(graph.dashEdges);
  const packed = { surfaces: graph.surfaces, body: graph.body, character: graph.character, edges, dashEdges,
    spans: Int32Array.from(spans), xy, flags, dash };
  return { packed, transfer: [packed.xy.buffer, packed.flags.buffer, packed.dash.buffer, packed.spans.buffer] };
}

// Rebuilds a graph from packGraph's output. Frames materialize per edge on
// first read (spreading an edge reads them too).
function unpackGraph(packed, geometry) {
  const { xy, flags, dash, spans } = packed;
  // Index of each frame's dash vector: dashes are stored in frame order.
  const dashIndex = new Int32Array(flags.length);
  for (let i = 0, d = 0; i < flags.length; i++) { dashIndex[i] = d; if (flags[i] & 8) d++; }
  let s = 0;
  const lazy = (edge) => {
    const start = spans[s++], length = spans[s++];
    Object.defineProperty(edge, 'frames', {
      configurable: true, enumerable: true,
      get() {
        const frames = new Array(length);
        for (let k = 0; k < length; k++) {
          const i = start + k, flag = flags[i];
          const frame = { direction: DIRECTIONS[flag & 3], jumpPressed: !!(flag & 4) };
          if (flag & 8) frame.dash = { x: dash[dashIndex[i] * 2], y: dash[dashIndex[i] * 2 + 1] };
          frame.x = xy[i * 2]; frame.y = xy[i * 2 + 1];
          frames[k] = frame;
        }
        Object.defineProperty(this, 'frames', { value: frames, writable: true, configurable: true, enumerable: true });
        return frames;
      },
      set(value) { Object.defineProperty(this, 'frames', { value, writable: true, configurable: true, enumerable: true }); },
    });
    return edge;
  };
  const mapOf = (entries) => entries ? new Map(entries.map(([id, list]) => [id, list.map(lazy)])) : undefined;
  const edges = mapOf(packed.edges);
  const dashEdges = mapOf(packed.dashEdges);
  const graph = { surfaces: packed.surfaces, edges, body: packed.body, geometry, character: packed.character };
  if (dashEdges) graph.dashEdges = dashEdges;
  return graph;
}

module.exports = { packGraph, unpackGraph };
