import {installTutorShortcuts} from './tutor-shortcuts.js';

const SHORTCUT_HINT='Enter 发送 · Shift+Enter 换行';
export function installTutorInputTools({composer,input,onSend,onEdit}){
  const doc=input.ownerDocument,win=doc.defaultView;
  // Retired preferences must not restore one of the removed shortcut modes.
  try{
    win.localStorage.removeItem('kotoba-tutor-send-mode');
    win.localStorage.removeItem('kotoba-tutor-send-mode-revision');
  }catch{}
  const menu=doc.createElement('details');menu.className='tutor-draft-menu';
  const summary=doc.createElement('summary');summary.textContent='草稿';summary.title='清空、撤销或重试问题';
  const content=doc.createElement('div');content.className='tutor-draft-menu-content';
  content.append(composer.querySelector('.tutor-draft-tools'));
  menu.append(summary,content);
  composer.querySelector('.tutor-form-actions').before(menu);
  menu.addEventListener('click',event=>{if(event.target.closest('button'))menu.open=false;});
  menu.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){event.preventDefault();event.stopPropagation();menu.open=false;input.focus();}});
  const shortcuts=installTutorShortcuts(input,{onSend,onEdit});
  input.title=SHORTCUT_HINT;
  composer.querySelector('#tutor-send').title=SHORTCUT_HINT;
  function grow(){
    if(input.hidden||input.disabled)return;
    const style=win.getComputedStyle(input),minimum=parseFloat(style.minHeight)||42,maximum=parseFloat(style.maxHeight)||96;
    if(!input.value){input.style.height=minimum+'px';return;}
    input.style.height='0px';
    input.style.height=Math.max(minimum,Math.min(maximum,input.scrollHeight+2))+'px';
  }
  input.addEventListener('input',grow);
  const observer=typeof win.ResizeObserver==='function'?new win.ResizeObserver(grow):null;observer?.observe(composer);
  return {refresh:grow,destroy(){shortcuts();observer?.disconnect();input.removeEventListener('input',grow);menu.remove();}};
}
