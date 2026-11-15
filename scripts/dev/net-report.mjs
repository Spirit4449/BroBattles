#!/usr/bin/env node
// Merge one network trace run (server + every client) and print a plain-text
// diagnosis. Fetches the run from the production Pi over SSH unless --local.
//
//   node scripts/dev/net-report.mjs <runId> [--local] [--dir <path>] [--json] [--brief] [--baseline <runId>]
//   node scripts/dev/net-report.mjs --compare <runA> <runB>
//   node scripts/dev/net-report.mjs --pool <run-m1> <run-m2> …   (victim screen truth pooled per client tag)
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
import { analyzeRun, summarizeVictimScreen, victimScreenLine } from "./netReportAnalysis.mjs";

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

// probe.json (net profiles, measured RTT, phases) is written by net-probe.mjs
// under output/net-traces/<runId>/, next to the fetched files.
function readProbe(runId, dir) {
  for (const file of [path.join(dir, "probe.json"), path.join(OUT_ROOT, runId, "probe.json")]) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) {}
  }
  return null;
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

const fmt = (v, d = 0) => (typeof v === "string" ? v : v == null || !Number.isFinite(v) ? "-" : Number(v).toFixed(d));

function probeLine(p) {
  const clients = Object.entries(p.clients || {}).map(([tag, c]) => {
    const net = c.net ? `${c.net.name} (+${c.net.rttMs}±${c.net.jitterMs / 2}ms${c.net.spikeP ? `, ${c.net.spikeP * 100}%×${c.net.spikeMs}ms` : ""})` : "fast";
    return `${tag} ${c.character || "?"} ${c.team || "?"} net ${net}${c.flags ? ` flags ${c.flags}` : ""}: game rtt p50 ${fmt(c.rtt?.game?.p50)} p95 ${fmt(c.rtt?.game?.p95)} min ${fmt(c.rtt?.game?.min)}ms, clock best ${fmt(c.rtt?.clockBest)}ms` +
      (c.link ? `, proxy late max ${fmt(Math.max(c.link.up.lateMax ?? 0, c.link.down.lateMax ?? 0))}ms` : "");
  });
  return `probe: ${p.versus ? "versus" : "coop"}, script ${p.script} | ${clients.join(" | ")}`;
}
const pad = (s, n) => String(s).padEnd(n);

function printReport(runId, r) {
  const L = [];
  L.push(`# Network trace ${runId}`);
  const rooms = r.rooms.map(x => `match ${x.matchId} ${x.modeId || "?"}${x.modeVariantId ? `:${x.modeVariantId}` : ""} map ${x.map ?? "?"} bots=${x.bots}`);
  L.push(`server: ${r.server.hostname || "?"} node ${r.server.node || "?"} cpus=${r.server.cpus ?? "?"} | ${rooms.join("; ") || "no room joined"}`);
  L.push(`duration ${fmt(r.durationS)}s of live ticks, clients: ${Object.keys(r.clients).join(", ") || "none"}`);
  if (r.probe) L.push(probeLine(r.probe));
  if (r.fairness?.summary) L.push(r.fairness.summary);
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
    if (c.flags) L.push(`flags in effect: ${JSON.stringify(c.flags.effective || {})} (from URL/session: ${JSON.stringify(c.flags.urlFlags || {})})`);
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
      if (a.drawnToTestedConfirmed?.n) L.push(`  confirmed hits: predicted contact → server-tested target p50/p95 ${q(a.drawnToTestedConfirmed)}px`);
      L.push(`  attacker truth by delivery: ${Object.entries(a.predictionsByDelivery || {}).map(([d, n]) => `${d} ${a.unconfirmedByDelivery?.[d] || 0}/${n} unconfirmed`).join(", ") || "no predictions"}; damaging hits ${Object.entries(a.hitsByDelivery || {}).map(([d, n]) => `${d} ${n}`).join(", ") || "none"}`);
      for (const u of (a.unconfirmedList || []).slice(0, 12)) {
        L.push(`  unconfirmed t=${fmt(u.t / 1000, 2)}s → ${u.target} ${u.attack || "?"} (${u.delivery || "?"})${u.id ? ` id ${u.id}${u.matchedById ? "" : " (request by time)"}` : ""} ${fmt(u.sinceRequestMs)}ms after request | rewind requested ${fmt(u.rewindRequestedMs)} applied ${fmt(u.rewindAppliedMs)}ms${u.rewindCapped ? " CAPPED" : ""} | drawn→tested ${u.drawnToTestedPx == null ? "-" : `${u.drawnToTestedPx}px (${u.drawnToTested.join(",")})`}${u.stall ? " | server stall" : ""}`);
      }
      if ((a.unconfirmedList || []).length > 12) L.push(`  … ${a.unconfirmedList.length - 12} more unconfirmed in report.json`);
    }
    const v = c.victim;
    if (v?.hits) {
      const row = (x) => (x?.n ? `n=${x.n} ${fmt(x.px.p50)}/${fmt(x.px.p95)}/${fmt(x.px.max)}px ${fmt(x.ms.p50)}/${fmt(x.ms.p95)}ms, >${v.limitPx}px ${x.overLimit}, >½body(${v.halfBodyPx}px) ${x.overHalfBody}` : "n=0");
      L.push(`self-view staleness, victim drawn→server-tested (${v.measured}/${v.hits} hits taken measured; tested from ${Object.entries(v.sources).map(([k, n]) => `${k} ${n}`).join(", ")}; p50/p95/max): all ${row(v.all)} | from humans ${row(v.fromHumans)}`);
      for (const [d, x] of Object.entries(v.byDelivery)) L.push(`  ${d}: ${row(x)}`);
      for (const w of v.worst.slice(0, 4)) L.push(`  worst t=${fmt(w.t / 1000, 2)}s by ${w.attacker}${w.bot ? " (bot)" : ""} ${w.aChar || ""} ${w.type} (${w.delivery}) ${w.displacementPx}px (${w.dx},${w.dy}) age ${w.ageMs}ms rewind ${fmt(w.rewindMs)}${w.rewindRequestedMs != null ? ` of ${w.rewindRequestedMs} requested` : ""} [${w.source}]`);
    }
    for (const line of screenLines(c.screen)) L.push(line);
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

