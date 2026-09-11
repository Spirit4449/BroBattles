// Measure six firing Huntresses under a repeatable headless workload; not a GPU or hosting benchmark.
const { makeRoom } = require('../tests/helpers/botRoom');
const combat = require('../src/server/core/gameRoom/huntressCombat');
const runtime = require('../src/server/core/gameRoom/attackRuntimeManager');
const { broadcastSnapshot } = require('../src/server/core/gameRoom/roomStateManager');
const { advanceAmmo } = require('../src/server/core/bots/combat');
const { STEP_MS } = require('../src/shared/huntressProjectile');
const originalNow = Date.now;
const originalLog = console.log;
function run() {
  console.log = () => {};
  const { room, players } = makeRoom({ characters: Array(6).fill('huntress') });
  room.botControllers.clear();
  room.geometry = { ...room.geometry, colliders: [] };
  players.forEach((p,i) => Object.assign(p,{x:200+i*220,y:250,health:1e8,maxHealth:1e8}));
  let bytes = 0, events = 0, now = 1e9;
  room.io = { sockets: {sockets:new Map()}, to() { return { compress() {return this;}, emit(_type,payload) {
    bytes += Buffer.byteLength(JSON.stringify(payload)); events++;
  } }; } };
  Date.now = () => now;
  const times=[];
  try {
    for(let tick=0;tick<3600;tick++) {
      now+=STEP_MS;room._tickId=tick;room._simulationMono=now;
      const started=performance.now();
      for(const p of players) {
        advanceAmmo(p,STEP_MS);
        if(tick%90===0&&p.ammoState.charges>0) {
          room.handlePlayerAction(p.participantId,{type:'huntress-arrow',id:`${tick}`,angle:-0.4,power:0.5,speed:490});
        }
      }
      room.processTick();runtime.tickActiveAttacks(room,now);combat.tick(room);
      if(tick%2===0)broadcastSnapshot(room);
      if(tick>120)times.push(performance.now()-started);
    }
    times.sort((a,b)=>a-b);
    return {tickP95Ms:+times[Math.floor(times.length*.95)].toFixed(3),
      tickP99Ms:+times[Math.floor(times.length*.99)].toFixed(3),bytesPerSecond:Math.round(bytes/60),events};
  } finally {Date.now=originalNow;room.cleanup();console.log=originalLog;}
}
for(let trial=0;trial<3;trial++) console.log(JSON.stringify({trial,authoritative:run()}));
