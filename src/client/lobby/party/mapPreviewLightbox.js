// Full-arena view of a map, opened from the map picker's expand button. Uses
// the shared bb-popup dialog frame and motion (as the player card preview
// does). The image loads before the dialog opens, so it never resizes on show.
import { dismissPopup } from '../../ui/popupMotion.js';
import './mapPreviewLightbox.css';

let active = null;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load ${src}`));
    image.src = src;
  });
}

/** Opens the full-arena preview for one map. */
export async function openMapPreviewLightbox({ src, title }) {
  const token = {};
  active = token;
  let image;
  try {
    image = await loadImage(src);
    await image.decode?.().catch(() => {});
  } catch {
    return null;
  }
  if (active !== token) return null; // A newer open replaced this one.

  const label = title || 'Map';
  const dialog = document.createElement('dialog');
  dialog.className = 'map-preview-dialog bb-popup';
  dialog.setAttribute('aria-label', `${label} full map`);
  dialog.style.setProperty('--map-preview-aspect', `${image.naturalWidth} / ${image.naturalHeight}`);

  const header = document.createElement('header');
  header.className = 'bb-popup-header';
  const heading = document.createElement('h2');
  heading.className = 'bb-popup-title';
  heading.textContent = label;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'bb-close pixel-menu-button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close map preview');
  header.append(heading, close);

  const body = document.createElement('div');
  body.className = 'map-preview-body';
  image.className = 'map-preview-image';
  image.alt = `${label} full map`;
  image.draggable = false;
  body.append(image);
  dialog.append(header, body);

  let closing = false;
  const requestClose = () => {
    if (closing) return;
    closing = true;
    dismissPopup(dialog, () => dialog.close());
  };
  close.addEventListener('click', requestClose);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); requestClose(); });
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) requestClose();
  });

  const previousFocus = document.activeElement;
  let unregisterScope;
  dialog.addEventListener('close', () => {
    unregisterScope?.();
    dialog.remove();
    if (active === token) active = null;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }, { once: true });

  document.body.append(dialog);
  dialog.showModal();
  close.focus();
  unregisterScope = window.__BB_PAGE_SCOPE__?.onDispose(() => dialog.close());
  return dialog;
}