// Victim screen truth lines for one client (or a pool): all shots, then per
// shooter character.
function screenLines(v) {
  if (!v) return [];
  const q = (x) => (x?.n ? `${fmt(x.p50)}/${fmt(x.p95)}` : "-");
  const pct = (x) => (x == null ? "-" : `${Math.round(x * 100)}%`);
  const L = [];
  const row = (label, a) => `${label}: released hits ${a.releasedHits} (${a.traced} traced), screen-agreed ${a.agreed} (${pct(a.agreedShare)}), ` +
    `miss gap p50/p95 ${q(a.missGap)}px, gap at server hit ${q(a.gapAtReg)}px, touch before hit ${q(a.touchLeadMs)}ms | ` +
    `shots ${a.shots}, touched ${a.touched}, phantom ${a.phantom} (${pct(a.phantomShare)}) hold ${q(a.phantomHoldMs)}ms | ` +
    `lead ${q(a.lead)}ms (target ${q(a.targetLead)}: R ${q(a.R)} + uplink ${q(a.uplink)} (rtt/2 ${q(a.rtt2)}) + P ${q(a.P)})` +
    (a.attachedHits ? ` | attached hits ${a.attachedHits}: attacker body→my body ${q(a.attachedBodyGap)}px` : "") +
    (a.hitLeadN ? ` | lead error (server age at test − drawn age, full lead shown) hits ${q(a.leadErrHit)}ms (n ${a.hitTracked}; with rtt/2 as uplink ${q(a.leadErrHitHalfPing)}), in ramp ${q(a.leadErrRamp)}ms;` +
      ` tested frame unseen/ramp/full ${a.hitPhases?.unseen}/${a.hitPhases?.ramp}/${a.hitPhases?.full} (unseen by ${q(a.unseenByMs)}ms), gap drawn at test ${q(a.gapAtTestedHit)}px` +
      `; phantoms unseen/ramp/full/far ${a.phantomPhases?.unseen}/${a.phantomPhases?.ramp}/${a.phantomPhases?.full}/${a.phantomPhases?.far}, lead error ${q(a.leadErrPhantom)}ms, server missed by ${q(a.phantomServerGap)}px` : "");
  L.push(`victim screen truth (touch ≤${v.touchPx ?? 3}px, p50/p95) ${row("all", v.all)}`);
  for (const [k, a] of Object.entries(v)) if (!["all", "samples", "touchPx"].includes(k)) L.push(`  screen ${row(`from ${k}`, a)}`);
  return L;
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
    // Fairness per client: net profile, attacker truth, victim truth.
    ...Object.fromEntries(Object.entries(r.clients || {}).flatMap(([tag, c]) => {
      const p = r.probe?.clients?.[tag];
      const a = c.attacks, v = c.victim;
      return [
        [`${tag}:char/net`, `${a?.character || c.character || "?"}/${p ? p.net?.name || "fast" : "?"}`],
        [`${tag}:rttP50`, p?.rtt?.game?.p50 ?? c.rttMin],
        [`${tag}:requests`, a?.requests], [`${tag}:hits`, a?.hits],
        [`${tag}:unconf%`, a?.predictions ? (a.unconfirmed / a.predictions) * 100 : null],
        [`${tag}:hitsTaken`, v?.hits ?? a?.hitsTaken],
        [`${tag}:victimP50px`, v?.all?.px?.p50], [`${tag}:victimP95px`, v?.all?.px?.p95], [`${tag}:victimMaxPx`, v?.all?.px?.max],
        [`${tag}:victim>${v?.limitPx ?? 40}px`, v?.all?.overLimit],
        [`${tag}:victimAgeP95ms`, v?.all?.ms?.p95],
        [`${tag}:screenAgreed%`, c.screen?.all?.agreedShare == null ? null : c.screen.all.agreedShare * 100],
        [`${tag}:screenMissP95px`, c.screen?.all?.missGap?.p95],
        [`${tag}:phantom%`, c.screen?.all?.phantomShare == null ? null : c.screen.all.phantomShare * 100],
        [`${tag}:phantomHoldP50`, c.screen?.all?.phantomHoldMs?.p50],
        [`${tag}:leadP50ms`, c.screen?.all?.lead?.p50],
      ];
    })),
  };
}

