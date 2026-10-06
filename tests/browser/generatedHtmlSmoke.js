import { createPlayerCardTile } from "../../src/client/views/playerCardTile.js";
import { createPlayerCardMedia } from "../../src/client/views/playerCardAnimation.cjs";
import { showPlayerCardPreview } from "../../src/client/views/playerCardPreview.js";
import { initializeShop, createRewardPresentation } from "../../src/client/lobby/shop/shop.js";
import playerCards from "../../src/shared/catalogs/playerCardsCatalog.json";
import { renderCharacterStatus } from "../../src/client/lobby/profile/characterStatusView.js";
import { createModalFocus } from "../../src/client/ui/modalFocus.js";
import { getSharedSelectionPopupShell } from "../../src/client/ui/selectionPopupShell.js";
import { createViewersPopup } from "../../src/client/chat/viewersPopup.js";
import { showUiConfirm } from "../../src/client/ui/uiConfirm.js";
import { createGameHudController } from "../../src/client/game/hud/gameHudController.js";
import "../../src/client/styles/levelBadge.css";

function check(condition, message) {
  if (!condition) throw new Error(message);
}
function key(value, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true });
  document.activeElement.dispatchEvent(event);
  return event;
}
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));

function assertNoGreenSpill(image, name) {
  const sample = document.createElement('canvas');
  sample.width = image.videoWidth || image.naturalWidth;
  sample.height = image.videoHeight || image.naturalHeight;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, sample.width, sample.height).data;
  let green = 0;
  for (let p = 0; p < pixels.length; p += 4) {
    if (pixels[p + 3] > 20 && pixels[p + 1] > 60 && pixels[p + 1] > Math.max(pixels[p], pixels[p + 2]) + 25) green++;
  }
  check(green < 20, `green spill remains on ${name}: ${green} pixels`);
}

