#!/usr/bin/env node
// Merge one network trace run (server + every client) and print a plain-text
// diagnosis. Fetches the run from the production Pi over SSH unless --local.
//
//   node scripts/dev/net-report.mjs <runId> [--local] [--dir <path>] [--json] [--brief] [--baseline <runId>]
//   node scripts/dev/net-report.mjs --compare <runA> <runB>
//
// --brief prints the verdict, server summary and attack lines only; --baseline
// appends a comparison against an earlier run's report.json.
//
// Output goes to stdout; report.json is written next to the run under
// output/net-traces/<runId>/ (gitignored).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyzeRun } from "./netReportAnalysis.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REMOTE = process.env.BB_NET_TRACE_REMOTE || "nisch@100.94.147.111";
const REMOTE_DIR = process.env.BB_NET_TRACE_REMOTE_DIR || "~/Desktop/Game/data/net-traces";
const OUT_ROOT = path.join(root, "output", "net-traces");

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2), next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch (_) {}
  }
  return out;
}

function fetchRun(runId, args) {
  if (args.dir) return path.resolve(args.dir);
  if (args.local) return path.join(root, "data", "net-traces", runId);
  const dest = path.join(OUT_ROOT, runId);
  fs.mkdirSync(dest, { recursive: true });
  execFileSync("rsync", ["-az", `${REMOTE}:${REMOTE_DIR}/${runId}/`, `${dest}/`], { stdio: ["ignore", "ignore", "inherit"] });
  return dest;
}

function loadRun(dir) {
  const server = readJsonl(path.join(dir, "server.jsonl"));
  const clients = {};
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".jsonl") || name === "server.jsonl") continue;
    clients[name.replace(/\.jsonl$/, "")] = readJsonl(path.join(dir, name));
  }
  return { server, clients };
}

const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? "-" : Number(v).toFixed(d));
const pad = (s, n) => String(s).padEnd(n);

