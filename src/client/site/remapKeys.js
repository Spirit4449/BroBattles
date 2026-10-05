import { KEY_SLOTS, assignBinding, eventKeyCode, keyLabel } from './keyBindings.mjs';
import { getSettings, saveSettings, subscribeSettings } from './preferences';
export function remapKeys(dialog) {
  const details=document.createElement('details');details.className='site-key-remap';
  const summary=document.createElement('summary');summary.textContent='Controls & remap keys';details.append(summary);
  const hint=document.createElement('p');hint.textContent='Select a key, then press its replacement. Escape cancels. Mouse: left-click to attack, right-click for special.';details.append(hint);
  const error=document.createElement('p');error.className='site-remap-status';error.setAttribute('role','status');
  const buttons=new Map();let active=null;let feedbackTimer;
  const update=()=>{for(const [slot,button] of buttons){button.textContent=active===slot?'Press a key…':keyLabel(getSettings().keys[slot]);button.classList.remove('is-in-use');}};
  const cancel=()=>{error.textContent='';error.className='site-remap-status';active=null;delete dialog.dataset.remapping;update();};
  for(const [slot,label] of KEY_SLOTS.filter(([slot])=>!slot.endsWith('Alt')&&slot!=='dash')){const row=document.createElement('div');row.className='site-key-row';const name=document.createElement('span');name.textContent=label;const button=document.createElement('button');button.type='button';button.className='pixel-menu-button';button.setAttribute('aria-label',`Remap ${label}`);button.onclick=()=>{active=slot;dialog.dataset.remapping='true';error.textContent='';update();};buttons.set(slot,button);row.append(name,button);details.append(row);}
  const capture=event=>{
    if(!active)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.type==='keyup'||event.repeat)return;
    if(event.code==='Escape'){cancel();return;}
    try{if(event.ctrlKey||event.metaKey||event.altKey)throw new Error('Choose a key without modifier shortcuts.');saveSettings({keys:assignBinding(getSettings().keys,active,eventKeyCode(event))});cancel();}catch(e){const button=buttons.get(active);button.textContent=e.message.startsWith('Already used')?'In Use':'Try another';button.classList.add('is-in-use');clearTimeout(feedbackTimer);feedbackTimer=setTimeout(update,1200);}
  };
  details.addEventListener('toggle',()=>{if(!details.open)cancel();});
  document.addEventListener('keydown',capture,true);document.addEventListener('keyup',capture,true);
  const off=subscribeSettings(cancel);update();
  dialog.addEventListener('settingsreset',()=>{
    active=null;delete dialog.dataset.remapping;
    for(const button of buttons.values()){
      button.classList.remove('is-in-use');button.classList.add('is-resetting-key');button.textContent='RESET!';
    }
    setTimeout(()=>{update();for(const button of buttons.values())button.classList.remove('is-resetting-key');},620);
  });
  dialog.addEventListener('close',()=>{clearTimeout(feedbackTimer);off();document.removeEventListener('keydown',capture,true);document.removeEventListener('keyup',capture,true);},{once:true});
  if(location.pathname.startsWith('/game/')){const guide=document.createElement('button');guide.type='button';guide.className='pixel-menu-button';guide.textContent='Controls guide';guide.onclick=()=>{dialog.close();const hud=document.getElementById('battle-keybind-hud');if(hud?.dataset.state!=='expanded')document.getElementById('battle-keybind-toggle')?.click();};details.append(guide);}
  return details;
}
