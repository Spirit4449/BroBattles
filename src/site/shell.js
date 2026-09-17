import { sonner } from "../lib/sonner";
import { MAINTENANCE_MESSAGE, maintenanceClock, maintenanceRemaining } from "../shared/maintenance";
import { wireBackdropDismiss, wireOutsideDismiss } from './dialogDismiss.mjs';
import { renderHeader } from '../shared/siteHeader.cjs';
import { remapKeys } from './remapKeys';
import { initializeDesktopNavigation, renderSiteAccount } from './navigation';
import './site.css';
import './pixelChecks.css';
import config from '../shared/siteConfig.json';
import { getSettings, saveSettings, resetSettings, subscribeSettings } from './preferences';
import { playSound } from '../lib/uiSounds';
export async function api(url, body, attempt=0) {
  let response;
  try { response=await fetch(url,{credentials:'same-origin',...(body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})}); } catch (error) { if(attempt<2){await new Promise(resolve=>setTimeout(resolve,400*(attempt+1)));return api(url,body,attempt+1);} throw new Error('Connection interrupted. Your progress is safe—please try again.'); }
  if(response.status>=500 && attempt<2){await new Promise(resolve=>setTimeout(resolve,400*(attempt+1)));return api(url,body,attempt+1);}
  let value; try { value=await response.json(); } catch (_) { throw new Error('Service unavailable. Please retry.'); }
  if(!response.ok) throw Object.assign(new Error(value.error || 'Request failed.'),{status:response.status});
  return value;
}
export function element(tag, text, className) { const node=document.createElement(tag); if(text!=null)node.textContent=text; if(className)node.className=className; return node; }
let openDialogs=0;
export function openDialog(title, { dismissible=true, side=false }={}) {
  const previous=document.activeElement;
  const dialog=element('dialog',null,'site-dialog bb-popup'+(side?' site-settings-side':''));
  const header=element('header',null,'bb-popup-header');const heading=element('h2',title,'bb-popup-title');heading.tabIndex=-1;heading.id=`site-dialog-title-${Date.now()}`;header.append(heading);dialog.setAttribute('aria-labelledby',heading.id);
  const body=element('div',null,'site-dialog-body');
  const close=element('button','×');close.type='button';close.className='site-close bb-close';close.setAttribute('aria-label','Close');
  if(dismissible)header.append(close);
  dialog.append(header,body);document.body.append(dialog);
  dialog.addEventListener('cancel',event=>{if(!dismissible)event.preventDefault();});
  close.onclick=()=>dialog.close();
  if(dismissible) side ? wireOutsideDismiss(dialog) : wireBackdropDismiss(dialog);
  openDialogs++;window.__BB_SITE_DIALOG_OPEN=true;document.exitPointerLock?.();
  dialog.addEventListener('close',()=>{openDialogs--;window.__BB_SITE_DIALOG_OPEN=openDialogs>0;dialog.remove();previous?.focus?.({preventScroll:true});},{once:true});
  if(side){dialog.show();const escape=event=>{if(event.key==='Escape' && !dialog.dataset.remapping && !document.querySelector('dialog:modal')){event.preventDefault();event.stopPropagation();dialog.close();}};document.addEventListener('keydown',escape,true);dialog.addEventListener('close',()=>document.removeEventListener('keydown',escape,true),{once:true});}else dialog.showModal();heading.focus();return {dialog,body};
}
export async function openLegal(kind) {
  const {body}=openDialog(kind==='terms'?'Terms of Service':'Privacy Policy');
  body.textContent='Loading…';
  try { const item=await api(`/api/site/legal/${kind}`); body.classList.add('site-prose');body.innerHTML=item.html;body.querySelectorAll('a[href="/terms"],a[href="/privacy"]').forEach(link=>link.dataset.legal=link.getAttribute('href').slice(1)); }
  catch(error){body.textContent=error.message;}
}
export function openSettings() {
  const existing=document.querySelector('.site-settings-window');if(existing){existing.close();return;}
  const inGame=location.pathname.startsWith('/game/');
  if(inGame && document.querySelector('#battle-keybind-hud')?.dataset.state==='expanded') document.getElementById('battle-keybind-close')?.click();
  const {dialog,body}=openDialog('Settings',{side:inGame});dialog.classList.add('site-settings-window');


  const form=element('div');const controls={};const volumes=element('div',null,'site-volume-row');
  for(const [key,label,min,max,step] of [['sensitivity','Mouse sensitivity',0.25,3,0.05],['sfx','SFX volume',0,1,0.01],['music','Background volume',0,1,0.01]]) {
    const row=element('label',null,'site-setting');row.append(element('span',label));const value=element('output');const input=element('input');input.type='range';input.id=`setting-${key}`;row.htmlFor=input.id;input.setAttribute('aria-label',label);input.min=min;input.max=max;input.step=step;
    input.addEventListener('input',()=>saveSettings({[key]:Number(input.value)}));input.addEventListener('change',()=>{if(key==='sfx')playSound('cursor4');});
    row.append(value,input);if(key==='sensitivity')form.append(row);else {row.firstChild.textContent=key==='sfx'?'SFX':'BG volume';volumes.append(row);}controls[key]={input,value};
  }
  form.append(volumes);
  for(const [key,label,hint] of [['autoHideCursor','Auto-hide cursor','Hide on battle start. When off, click the arena to capture the cursor.'],['streamer','Streamer mode','Conceals username labels on this screen. Names typed into messages can still appear.']]) {
    const row=element('label',null,'site-setting');const input=element('input');input.type='checkbox';input.setAttribute('aria-label',label);input.onchange=()=>saveSettings({[key]:input.checked});const title=element('span',label,'site-setting-title');const infoWrap=element('span',null,'site-setting-info-wrap');const info=element('button','i','site-setting-info');info.type='button';info.setAttribute('aria-label',hint);const tip=element('span',hint,'site-setting-tooltip');infoWrap.append(info,tip);title.append(infoWrap);row.append(title,input);form.append(row);controls[key]={input};
  }
  let resetting=false;
  const update=settings=>{if(resetting)return;for(const [key,{input,value}] of Object.entries(controls)){if(input.type==='checkbox')input.checked=settings[key];else {input.value=settings[key];value.textContent=key==='sensitivity'?`${settings[key].toFixed(2)}×`:`${Math.round(settings[key]*100)}%`;}}};
  const formatValue=(key,value)=>key==='sensitivity'?`${value.toFixed(2)}×`:`${Math.round(value*100)}%`;
  update(getSettings());const off=subscribeSettings(update);dialog.addEventListener('close',off,{once:true});
  const reset=element('button','RESET','pixel-menu-button');reset.id='settings-reset';
  let resetTimer;
  reset.onclick=()=>{
    if(resetting)return;
    const before=getSettings();const started=performance.now();const duration=720;
    resetting=true;reset.disabled=true;dialog.classList.add('is-resetting');
    resetSettings();dialog.dispatchEvent(new CustomEvent('settingsreset'));
    const tick=now=>{
      const progress=Math.min(1,(now-started)/duration);const eased=1-Math.pow(1-progress,3);
      for(const [key,{input,value}] of Object.entries(controls)){
        if(input.type==='checkbox'){if(progress>.52)input.checked=getSettings()[key];continue;}
        const current=before[key]+(getSettings()[key]-before[key])*eased;
        input.value=current;value.textContent=formatValue(key,current);
      }
      if(progress<1){requestAnimationFrame(tick);return;}
      resetting=false;reset.disabled=false;update(getSettings());
      clearTimeout(resetTimer);resetTimer=setTimeout(()=>dialog.classList.remove('is-resetting'),260);
    };
    requestAnimationFrame(tick);
  };
  dialog.addEventListener('close',()=>clearTimeout(resetTimer),{once:true});
  body.append(form,remapKeys(dialog),reset);
}
let navigationGuard = async () => true;
export function setNavigationGuard(guard) { navigationGuard = guard; }
function wireNavigation() {
  const host=document.querySelector('#navbar > .flex, .site-brand');
  if(host && !document.querySelector('.site-waffle')) {
    const wrap=element('div',null,'site-nav-wrap');const button=element('button',null,'site-waffle pixel-menu-button');button.type='button';button.setAttribute('aria-label','Open site menu');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','site-menu');
    for(let i=0;i<9;i++){const dot=element('i');dot.setAttribute('aria-hidden','true');button.append(dot);}const notification=element('span',null,'site-waffle-notification');notification.dataset.supportUnread='';notification.setAttribute('aria-hidden','true');button.append(notification);
    const menu=element('nav',null,'site-menu');menu.id='site-menu';menu.setAttribute('aria-label','Site navigation');menu.hidden=true;
    for(const [label,url] of [['About','/about'],['News','/news'],['Help Center','/help'],['Feedback','/feedback']]) {const a=element('a',label);a.href=url;if(url==='/help'){const badge=element('span','NEW','site-support-badge');badge.dataset.supportUnread='';badge.setAttribute('aria-hidden','true');a.append(badge);}menu.append(a);}
    const settings=element('button','Settings');settings.type='button';settings.onclick=()=>{toggle(false);openSettings();};menu.append(settings,element('hr'));
    for(const [label,url] of [['Privacy Policy','/privacy'],['Terms of Service','/terms']]){const a=element('a',label,'site-menu-legal');a.href=url;menu.append(a);}
    menu.append(element('small',config.version));wrap.append(button,menu);host.querySelector('.site-menu-placeholder')?.remove();host.prepend(wrap);
    menu.addEventListener('click', async event => {
      const link = event.target.closest('a');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (await navigationGuard()) location.assign(link.href);
    });
    const toggle=value=>{menu.hidden=!value;button.setAttribute('aria-expanded',String(value));};
    button.onclick=()=>{playSound('cursor4');toggle(menu.hidden);};
    wrap.addEventListener('keydown',event=>{if(event.key==='Escape'){toggle(false);button.focus();}if(event.key==='ArrowDown' && event.target===button){event.preventDefault();toggle(true);menu.querySelector('a').focus();}});
    document.addEventListener('click',event=>{if(!wrap.contains(event.target))toggle(false);});
    wrap.addEventListener('focusout',event=>{if(event.relatedTarget && !wrap.contains(event.relatedTarget))toggle(false);});
  }
  if(location.pathname.startsWith('/game/')){const button=element('button',null,'site-battle-settings fullscreen-toggle');button.setAttribute('aria-label','Settings');const img=element('img');img.src='/assets/settings.webp';img.alt='';button.append(img);button.onclick=openSettings;document.body.append(button);}
}
// Existing lobby code reads textContent as identity. Keep that data intact and
// obscure its presentation; the accessibility tree receives only a neutral label.
const privateSelector=['#username-text','input[autocomplete=username]','#spectate-player-name','#party-join-request-owner','#party-join-request-title','.party-discovery-title','.party-discovery-meta span','.bb-chat-reply-preview strong','.username','.mm-name','.bs-card-player-name','.team-hud-player-name','#profile-username','#profile-hero-name','#profile-popup-title','#profile-new-username','#guestName','.bb-chat-author','.bb-chat-game-line-name','.bb-chat-viewer-name','.bb-chat-typing-text','.bb-chat-reply-author','.bb-chat-reply-name','.bb-chat-reply-banner strong','.leaderboard-name','.leaderboard-username','.sonner__hdr','.sonner__msg','#party-slot-menu-name','.party-discovery-member-name','.bb-game-over-result-row [role=cell]:first-child','[data-private-name]'].join(',');
const savedAttributes=new WeakMap();
const privateAttributes = new WeakMap();
const privateAttributeSelectors = [
  ['.bb-chat-inline-reaction[data-tooltip]', 'data-tooltip'],
  ['.party-discovery-meta[title],.party-discovery-member[title]', 'title'],
  ['.leaderboard-row[aria-label]', 'aria-label'],
];
function applyStreamer() {
  const on=getSettings().streamer;document.documentElement.classList.toggle('bb-streamer',on);
  for(const [selector,attribute] of privateAttributeSelectors) for(const node of document.querySelectorAll(selector)) {
    const current=node.getAttribute(attribute);
    if(on && current!=='Player'){privateAttributes.set(node,current);node.setAttribute(attribute,'Player');}
    else if(!on && privateAttributes.has(node)){node.setAttribute(attribute,privateAttributes.get(node));privateAttributes.delete(node);}
  }
  for(const image of document.querySelectorAll('.bb-chat-typing-icon img,.bb-chat-viewer-avatar img,.bb-chat-avatar img')) {
    if(on){if(!savedAttributes.has(image))savedAttributes.set(image,{alt:image.getAttribute('alt')});if(image.alt!=='Player')image.alt='Player';}
    else if(savedAttributes.has(image)){image.alt=savedAttributes.get(image).alt || '';savedAttributes.delete(image);}
  }
  for(const node of document.querySelectorAll(privateSelector)) {
    node.classList.toggle('bb-private-name',on);
    if(on){if(!savedAttributes.has(node))savedAttributes.set(node,{role:node.getAttribute('role'),label:node.getAttribute('aria-label'),title:node.getAttribute('title')});if(node.getAttribute('aria-label')!=='Player'){node.setAttribute('aria-label','Player');if(!node.matches('input'))node.setAttribute('role','img');node.removeAttribute('title');}}
    else if(savedAttributes.has(node)){const attrs=savedAttributes.get(node);for(const [key,value] of Object.entries({role:attrs.role,'aria-label':attrs.label,title:attrs.title})){if(value===null)node.removeAttribute(key);else node.setAttribute(key,value);}savedAttributes.delete(node);}
  }
}
export async function refreshUnread() {
  try{const data=await api('/api/site/session');renderSiteAccount(data);const hasUnread=data.unread>0;const unreadLabel=`${data.unread} unread ${data.unread===1?'message':'messages'}`;document.querySelectorAll('[data-support-unread]').forEach(node=>node.classList.toggle('is-visible',hasUnread));const waffle=document.querySelector('.site-waffle');if(waffle)waffle.setAttribute('aria-label',hasUnread?`Open site menu. ${unreadLabel}.`:'Open site menu');const helpLink=document.querySelector('.site-menu a[href="/help"]');if(helpLink)helpLink.setAttribute('aria-label',hasUnread?`Help Center. ${unreadLabel}.`:'Help Center');document.querySelectorAll('a[href="/help/requests"]').forEach(link=>link.setAttribute('aria-label',hasUnread?`My requests. ${unreadLabel}.`:'My requests'));return data;}catch(_){return null;}
}
let acceptancePromise;
export function ensureLegalAcceptance() {
  if(acceptancePromise)return acceptancePromise;
  acceptancePromise=(async()=>{
    let current; try { current=await api('/api/legal/status'); } catch (_) { current={accepted:false}; } if(current.accepted)return;
    await new Promise((resolve,reject)=>{
      let accepted=false;
      const {dialog,body}=openDialog('Before you battle');
      dialog.classList.add('site-battle-consent-dialog');
      dialog.addEventListener('close',()=>{if(!accepted)reject(Object.assign(new Error('Ready cancelled.'),{code:'CONSENT_CANCELLED'}));},{once:true});
      body.innerHTML='<div class="battle-consent"><div class="battle-legal-cards"><a class="battle-legal-card" href="/terms" data-legal="terms"><img src="/assets/ui/terms-scroll-pixel.webp" alt="Terms of Service" width="72" height="72"/><strong>Terms of Service</strong></a><a class="battle-legal-card" href="/privacy" data-legal="privacy"><img src="/assets/ui/privacy-shield-pixel.webp" alt="Privacy Policy" width="72" height="72"/><strong>Privacy Policy</strong></a></div><label class="site-consent"><input type="checkbox"/><span>I agree to the <a href="/terms" data-legal="terms">Terms of Service</a> and <a href="/privacy" data-legal="privacy">Privacy Policy</a>.</span></label></div>';
      const error=element('p',null,'site-error');error.setAttribute('role','alert');const button=element('button','Continue','pixel-menu-button');button.disabled=true;body.querySelector('input').onchange=event=>button.disabled=!event.target.checked;
      button.onclick=async()=>{button.disabled=true;try{await api('/api/legal/accept',{accepted:true,termsVersion:config.termsVersion,privacyVersion:config.privacyVersion});accepted=true;dialog.close();resolve();}catch(e){error.textContent=e.message;button.disabled=false;}};
      body.append(error,button);
    });
  })().catch(error=>{acceptancePromise=null;throw error;});return acceptancePromise;
}
function initializeRuntimeBanner() {
  const banner = element('aside', null, 'site-runtime-banner');
  banner.setAttribute('role', 'timer'); banner.hidden = true;
  document.body.append(banner);
  let runtime = {}, offset = 0;
  let announcementShown = false;
  const isGameEntry = location.pathname === '/' || location.pathname.startsWith('/game/');
  function showAnnouncement() {
    const message = String(runtime.announcements || '').trim();
    if (!isGameEntry || announcementShown || !message) return;
    if (document.querySelector('#lobby-area[data-loading]')) return;
    announcementShown = true;
    sonner('Global announcement', message, 'Dismiss', undefined, { persistent: true });
  }
  document.addEventListener('lobby:ready', showAnnouncement, { once: true });
  function render() {
    const now = Date.now() + offset;
    const active = maintenanceRemaining(runtime.maintenanceUntil, now) > 0;
    const message = active ? `Matchmaking Disabled — ${MAINTENANCE_MESSAGE} ◷ ${maintenanceClock(runtime.maintenanceUntil, now)} remaining` : '';
    if (banner.textContent !== message) banner.textContent = message;
    banner.hidden = !message;
  }
  async function refresh() {
    try {
      const response = await fetch('/api/site/runtime', { cache: 'no-store' });
      if (!response.ok) return;
      runtime = await response.json();
      showAnnouncement();
      offset = Number.isFinite(runtime.serverTime) ? runtime.serverTime - Date.now() : 0;
      render();
    } catch (_) { /* Keep the last known announcement during a network interruption. */ }
  }
  const clock = setInterval(render, 1000);
  window.addEventListener('pagehide', () => clearInterval(clock), { once: true });

  refresh();
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
}
function initialize() {
  initializeRuntimeBanner();
  // Auth pages have no lobby header: supply a compact shared brand header.
  if((['/signup','/login','/admin'].includes(location.pathname)) && !document.querySelector('.site-brand')){document.body.insertAdjacentHTML('afterbegin',renderHeader(location.pathname));}
  wireNavigation();initializeDesktopNavigation();applyStreamer();subscribeSettings(applyStreamer);
  let pending=false;new MutationObserver(records=>{
    if(!getSettings().streamer || pending) return;
    const relevant=records.some(record=>record.type==='attributes' || Array.from(record.addedNodes).some(node=>node.nodeType===1) || (record.target.matches?.(privateSelector) && !record.target.classList.contains('bb-private-name')));
    if(relevant){pending=true;queueMicrotask(()=>{pending=false;applyStreamer();});}
  }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['title','data-tooltip','aria-label','alt']});
  document.addEventListener('click',event=>{const link=event.target.closest('[data-legal]');if(link){event.preventDefault();openLegal(link.dataset.legal);}});
  refreshUnread();
  const unreadTimer = setInterval(() => { if (!document.hidden) refreshUnread(); }, 30000);
  window.addEventListener('pagehide', () => clearInterval(unreadTimer), { once: true });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshUnread();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