function printReport(runId, r) {
  const L = [];
  L.push(`# Network trace ${runId}`);
  const rooms = r.rooms.map(x => `match ${x.matchId} ${x.modeId || "?"}${x.modeVariantId ? `:${x.modeVariantId}` : ""} map ${x.map ?? "?"} bots=${x.bots}`);
  L.push(`server: ${r.server.hostname || "?"} node ${r.server.node || "?"} cpus=${r.server.cpus ?? "?"} | ${rooms.join("; ") || "no room joined"}`);
  L.push(`duration ${fmt(r.durationS)}s of live ticks, clients: ${Object.keys(r.clients).join(", ") || "none"}`);
  L.push("");
  L.push("## Verdict");
  for (const line of r.verdict) L.push(`- ${line}`);
  L.push("");
  L.push("## Server");
  const s = r.server;
  L.push(`loop delta p95 ${fmt(s.loopP95, 1)}ms max ${fmt(s.loopMax, 1)}ms | loop stalls >=50ms: ${s.loopStalls} (>=200ms: ${s.loopStallsSevere})`);
  L.push(`snapshot emission gaps >=100ms: ${s.snapshotGaps} (max ${fmt(s.snapshotGapMax)}ms) | avg snapshot ${fmt(s.avgSnapshotBytes)} bytes`);
  L.push(`bots: tick p95 ${fmt(s.botP95, 2)}ms max ${fmt(s.botMax, 2)}ms, max main-thread per second ${fmt(s.botTotalMaxPerSecond, 1)}ms` +
    (s.slowestBot ? ` (slowest ${s.slowestBot.name || "?"} ${s.slowestBot.char || ""} ${fmt(s.slowestBot.ms, 1)}ms)` : ""));
  L.push(`navigation builds: ${s.nav.count} (build max ${fmt(s.nav.buildMax)}ms, queue max ${fmt(s.nav.queueMax)}ms, errors ${s.nav.errors})`);
  L.push(`host: load1 max ${fmt(s.host.loadMax, 2)} | event-loop delay p99 max ${fmt(s.host.loopDelayP99Max, 1)}ms, max ${fmt(s.host.loopDelayMax, 1)}ms | process cpu max ${fmt(s.host.cpuMax)}% | mem avail min ${fmt(s.host.memAvailMin)}MB | swap max ${fmt(s.host.swapMax)}MB`);
  L.push(`stall attribution: ${s.attribution.withNav} of ${s.attribution.stalls} loop stalls overlapped a navigation build, ${s.attribution.withBots} had bot ticks > ${s.attribution.botThresholdMs}ms that second, ${s.attribution.withHostLoad} had load1 > cpus`);
  L.push(`max socket write buffer: ${fmt(s.writeBufferMax)} packets | GC pause max ${fmt(s.gc?.pauseMax, 1)}ms (major ${fmt(s.gc?.majorMax, 1)}ms), GC ms/s max ${fmt(s.gc?.msPerSecondMax)}`);
  if (s.phases && Object.keys(s.phases).length) {
    L.push(`step phases (ms/s p50/max, slowest step): ${Object.entries(s.phases).map(([k, v]) => `${k} ${fmt(v.p50PerSecond)}/${fmt(v.maxPerSecond)} (${fmt(v.stepMax, 1)})`).join(" | ")}`);
  }
  L.push("");
  for (const [tag, c] of Object.entries(r.clients)) {
    L.push(`## Client ${tag} (${c.user || "?"})`);
    if (!c.snapshots) { L.push("no data"); L.push(""); continue; }
    L.push(`snapshots ${c.snapshots} | arrival interval p50 ${fmt(c.arrival.p50, 1)} p95 ${fmt(c.arrival.p95, 1)} p99 ${fmt(c.arrival.p99, 1)} max ${fmt(c.arrival.max)}ms`);
    L.push(`arrival histogram: ${Object.entries(c.arrival.histogram).map(([k, v]) => `${k}:${v}`).join("  ")}`);
    L.push(`gaps >=100ms: ${c.gaps.length} → server-side ${c.gapCauses.server}, transport ${c.gapCauses.transport}, client freeze ${c.gapCauses.client || 0}`);
    L.push(`one-way delay (clock-estimated) p50 ${fmt(c.delay.p50, 1)} p95 ${fmt(c.delay.p95, 1)} max ${fmt(c.delay.max, 1)}ms | best RTT ${fmt(c.rttMin, 1)}ms`);
    L.push(`frames: ${c.frames} | frame time p50 ${fmt(c.frameTime.p50, 1)} p95 ${fmt(c.frameTime.p95, 1)} max ${fmt(c.frameTime.max)}ms | hitches >=50ms: ${c.frameTime.hitches}`);
    L.push(`render: underruns ${fmt(c.render.underruns)} max extrapolation ${fmt(c.render.maxExtrapolationMs)}ms interp delay ${fmt(c.render.interpDelayMin)}–${fmt(c.render.interpDelayMax)}ms`);
    L.push(`corrections: ${c.corrections.total} (${Object.entries(c.corrections.byReason).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}), max error ${fmt(c.corrections.maxErrorPx, 1)}px`);
    L.push(`rubber-band: local ${c.rubber.local.length}, remote ${c.rubber.remote.length} → ${Object.entries(c.rubber.byCause).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}` +
      ` (ignored as ordinary movement: ${Object.entries(c.rubber.explained || {}).map(([k, v]) => `${k} ${v}`).join(", ") || "none"})`);
    const a = c.attacks;
    if (a) {
      const q = (x) => (x?.n ? `${fmt(x.p50)}/${fmt(x.p95)}` : "-");
      L.push(`attacks (${a.character || "?"}): ${a.requests} requests, ${a.hits} damaging hits | p50/p95 ms: press→send ${q(a.pressToSend)} (${a.withinOneFrame == null ? "-" : Math.round(a.withinOneFrame * 100)}% ≤1 frame), send→server ${q(a.sendToServer)}, server hit→client health ${q(a.serverToClient)}${a.serverToClientStalled?.n ? ` (during stalls ${q(a.serverToClientStalled)})` : ""}`);
      L.push(`  predicted hit→confirm ${q(a.predToConfirm)}, press→confirm ${q(a.pressToConfirm)}, request→server hit ${q(a.sendToHit)}, hit→super ${q(a.hitToSuper)} | rewind as shooter ${q(a.rewindAsShooter)} max ${fmt(a.rewindAsShooter?.max)}`);
      L.push(`  predictions ${a.predictions}, unconfirmed ${a.unconfirmed} (${a.unconfirmedRate == null ? "-" : (a.unconfirmedRate * 100).toFixed(1)}%, ${a.unconfirmedDuringStall} near a server stall), withdrawn events ${a.withdrawnEvents} | hits taken ${a.hitsTaken}, rewind as victim ${q(a.rewindAsVictim)} max ${fmt(a.rewindAsVictim?.max)}`);
      for (const [type, v] of Object.entries(a.byType || {})) L.push(`  ${type}: ${v.hits} hits, predicted→confirm ${q(v.predToConfirm)}, press→confirm ${q(v.pressToConfirm)}`);
    }
    const events = [...c.rubber.local, ...c.rubber.remote].sort((a, b) => b.magnitudePx - a.magnitudePx).slice(0, 8);
    for (const e of events) {
      L.push(`  ${pad(e.kind, 6)} ${pad(e.actor || "self", 14)} t=${fmt(e.serverT / 1000, 2)}s ${fmt(e.magnitudePx, 1)}px cause=${e.cause}` +
        `${e.context ? ` [${e.context}]` : ""}`);
    }
    for (const g of c.gaps.slice().sort((a, b) => b.arrivalGapMs - a.arrivalGapMs).slice(0, 5)) {
      L.push(`  gap ${fmt(g.arrivalGapMs)}ms at t=${fmt(g.serverT / 1000, 2)}s source gap ${fmt(g.sourceGapMs)}ms → ${g.cause}${g.serverStall ? ` (server stall ${fmt(g.serverStall)}ms)` : ""}${g.nav ? " during nav build" : ""}`);
    }
    L.push("");
  }
  if (r.timeline.length) {
    L.push("## Notable seconds (server mono)");
    L.push("   t(s)  loopMax snapGap botMax botTot nav  load  elDelay | client max arrival gaps | rubber");
    for (const row of r.timeline.slice(0, 40)) {
      L.push(`${pad(fmt(row.t / 1000, 0), 7)} ${pad(fmt(row.loopMax), 7)} ${pad(fmt(row.snapGapMax), 7)} ${pad(fmt(row.botMax, 1), 6)} ${pad(fmt(row.botTotal), 6)} ${pad(row.nav ? "yes" : "", 4)} ${pad(fmt(row.load, 1), 5)} ${pad(fmt(row.elDelayMax), 7)} | ${pad(Object.entries(row.clientGaps).map(([k, v]) => `${k}:${fmt(v)}`).join(" "), 22)} | ${row.rubber || ""}`);
    }
    if (r.timeline.length > 40) L.push(`… ${r.timeline.length - 40} more in report.json`);
  }
  return L.join("\n");
}

