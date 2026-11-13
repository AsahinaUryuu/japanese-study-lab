import {readerToolbarMarkup,installReaderTools,copyReaderAnswer} from './tutor-reader-tools.js';

/** Enlarges one tutor thread and temporarily hosts the sidebar's actual composer.
 * Message, draft and request state continue to belong to the existing panel. */
export function createTutorReader({getContext,renderMessage,composer,toast=()=>{}}={}){
  if(typeof getContext!=='function'||typeof renderMessage!=='function')throw new TypeError('放大阅读需要当前对话和消息渲染器。');
  if(!composer||composer.nodeType!==1)throw new TypeError('放大对话需要共用助教输入区。');
  const doc=document;
  const dialog=doc.createElement('dialog');dialog.id='tutor-reader-dialog';dialog.className='tutor-reader';
  dialog.setAttribute('aria-labelledby','tutor-reader-title');dialog.setAttribute('aria-describedby','tutor-reader-context');
  dialog.innerHTML='<header class="tutor-reader-heading"><div><span class="tutor-reader-eyebrow">日语学习助教</span><h2 id="tutor-reader-title">放大对话</h2><p id="tutor-reader-context"></p></div><button type="button" id="tutor-reader-close" aria-label="关闭放大对话，返回侧栏" title="关闭并返回侧栏（Esc）">×</button></header><div id="tutor-reader-body" class="tutor-reader-body" tabindex="0" aria-label="放大的助教对话"><p id="tutor-reader-empty" class="tutor-reader-empty" hidden>这里还没有对话。在下方写下你的第一个问题吧。</p><div id="tutor-reader-history" role="log" aria-live="polite" aria-relevant="additions text"></div><p id="tutor-reader-working" class="tutor-reader-working" role="status" hidden>助教正在思考，答复会自动出现在这里…</p></div><footer class="tutor-reader-footer" aria-label="继续向当前助教提问"></footer>';
  dialog.querySelector('.tutor-reader-heading').insertAdjacentHTML('afterend',readerToolbarMarkup());
  doc.body.append(dialog);
  const $=selector=>dialog.querySelector(selector);
  const body=$('#tutor-reader-body'),history=$('#tutor-reader-history'),closeButton=$('#tutor-reader-close'),composerSlot=$('.tutor-reader-footer');
  let destroyed=false,boundKey='',previousFocus=null,rendered=[],composerHome=null,sidebarScroll=[];
  const tools=installReaderTools({dialog,body,history,getContext:current,toast});
  function current(){
    const value=getContext();
    if(!value||typeof value.key!=='string'||!value.key)return null;
    return {key:value.key,lessonTitle:String(value.lessonTitle||'当前课程'),label:String(value.label||''),working:value.working===true,messages:(Array.isArray(value.messages)?value.messages:[]).filter(message=>message&&['user','assistant'].includes(message.role)&&typeof message.content==='string')};
  }
  function selectionState(){
    return [...composer.querySelectorAll('textarea,input')].filter(input=>typeof input.selectionStart==='number').map(input=>({input,start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection,top:input.scrollTop,left:input.scrollLeft}));
  }
  function restoreSelection(selections){
    for(const {input,start,end,direction,top,left} of selections){
      try{input.setSelectionRange(start,end,direction||'none');}catch{}
      input.scrollTop=top;input.scrollLeft=left;
    }
  }
  function mountComposer(){
    const parent=composer.parentNode;
    if(!parent)throw new Error('助教输入区尚未挂载。');
    const marker=doc.createComment('tutor-composer-home'),next=composer.nextSibling;
    const selections=selectionState();
    sidebarScroll=[parent,...parent.querySelectorAll('*')].filter(node=>!composer.contains(node)&&(node===parent||node.scrollTop||node.scrollLeft||/auto|scroll/.test(doc.defaultView.getComputedStyle(node).overflowY+' '+doc.defaultView.getComputedStyle(node).overflowX))).map(node=>({node,top:node.scrollTop,left:node.scrollLeft}));
    parent.insertBefore(marker,composer);composerHome={parent,next,marker};
    composerSlot.append(composer);restoreSelection(selections);
  }
  function returnComposer(){
    if(!composerHome)return;
    const selections=selectionState(),{parent,next,marker}=composerHome;
    composerHome=null;
    if(marker.parentNode)marker.parentNode.insertBefore(composer,marker);
    else if(next?.parentNode===parent)parent.insertBefore(composer,next);
    else parent.append(composer);
    marker.remove();restoreSelection(selections);
  }
  function restoreFocus(){
    const target=previousFocus;previousFocus=null;
    if(target?.isConnected&&typeof target.focus==='function')target.focus({preventScroll:true});
    for(const {node,top,left} of sidebarScroll){node.scrollTop=top;node.scrollLeft=left;}
    sidebarScroll=[];
  }
  function didClose(){
    if(boundKey)tools.rememberScroll(boundKey);
    boundKey='';returnComposer();restoreFocus();
  }
  function close(){
    if(destroyed)return;
    // Closing the native dialog collapses its geometry. Capture while visible.
    if(dialog.open&&boundKey)tools.rememberScroll(boundKey);
    if(dialog.open)dialog.close();
    // Native close events are queued. Return the shared controls immediately;
    // a later close event must not steal focus or unmount a newly opened dialog.
    didClose();
  }
  function articleFor(message){
    const article=doc.createElement('article');article.className='tutor-reader-message '+(message.role==='user'?'from-user':'from-assistant');
    article.setAttribute('aria-label',message.role==='user'?'你的提问':'AI 助教的回答');
    const author=doc.createElement('div');author.className='tutor-reader-author';author.textContent=message.role==='user'?'你':'AI 助教';
    const content=doc.createElement('div');content.className='tutor-message-content';
    if(message.role==='assistant')renderMessage(content,message.content);
    else {content.classList.add('tutor-reader-user-text');content.textContent=message.content;}
    if(message.role==='assistant'){
      const copy=doc.createElement('button');copy.type='button';copy.className='reader-copy-answer';copy.textContent='复制回答';copy.setAttribute('aria-label','复制整条回答为 Markdown');
      copy.onclick=async()=>{copy.disabled=true;try{const ok=await copyReaderAnswer(message.content,{doc,toast,root:dialog});copy.textContent=ok?'已复制回答':'重试复制';}finally{copy.disabled=false;}};
      const row=doc.createElement('div');row.className='reader-message-heading';row.append(author,copy);article.append(row,content);
    }else article.append(author,content);
    return article;
  }
  function paint(value,forceBottom=false){
    const nearBottom=body.scrollHeight-body.clientHeight-body.scrollTop<=80,previousTop=body.scrollTop;
    $('#tutor-reader-context').textContent=value.lessonTitle+(value.label?' · '+value.label:'');
    $('#tutor-reader-context').title=$('#tutor-reader-context').textContent;
    const next=value.messages.map(message=>JSON.stringify([message.role,message.content]));
    const lastIndex=rendered.length?next.lastIndexOf(rendered.at(-1)):-1;
    const added=rendered.length&&lastIndex>=0?next.length-lastIndex-1:Math.max(0,next.length-rendered.length);
    let same=0;while(same<rendered.length&&same<next.length&&rendered[same]===next[same])same++;
    const changed=same<next.length||same<rendered.length;
    // Keep unchanged messages mounted, including selections and copy controls.
    while(history.children.length>same)history.lastElementChild.remove();
    for(let index=same;index<value.messages.length;index++)history.append(articleFor(value.messages[index]));
    rendered=next;
    $('#tutor-reader-empty').hidden=!!value.messages.length||value.working;
    $('#tutor-reader-working').hidden=!value.working;
    history.setAttribute('aria-busy',String(value.working));
    if(forceBottom||nearBottom)body.scrollTop=body.scrollHeight;
    else body.scrollTop=previousTop;
    tools.refresh({changed,added:forceBottom?0:added,wasNearBottom:nearBottom});
  }
  function refresh(){
    if(destroyed||!dialog.open)return;
    const value=current();
    if(!value||value.key!==boundKey){close();return;}
    paint(value);
  }
  function open(){
    if(destroyed)return false;
    // An external native close can precede its queued close event. Complete the
    // return before opening again so the original home marker is never replaced.
    if(!dialog.open&&composerHome)didClose();
    const value=current();
    if(!value){toast('请先进入一节课程，再打开当前对话。');return false;}
    if(dialog.open&&value.key===boundKey){refresh();return true;}
    if(dialog.open)close();
    if(typeof dialog.showModal!=='function'){toast('当前浏览器不支持放大阅读，请更新浏览器后重试。');return false;}
    previousFocus=doc.activeElement;boundKey=value.key;rendered=[];history.replaceChildren();tools.bind(boundKey);
    try{mountComposer();dialog.showModal();}
    catch{didClose();toast('暂时无法打开放大阅读，请关闭其他弹窗后重试。');return false;}
    paint(value,true);
    tools.restoreScroll(boundKey);
    const focusTarget=composer.contains(previousFocus)?previousFocus:closeButton;
    focusTarget.focus({preventScroll:true});return true;
  }
  closeButton.addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('close',()=>{if(!dialog.open)didClose();});
  return {open,close,refresh,isOpen:()=>!destroyed&&dialog.open,destroy(){if(destroyed)return;close();destroyed=true;tools.destroy();dialog.remove();}};
}
