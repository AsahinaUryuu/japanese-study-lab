import {copyTutorCode} from './tutor-markdown.js';

const PREF_KEY='kotoba-tutor-reading-v1',SCROLL_KEY='kotoba-tutor-reading-positions-v1';
const defaults={font:16,line:1.9,theme:'light',wrap:false,width:'comfortable'};
const finite=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
export function normalizeReadingPreferences(raw={}){
  if(!raw||typeof raw!=='object')raw={};
  return {font:Math.round(finite(raw.font,12,26,16)),line:[1.6,1.9,2.2].includes(raw.line)?raw.line:1.9,
    theme:['light','paper','dark'].includes(raw.theme)?raw.theme:'light',wrap:raw.wrap===true,width:raw.width==='wide'?'wide':'comfortable'};
}
export function readerToolbarMarkup(){return `<div class="tutor-reader-tools" aria-label="对话阅读工具"><div class="tutor-reader-tool-row"><details id="reader-settings"><summary>阅读设置 <span id="reader-font-summary">16px</span></summary><div class="reader-settings-grid"><fieldset><legend>正文字号</legend><div class="reader-font-buttons"><button type="button" id="reader-font-down" aria-label="缩小正文字号">A−</button><output id="reader-font-value" aria-live="polite">16px</output><button type="button" id="reader-font-up" aria-label="放大正文字号">A+</button><button type="button" id="reader-font-reset">默认字号</button></div><input id="reader-font-range" type="range" min="12" max="26" step="1" value="16" aria-label="正文字号"></fieldset><label>正文行距<select id="reader-line"><option value="1.6">紧凑</option><option value="1.9">标准</option><option value="2.2">宽松</option></select></label><label>阅读配色<select id="reader-theme"><option value="light">明亮</option><option value="paper">纸张</option><option value="dark">深色</option></select></label><label>正文宽度<select id="reader-width"><option value="comfortable">舒适行宽</option><option value="wide">铺满窗口</option></select></label><label class="reader-check"><input id="reader-wrap" type="checkbox">长代码自动折行</label><p class="reader-settings-note">阅读偏好自动保存在当前浏览器，不影响输入框与学习正文。</p></div></details><button type="button" id="reader-search-toggle" aria-expanded="false" aria-controls="reader-search-bar">查找对话</button><button type="button" id="reader-top">↑ 开头</button><button type="button" id="reader-latest">↓ 最新</button><button type="button" id="reader-export">导出对话</button></div><div id="reader-search-bar" class="reader-search-bar" hidden><input id="reader-search" type="search" maxlength="200" placeholder="查找当前对话…" aria-label="查找当前对话"><output id="reader-search-count" role="status" aria-live="polite">输入关键词</output><button type="button" id="reader-search-prev" aria-label="上一个匹配" title="上一个（Shift+Enter）">↑</button><button type="button" id="reader-search-next" aria-label="下一个匹配" title="下一个（Enter）">↓</button><button type="button" id="reader-search-close" aria-label="关闭对话查找">×</button></div></div>`;}

export async function copyReaderAnswer(source,{doc,toast=()=>{},root}={}){
  const copied=await copyTutorCode(source,{doc,fallbackRoot:root,toast:()=>{}});
  toast(copied?'回答已复制为 Markdown。':'自动复制失败，请选中回答后手动复制。');return copied;
}
export function conversationMarkdown(context){
  const lines=['# '+String(context?.lessonTitle||'助教对话'),String(context?.label||'')];
  for(const message of context?.messages||[]){if(message&&['user','assistant'].includes(message.role)&&typeof message.content==='string')lines.push('## '+(message.role==='user'?'我的问题':'AI 助教'),message.content);}
  return lines.join('\n\n')+'\n';
}

