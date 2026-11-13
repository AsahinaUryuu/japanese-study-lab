import {readerCardHTML,addReaderReview} from './reader-core.js';
export function createReaderPanel({getRecords,onSave,speak,toast}){
 const panel=document.createElement('section');panel.className='reader-word-card';panel.id='reader-word-card';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','false');panel.setAttribute('aria-labelledby','reader-word-title');panel.hidden=true;document.body.append(panel);
 let current=null,anchor=null;
 function close(restore=false){const previous=anchor;if(anchor?.isConnected)anchor.setAttribute('aria-expanded','false');panel.hidden=true;panel.replaceChildren();current=null;anchor=null;if(restore&&previous?.isConnected)previous.focus({preventScroll:true});}
 function position(){
  if(!anchor?.isConnected)return close();
  const viewport=window.visualViewport,visibleWidth=viewport?.width||window.innerWidth,visibleHeight=viewport?.height||window.innerHeight,offsetTop=viewport?.offsetTop||0,offsetLeft=viewport?.offsetLeft||0;const rect=anchor.getBoundingClientRect(),gap=8,padding=12,width=Math.min(340,visibleWidth-padding*2);
  panel.style.width=width+'px';panel.style.maxHeight=Math.max(100,visibleHeight-padding*2)+'px';
  const height=panel.getBoundingClientRect().height,left=Math.max(offsetLeft+padding,Math.min(rect.left,offsetLeft+visibleWidth-width-padding));
  const top=rect.bottom+gap+height<=offsetTop+visibleHeight-padding?rect.bottom+gap:Math.max(offsetTop+padding,Math.min(rect.top-gap-height,offsetTop+visibleHeight-height-padding));
  panel.style.left=left+'px';panel.style.top=top+'px';
 }
 function open(entry,target,context={}){
  if(anchor===target&&!panel.hidden){close(true);return;}
  close();anchor=target;current=entry;anchor.setAttribute('aria-expanded','true');anchor.setAttribute('aria-controls',panel.id);
  panel.innerHTML=readerCardHTML(entry,{...context,added:Object.hasOwn(getRecords(),entry.id)});panel.hidden=false;position();panel.querySelector('[data-reader="close"]').focus({preventScroll:true});
 }
 panel.addEventListener('click',event=>{
  const action=event.target.closest('[data-reader]')?.dataset.reader;if(!action||!current)return;
  if(action==='close'){close(true);return;}
  if(action==='speak'){speak(current.reading||current.word);return;}
  if(action==='add'){
   const added=addReaderReview(getRecords(),current.id);if(added)onSave();
   const button=panel.querySelector('[data-reader="add"]');button.disabled=true;button.textContent='✓ 已加入复习';panel.querySelector('.reader-status').textContent=added?'已加入复习，可继续阅读。':'已在复习计划中，原有复习进度保留。';position();toast(added?'已将「'+current.word+'」加入复习':'该词已在复习计划中');
  }
 });
 const outside=event=>{if(!panel.hidden&&!panel.contains(event.target)&&!anchor?.contains(event.target))close();};
 const escape=event=>{if(event.key==='Escape'&&!panel.hidden){event.preventDefault();event.stopPropagation();close(true);}};
 const scroll=event=>{if(!panel.hidden&&!panel.contains(event.target))close();};
 const resize=()=>close();
 panel.addEventListener('toggle',()=>{if(!panel.hidden)position();},true);
 document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape,true);document.addEventListener('scroll',scroll,true);window.addEventListener('resize',resize);
 return {open,close,destroy(){close();document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape,true);document.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',resize);panel.remove();}};
}
