import {installTutorResize} from './tutor-resize.js';
import {installTutorInputTools} from './tutor-input-tools.js';
import {renderTutorMarkdown,copyTutorCode} from './tutor-markdown.js';
import {createTutorReader} from './tutor-reader.js';
import {trimTutorHistory} from './tutor-context.js';

const MAX_MESSAGES=20, MAX_QUESTION=4000, MAX_REPLY=30000;
const SHORTCUT_HINT='Enter 发送 · Shift+Enter 换行';

export function renderTutorText(container,text,options={}){return renderTutorMarkdown(container,text,options);}

export function createTutorPanel({getContext,onAsk,onSave=()=>true,onConfigure=()=>{},onSelectContext=()=>{},toast=()=>{}}={}){
  if(typeof getContext!=='function'||typeof onAsk!=='function')throw new TypeError('助教需要课程上下文与提问接口。');
  const doc=document,win=doc.defaultView;
  const panel=doc.createElement('aside');panel.id='tutor-panel';panel.className='tutor-panel';panel.setAttribute('aria-label','日语学习助教');
  panel.innerHTML=`<div id="tutor-resize" class="tutor-resize" role="separator" aria-orientation="vertical" aria-label="调整助教栏宽度" tabindex="0" title="拖动调整宽度；左右方向键微调；双击恢复默认"></div><header class="tutor-heading"><div><span class="tutor-eyebrow">一起把问题弄懂 · 1.0.0</span><h2>日语学习助教</h2></div><button type="button" id="tutor-collapse" class="tutor-icon" aria-label="收起 AI 助教" title="收起助教">›</button></header><section class="tutor-context"><div class="tutor-context-top"><span id="tutor-stage" class="tutor-context-tag"></span><button type="button" id="tutor-configure" class="tutor-link">接口设置</button></div><h3 id="tutor-lesson"></h3><p id="tutor-context-label"></p><label id="tutor-context-picker-wrap" hidden>追问对象<select id="tutor-context-picker" aria-label="选择追问的评测"></select></label><details id="tutor-context-details"><summary>这次提问会带上什么？</summary><p id="tutor-context-description"></p></details></section><div class="tutor-answer-tools"><span>对话记录</span><button type="button" id="tutor-latest" class="tutor-reader-tag" title="滚动到最新回复">↓ 最新</button><button type="button" id="tutor-reader-open" class="tutor-reader-tag" aria-haspopup="dialog" title="在弹窗中阅读当前对话">↗ 放大阅读</button></div><div id="tutor-messages" class="tutor-messages" role="log" aria-label="当前课程助教对话" aria-live="polite"></div><div id="tutor-composer" class="tutor-composer"><p id="tutor-error" class="tutor-error" role="alert" hidden></p><form id="tutor-form" class="tutor-form"><label for="tutor-input" class="tutor-input-label">向当前课程的助教提问</label><textarea id="tutor-input" aria-describedby="tutor-request-state tutor-draft-status" maxlength="4000" rows="3" placeholder="哪里不明白？可以直接说“为什么这里错了”" spellcheck="false"></textarea><div class="tutor-form-actions"><span id="tutor-request-state" title="Enter 发送；Shift+Enter 换行">${SHORTCUT_HINT}</span><button type="button" id="tutor-stop" class="tutor-stop" hidden>停止</button><button type="submit" id="tutor-send" class="button primary small">发送问题 ↑</button></div><div class="tutor-draft-tools"><span id="tutor-draft-status" role="status">0 / 4,000</span><button type="button" id="tutor-clear-draft">清空草稿</button><button type="button" id="tutor-undo-draft" hidden>撤销替换</button><button type="button" id="tutor-retry" hidden>重试问题</button></div></form></div>`;
  const toggle=doc.createElement('button');toggle.id='tutor-toggle';toggle.className='tutor-toggle';toggle.type='button';toggle.textContent='✧ 助教';toggle.setAttribute('aria-label','展开 日语学习助教');toggle.setAttribute('aria-controls','tutor-panel');
  doc.body.append(panel,toggle);
  const composer=panel.querySelector('#tutor-composer');
  const count=composer.querySelector('#tutor-draft-status');
  composer.querySelector('.tutor-form-actions').prepend(count);
  composer.querySelector('#tutor-input').rows=1;
  const $=selector=>panel.querySelector(selector)||composer.querySelector(selector),messages=$('#tutor-messages'),input=$('#tutor-input');
  const pending=new Map(),errors=new Map(),draftBackups=new Map();let destroyed=false,visibleKey='',open=false,paintedMessages='',forceScroll=false,inputTools=null,elapsedTimer=null,draftSaved=true;
  try{open=win.localStorage.getItem('kotoba-tutor-open')==='true';}catch{}
  const resize=installTutorResize({panel,handle:$('#tutor-resize'),win,doc});
  const reader=createTutorReader({
    composer,
    getContext:()=>{const current=context();return current?{key:current.key,lessonTitle:current.lessonTitle,label:current.label,messages:current.thread.messages||[],working:pending.has(current.key)}:null;},
    renderMessage:(target,text)=>renderTutorText(target,text,{toast}),
    toast
  });
  function setOpen(value){
    open=!!value;if(!open){reader.close();}panel.hidden=!open;toggle.hidden=open;
    doc.body.classList.toggle('tutor-open',open);doc.body.classList.toggle('tutor-collapsed',!open);
    toggle.setAttribute('aria-expanded',String(open));resize.refresh();
    try{win.localStorage.setItem('kotoba-tutor-open',String(open));}catch{}
  }
  function save(){try{return onSave();}catch{toast('助教对话暂时无法保存，请导出学习记录。');return false;}}
  function context(){const value=getContext();return value?.key&&value.thread?value:null;}
  function trimThread(thread){const kept=trimTutorHistory(thread.messages);thread.messages.splice(0,thread.messages.length,...kept);}
  function capture(current){const {thread,...rest}=current;return JSON.parse(JSON.stringify(rest));}
  function renderMessages(current){
    const list=current?.thread.messages||[],working=current&&pending.has(current.key);
    const fingerprint=JSON.stringify([current?.key,list,working]);
    if(fingerprint===paintedMessages)return;
    const previousTop=messages.scrollTop,nearBottom=messages.scrollHeight-previousTop-messages.clientHeight<70;
    paintedMessages=fingerprint;messages.replaceChildren();
    if(!current||!list.length){
      const empty=doc.createElement('div');empty.className='tutor-empty';
      const title=doc.createElement('b');title.textContent=current?'读到哪里，就问到哪里':'先选择一节课程';
      const description=doc.createElement('p');description.textContent=current?'我会结合上方标明的课程和追问对象回答。直接在下方写下你的疑惑，就可以继续讨论。':'进入课程后，这里会自动跟随当前学习环节。';
      empty.append(title,description);messages.append(empty);
    }
    for(const message of list){
      const article=doc.createElement('article');article.className='tutor-message '+(message.role==='user'?'from-user':'from-assistant');
      const author=doc.createElement('div');author.className='tutor-message-author';author.textContent=message.role==='user'?'你':'AI 助教';
      const content=doc.createElement('div');content.className='tutor-message-content';if(message.role==='assistant')renderTutorText(content,message.content,{toast});else{const p=doc.createElement('p');p.textContent=message.content;content.append(p);}const actions=doc.createElement('span');actions.className='tutor-message-actions';
      const copy=doc.createElement('button');copy.type='button';copy.textContent='复制';copy.setAttribute('aria-label',message.role==='user'?'复制这条问题':'复制这条回答');copy.onclick=()=>void copyTutorCode(message.content,{doc,toast:note=>toast(note.includes('失败')?'复制失败，请手动选择文字。':'已复制原文。')});actions.append(copy);
      if(message.role==='user'){const edit=doc.createElement('button');edit.type='button';edit.textContent='编辑后重发';edit.disabled=!!working;edit.onclick=()=>replaceDraft(message.content);actions.append(edit);}
      author.append(actions);article.append(author,content);messages.append(article);
    }
    if(working){const waiting=doc.createElement('p');waiting.className='tutor-thinking';waiting.textContent='正在结合这次学习内容思考…';messages.append(waiting);}
    if(nearBottom||forceScroll){messages.scrollTop=messages.scrollHeight;forceScroll=false;$('#tutor-latest').textContent='↓ 最新';}else{messages.scrollTop=previousTop;$('#tutor-latest').textContent='↓ 查看新消息';}
  }
  function refresh(){
    if(destroyed)return;
    const current=context(),key=current?.key||'';
    if(key!==visibleKey){visibleKey=key;paintedMessages='';forceScroll=true;input.value=current?.thread.draft||'';}
    else if(doc.activeElement!==input&&input.value!==(current?.thread.draft||''))input.value=current?.thread.draft||'';
    const working=!!current&&pending.has(key);
    $('#tutor-stage').textContent=current?.stageTitle||'随课答疑';
    $('#tutor-lesson').textContent=current?.lessonTitle||'你的固定学习伙伴';
    $('#tutor-context-label').textContent=current?.label||'课程之间的对话分别保存';
    $('#tutor-context-description').textContent=current?.description||'选择课程后，助教会带上当前课程的教材、题目和相应的作答记录。';
    $('#tutor-context-details').hidden=!current;
    const options=Array.isArray(current?.options)?current.options:[];
    const select=$('#tutor-context-picker');select.replaceChildren();
    for(const option of options){const item=doc.createElement('option');item.value=option.key;item.textContent=option.label;item.selected=option.key===key;select.append(item);}
    $('#tutor-context-picker-wrap').hidden=options.length<2;
    const error=errors.get(key)||'';$('#tutor-error').hidden=!error;$('#tutor-error').textContent=error;
    input.disabled=!current||working;$('#tutor-send').disabled=!current||working||!input.value.trim();$('#tutor-stop').hidden=!working;
    $('#tutor-request-state').textContent=working?'正在回复…':current?.configured===false?'请先配置助教接口':SHORTCUT_HINT;
    renderMessages(current);reader.refresh();refreshComposer();
  }
  async function ask(){
    const current=context();if(!current){toast('请先进入一节课程。');return;}
    if(pending.has(current.key))return;
    if(current.configured===false){onConfigure();toast('请先设置用于日语答疑的模型接口。');return;}
    const question=input.value.trim();if(!question){input.focus();return;}
    if(question.length>MAX_QUESTION){errors.set(current.key,'问题最多 4,000 字符，请分成几个小问题。');refresh();return;}
    const thread=current.thread;thread.messages||=[];
    const history=thread.messages.slice(-MAX_MESSAGES).map(({role,content})=>({role,content}));
    const captured=capture(current),key=current.key,controller=new AbortController();
    const userMessage={role:'user',content:question};
    thread.messages.push(userMessage);thread.draft='';errors.delete(key);
    pending.set(key,{controller,thread,userMessage,question,started:Date.now()});if(!elapsedTimer)elapsedTimer=win.setInterval(refreshRequestTime,1000);Object.defineProperty(thread,'pending',{value:true,writable:true,configurable:true,enumerable:false});input.value='';forceScroll=true;save();refresh();
    try{
      const answer=await onAsk({context:captured,question,history,signal:controller.signal});
      if(destroyed)return;
      if(controller.signal.aborted)throw new Error('请求已取消');
      if(typeof answer?.reply!=='string'||!answer.reply.trim())throw new Error('模型没有返回答复，请重试。');
      thread.messages.push({role:'assistant',content:answer.reply.slice(0,MAX_REPLY)});trimThread(thread);save();
    }catch(error){
      if(destroyed)return;
      const index=thread.messages.indexOf(userMessage);if(index>=0)thread.messages.splice(index,1);
      if(!thread.draft)thread.draft=question;
      // Restore a failed submission even if the browser kept textarea focus.
      if(context()?.key===key&&!input.value)input.value=thread.draft;
      errors.set(key,controller.signal.aborted?'已停止本次请求，问题已保留，可修改后重发。':String(error?.message||'暂时无法获得答复，请稍后重试。').slice(0,1000));save();
    }finally{
      pending.delete(key);delete thread.pending;
      if(!pending.size&&elapsedTimer){win.clearInterval(elapsedTimer);elapsedTimer=null;}
      if(!destroyed){refresh();}
    }
  }
  $('#tutor-form').addEventListener('submit',event=>{event.preventDefault();void ask();});
  const saveDraft=()=>{const current=context();if(current&&!pending.has(current.key)){current.thread.draft=input.value.slice(0,MAX_QUESTION);draftSaved=save()!==false;refreshComposer();}};
  input.addEventListener('input',saveDraft);
  inputTools=installTutorInputTools({composer,input,onSend:()=>{void ask();},onEdit:saveDraft});
  function refreshRequestTime(){const current=context(),request=current&&pending.get(current.key);if(request)$('#tutor-request-state').textContent='正在回复 · '+Math.max(0,Math.floor((Date.now()-request.started)/1000))+' 秒';}
  function refreshComposer(){
    const current=context(),working=!!current&&pending.has(current.key);
    composer.classList.toggle('is-pending',working);
    composer.classList.toggle('is-unconfigured',current?.configured===false);
    $('#tutor-send').disabled=!current||working||!input.value.trim();
    $('#tutor-draft-status').textContent=input.value.length.toLocaleString()+' / 4,000'+(input.value?' · '+(draftSaved?'草稿已保存':'保存失败，请复制备份'):'');
    $('#tutor-draft-status').classList.toggle('near-limit',input.value.length>3600);
    $('#tutor-clear-draft').disabled=working||!input.value;$('#tutor-undo-draft').hidden=!current||!draftBackups.has(current.key);$('#tutor-undo-draft').disabled=working;
    $('#tutor-retry').hidden=working||!current||!errors.has(current.key);$('#tutor-retry').disabled=!input.value.trim();
    inputTools?.refresh();if(current?.configured===false)$('#tutor-request-state').textContent='请先配置助教接口';refreshRequestTime();
  }
  function replaceDraft(value){const current=context();if(!current||pending.has(current.key))return;draftBackups.set(current.key,input.value);while(draftBackups.size>20)draftBackups.delete(draftBackups.keys().next().value);input.value=value;saveDraft();input.focus();}
  $('#tutor-clear-draft').onclick=()=>replaceDraft('');
  $('#tutor-undo-draft').onclick=()=>{const current=context();if(!current||pending.has(current.key)||!draftBackups.has(current.key))return;input.value=draftBackups.get(current.key);draftBackups.delete(current.key);saveDraft();input.focus();};
  $('#tutor-retry').onclick=()=>void ask();
  $('#tutor-latest').onclick=()=>{messages.scrollTop=messages.scrollHeight;$('#tutor-latest').textContent='↓ 最新';};
  $('#tutor-reader-open').onclick=()=>reader.open();
  $('#tutor-collapse').onclick=()=>setOpen(false);toggle.onclick=()=>{setOpen(true);refresh();};
  $('#tutor-configure').onclick=()=>onConfigure();
  $('#tutor-context-picker').onchange=event=>{onSelectContext(event.target.value);refresh();};
  $('#tutor-stop').onclick=()=>{const current=context();if(current)pending.get(current.key)?.controller.abort();};
  setOpen(open);refresh();
  return {
    refresh,open(){setOpen(true);refresh();},close(){setOpen(false);},
    setOpen(value){setOpen(value);refresh();},isBusy(){return pending.size>0;},
    focus(message){setOpen(true);refresh();const current=context();if(current&&!pending.has(current.key)&&typeof message==='string'){current.thread.draft=message.slice(0,MAX_QUESTION);input.value=current.thread.draft;save();refreshComposer();}input.focus();},
    cancel(key){if(key)pending.get(key)?.controller.abort();else for(const request of pending.values())request.controller.abort();},
    cancelAll(){for(const request of pending.values())request.controller.abort();},
    destroy(){if(destroyed)return;destroyed=true;reader.destroy();inputTools?.destroy();if(elapsedTimer)win.clearInterval(elapsedTimer);resize.destroy();for(const request of pending.values()){request.controller.abort();delete request.thread.pending;}pending.clear();panel.remove();toggle.remove();doc.body.classList.remove('tutor-open','tutor-collapsed');}
  };
}
