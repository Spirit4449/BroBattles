import { createPlayerCardMedia, presentPlayerCardMedia, disposePlayerCardMedia } from './playerCardAnimation.cjs';
import { dismissPopup } from '../ui/popupMotion.js';
import { currencyRewardImage } from './rewardPresentation.js';
import { titleMarkup } from './titleView.js';
import cards from '../../shared/catalogs/playerCardsCatalog.json';
import '../styles/playerCardPreview.css';

const KIND_LABELS = { card: 'Player card', skin: 'Skin', profileIcon: 'Profile icon', title: 'Player title', currency: 'Currency', character: 'Bro', mode: 'Game mode' };

function grantName(grant) {
  if (grant.kind !== 'currency') return grant.name || KIND_LABELS[grant.kind] || 'Reward';
  return `${(Number(grant.amount) || 0).toLocaleString()} ${grant.name || (grant.currency === 'gems' ? 'Gems' : 'Coins')}`;
}

// Static artwork for anything that is not an animated player card.
function grantArt(grant) {
  const art = document.createElement('div');
  art.className = `reward-preview-art reward-preview-${grant.kind}`;
  if (grant.kind === 'title') {
    art.innerHTML = `<span class="title-presentation-box">${titleMarkup(grant.id)}</span>`;
    return art;
  }
  const image = document.createElement('img');
  image.alt = '';
  image.src = grant.kind === 'currency' ? currencyRewardImage(grant.currency, grant.amount) : (grant.shopImage || grant.image || '');
  art.append(image);
  return art;
}

/*
 * Native modal listing everything a shop offer grants. Each reward is a framed
 * tile: type on top, artwork, its name, then the game's shared rarity label.
 * Player cards play their animation; other rewards show their artwork.
 */
export function showRewardPreview(grants, { title } = {}) {
  const entries = (grants || []).map(grant => {
    if (grant.kind !== 'card') return { grant };
    const card = cards.cards.find(candidate => candidate.id === grant.id);
    return card ? { grant, card } : null;
  }).filter(Boolean);
  if (!entries.length) return null;
  const single = entries.length === 1;
  const dialog = document.createElement('dialog');
  dialog.className = `player-card-preview bb-popup${single ? ' is-single' : ''}`;
  dialog.setAttribute('aria-label', title ? `${title} contents` : 'Reward preview');
  const header = document.createElement('header');
  header.className = 'bb-popup-header';
  const heading = document.createElement('h2');
  heading.className = 'bb-popup-title';
  heading.textContent = title || (single ? grantName(entries[0].card || entries[0].grant) : 'Rewards');
  const gallery = document.createElement('div');
  gallery.className = 'player-card-preview-gallery';
  gallery.style.setProperty('--preview-columns', String(Math.min(3, entries.length)));
  const mediaElements = [];
  for (const { grant, card } of entries) {
    const rarity = (card?.rarity || grant.rarity || '').toLowerCase();
    const figure = document.createElement('figure');
    figure.className = `reward-preview-item is-${grant.kind} ${grant.kind === 'currency'
      ? `reward-tint-${grant.currency === 'gems' ? 'gems' : 'coins'}`
      : `shop-rarity-${rarity || 'common'}`}`;
    const type = document.createElement('span');
    type.className = 'reward-preview-type';
    type.textContent = KIND_LABELS[grant.kind] || 'Reward';
    figure.append(type);
    if (card) {
      const media = createPlayerCardMedia(card, { interactive: true });
      mediaElements.push(media);
      figure.append(presentPlayerCardMedia(media, card, { containEffects: true }));
    } else {
      figure.append(grantArt(grant));
    }
    const caption = document.createElement('figcaption');
    const name = document.createElement('strong');
    name.className = 'reward-preview-name';
    name.textContent = grantName(card || grant);
    caption.append(name);
    // Currency has no rarity; an empty slot keeps every tile's rows aligned.
    const tag = document.createElement('span');
    if (rarity && grant.kind !== 'currency') {
      tag.className = 'reward-preview-rarity';
      tag.textContent = rarity;
    } else {
      tag.className = 'reward-preview-tag-slot';
      tag.setAttribute('aria-hidden', 'true');
    }
    caption.append(tag);
    figure.append(caption);
    gallery.append(figure);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'bb-close pixel-menu-button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close preview');
  let closing = false;
  const requestClose = () => {
    if (closing) return;
    closing = true;
    dismissPopup(dialog, () => dialog.close());
  };
  close.addEventListener('click', requestClose);
  dialog.addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
  header.append(heading, close);
  dialog.append(header, gallery);
  const previousFocus = document.activeElement;
  let disposed = false;
  let unregisterScope;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    unregisterScope?.();
    mediaElements.forEach(disposePlayerCardMedia);
    dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  };
  dialog.addEventListener('close', cleanup, { once: true });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) requestClose();
  });
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
  unregisterScope = window.__BB_PAGE_SCOPE__?.onDispose(() => { dialog.close(); cleanup(); });
  return dialog;
}

// Card-only callers (profile, collection screens) keep their original entry point.
export function showPlayerCardPreview(grants) {
  return showRewardPreview((grants || []).filter(grant => grant.kind === 'card'));
}
