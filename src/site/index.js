import './shell';
import { initializeSupportPage } from './supportUI';
initializeSupportPage();
const search=document.getElementById('help-search');
search?.addEventListener('input',()=>{const query=search.value.trim().toLowerCase();let count=0;document.querySelectorAll('[data-help-category]').forEach(category=>{let visible=0;category.querySelectorAll('[data-help-search]').forEach(link=>{link.hidden=!link.dataset.helpSearch.includes(query);if(!link.hidden)visible++;});category.hidden=!visible;count+=visible;});document.getElementById('help-empty').hidden=count>0;});
const toc=document.querySelector('.site-toc');
if(toc)document.querySelectorAll('.site-prose h2').forEach((heading,index)=>{heading.id=`section-${index+1}`;const a=document.createElement('a');a.href=`#${heading.id}`;a.textContent=heading.textContent;toc.append(a);});
