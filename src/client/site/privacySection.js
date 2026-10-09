import { sonner } from '../ui/sonner';
import { PRIVACY_FIELDS, loadPrivacy, onPrivacyChange, privacyControl, savePrivacy } from '../friends/privacyClient.js';

// Account-saved privacy rows for the Settings dialog. Stays empty for guests.
export function privacySection(dialog, onShow) {
  const wrap = document.createElement('section');
  wrap.className = 'site-privacy';
  wrap.hidden = true;
  let privacy = null;
  const controls = new Map();

  const render = () => {
    const title = document.createElement('h3');
    title.className = 'site-settings-heading';
    title.textContent = 'Privacy';
    wrap.replaceChildren(title);
    for (const field of PRIVACY_FIELDS) {
      // A <label> would forward description clicks into the dropdown.
      const row = document.createElement(field.boolean ? 'label' : 'div');
      row.className = 'site-setting site-privacy-setting';
      const label = document.createElement('span');
      label.className = 'site-setting-title';
      label.textContent = field.label;
      const description = document.createElement('small');
      description.textContent = field.description;
      const control = privacyControl(field, privacy[field.key], async (value) => {
        control.setDisabled(true);
        try {
          privacy = await savePrivacy({ [field.key]: value });
        } catch (error) {
          control.setValue(privacy[field.key]);
          sonner('Could not save setting', error.message, 'OK', undefined, { tone: 'error' });
        }
        control.setDisabled(false);
      });
      controls.set(field.key, control);
      row.append(label, control.element, description);
      wrap.append(row);
    }
    wrap.hidden = false;
    onShow?.();
  };

  loadPrivacy()
    .then((value) => {
      if (!value || !dialog.isConnected) return;
      privacy = value;
      render();
    })
    .catch(() => {});

  const off = onPrivacyChange((value) => {
    privacy = value;
    for (const [key, control] of controls) control.setValue(value[key]);
  });
  dialog.addEventListener('close', off, { once: true });
  return wrap;
}