export function comparable(r) {
  const clients = Object.values(r.clients || {});
  const sum = (f) => clients.reduce((n, c) => n + (f(c) || 0), 0);
  const causes = {};
  for (const c of clients) for (const [k, v] of Object.entries(c.rubber?.byCause || {})) causes[k] = (causes[k] || 0) + v;
  const attackStat = (key, q) => {
    const vals = clients.map(c => c.attacks?.[key]?.[q]).filter(Number.isFinite);
    return vals.length ? Math.max(...vals) : null;
  };
  const preds = sum(c => c.attacks?.predictions), unconf = sum(c => c.attacks?.unconfirmed);
  return {
    loopStalls: r.server.loopStalls, loopStallsSevere: r.server.loopStallsSevere, loopMax: r.server.loopMax,
    snapshotGaps: r.server.snapshotGaps, botMaxTick: r.server.botMax, botMsPerSecMax: r.server.botTotalMaxPerSecond,
    navBuilds: r.server.nav.count, navQueueMax: r.server.nav.queueMax, gcPauseMax: r.server.gc?.pauseMax, loadMax: r.server.host.loadMax,
    clientGaps: sum(c => c.gaps?.length), gapsServer: sum(c => c.gapCauses?.server), gapsTransport: sum(c => c.gapCauses?.transport),
    gapsClient: sum(c => c.gapCauses?.client),
    rubberLocal: sum(c => c.rubber?.local.length), rubberRemote: sum(c => c.rubber?.remote.length),
    ...Object.fromEntries(Object.entries(causes).map(([k, v]) => [`rb:${k}`, v])),
    corrections: sum(c => c.corrections?.total), correctionMaxPx: Math.max(0, ...clients.map(c => c.corrections?.maxErrorPx || 0)),
    underrunsMax: Math.max(0, ...clients.map(c => c.render?.underruns || 0)),
    attackHits: sum(c => c.attacks?.hits),
    pressToSendP95: attackStat("pressToSend", "p95"),
    predToConfirmP50: attackStat("predToConfirm", "p50"), predToConfirmP95: attackStat("predToConfirm", "p95"),
    serverToClientP95: attackStat("serverToClient", "p95"),
    pressToConfirmP50: attackStat("pressToConfirm", "p50"), pressToConfirmP95: attackStat("pressToConfirm", "p95"),
    unconfirmedPct: preds ? (unconf / preds) * 100 : null,
  };
}

