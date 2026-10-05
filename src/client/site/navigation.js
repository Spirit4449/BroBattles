import { api, element, openSettings } from './shell';
export function initializeDesktopNavigation() {
  const header=document.querySelector('.site-header');if(!header)return;
  const nav=header.querySelector('.site-desktop-nav');if(!nav)return;
  for(const group of nav.querySelectorAll('.site-nav-group')) {
    const toggle=group.querySelector('button'), panel=group.querySelector('.site-nav-sub');
    const close=()=>{panel.hidden=true;toggle.setAttribute('aria-expanded','false');};
    const open=()=>{nav.querySelectorAll('.site-nav-sub').forEach(p=>p.hidden=true);nav.querySelectorAll('[aria-expanded]').forEach(b=>b.setAttribute('aria-expanded','false'));panel.hidden=false;toggle.setAttribute('aria-expanded','true');};
    toggle.onclick=open;group.onmouseenter=open;group.onmouseleave=()=>{if(!group.contains(document.activeElement))close();};
    group.onkeydown=e=>{if(e.key==='Escape'){close();toggle.focus();}};
    group.onfocusout=e=>{if(!group.contains(e.relatedTarget))close();};
    document.addEventListener('click',e=>{if(!group.contains(e.target))close();});
  }
}
export function renderSiteAccount(session) {
  const header=document.querySelector('.site-header');
  if(!header){

    return;
  }
  let root=header.querySelector('.site-account');if(!root){root=element('div',null,'site-account');header.append(root);}
  const signature=session?.member?(session.username||'My profile'):'guest';if(root.dataset.identity===signature)return;root.dataset.identity=signature;root.replaceChildren();
  if(!session?.member){const login=element('a','Log in','pixel-menu-button');login.href='/login?next='+encodeURIComponent(location.pathname);root.append(login);return;}
  const trigger=element('button',null,'pixel-menu-button site-account-trigger');trigger.type='button';const name=element('span',session.username||'My profile');name.dataset.privateName='';const caret=element('span','▾','site-account-caret');caret.setAttribute('aria-hidden','true');trigger.append(name,caret);trigger.setAttribute('aria-expanded','false');
  const menu=element('div',null,'site-account-menu');const profile=element('a','My profile','site-account-profile-link');profile.href='/?profile=self';const settings=element('button','Settings');settings.onclick=openSettings;const logout=element('button','Sign out','site-signout');logout.onclick=async()=>{logout.disabled=true;try{await api('/logout',{});location.assign('/login');}catch(e){logout.disabled=false;logout.textContent='Retry sign out';}};menu.append(profile,settings,logout);root.append(trigger,menu);
  const setOpen=on=>{root.classList.toggle('is-open',on);trigger.setAttribute('aria-expanded',String(on));};
  trigger.onclick=()=>setOpen(!root.classList.contains('is-open'));
  root.onmouseenter=()=>setOpen(true);root.onmouseleave=()=>{if(!root.contains(document.activeElement))setOpen(false);};
  root.onfocusout=e=>{if(!root.contains(e.relatedTarget))setOpen(false);};
  root.onkeydown=e=>{if(e.key==='Escape'){setOpen(false);trigger.focus({preventScroll:true});}};
}
