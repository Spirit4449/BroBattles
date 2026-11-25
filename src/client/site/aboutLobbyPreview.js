// Presentation only. The About page supplies a scripted party and queue snapshot.
import { getLobbyBgAsset, getMapSelectPreviewAsset } from '../game/maps/manifest';
import { getMapLabel, getModeArtAsset, getModeLabel, getVariantDescriptor, normalizeGameSelection } from '../lib/gameSelectionCatalog.js';
import { updatePlatformsForMode } from '../lobby/party/partyPlatforms.js';
import { applyLobbyStatusVisualState, playLobbySpawnAnimation, statusToClass, triggerLobbyCharacterSplash } from '../lobby/party/slotEffects.js';
import { createMatchmakingOverlay } from '../lobby/matchmaking/matchmakingOverlay.js';
import { setSlotLevelBadge } from '../views/levelBadgeView.js';

import { previewRoster as roster } from './aboutParty.mjs';

const selection = normalizeGameSelection({ modeId: 'soccer' });

function mount(frame) {
  const byId = id => document.getElementById(id);
  const { modeId, modeVariantId, mapId } = selection;
  const { variant } = getVariantDescriptor(modeId, modeVariantId);
  document.body.style.backgroundImage = `url("${getLobbyBgAsset(mapId)}")`;
  byId('navbar-right').removeAttribute('data-account-loading');
  for (const [id, value] of Object.entries({
    'username-text': 'You', 'coin-count': '840', 'gem-count': '25', 'trophy-count': '1680',
    'mode-preview-name': getModeLabel(modeId), 'mode-preview-subtitle': variant.label, 'map-preview-name': getMapLabel(mapId),
  })) byId(id).textContent = value;
  document.querySelector('.site-menu-placeholder').outerHTML =
    `<div class="site-nav-wrap"><span class="site-waffle pixel-menu-button">${'<i></i>'.repeat(9)}</span></div>`;
  byId('mode-preview-img').src = getModeArtAsset(modeId);
  byId('map-preview-img').src = getMapSelectPreviewAsset(mapId);
  byId('map').add(new Option(getMapLabel(mapId), String(mapId), true, true));
  byId('create-party').querySelector('p').textContent = 'Leave Party';
  byId('party-settings-button').classList.remove('hidden');
  updatePlatformsForMode(variant.playersPerTeam);
  byId('lobby-area').removeAttribute('data-loading');
  byId('lobby-area').removeAttribute('aria-busy');
  for (const slot of document.querySelectorAll('.character-slot')) {
    slot.querySelector('.character-sprite').src = '/assets/icons/random.webp';
    slot.querySelector('.status').style.display = '';
  }

  const overlay = createMatchmakingOverlay();
  const friend = byId('your-slot-2');
  const self = byId('your-slot-1');
  self.dataset.isCurrentUser = 'true';
  self.dataset.isOwner = 'true';
  let previous = {};

  function paintSlot(slot, player, bro, state, level) {
    const occupied = state !== 'empty' && state !== 'invited';
    slot.classList.toggle('empty', !occupied);
    slot.classList.toggle('player-display', occupied);
    slot.dataset.playerName = occupied ? player.name : '';
    slot.dataset.character = occupied ? bro : 'Random';
    slot.querySelector('.username').textContent = occupied ? player.name : 'Random';
    const sprite = slot.querySelector('.character-sprite');
    const src = occupied ? `/assets/${bro}/body.webp` : '/assets/icons/random.webp';
    if (sprite.getAttribute('src') !== src) sprite.src = src;
    sprite.classList.toggle('random', !occupied);
    const status = slot.querySelector('.status');
    const before = status.textContent;
    status.textContent = occupied ? state : state === 'invited' ? 'Invited' : 'Invite';
    status.className = `status ${occupied ? statusToClass(state) : 'invite'}`;
    if (before !== state) applyLobbyStatusVisualState(slot, before, state);
    setSlotLevelBadge(slot, occupied ? level : null);
  }

  function render() {
    if (!frame.dataset.scene) return;
    const scene = JSON.parse(frame.dataset.scene);
    if (scene.bro !== previous.bro || scene.self !== previous.self) {
      paintSlot(self, roster[0], scene.bro, scene.self, 4);
      if (previous.bro && previous.bro !== scene.bro && scene.bro === 'thorg') triggerLobbyCharacterSplash(self);
      const ready = scene.self === 'Ready';
      byId('ready').value = ready ? 'Cancel' : 'Ready';
      byId('ready').classList.toggle('cancel', ready);
      document.body.classList.toggle('lobby-ready', ready);
    }
    if (scene.friend !== previous.friend) {
      paintSlot(friend, roster[1], roster[1].char_class, scene.friend, 3);
      if (previous.friend === 'invited' && scene.friend === 'Online') playLobbySpawnAnimation(friend);
    }
    if (scene.found && scene.found !== previous.found) {
      if (!previous.found) overlay.show({ seatedPlayers: roster.slice(0, 2) });
      overlay.render({ found: scene.found, total: roster.length, players: roster.slice(0, scene.found),
        yourTeam: 'team1', selection, full: scene.found === roster.length });
    } else if (!scene.found && previous.found) overlay.hide({ immediate: true });
    previous = scene;
  }
  new MutationObserver(render).observe(frame, { attributes: true, attributeFilter: ['data-scene'] });
  render();
}

if (window.frameElement?.classList.contains('about-lobby-preview')) mount(window.frameElement);