/** Reading-only preferences and navigation. Never changes a thread or its draft. */
export function installReaderTools({dialog,body,history,getContext,toast=()=>{}}){
  const doc=dialog.ownerDocument,win=doc.defaultView,$=selector=>dialog.querySelector(selector);
  let preferences={...defaults},positions={},matches=[],active=-1,searchTimer,scrollTimer,unread=0,boundKey='',destroyed=false,lastVisiblePosition=null;
  try{preferences=normalizeReadingPreferences(JSON.parse(win.localStorage.getItem(PREF_KEY)||'{}'));}catch{}
  try{const raw=JSON.parse(win.sessionStorage.getItem(SCROLL_KEY)||'{}');if(raw&&typeof raw==='object'&&!Array.isArray(raw))positions=raw;}catch{}
  function applyPreferences(save=false){
    dialog.style.setProperty('--reader-font',preferences.font+'px');dialog.style.setProperty('--reader-code-font',Math.max(11,preferences.font-2)+'px');dialog.style.setProperty('--reader-line',String(preferences.line));
    dialog.dataset.readingTheme=preferences.theme;dialog.dataset.readingWidth=preferences.width;dialog.classList.toggle('reader-code-wrap',preferences.wrap);
    $('#reader-font-range').value=String(preferences.font);$('#reader-font-value').textContent=preferences.font+'px';$('#reader-font-summary').textContent=preferences.font+'px';
    $('#reader-font-down').disabled=preferences.font<=12;$('#reader-font-up').disabled=preferences.font>=26;
    $('#reader-line').value=String(preferences.line);$('#reader-theme').value=preferences.theme;$('#reader-width').value=preferences.width;$('#reader-wrap').checked=preferences.wrap;
    if(save)try{win.localStorage.setItem(PREF_KEY,JSON.stringify(preferences));}catch{toast('本次阅读设置已生效，但浏览器暂时无法保存。');}
  }
  function setPreference(name,value){preferences=normalizeReadingPreferences({...preferences,[name]:value});applyPreferences(true);}
  $('#reader-font-down').onclick=()=>setPreference('font',preferences.font-1);
  $('#reader-font-up').onclick=()=>setPreference('font',preferences.font+1);
  $('#reader-font-reset').onclick=()=>setPreference('font',defaults.font);
  $('#reader-font-range').oninput=event=>setPreference('font',Number(event.target.value));
  $('#reader-line').onchange=event=>setPreference('line',Number(event.target.value));
  $('#reader-theme').onchange=event=>setPreference('theme',event.target.value);
  $('#reader-width').onchange=event=>setPreference('width',event.target.value);
  $('#reader-wrap').onchange=event=>setPreference('wrap',event.target.checked);
  applyPreferences();

  function nearBottom(){return body.scrollHeight-body.clientHeight-body.scrollTop<=80;}
  function snapshotPosition(key=boundKey){
    if(!key||!dialog.open)return null;
    return lastVisiblePosition={key,top:Math.max(0,Number(body.scrollTop)||0),bottom:nearBottom(),time:Date.now()};
  }
  function updateLatest(){
    const button=$('#reader-latest');button.textContent=unread?'↓ 新消息 '+unread:'↓ 最新';button.classList.toggle('has-unread',!!unread);button.setAttribute('aria-label',unread?'跳到最新消息，有 '+unread+' 条新消息':'跳到最新消息');
  }
  function savePosition(key=boundKey){
    if(!key)return;
    // External native close can hide the dialog before its close event arrives.
    // Use the last visible snapshot, never display:none geometry (all zeros).
    const position=dialog.open?snapshotPosition(key):lastVisiblePosition?.key===key?lastVisiblePosition:null;
    if(!position)return;
    positions[key]={top:position.top,bottom:position.bottom,time:position.time};
    positions=Object.fromEntries(Object.entries(positions).filter(([,v])=>v&&Number.isFinite(v.top)&&Number.isFinite(v.time)).sort((a,b)=>b[1].time-a[1].time).slice(0,30));
    try{win.sessionStorage.setItem(SCROLL_KEY,JSON.stringify(positions));}catch{}
  }
  function scrollChanged(){
    if(!dialog.open)return;
    snapshotPosition();
    if(nearBottom()){unread=0;updateLatest();}
    clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{if(!destroyed&&dialog.open)savePosition();},150);
  }
  body.addEventListener('scroll',scrollChanged,{passive:true});
  $('#reader-top').onclick=()=>{body.scrollTop=0;savePosition();};
  $('#reader-latest').onclick=()=>{body.scrollTop=body.scrollHeight;unread=0;updateLatest();savePosition();};

  function removeMarks(){
    for(const mark of history.querySelectorAll('mark.reader-search-mark')){const parent=mark.parentNode;mark.replaceWith(doc.createTextNode(mark.textContent));parent.normalize();}
    matches=[];active=-1;
  }
  function searchStatus(){
    $('#reader-search-count').textContent=!$('#reader-search').value.trim()?'输入关键词':matches.length?(active+1)+' / '+matches.length+(matches.length===200?'（前 200 处）':''):'未找到匹配';
    $('#reader-search-prev').disabled=!matches.length;$('#reader-search-next').disabled=!matches.length;
    for(let index=0;index<matches.length;index++)for(const mark of matches[index])mark.classList.toggle('current',index===active);
  }
  function selectMatch(index,scroll=true){
    if(!matches.length){active=-1;searchStatus();return;}
    active=(index+matches.length)%matches.length;searchStatus();
    if(scroll)matches[active][0]?.scrollIntoView?.({block:'center',behavior:'auto'});
  }
  function search(scroll=false){
    clearTimeout(searchTimer);searchTimer=null;removeMarks();const query=$('#reader-search').value.trim();
    if(!query||$('#reader-search-bar').hidden){searchStatus();return;}
    const expression=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
    for(const content of history.querySelectorAll('.tutor-message-content')){
      const walker=doc.createTreeWalker(content,win.NodeFilter.SHOW_TEXT,{acceptNode(node){return node.parentElement.closest('button,.tutor-code-toolbar,.tutor-copy-status')?win.NodeFilter.FILTER_REJECT:win.NodeFilter.FILTER_ACCEPT;}});
      const nodes=[];let node,text='';while((node=walker.nextNode())){nodes.push({node,start:text.length,end:text.length+node.data.length});text+=node.data;}
      const found=[...text.matchAll(expression)].slice(0,200-matches.length),groups=[];
      for(let i=found.length-1;i>=0;i--){
        const start=found[i].index,end=start+found[i][0].length,marks=[];
        for(let j=nodes.length-1;j>=0;j--){const part=nodes[j],from=Math.max(start,part.start),to=Math.min(end,part.end);if(from>=to)continue;
          const selected=part.node.splitText(from-part.start);selected.splitText(to-from);const mark=doc.createElement('mark');mark.className='reader-search-mark';selected.replaceWith(mark);mark.append(selected);marks.unshift(mark);
        }
        groups.unshift(marks);
      }
      matches.push(...groups);if(matches.length>=200)break;
    }
    selectMatch(0,scroll);
  }
  function toggleSearch(open){
    $('#reader-search-bar').hidden=!open;$('#reader-search-toggle').setAttribute('aria-expanded',String(open));
    if(open){$('#reader-search').focus({preventScroll:true});search();}
    else{clearTimeout(searchTimer);searchTimer=null;removeMarks();searchStatus();$('#reader-search-toggle').focus({preventScroll:true});}
  }
  $('#reader-search-toggle').onclick=()=>toggleSearch($('#reader-search-bar').hidden);
  $('#reader-search-close').onclick=()=>toggleSearch(false);
  $('#reader-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>search(true),120);};
  $('#reader-search').onkeydown=event=>{if(event.isComposing||event.keyCode===229)return;if(event.key==='Enter'){event.preventDefault();if(searchTimer)search();selectMatch(active+(event.shiftKey?-1:1));}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();toggleSearch(false);}};
  $('#reader-search-next').onclick=()=>{searchTimer&&search();selectMatch(active+1);};
  $('#reader-search-prev').onclick=()=>{searchTimer&&search();selectMatch(active-1);};
  searchStatus();
  $('#reader-export').onclick=()=>{
    const value=getContext();if(!value?.messages?.length){toast('当前还没有可导出的对话。');return;}
    let url;try{
      url=win.URL.createObjectURL(new win.Blob([conversationMarkdown(value)],{type:'text/markdown;charset=utf-8'}));
      const anchor=doc.createElement('a');anchor.href=url;anchor.download='助教对话-'+String(value.lessonTitle||'当前课程').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,70)+'.md';
      dialog.append(anchor);anchor.click();anchor.remove();toast('当前对话已导出为 Markdown。');
      win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);
    }catch{if(url)win.URL.revokeObjectURL(url);toast('暂时无法导出，请使用回答上的复制按钮。');}
  };
  return {
    bind(key){boundKey=key;lastVisiblePosition=null;unread=0;updateLatest();$('#reader-search').value='';removeMarks();searchStatus();},
    restoreScroll(key){const position=positions[key];if(position&&Number.isFinite(position.top)&&typeof position.bottom==='boolean'){body.scrollTop=position.bottom?body.scrollHeight:Math.max(0,position.top);snapshotPosition(key);return true;}return false;},
    rememberScroll:savePosition,
    refresh({changed=false,added=0,wasNearBottom=true}={}){if(added&&!wasNearBottom){unread+=added;updateLatest();}if(changed)search();$('#reader-export').disabled=!getContext()?.messages?.length;snapshotPosition();},
    destroy(){destroyed=true;clearTimeout(searchTimer);clearTimeout(scrollTimer);body.removeEventListener('scroll',scrollChanged);removeMarks();}
  };
}
