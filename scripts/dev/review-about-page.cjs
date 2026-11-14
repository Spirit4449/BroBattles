// Browser verification of the real server-rendered About page and built bundle.
// No database/dev server. Run after npm run build, with CHROME_EXECUTABLE if needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright-core');
const { registerSitePages } = require('../../src/server/services/site/siteContent');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/about-gameplay');
const clips = require('../../src/shared/site/aboutClips.json').map(clip => clip.key);
const [firstClip, secondClip] = clips;

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.get('/api/site/session', (_req,res) => res.json({ authenticated:false, unread:0 }));
  app.get('/api/site/runtime', (_req,res) => res.json({ serverTime:Date.now() }));
  app.get('/api/version', (_req,res) => res.json({ version:'local-preview' }));
  registerSitePages(app);
  app.use('/assets',express.static(path.join(root,'public/assets')));
  app.use(express.static(path.join(root,'dist')));
  const server = await new Promise(resolve => { const s=app.listen(0,'127.0.0.1',()=>resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless:true, ...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {}) });
  try {
    const page = await browser.newPage({ viewport:{width:1440,height:1000} });
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${origin}/about`);
    await page.locator('[data-about-reel] video').evaluate(video=>new Promise(resolve=>{if(video.readyState>=2)resolve();else video.addEventListener('loadeddata',resolve,{once:true});}));
    await page.waitForFunction(()=>document.querySelector('[data-about-reel] video').currentTime>.1);
    await page.locator('[data-reel-toggle]').click();
    assert.equal(await page.locator('[data-about-reel] video').evaluate(video=>video.paused),true);
    await page.screenshot({path:path.join(output,'about-desktop.png'),fullPage:true});
    // The reel only plays while visible, so bring it back into view first.
    await page.evaluate(()=>scrollTo(0,0));
    await page.locator('[data-reel-toggle]').click();
    await page.waitForFunction(key=>document.querySelector('[data-about-reel] video').currentSrc.endsWith(`${key}.mp4`)&&!document.querySelector('[data-about-reel] video').paused,firstClip);
    // Clips play in order and loop: an ended clip moves on to the next one.
    const clipCount = require('../../src/shared/site/aboutClips.json').length;
    for(let step=1; step<=clipCount; step++) {
      const next = clips[step % clipCount];
      await page.locator('[data-about-reel] video').evaluate(video=>video.dispatchEvent(new Event('ended')));
      await page.waitForFunction(key=>document.querySelector('[data-about-reel] video').currentSrc.endsWith(`${key}.mp4`),next);
    }
    await page.locator('[data-reel-toggle]').click();
    await page.locator('#fighters').scrollIntoViewIfNeeded();
    // The Bros tabs swap panels and the level-up demo reaches the next level.
    await page.locator('#tab-thorg').click();
    assert.equal(await page.locator('#fighter-thorg').isVisible(),true);
    assert.equal(await page.locator('#fighter-ninja').isVisible(),false);
    await page.locator('.about-bro.is-active [data-upgrade-button]').click();
    await page.waitForFunction(()=>document.querySelector('[data-level-badge]').dataset.level==='2');
    await page.waitForFunction(()=>document.querySelector('.about-bro-stage').classList.contains('is-live'));
    await page.locator('#reel').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('[data-about-reel] video').evaluate(video=>video.paused),true);
    // Reduced motion makes no video request until an explicit play action.
    const quiet = await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
    const media=[];quiet.on('request',r=>{if(r.url().endsWith('.mp4'))media.push(r.url());});
    await quiet.goto(`${origin}/about`);
    await quiet.locator('[data-reel-toggle]').waitFor();
    assert.equal(await quiet.locator('[data-about-reel] video').getAttribute('src'),null);
    assert.equal(media.length,0);
    await quiet.screenshot({path:path.join(output,'about-mobile.png'),fullPage:true});
    assert.equal(await quiet.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await quiet.locator('[data-reel-toggle]').click();
    await quiet.waitForFunction(()=>document.querySelector('[data-about-reel] video').currentTime>.1);
    // Fetch/decode failure exposes retry and keeps the still.
    await quiet.route(`**/${secondClip}.mp4`,route=>route.abort());
    await quiet.locator('[data-about-reel] video').evaluate(video=>video.dispatchEvent(new Event('ended')));
    await quiet.locator('[data-reel-status]').waitFor({state:'visible'});
    await quiet.unroute(`**/${secondClip}.mp4`);
    await quiet.locator('[data-reel-toggle]').click();
    await quiet.waitForFunction(()=>document.querySelector('[data-about-reel] video').currentTime>.1);
    // Data Saver is independent of reduced motion.
    const saver=await browser.newPage();
    await saver.addInitScript(()=>Object.defineProperty(navigator,'connection',{value:{saveData:true,addEventListener(){},removeEventListener(){}}}));
    await saver.goto(`${origin}/about`);
    assert.equal(await saver.locator('[data-about-reel] video').getAttribute('src'),null);
    assert.deepEqual(errors,[]);
    console.log(`PASS: desktop/mobile layout; decoded real clips; looping order; pause; fighter tabs and level-up; reduced motion; Data Saver; failed-media retry. Screenshots: ${output}`);
  } finally { await browser.close();server.close(); }
})().catch(error=>{console.error(error);process.exit(1);});