window.htmlSmoke = {
  async runCardCleanup() {
    for (const card of playerCards.cards.filter(card => ['astral-amethyst', 'mjolnirs-anvil', 'wizard-spell'].includes(card.id))) {
      const video = document.createElement('video');
      video.muted = true;
      video.src = card.animationUrl;
      document.body.append(video);
      try {
        await video.play();
        video.pause();
        check(video.videoWidth === card.battleViewport.width, `${card.id} export resolution`);
        for (const time of [.1, 1.5, 2.5, 3.5, 4.5, 5.5]) {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`${card.id} seek timeout`)), 5000);
            video.addEventListener('seeked', () => { clearTimeout(timeout); resolve(); }, { once: true });
            video.currentTime = time;
          });
          assertNoGreenSpill(video, `${card.id} at ${time}s`);
        }
      } finally { video.removeAttribute('src'); video.load(); video.remove(); }
    }
    return ['decoded green cleanup and resolution across all three repaired animations'];
  },
  async runBattleLayout() {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/styles/game.css';
    const loaded = new Promise(resolve => { css.onload = resolve; });
    document.head.append(css);
    await loaded;
    const overlay = document.createElement('div');
    overlay.id = 'battle-start-overlay';
    overlay.innerHTML = '<div class="bs-panel"><div class="bs-grid"><div id="bs-your" class="bs-col"></div><div id="bs-opp" class="bs-col"></div></div></div>';
    document.body.append(overlay);
    const originalFetch = window.fetch;
    window.fetch = (url, options) => url === '/player-cards/catalog'
      ? Promise.resolve({ ok: true, json: async () => ({ catalog: playerCards }) })
      : originalFetch(url, options);
    const hud = createGameHudController({ getGameData: () => ({ yourTeam: 1, modeId: 'duels' }) });
    try {
      for (const count of [1, 2, 4]) {
        for (let offset = 0; offset < playerCards.cards.length; offset += count * 2) {
          const cards = Array.from({ length: count * 2 }, (_, i) => playerCards.cards[(offset + i) % playerCards.cards.length]);
          hud.showBattleStartOverlay(cards.map((card, i) => ({
            name: card.name, selected_card_id: card.id, team: i < count ? 1 : 2,
            char_class: 'thorg', trophies: 8319, level: 4,
            stats: { health: 15000, damage: 1900, specialDamage: 3600 },
          })));
          await tick(60);
          overlay.classList.add('phase-cards');
          const nodes = [...overlay.querySelectorAll('.bs-player-card')];
          nodes.forEach(node => { node.style.transition = 'none'; node.classList.add('is-in'); });
          await Promise.all([...overlay.querySelectorAll('img')].map(img => img.decode().catch(() => {})));
          const reference = nodes[0].getBoundingClientRect();
          for (const [i, node] of nodes.entries()) {
            const rect = node.getBoundingClientRect();
            check(Math.abs(rect.width - reference.width) < 0.1 && Math.abs(rect.height - reference.height) < 0.1, 'battle containers must match');
            check(rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight, 'battle card must fit viewport');
            const frame = node.querySelector('.bs-card-frame');
            const poster = frame.matches('img') ? frame : frame.querySelector('img');
            const art = poster.getBoundingClientRect();
            check(Math.abs(art.width / art.height - poster.naturalWidth / poster.naturalHeight) < .001,
              cards[i].id + ' artwork must preserve its natural proportions');
            const view = cards[i].battleViewport;
            const scale = art.width / view.width;
            const fit = Math.min(rect.width / view.w, rect.height / view.h);
            check(Math.abs(art.left + (view.x + view.w / 2) * scale - (rect.left + rect.width / 2)) < 1, 'frame centered horizontally');
            check(Math.abs(art.top + (view.y + view.h / 2) * scale - (rect.top + rect.height / 2)) < 1, 'frame centered vertically');
            check(scale < fit && scale > fit * .8, 'frame uses a modest uniform reduction');
            const video = frame.querySelector('video');
            if (video) {
              const playing = video.getBoundingClientRect();
              check(['x', 'y', 'width', 'height'].every(key => Math.abs(playing[key] - art[key]) < 0.1), 'video and poster geometry must match');
            }
          }
        }
      }
      return ['all 13 cards preserve proportions with uniformly reduced frames in solo, duo, and full teams'];
    } finally {
      overlay.remove(); css.remove(); window.fetch = originalFetch;
    }
  },
  async runPreviewLayout() {
    const previousScope = window.__BB_PAGE_SCOPE__;
    const cleanups = new Set();
    window.__BB_PAGE_SCOPE__ = { onDispose(callback) {
      cleanups.add(callback);
      return () => cleanups.delete(callback);
    } };
    let preview;
    try {
      for (const ids of [['arena-crown'], ['shuriken-strike'], ['arena-crown', 'radiant-silver']]) {
        preview = showPlayerCardPreview(ids.map(id => ({ kind: 'card', id })));
        await tick(100);
        for (const canvas of preview.querySelectorAll('.player-card-canvas')) {
          const box = canvas.getBoundingClientRect();
          const video = canvas.querySelector('video').getBoundingClientRect();
          check(video.left >= box.left - 1 && video.right <= box.right + 1 &&
            video.top >= box.top - 1 && video.bottom <= box.bottom + 1,
            'preview clips the full animation effect canvas');
          const caption = canvas.parentElement.querySelector('figcaption').getBoundingClientRect();
          check(video.bottom <= caption.top + 1, 'preview effects overlap the rarity caption');
        }
        const videos = [...preview.querySelectorAll('video')];
        preview.close();
        await tick(50);
        check(!preview.isConnected && cleanups.size === 0, 'closed preview retained page cleanup registrations');
        check(videos.every(video => !video.getAttribute('src')), 'closed preview retained a video decoder');
      }
      // Immediate dismissal must clean up even before visibility observers run.
      preview = showPlayerCardPreview([{ kind: 'card', id: 'arena-crown' }]);
      preview.close();
      await tick(50);
      check(cleanups.size === 0, 'immediately closed preview retained cleanup registrations');
      preview = showPlayerCardPreview([{ kind: 'card', id: 'arena-crown' }]);
      for (const cleanup of [...cleanups]) cleanup();
      check(!preview.isConnected && cleanups.size === 0, 'page disposal retained an open preview');
    } finally {
      preview?.close();
      for (const cleanup of [...cleanups]) cleanup();
      if (previousScope) window.__BB_PAGE_SCOPE__ = previousScope;
      else delete window.__BB_PAGE_SCOPE__;
    }
    return ['full preview effect bounds and cleanup on close/page disposal'];
  },
  async runRewardLayout() {
    const host = document.createElement('div');
    document.body.append(host);
    const presentation = createRewardPresentation({ state: { overlay: host }, updateWallet() {} });
    try {
      for (const id of ['radiant-emerald', 'astral-amethyst', 'arena-crown']) {
        const card = playerCards.cards.find(card => card.id === id);
        const grant = { kind: 'card', id, name: card.name };
        const revealed = presentation.showRewardReveal({
          result: { wallet: {}, grants: [grant] },
          item: { name: card.name, rarity: card.rarity, grants: [grant] },
          kind: 'trophy',
        });
        await tick(900); // Both the panel and reward entrance transforms must finish.
        const box = host.querySelector('.player-card-canvas').getBoundingClientRect();
        const media = host.querySelector('video').getBoundingClientRect();
        const panel = host.querySelector('.shop-reveal-panel').getBoundingClientRect();
        const heading = host.querySelector('.shop-reveal-heading').getBoundingClientRect();
        const done = host.querySelector('.reward-continue').getBoundingClientRect();
        const view = card.animationViewport;
        const scale = Math.min(box.width / view.w, box.height / view.h) * (card.renderScale || 1);
        const artworkScale = media.width / view.width;
        const logicalWidth = view.w * artworkScale;
        const logicalHeight = view.h * artworkScale;
        check(box.height > 200, `${id}: reward card container is too small`);
        check(Math.abs(logicalWidth - view.w * scale) < 2 && Math.abs(logicalHeight - view.h * scale) < 2,
          `${id}: reward artwork shrank inside its container (${logicalWidth}x${logicalHeight} in ${box.width}x${box.height})`);
        check(Math.abs(media.left + (view.x + view.w / 2) * artworkScale - (panel.left + panel.width / 2)) < 2,
          `${id}: reward artwork is not horizontally centered`);
        check(Math.abs(media.top + (view.y + view.h / 2) * artworkScale - (box.top + box.height / 2)) < 2,
          `${id}: reward artwork is not vertically centered in its container`);
        check(heading.top > panel.top && done.bottom < panel.bottom,
          `${id}: reward title or Done button is clipped`);
        presentation.closeReveal();
        await revealed;
      }
    } finally { presentation.closeReveal(); host.remove(); }
    return ['real player-card reveal size and centering after entrance animations'];
  },
  async run() {
    const results = [...await this.runRewardLayout(), ...await this.runPreviewLayout()];
    const malicious = '<img src=x onerror="window.injected=true"> & "quoted"';
    for (const lobby of [false, true]) {
      const card = createPlayerCardTile({ name: malicious, id: malicious, rarity: 'rare" onclick="oops', assetUrl: '/assets/x.webp" onerror="window.injected=true' }, { lobby });
      document.body.append(card);
      check(card.querySelectorAll("img").length === 1, "card name created an image");
      check(card.querySelector("strong").textContent === malicious, "card name was corrupted");
      check(card.querySelector("button").dataset.cardId === malicious, "card ID was corrupted");
      check(!card.querySelector("[onerror], [onclick]"), "card interpolation created a handler");
      check(card.querySelector("button").type === "button", "card button submits forms");
      card.remove();
    }
    check(createPlayerCardTile({}, { selected: true }).querySelector("button").disabled, "selected card is actionable");
    results.push("safe profile cards");

    for (const card of playerCards.cards.filter(card => card.animationUrl?.endsWith('.webm'))) {
      const tile = createPlayerCardTile(card, { lobby: true });
      tile.style.width = '200px';
      document.body.append(tile);
      const video = tile.querySelector('video');
      check(video && !video.getAttribute('src'), 'profile downloaded video before interaction');
      const still = tile.querySelector('.player-card-still');
      check(still?.src.endsWith(card.assetUrl) && still.style.opacity === '1', 'independent still missing before download');
      const requestFrame = video.requestVideoFrameCallback.bind(video);
      let releaseFrame;
      video.requestVideoFrameCallback = callback => requestFrame((...args) => { releaseFrame = () => callback(...args); });
      tile.dispatchEvent(new MouseEvent('mouseenter'));
      for (let attempt = 0; attempt < 100 && video.currentTime === 0; attempt++) await tick(50);
      check(video.currentTime > 0 && !video.paused, `profile video failed to play: ${card.id}, src=${video.getAttribute('src')}, ready=${video.readyState}, error=${video.error?.message}, y=${video.getBoundingClientRect().y}, hidden=${document.hidden}`);
      check(video.getAttribute('src').startsWith('blob:'), 'video bypassed the shared download queue');
      for (let attempt = 0; attempt < 50 && !releaseFrame; attempt++) await tick(20);
      check(releaseFrame && video.style.opacity === '0' && still.style.opacity === '1', 'poster disappeared before the decoded frame was presented');
      video.requestVideoFrameCallback = requestFrame;
      releaseFrame();
      await tick(200);
      check(video.style.opacity === '1' && still.style.opacity === '0', 'ready video did not replace the still layer');
      const stillBounds = still.getBoundingClientRect();
      const videoBounds = video.getBoundingClientRect();
      check(['x', 'y', 'width', 'height'].every(key => Math.abs(stillBounds[key] - videoBounds[key]) < 1), 'still and video layers are misaligned');
      const downloadedUrl = video.getAttribute('src');
      const box = tile.querySelector('.player-card-canvas').getBoundingClientRect();
      const canvasBounds = video.getBoundingClientRect();
      const view = card.animationViewport;
      const scale = Math.min(box.width / view.w, box.height / view.h) * (card.renderScale || 1);
      check(Math.abs(canvasBounds.width - view.width * scale) < 1 &&
        Math.abs(canvasBounds.height - view.height * scale) < 1, 'animated card does not match its viewport scale');
      await still.decode();
      // These frames have no green artwork. Slime and emerald intentionally do.
      const cleanGreen = ['shuriken-strike', 'astral-amethyst', 'mjolnirs-anvil', 'wizard-spell'].includes(card.id);
      if (cleanGreen) assertNoGreenSpill(still, `${card.id} poster`);
      let presented = 0;
      let sampling = true;
      const countFrame = () => { presented++; if (sampling) video.requestVideoFrameCallback(countFrame); };
      video.requestVideoFrameCallback(countFrame);
      for (let i = 0; i < 6; i++) {
        await tick(200);
        if (cleanGreen) assertNoGreenSpill(video, card.id);
      }
      sampling = false;
      check(presented >= 16, `card playback dropped too many frames: ${card.id}, ${presented} in 1.2 seconds`);
      if (cleanGreen) {
        // Enclosed green appears during the later orb/particle bursts too.
        for (const time of [2.5, 3.5, 4.5, 5.5]) {
          await new Promise(resolve => {
            video.addEventListener('seeked', resolve, { once: true });
            video.currentTime = time;
          });
          assertNoGreenSpill(video, `${card.id} at ${time}s`);
        }
        // Seeking temporarily restores the still while the new frame decodes.
        for (let attempt = 0; attempt < 50 && video.style.opacity !== '1'; attempt++) await tick(20);
      }
      check(video.videoWidth === still.naturalWidth && video.videoHeight === still.naturalHeight,
        'video and poster canvases have different dimensions');
      check(Math.abs(video.videoWidth / video.videoHeight - view.width / view.height) < .001,
        'video canvas does not match its catalog aspect ratio');
      tile.dispatchEvent(new MouseEvent('mouseleave'));
      tile.dispatchEvent(new FocusEvent('focusout', { relatedTarget: null }));
      check(!video.paused && video.getAttribute('src') === downloadedUrl && video.style.opacity === '1',
        'started profile video stopped after hover/focus left');
      tile.style.display = 'none';
      for (let attempt = 0; attempt < 20 && !video.paused; attempt++) await tick(50);
      check(video.paused && video.getAttribute('src') === downloadedUrl, 'hidden profile did not pause/retain its decoder');
      check(still.style.opacity === '1' && video.style.opacity === '0', 'hidden profile did not restore its still');
      tile.style.display = '';
      for (let attempt = 0; attempt < 100 && video.style.opacity !== '1'; attempt++) await tick(30);
      check(video.style.opacity === '1', 'cached hover replay did not reveal its first frame');
      tile.remove();
      await tick(50);
      check(!video.getAttribute('src'), 'removed profile retained its decoder');
      const automatic = createPlayerCardMedia(card);
      document.body.append(automatic);
      for (let attempt = 0; attempt < 100 && automatic.currentTime === 0; attempt++) await tick(50);
      check(automatic.currentTime > 0 && automatic.loop && automatic.muted, 'automatic card did not loop silently');
      check(automatic.getAttribute('src') === downloadedUrl, 'automatic media did not reuse the downloaded bytes');
      automatic.style.display = 'none';
      for (let attempt = 0; attempt < 20 && !automatic.paused; attempt++) await tick(50);
      check(automatic.paused && automatic.getAttribute('src') === downloadedUrl, 'hidden card did not pause/retain its decoder');
      automatic.remove();
      await tick(50);
      check(!automatic.getAttribute('src'), 'removed automatic card retained its decoder');
    }
    results.push('profile hover and automatic video card playback');

    const previewTrigger = document.getElementById('trigger');
    previewTrigger.focus();
    const preview = showPlayerCardPreview([{ kind: 'card', id: 'arena-crown' }, { kind: 'card', id: 'shuriken-strike' }]);
    check(preview.open && preview.querySelectorAll('figure').length === 2, 'bundle preview omitted cards');
    const previewVideo = preview.querySelector('video');
    for (let attempt = 0; attempt < 100 && previewVideo.currentTime === 0; attempt++) await tick(50);
    check(previewVideo.currentTime > 0, 'popup card did not animate');
    check(previewVideo.dataset.animationState === 'ready', 'popup animation was not alpha-verified');
    const probeCanvas = document.createElement('canvas'); probeCanvas.width = probeCanvas.height = 1;
    const probeContext = probeCanvas.getContext('2d');
    probeContext.drawImage(previewVideo, 0, 0, 1, 1, 0, 0, 1, 1);
    check(probeContext.getImageData(0, 0, 1, 1).data[3] < 16, 'popup card has an opaque background');
    preview.querySelector('button').click();
    for (let attempt = 0; attempt < 30 && preview.isConnected; attempt++) await tick(20);
    check(!preview.isConnected && document.activeElement === previewTrigger, 'preview did not clean up or restore focus');
    results.push('animated bundle preview and transparent video pixels');

    const originalFetch = window.fetch;
    const crown = { kind: 'card', id: 'arena-crown', name: 'Crown of the Arena' };
    const bundle = { id: 'test-card-bundle', name: 'Card bundle', kind: 'bundle', grants: [crown], state: { owned: true } };
    window.fetch = (url, ...args) => url === '/api/shop/bootstrap'
      ? Promise.resolve(new Response(JSON.stringify({ wallet: {},
        sectionMeta: [{ id: 'sales', name: 'Sales', icon: '/assets/shop/icons/shop-v2.webp', rotation: 'sales' }],
        sections: { sales: [bundle] },
      }), { headers: { 'Content-Type': 'application/json' } }))
      : originalFetch(url, ...args);
    const shop = initializeShop();
    try {
      await shop.open('sales');
      const info = document.querySelector('[data-shop-card-preview="test-card-bundle"]');
      check(info && !info.disabled, 'owned card bundle has no preview button');
      info.click();
      const offerPreview = document.querySelector('dialog.player-card-preview');
      check(offerPreview?.open, 'info button did not open card preview');
      offerPreview.querySelector('button').click();
      await tick(50);
    } finally { shop.close(); window.fetch = originalFetch; }
    const rewardHost = document.createElement('div'); document.body.append(rewardHost);
    const rewardState = { overlay: rewardHost };
    const rewards = createRewardPresentation({ state: rewardState, updateWallet() {} });
    const revealed = rewards.showRewardReveal({ result: { wallet: {}, grants: [crown] }, item: bundle, kind: 'trophy' });
    const rewardVideo = rewardHost.querySelector('video');
    for (let attempt = 0; attempt < 100 && rewardVideo.currentTime === 0; attempt++) await tick(50);
    check(rewardVideo.currentTime > 0, 'unlocked card reveal did not animate');
    rewards.closeReveal(); await revealed; rewardHost.remove();
    document.querySelector('.shop-overlay')?.remove();
    results.push('shop info button and animated unlock reveal');

    const status = document.createElement("div");
    renderCharacterStatus(status, { isLocked: true, stats: { unlockPrice: malicious } });
    check(status.querySelectorAll("img").length === 1 && status.textContent.includes("0"), "invalid price injected markup");
    renderCharacterStatus(status, { isMaxed: true });
    check(status.classList.contains("maxed"), "maxed state missing");
    renderCharacterStatus(status, { price: 100 });
    check(!status.classList.contains("maxed") && status.classList.contains("upgradable"), "stale status class");
    renderCharacterStatus(status, { isLocked: true, stats: { unlockMethod: { type: "trophyRoad", min: 1500 } } });
    check(status.textContent.includes((1500).toLocaleString()) && !status.classList.contains("upgradable"), "trophy status incorrect");
    results.push("character status transitions");

    const trigger = document.getElementById("trigger");
    trigger.focus();
    const shell = getSharedSelectionPopupShell();
    const content = document.createElement("div");
    content.innerHTML = '<button disabled>Disabled</button><button hidden>Hidden</button><button id="last">Last</button>';
    shell.mount({ titleText: "Choose", contentNode: content, onClose: () => shell.hide() }).show();
    const last = content.querySelector("#last");
    check(document.activeElement === shell.closeButton, "picker did not take focus");
    check(shell.popup.getAttribute("aria-labelledby") === shell.title.id, "picker title not linked");
    check(shell.closeButton.getAttribute("aria-label"), "close button lacks a label");
    key("Tab", true);
    check(document.activeElement === last, "reverse Tab did not wrap past hidden controls");
    key("Tab");
    check(document.activeElement === shell.closeButton, "Tab did not wrap");
    document.getElementById("outside").focus();
    check(document.activeElement === shell.closeButton, "focus escaped picker");

    last.focus();
    const detail = document.createElement("div");
    detail.innerHTML = '<button>Close details</button>';
    document.body.append(detail);
    const nested = createModalFocus(detail, { onEscape: () => { detail.remove(); nested.deactivate(); } });
    nested.activate();
    key("Escape");
    check(!detail.isConnected && !shell.overlay.classList.contains("is-hidden"), "Escape closed underlying picker");
    check(document.activeElement === last, "nested close did not return focus");

    const confirmation = showUiConfirm({ title: "Confirm" });
    check(document.activeElement.closest('[role="dialog"]').classList.contains("cs-confirm"), "confirmation cannot receive focus above picker");
    key("Escape");
    check(await confirmation === false, "Escape did not cancel confirmation");
    check(document.activeElement === last, "confirmation did not return focus");

    const native = document.createElement("dialog");
    native.innerHTML = '<button>Native dialog</button>';
    document.body.append(native);
    native.showModal();
    check(document.activeElement === native.querySelector("button"), "picker stole native modal focus");
    native.close();
    native.remove();
    key("Escape");
    check(document.activeElement === trigger, "picker did not restore trigger");
    results.push("nested modal keyboard and focus behavior");

    shell.show();
    const replacement = document.createElement("div");
    replacement.innerHTML = '<button>New selection</button>';
    shell.mount({ contentNode: replacement }).show();
    check(shell.popup.contains(document.activeElement), "remount lost focus");
    shell.hide();
    results.push("picker remount");

    trigger.focus();
    const removedDialog = document.createElement("div");
    removedDialog.innerHTML = "<button>Temporary</button>";
    document.body.append(removedDialog);
    createModalFocus(removedDialog).activate();
    removedDialog.remove();
    await tick(0);
    document.getElementById("outside").focus();
    check(document.activeElement.id === "outside", "removed dialog kept its focus trap");
    check(!key("Tab").defaultPrevented, "removed dialog intercepted keyboard navigation");
    results.push("navigation cleanup");

    trigger.focus();
    let openedName;
    const viewers = createViewersPopup({ getCurrentUserName: () => "Me", onOpenProfile: name => { openedName = name; document.getElementById("outside").focus(); } });
    viewers.open({ viewers: [{ name: malicious, readAt: Date.now(), charClass: "ninja" }] }, trigger);
    const viewerCard = document.querySelector(".bb-chat-viewers-card");
    const viewerClose = viewerCard.querySelector("button");
    check(!viewerCard.querySelector("[onerror]"), "viewer name injected markup");
    key("Tab", true);
    check(document.activeElement !== viewerClose && viewerCard.contains(document.activeElement), "viewer reverse Tab failed");
    key("Tab");
    check(document.activeElement === viewerClose, "viewer forward Tab failed");
    viewerCard.querySelector(".bb-chat-viewer-name").click();
    check(openedName === malicious, "profile action lost username");
    await tick(150);
    check(document.activeElement.id === "outside", "closing viewer stole profile focus");
    viewers.open({ viewers: [] }, trigger);
    key("Escape");
    await tick(150);
    check(!viewers.isOpen() && document.activeElement === trigger, "viewer Escape/focus restore failed");
    viewers.destroy();
    document.getElementById("outside").focus();
    check(document.activeElement.id === "outside", "destroy left a focus trap");
    results.push("viewer keyboard, profile handoff, and cleanup");
    check(!window.injected, "HTML injection executed");
    return results;
  },
};
