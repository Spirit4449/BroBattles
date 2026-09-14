import { api, element, refreshUnread } from './shell';
import { pixelSelect } from './pixelSelect';
const categories=['bug','idea','gameplay','account','purchase','safety','privacy','other'];
const key=()=>crypto.randomUUID();
const date=value=>{const timestamp=new Date(value);const now=new Date();const elapsed=now-timestamp;const time=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(timestamp);const sameDay=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();const yesterday=new Date(now);yesterday.setDate(now.getDate()-1);if(elapsed>=0&&elapsed<60_000)return'Just now';if(elapsed>=60_000&&elapsed<3_600_000)return`${Math.floor(elapsed/60_000)} min ago`;if(sameDay(timestamp,now))return`Today at ${time}`;if(sameDay(timestamp,yesterday))return`Yesterday at ${time}`;return`${new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(timestamp)} at ${time}`;};
function errorNode() { const node=element('p',null,'site-error');node.setAttribute('role','alert');return node; }
function formFields(reply=false) {
  const form=element('form',null,'site-form');
  if(!reply){const category=element('label','Category');const select=element('select');select.name='category';for(const value of categories){const option=element('option',value[0].toUpperCase()+value.slice(1));option.value=value;select.append(option);}category.append(pixelSelect(select,'Category'));const subject=element('label','Subject');const input=element('input');input.name='subject';input.required=true;input.minLength=3;input.maxLength=120;subject.append(input);form.append(category,subject);}
  const message=element('label',reply?'Your reply':'Message');const textarea=element('textarea');textarea.name='message';textarea.required=true;textarea.minLength=5;textarea.maxLength=4000;message.append(textarea);form.append(message,element('small','Please do not include passwords, card details, or unnecessary personal information.'));
  return form;
}
function requestPlaceholders() {const group=element('div',null,'site-request-skeletons');group.setAttribute('aria-hidden','true');for(let i=0;i<3;i++){const card=element('div',null,'site-request-skeleton');card.append(element('span',null,'site-skeleton-status'),element('span',null,'site-skeleton-title'),element('span',null,'site-skeleton-meta'));group.append(card);}return group;}
export function renderSubmit(root,kind,onComplete) {
  root.replaceChildren();const form=formFields();let submissionKey=key();const error=errorNode();const button=element('button',kind==='feedback'?'Send feedback':'Send request','pixel-menu-button');button.type='submit';
  form.append(error,button);root.append(element('p',kind==='feedback'?'Feedback helps improve the game. For a reply, use Contact us.':'Replies appear in My requests. No email address is needed.'),form);
  form.addEventListener('input',()=>{submissionKey=key();});
  form.onsubmit=async event=>{event.preventDefault();button.disabled=true;error.textContent='';try{const fields=Object.fromEntries(new FormData(form));const result=await api(kind==='feedback'?'/api/feedback':'/api/support/requests',{...fields,submissionKey});const confirmation=element('section',null,'site-submit-success');confirmation.setAttribute('role','status');confirmation.setAttribute('tabindex','-1');confirmation.append(element('h2','Thank you!'),element('p',kind==='feedback'?'Your feedback has been received.':'Your request has been received.'));if(kind==='support'){const a=element('a','View your requests','pixel-menu-button');a.href='/help/requests';confirmation.append(a);}root.replaceChildren(confirmation);requestAnimationFrame(()=>{confirmation.classList.add('is-visible');confirmation.focus({preventScroll:true});});onComplete?.(result);}catch(e){error.textContent=e.message;button.disabled=false;}};
}
export function renderInbox(root,{admin=false,kind='support'}={}) {
  root.classList.add('site-inbox');
  root.replaceChildren(requestPlaceholders());
  let generation=0;
  let page=1,status='',category='';const base=admin?`/api/admin/${kind}`:'/api/support/requests';
  async function detail(id) {
    const requestGeneration=++generation;
    root.setAttribute('aria-busy','true');
    const savedScroll=window.scrollY;
    root.style.minHeight=`${root.getBoundingClientRect().height}px`;
    try {
      const data=await api(`${base}/${id}`);refreshUnread();if(requestGeneration!==generation)return;root.replaceChildren();
      const back=element('button','← Back to requests','pixel-menu-button');back.onclick=list;root.append(back,element('h2',data.request.subject),element('p',`${admin?`#${id} · `:''}${data.request.category} · ${data.request.status.replace('_',' ')}`));
      if(admin) root.append(element('p', `User #${data.request.userId} · ${data.request.version} · Created ${date(data.request.created_at)}`));
      if(admin){const statusRow=element('div',null,'site-filter');for(const value of ['open','in_progress','closed']){const button=element('button',value.replace('_',' '),'pixel-menu-button');button.disabled=value===data.request.status;button.onclick=async()=>{button.disabled=true;try{await api(`${base}/${id}/status`,{status:value});await detail(id);}catch(e){root.append(element('p',e.message,'site-error'));button.disabled=false;}};statusRow.append(button);}root.append(statusRow);}
      for(const message of data.messages){const item=element('div',null,'site-message');const avatar=element('img');avatar.src=message.sender==='admin'?'/assets/logos/logo-small.webp':'/assets/profile-icons/ninja.webp';avatar.alt='';item.append(avatar);item.dataset.sender=message.sender;item.append(element('small',`${message.sender==='admin'?'Bro Battles Support':'Player'} · ${date(message.created_at)}`),element('p',message.body));root.append(item);}
      if(kind==='support') {const form=formFields(true);const button=element('button','Send reply','pixel-menu-button');button.type='submit';const error=errorNode();let submissionKey=key();form.addEventListener('input',()=>submissionKey=key());form.append(error,button);form.onsubmit=async event=>{event.preventDefault();button.disabled=true;try{await api(`${base}/${id}/messages`,{message:new FormData(form).get('message'),submissionKey});await detail(id);}catch(e){error.textContent=e.message;button.disabled=false;}};root.append(form);}
      root.removeAttribute('aria-busy');requestAnimationFrame(()=>window.scrollTo({top:savedScroll,behavior:'instant'}));
    }catch(error){if(requestGeneration!==generation)return;root.removeAttribute('aria-busy');root.replaceChildren(element('p',error.message,'site-error'));const back=element('button','Back','pixel-menu-button');back.onclick=list;root.append(back);}
  }
  async function list() {
    const requestGeneration=++generation;
    root.setAttribute('aria-busy','true');
    const savedScroll=window.scrollY;
    root.style.minHeight=`${root.getBoundingClientRect().height}px`;
    try {
      const data=await api(`${base}?page=${page}${admin?`&status=${encodeURIComponent(status)}&category=${encodeURIComponent(category)}`:''}`);if(requestGeneration!==generation)return;root.replaceChildren();
      if(admin){const filters=element('div',null,'site-filter');
        for(const [label,values,current,change] of [['Status',['','open','in_progress','closed'],status,value=>status=value],['Category',['',...categories],category,value=>category=value]]){const field=element('label',label+' ');const select=element('select');for(const value of values){const option=element('option',value?value.replace('_',' '):'All');option.value=value;select.append(option);}select.value=current;select.onchange=()=>{change(select.value);page=1;list();};field.append(pixelSelect(select,label));filters.append(field);}root.append(filters);}
      if(!data.items.length)root.append(element('p','No requests here yet.'));
      for(const item of data.items){const button=element('button',null,'site-request');button.dataset.unread=String(!!item.unread);button.append(element('span',item.status.replace('_',' '),'site-ticket-status'),element('strong',`${item.unread?'● ':''}${item.subject}`),element('small',`${admin?`#${item.id} · `:''}${item.category} · ${item.status.replace('_',' ')} · ${date(item.updated_at)}`));button.onclick=()=>detail(item.id);root.append(button);}
      if(data.total>20){const pager=element('div',null,'site-pagination');for(const [label,next,disabled] of [['Previous',page-1,page===1],['Next',page+1,page*20>=data.total]]){const button=element('button',label,'pixel-menu-button');button.disabled=disabled;button.onclick=()=>{page=next;list();};pager.append(button);}pager.append(element('span',`Page ${page} · ${data.total} total`));root.append(pager);}
      root.removeAttribute('aria-busy');requestAnimationFrame(()=>window.scrollTo({top:savedScroll,behavior:'instant'}));
    }catch(error){if(requestGeneration!==generation)return;root.removeAttribute('aria-busy');root.replaceChildren(element('p',error.message,'site-error'));const retry=element('button','Retry','pixel-menu-button');retry.onclick=list;root.append(retry);}
  }
  list();
}
export async function initializeSupportPage() {
  const root=document.getElementById('support-app');if(!root)return;
  const view=root.dataset.view;
  if(view==='requests')root.replaceChildren(requestPlaceholders());
  const session=await refreshUnread();
  if(!session){root.textContent='Support is unavailable. Please refresh to retry, or email support@classchats.net.';return;}
  if(view==='feedback' && (session.guest || session.member)){renderSubmit(root,'feedback');return;}
  if(!session.member){root.replaceChildren(element('h2',view==='feedback'?'Join the arena first':'Log in to contact support'),element('p',view==='feedback'?'Open the lobby to start a guest session, then return here to send feedback.':'Use a permanent account so you can return to read replies.'));for(const [label,url] of view==='feedback'?[['Go to lobby','/']]:[['Log in','/login?next='+encodeURIComponent(location.pathname)],['Create account','/signup?next='+encodeURIComponent(location.pathname)]]){const a=element('a',label,'pixel-menu-button');a.href=url;root.append(a,' ');}return;}
  if(view==='contact')renderSubmit(root,'support');else renderInbox(root);
}
