import { api, element, openSettings } from './shell';
const groups=[['About','/about',[['Discover the game','/about'],['Game modes','/about#modes'],['Meet the fighters','/about#fighters']]],['News','/news',[['Latest stories','/news'],['Welcome to beta','/news/welcome-to-beta']]],['Help Center','/help',[['Browse answers','/help'],['Contact us','/help/contact'],['My requests','/help/requests']]],['Feedback','/feedback',[['Send an idea','/feedback'],['Report a bug','/feedback']]]];
export function initializeDesktopNavigation() {
  const header=document.querySelector('.site-header');
  if(header && !header.querySelector('.site-desktop-nav')) {
    const nav=element('nav',null,'site-desktop-nav');nav.setAttribute('aria-label','Main navigation');
    for(const [label,url,links] of groups){const group=element('div',null,'site-nav-group');const link=element('a',label);link.href=url;if(location.pathname.startsWith(url)){link.setAttribute('aria-current','page');group.classList.add('is-current');}const toggle=element('button','⌄');toggle.type='button';toggle.setAttribute('aria-label',`Expand ${label}`);toggle.setAttribute('aria-expanded','false');const panel=element('div',null,'site-nav-sub');panel.hidden=true;
      for(const [text,href] of links){const item=element('a',text);item.href=href;panel.append(item);}group.append(link,toggle,panel);nav.append(group);
      const close=()=>{panel.hidden=true;toggle.setAttribute('aria-expanded','false');};
      const open=()=>{nav.querySelectorAll('.site-nav-sub').forEach(p=>p.hidden=true);nav.querySelectorAll('[aria-expanded]').forEach(b=>b.setAttribute('aria-expanded','false'));panel.hidden=false;toggle.setAttribute('aria-expanded','true');};
      toggle.onclick=open;
      link.onclick=e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();open();};
      group.onmouseenter=open;group.onmouseleave=()=>{if(!group.contains(document.activeElement))close();};
      group.addEventListener('keydown',e=>{if(e.key==='Escape'){close();toggle.focus();}});
      group.addEventListener('focusout',e=>{if(!group.contains(e.relatedTarget))close();});
      document.addEventListener('click',e=>{if(!group.contains(e.target))close();});
    }
    const settings=element('button','Settings','site-nav-settings');settings.type='button';settings.onclick=openSettings;nav.append(settings);
    header.querySelector('.site-brand').after(nav);
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
  const trigger=element('button',null,'pixel-menu-button');trigger.type='button';const name=element('span',session.username||'My profile');name.dataset.privateName='';trigger.append(name,element('span',' ▾'));trigger.setAttribute('aria-expanded','false');
  const menu=element('div',null,'site-account-menu');const profile=element('a','My profile');profile.href='/?profile=self';const settings=element('button','Settings');settings.onclick=openSettings;const logout=element('button','Sign out','site-signout');logout.onclick=async()=>{logout.disabled=true;try{await api('/logout',{});location.assign('/login');}catch(e){logout.disabled=false;logout.textContent='Retry sign out';}};menu.append(profile,settings,logout);root.append(trigger,menu);
  const setOpen=on=>{root.classList.toggle('is-open',on);trigger.setAttribute('aria-expanded',String(on));};
  trigger.onclick=()=>setOpen(!root.classList.contains('is-open'));
  root.onmouseenter=()=>setOpen(true);root.onmouseleave=()=>{if(!root.contains(document.activeElement))setOpen(false);};
  root.onfocusout=e=>{if(!root.contains(e.relatedTarget))setOpen(false);};
  root.onkeydown=e=>{if(e.key==='Escape'){setOpen(false);trigger.focus({preventScroll:true});}};
}
