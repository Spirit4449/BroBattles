import './shell';
import { initializeSupportPage } from './supportUI';
import { initializeHelpSearch } from './helpSearch';
initializeSupportPage();
initializeHelpSearch();
const toc=document.querySelector('.site-toc');
if(toc)document.querySelectorAll('.site-prose h2').forEach((heading,index)=>{heading.id=`section-${index+1}`;const a=document.createElement('a');a.href=`#${heading.id}`;a.textContent=heading.textContent;toc.append(a);});
