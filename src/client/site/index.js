import './shell';
import '../styles/chat.css';
import '../styles/friends.css';
import '../styles/titles.css';
import '../styles/characterSelect.css';
import '../styles/levelBadge.css';
import './pages.css';
import { initializeAboutReel } from './aboutReel.mjs';
import { initializeAboutBros } from './aboutBros.mjs';
import { initializeSiteMotion } from './siteMotion.mjs';
import { initializeAboutRoad } from './aboutRoad.mjs';
import { initializeAboutCosmetics } from './aboutCosmetics.mjs';
import { initializeAboutFriends } from './aboutFriends.mjs';
import { initializeSupportPage } from './supportUI';
import { initializeHelpSearch } from './helpSearch';
initializeSupportPage();
initializeHelpSearch();
initializeAboutReel();
initializeAboutBros();
initializeAboutRoad();
initializeAboutCosmetics();
initializeAboutFriends();
initializeSiteMotion();
const toc=document.querySelector('.site-toc');
if(toc){
  const links=[...document.querySelectorAll('.site-prose h2')].map((heading,index)=>{heading.id ||= `section-${index+1}`;const a=document.createElement('a');a.href=`#${heading.id}`;a.textContent=heading.textContent;toc.append(a);return [heading,a];});
  // Highlight the section being read.
  if('IntersectionObserver' in window && links.length){
    const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){for(const [,a] of links)a.classList.toggle('is-current',a.hash===`#${entry.target.id}`);}},{rootMargin:'-12% 0px -55% 0px'});
    links.forEach(([heading])=>observer.observe(heading));
  }
}
