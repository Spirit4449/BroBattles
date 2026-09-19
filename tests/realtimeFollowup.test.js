const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const { BotController } = require('../src/server/core/bots/controller');
const { reconcileFlight } = require('../src/shared/projectilePresentation');
const animation = {};
vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/characters/shared/animationState'), 'utf8'), {
  babelrc:false, configFile:false, presets:[['@babel/preset-env',{targets:{node:'current'}}]],
}).code, { exports:animation, performance:{now:()=>1000} });

test('remote physical velocity overrides stale jumping, falling and wall-slide labels', () => {
  for (const character of ['ninja','huntress','wizard','thorg','draven','gloop']) {
    const select = state => animation.chooseRemoteAnimationState({character, animation:'jumping', currentPosition:state});
    assert.equal(select({grounded:false,vy:120}), 'falling');
    assert.equal(select({grounded:false,vy:-200,wallSliding:true}), 'sliding');
    assert.equal(animation.chooseRemoteAnimationState({character,animation:'sliding',currentPosition:{grounded:false,vy:-200,wallSliding:false}}),'jumping');
  }
});

test('wall kick restarts jump exactly once and a landing resets the airborne guard', () => {
  const calls=[], sprite={body:{touching:{down:false}},anims:{currentAnim:{key:'ninja-jumping'},isPlaying:true,play:(...args)=>calls.push(args)}};
  const play=()=>animation.playCharacterAnimation({scene:{},sprite,character:'ninja',logical:'jumping',resolveAnimKey:()=> 'ninja-jumping'});
  const state=(seq,grounded=false)=>animation.chooseRemoteAnimationState({animation:'jumping',sprite,currentPosition:{movementFxSeq:seq,movementFxType:'wall-jump',grounded,vy:grounded?0:-300}});
  state(1);play();
  state(2);play();assert.equal(calls.length,2);assert.equal(calls[1][1],false);
  state(2);play();assert.equal(calls.length,2);
  state(3,true);state(4);play();assert.equal(calls.length,3);
  animation.resetAirborneJumpAnimation(sprite);play();assert.equal(calls.at(-1)[1],false);
});

test('flight error converges without a constant-speed shot stopping or reversing', () => {
  for(const error of [10,45,100,200]) {
    const speed=700,c=reconcileFlight({x:error,y:0},{x:0,y:0},0,speed);
    let last=error;
    for(let t=10;t<=c.duration+20;t+=10) {
      const x=speed*t/1000+c.x*Math.max(0,1-t/c.duration);
      assert.ok(x>last);last=x;
    }
    assert.equal(Math.max(0,1-c.duration/c.duration),0);
  }
});

test('planning yields, resumes, and never executes when the room budget is exhausted', () => {
  let units=0;
  const brain=Object.create(BotController.prototype);
  Object.assign(brain,{room:{_botPlanningDeadline:performance.now()-1},player:{lastDamagedAt:0},metrics:{},planning:{at:100,damageAt:0,steps:(function*(){for(let i=0;i<300;i++){units++;yield;}})()}});
  brain.advancePlanning(100);assert.equal(units,0);
  brain.room._botPlanningDeadline=Infinity;
  brain.advancePlanning(116);assert.ok(units>0&&units<=128);assert.ok(brain.planning);
  for(let i=0;i<20&&brain.planning;i++)brain.advancePlanning(132+i);
  assert.equal(units,300);assert.equal(brain.planning,null);
});

test('damage and long stalls discard obsolete bot planning before it can issue actions', () => {
  for(const scenario of [{now:101,damage:1},{now:700,damage:0}]) {
    const brain=Object.create(BotController.prototype);
    Object.assign(brain,{room:{},player:{lastDamagedAt:scenario.damage},metrics:{},planning:{at:100,damageAt:0,steps:{next(){assert.fail('obsolete plan ran');}}}});
    brain.advancePlanning(scenario.now);assert.equal(brain.planning,null);assert.equal(brain.nextThink,0);
  }
});
