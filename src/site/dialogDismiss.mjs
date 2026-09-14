// A backdrop click must start outside, not merely end there after a drag.
export function wireBackdropDismiss(dialog) {
  let startedOutside = false;
  const isOutside = event => {
    const rect = dialog.getBoundingClientRect();
    return event.target === dialog &&
      (event.clientX < rect.left || event.clientX > rect.right ||
       event.clientY < rect.top || event.clientY > rect.bottom);
  };
  dialog.addEventListener('pointerdown', event => {
    startedOutside = event.isPrimary !== false && event.button === 0 && isOutside(event);
  }, true);
  dialog.addEventListener('pointercancel', () => { startedOutside = false; });
  dialog.addEventListener('click', event => {
    const dismiss = startedOutside && isOutside(event);
    startedOutside = false;
    if (dismiss) dialog.close();
  });
}

// Non-modal dialogs do not have a backdrop, so outside pointer events land on
// the document instead of the dialog. Require the press and release to both be
// outside to avoid closing after a control is dragged out of the panel.
export function wireOutsideDismiss(dialog, eventTarget = dialog.ownerDocument) {
  let startedOutside = false;
  const isOutside = event => !dialog.contains(event.target);
  const onPointerDown = event => {
    startedOutside = event.isPrimary !== false && event.button === 0 && isOutside(event);
  };
  const onPointerCancel = () => { startedOutside = false; };
  const onClick = event => {
    const dismiss = startedOutside && isOutside(event);
    startedOutside = false;
    if (dismiss) dialog.close();
  };
  const removeListeners = () => {
    eventTarget.removeEventListener('pointerdown', onPointerDown, true);
    eventTarget.removeEventListener('pointercancel', onPointerCancel, true);
    eventTarget.removeEventListener('click', onClick);
  };

  eventTarget.addEventListener('pointerdown', onPointerDown, true);
  eventTarget.addEventListener('pointercancel', onPointerCancel, true);
  eventTarget.addEventListener('click', onClick);
  dialog.addEventListener('close', removeListeners, {once:true});
}
