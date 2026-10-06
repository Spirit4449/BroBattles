import { createPlayerCardMedia, presentPlayerCardMedia, disposePlayerCardMedia } from './playerCardAnimation.cjs';
import { dismissPopup } from '../ui/popupMotion.js';
import cards from '../../shared/catalogs/playerCardsCatalog.json';
import '../styles/playerCardPreview.css';

// A native modal sits above Shop and keeps Escape/Tab within this preview.
export function showPlayerCardPreview(grants) {
  const entries = grants.map(grant => cards.cards.find(card => card.id === grant.id)).filter(Boolean);
  if (!entries.length) return null;
  const dialog = document.createElement('dialog');
  dialog.className = 'player-card-preview bb-popup';
  dialog.setAttribute('aria-label', 'Player card preview');
  const header = document.createElement('header');
  header.className = 'bb-popup-header';
  const title = document.createElement('h2');
  title.className = 'bb-popup-title';
  title.textContent = entries.length === 1 ? entries[0].name : 'Player cards';
  const gallery = document.createElement('div');
  gallery.className = 'player-card-preview-gallery';
  const mediaElements = [];
  for (const card of entries) {
    const figure = document.createElement('figure');
    const media = createPlayerCardMedia(card, { interactive: true });
    mediaElements.push(media);
    figure.append(presentPlayerCardMedia(media, card, { containEffects: true }));
    const caption = document.createElement('figcaption');
    caption.textContent = card.rarity.toUpperCase();
    figure.append(caption);
    gallery.append(figure);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'bb-close pixel-menu-button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close card preview');
  let closing = false;
  const requestClose = () => {
    if (closing) return;
    closing = true;
    dismissPopup(dialog, () => dialog.close());
  };
  close.addEventListener('click', requestClose);
  dialog.addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
  header.append(title, close);
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