function compare(a, b) {
  const A = comparable(a.report), B = comparable(b.report);
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])];
  const L = [`metric               ${pad(a.runId, 26)} ${b.runId}`];
  for (const k of keys) L.push(`${pad(k, 20)} ${pad(fmt(A[k], 1), 26)} ${fmt(B[k], 1)}`);
  return L.join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.compare) {
  const ids = [args.compare, ...args._].filter(x => typeof x === "string").slice(0, 2);
  const load = (id) => ({ runId: id, report: JSON.parse(fs.readFileSync(path.join(OUT_ROOT, id, "report.json"), "utf8")) });
  console.log(compare(load(ids[0]), load(ids[1])));
  process.exit(0);
}
const runId = args._[0];
if (!runId) {
  console.error("usage: net-report.mjs <runId> [--local] [--dir path] | --compare <a> <b>");
  process.exit(2);
}
const dir = fetchRun(runId, args);
const report = analyzeRun(loadRun(dir));
const outDir = path.join(OUT_ROOT, runId);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 1));
const text = args.json ? JSON.stringify(report, null, 1) : printReport(runId, report);
if (args.brief && !args.json) {
  // Verdict, the server block, and each client's headline and attack lines.
  const keep = /^(#|- |loop |snapshot emission|bots:|navigation|host:|stall attribution|max socket|step phases|## |gaps >=|corrections:|rubber-band:|attacks |  predicted|  predictions|render:)/;
  console.log(text.split("\n").filter(l => keep.test(l) && !l.startsWith("## Notable")).join("\n"));
} else console.log(text);
if (args.baseline && typeof args.baseline === "string") {
  try {
    const base = JSON.parse(fs.readFileSync(path.join(OUT_ROOT, args.baseline, "report.json"), "utf8"));
    console.log("\n" + compare({ runId: args.baseline, report: base }, { runId, report }));
  } catch (e) { console.log(`(no baseline ${args.baseline}: ${e.message})`); }
}
console.log(`\n(report.json: ${path.relative(root, path.join(outDir, "report.json"))}; raw: ${dir})`);