function compare(a, b) {
  const A = comparable(a.report), B = comparable(b.report);
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])];
  const L = [];
  for (const x of [a, b]) {
    const line = x.report.fairness?.summary || "fairness: (report.json predates fairness metrics; re-run net-report on it)";
    L.push(`${x.runId}: ${line}`);
  }
  L.push(`${pad("metric", 22)} ${pad(a.runId, 26)} ${b.runId}`);
  for (const k of keys) L.push(`${pad(k, 22)} ${pad(fmt(A[k], 1), 26)} ${fmt(B[k], 1)}`);
  return L.join("\n");
}

// Victim screen truth pooled over several runs (e.g. one probe --matches
// series), per client tag; each run must have a report.json.
function pool(ids) {
  const byTag = {};
  const L = [];
  for (const id of ids) {
    let report;
    try { report = JSON.parse(fs.readFileSync(path.join(OUT_ROOT, id, "report.json"), "utf8")); } catch (e) { L.push(`(skipped ${id}: ${e.message})`); continue; }
    for (const [tag, c] of Object.entries(report.clients || {})) {
      const p = report.probe?.clients?.[tag];
      const b = (byTag[tag] ||= { hits: [], shots: [], leads: [], labels: new Set() });
      b.labels.add(`${c.attacks?.character || c.character || "?"}/${p?.net?.name || "fast"}${p?.flags ? ` {${p.flags}}` : ""}`);
      b.hits.push(...(c.screen?.samples?.hits || []));
      b.shots.push(...(c.screen?.samples?.shots || []));
      b.leads.push(...(c.screen?.samples?.leads || []));
    }
  }
  L.unshift(`# Victim screen truth pooled over ${ids.length} runs: ${ids.join(", ")}`);
  for (const [tag, b] of Object.entries(byTag)) {
    const v = { touchPx: 3, ...summarizeVictimScreen(b) };
    L.push(`## ${tag} (${[...b.labels].join(", ")}): ${victimScreenLine(v)}`);
    for (const line of screenLines(v)) L.push(line);
  }
  return L.join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.pool) {
  console.log(pool([args.pool, ...args._].filter(x => typeof x === "string")));
  process.exit(0);
}
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
const report = analyzeRun({ ...loadRun(dir), probe: readProbe(runId, dir) });
const outDir = path.join(OUT_ROOT, runId);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 1));
const text = args.json ? JSON.stringify(report, null, 1) : printReport(runId, report);
if (args.brief && !args.json) {
  // Verdict, the server block, and each client's headline and attack lines.
  const keep = /^(#|- |probe:|fairness:|flags in effect|loop |snapshot emission|bots:|navigation|host:|stall attribution|max socket|step phases|## |gaps >=|corrections:|rubber-band:|attacks |  predicted|  predictions|  confirmed hits|  attacker truth|self-view staleness|victim screen truth|  screen |  (attached|released|area|self|\?):|render:)/;
  console.log(text.split("\n").filter(l => keep.test(l) && !l.startsWith("## Notable")).join("\n"));
} else console.log(text);
if (args.baseline && typeof args.baseline === "string") {
  try {
    const base = JSON.parse(fs.readFileSync(path.join(OUT_ROOT, args.baseline, "report.json"), "utf8"));
    console.log("\n" + compare({ runId: args.baseline, report: base }, { runId, report }));
  } catch (e) { console.log(`(no baseline ${args.baseline}: ${e.message})`); }
}
console.log(`\n(report.json: ${path.relative(root, path.join(outDir, "report.json"))}; raw: ${dir})`);
