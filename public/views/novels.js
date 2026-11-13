import {e,heading,button,empty} from '../ui.js';
import {readerParagraphHTML,hasReaderParagraph} from '../reader-core.js';
import {furiganaButton} from '../reader-text.js';
import {readingRecord} from '../stories-core.js';
import {rememberNovelChapter,novelResumeChapter} from '../novel-progress.js';

let generation=0,active=null;
const bookHref=id=>'#novel/'+encodeURIComponent(id);
const chapterHref=(book,chapter)=>bookHref(book)+'/'+encodeURIComponent(chapter);
const recordKey=(book,chapter)=>'novel:'+book+':'+chapter;
const countChars=book=>(book.chapters||[]).reduce((n,c)=>n+(Number(c.characters)||0),0);
const completeCount=(book,env)=>(book.chapters||[]).filter(c=>env.store.data.readings?.[recordKey(book.id,c.id)]?.done).length;
const isCurrent=(env,scope)=>active===scope&&scope.generation===generation&&!scope.controller.signal.aborted&&env.state.route===scope.route;
const chapterIndex=(book,id)=>book.chapters.findIndex(c=>c.id===id);
function latestChapter(book,env){
 return novelResumeChapter(book,env.store.data);
}
function rememberPosition(env,scope,index,leaving=false){
 if((!leaving&&!isCurrent(env,scope))||!scope.chapter)return;
 const paragraph=Math.max(0,Math.min(scope.chapter.paragraphs.length-1,Math.floor(index)));
 if(scope.record.paragraph===paragraph)return;
 scope.record.paragraph=paragraph;env.store.save();
 const indicator=env.main.querySelector('[data-novel-position]');if(indicator)indicator.textContent=`自动记忆 · 第 ${paragraph+1} / ${scope.chapter.paragraphs.length} 段`;
}
export function cleanupNovels(){
 if(active?.scrollTimer)active.flushPosition?.();
 generation++;
 if(active){active.controller.abort();active.observer?.disconnect();if(active.onScroll){window.removeEventListener('scroll',active.onScroll);document.querySelector('.workspace')?.removeEventListener('scroll',active.onScroll);}clearTimeout(active.scrollTimer);if(active.frame)cancelAnimationFrame(active.frame);}
 active=null;
}
function tabs(){return '<nav class="reading-shelf-tabs" aria-label="阅读书架"><a class="button primary" href="#novels" aria-current="page">全文小说</a><a class="button subtle" href="#stories">课外故事</a><a class="button subtle" href="#stories?kind=online">自备轻小说</a></nav>';}
function importForm(env){
 const selected=env.state.params.get('link')||'',novels=env.data.externalNovels||[],linked=novels.find(b=>b.id===selected);
 return `<section class="novel-import card"><div><h2>导入一本书，在这里读</h2><p>导入你已有的 TXT 或无 DRM 的 EPUB。正文保存在本机，阅读、假名注音和查词不需要调用模型。</p></div><form id="novel-import-form"><div class="novel-import-fields"><label>选择文件<input type="file" name="novel-file" accept=".txt,.epub,text/plain,application/epub+zip" aria-describedby="novel-file-help"></label><label>关联书架作品<select name="novel-linked" aria-label="关联书架作品"><option value="">独立书籍</option>${novels.map(b=>`<option value="${e(b.id)}" ${b.id===selected?'selected':''}>${e(b.subtitle||b.title)}</option>`).join('')}</select></label><label>书名<input name="novel-title" maxlength="200" value="${e(linked?.subtitle||linked?.title||'')}" data-auto-title="${e(linked?.subtitle||linked?.title||'')}" placeholder="可留空，使用文件中的书名"></label><label>TXT 编码<select name="novel-encoding" aria-label="TXT 文件编码"><option value="auto">自动识别</option><option value="utf-8">UTF-8</option><option value="shift_jis">Shift-JIS（日文旧文本）</option><option value="utf-16le">UTF-16 LE</option><option value="gb18030">GB18030（中文环境保存）</option></select></label></div><p id="novel-file-help" class="hint">单个文件最多 64 MB。EPUB 按原书目录顺序导入，长章会分为连续阅读小节；如果 TXT 正文出现乱码，可换编码后重新导入。</p><div class="row">${button('导入并打开','novel-import','','primary')}<span class="hint" data-novel-import-status role="status" aria-live="polite"></span></div><p class="alert-error" data-novel-import-error role="alert" hidden></p></form></section>`;
}
function library(env){
 const books=env.data.importedNovels||[];
 const selected=!!env.state.params.get('link'),form=`<details class="novel-import-disclosure" ${selected||!books.length?'open':''}><summary>＋ 导入自己的 TXT / EPUB</summary>${importForm(env)}</details>`;
 return heading('全文小说',books.length?'正文已保存在本机，点击开始阅读；注音、查词和阅读进度在这里连贯完成。':'导入自己的日文读物，在这里读、查词并保存进度。')+tabs()+
 (selected?form:'')+`<div class="novel-library-heading"><h2>本机书架 · ${books.length} 部</h2>${button('刷新书库','novel-reload','','small')}</div>`+
 (books.length?`<div class="cards story-shelf">${books.map(b=>{const first=latestChapter(b,env),done=completeCount(b,env);return `<article class="card story-book"><div class="story-spine"><span>✓ 本机全文</span><span>${e(b.genre||b.format?.toUpperCase()||'TXT / EPUB')}</span></div><h2 lang="ja">${e(b.title)}</h2>${b.author?`<small>${e(b.author)}${b.license?' · '+e(b.license):''}</small>`:''}${b.description?`<p>${e(b.description)}</p>`:''}<small>${b.chapters.length} 个阅读小节 · ${countChars(b).toLocaleString()} 字 · 已读 ${done} 节</small><div class="novel-book-progress" role="progressbar" aria-label="${e(b.title)}阅读进度" aria-valuemin="0" aria-valuemax="${b.chapters.length}" aria-valuenow="${done}"><span style="width:${b.chapters.length?done/b.chapters.length*100:0}%"></span></div><div class="row">${first?`<a class="button primary" href="${chapterHref(b.id,first.id)}">${env.store.data.novelPositions?.[b.id]||env.store.data.novelLast?.bookId===b.id||done?'继续阅读':'开始阅读'} →</a>`:''}<a class="button subtle" href="${bookHref(b.id)}">目录</a></div></article>`;}).join('')}</div>`:empty('还没有导入书籍。选择一个 TXT 或 EPUB，就能在软件内开始阅读。'))+(selected?'':form);
}
function tocResults(book,env,scope){
 const query=(scope.tocQuery||'').toLowerCase(),filtered=book.chapters.map((c,i)=>({c,i})).filter(({c})=>c.title.toLowerCase().includes(query));
 const pageSize=80,pages=Math.max(1,Math.ceil(filtered.length/pageSize));scope.tocPage=Math.max(1,Math.min(pages,scope.tocPage||1));
 const page=scope.tocPage;
 return `<div class="novel-toc-pager"><span class="hint">${filtered.length} 节 · 第 ${page} / ${pages} 页</span><div class="row">${button('← 上一页','novel-toc-page',`data-page="${page-1}" ${page===1?'disabled':''}`,'small')}${button('下一页 →','novel-toc-page',`data-page="${page+1}" ${page===pages?'disabled':''}`,'small')}</div></div><div class="story-toc novel-toc">${filtered.slice((page-1)*pageSize,page*pageSize).map(({c,i})=>`<article><span class="story-chapter-number">${String(i+1).padStart(2,'0')}</span><div><h2><a href="${chapterHref(book.id,c.id)}">${e(c.title)}</a></h2><small>${Number(c.characters||0).toLocaleString()} 字 · ${env.store.data.readings?.[recordKey(book.id,c.id)]?.done?'✓ 已读':'未读完'}</small></div><a class="button subtle" href="${chapterHref(book.id,c.id)}">阅读 →</a></article>`).join('')}</div>${filtered.length?'':empty('没有匹配的章节，换一个关键词试试。')}${filtered.length>pageSize?`<div class="novel-toc-pager"><span class="hint">第 ${page} / ${pages} 页</span><div class="row">${button('← 上一页','novel-toc-page',`data-page="${page-1}" ${page===1?'disabled':''}`,'small')}${button('下一页 →','novel-toc-page',`data-page="${page+1}" ${page===pages?'disabled':''}`,'small')}</div></div>`:''}`;
}
function contents(book,env,scope){
 const next=latestChapter(book,env);
 return `<nav class="crumb"><a href="#novels">全文小说</a><span>›</span><span>${e(book.title)}</span></nav>`+heading(book.title,`${book.chapters.length} 个阅读小节 · ${countChars(book).toLocaleString()} 字 · 已读 ${completeCount(book,env)} 节`,next?`<a class="button primary" href="${chapterHref(book.id,next.id)}">继续阅读 →</a>`:'')+
 `${book.author||book.genre?`<p class="hint">${e([book.author,book.genre,book.license].filter(Boolean).join(' · '))}</p>`:''}${book.description?`<p class="story-description">${e(book.description)}</p>`:''}<p class="hint">阅读位置会自动记住；每一小节的手动书签、笔记和已读状态分别保存。书籍正文在本机保留，重新启动后可继续阅读。</p><div class="novel-toc-search"><label>查找章节<input type="search" data-novel-chapter-search placeholder="输入章节名" autocomplete="off"></label></div><div id="novel-toc-results">${tocResults(book,env,scope)}</div>`;
}
function context(env,scope){
 env.state.viewData.contextId=recordKey(scope.book.id,scope.chapter.id);
 env.state.viewData.contextLabel=scope.book.title+' · '+scope.chapter.title;
 env.state.viewData.context={reading:{bookTitle:scope.book.title,chapterTitle:scope.chapter.title,paragraphs:scope.chapter.paragraphs,note:scope.record.note||'',source:'用户导入的本机读物'}};
 env.refreshTutor();
}
function reader(book,chapter,env,scope){
 const index=chapterIndex(book,chapter.id),r=scope.record,max=chapter.paragraphs.length-1,mark=Number.isInteger(r.bookmark)?Math.max(0,Math.min(max,r.bookmark)):null;
 return `<nav class="crumb"><a href="#novels">全文小说</a><span>›</span><a href="${bookHref(book.id)}">${e(book.title)}</a></nav><header class="novel-heading"><p class="eyebrow">本机阅读 · 第 ${index+1} / ${book.chapters.length} 节</p><h1 lang="ja">${e(chapter.title)}</h1></header><div class="story-reading-tools novel-reading-tools"><div class="row">${furiganaButton(env.store.data.settings.showFurigana!==false)}${button(mark===null?'尚无手动书签':'书签 · 第 '+(mark+1)+' 段','novel-bookmark-resume',mark===null?'disabled':'','small')}${button('停止朗读','stop-speech','','small')}</div><div class="row"><label class="story-font">字号<select data-novel-font aria-label="小说正文字号">${[14,16,17,18,20,22,24,26].map(n=>`<option value="${n}" ${n===env.store.data.settings.fontSize?'selected':''}>${n}px</option>`).join('')}</select></label>${button('问助教','ask','','small')}<a class="button small subtle" href="${bookHref(book.id)}">目录</a></div></div><div class="novel-reading-status"><span data-novel-position>自动记忆 · 第 ${Math.min(max,r.paragraph||0)+1} / ${chapter.paragraphs.length} 段</span><span data-novel-annotation-status role="status" aria-live="polite">正在本地准备注音与查词…</span>${button('重试注音','novel-annotate-retry','hidden','small')}</div><article class="story-reader lesson-body novel-reader"><p class="reader-help">点击点线下的词查看读音与释义并加入复习。专有名词或暂时无法可靠匹配的词会保留原文；注音开关与课程共用。</p>${chapter.paragraphs.map((p,i)=>`<section class="story-paragraph novel-paragraph ${mark===i?'is-reading-mark':''}" data-novel-paragraph="${i}" id="novel-paragraph-${i}"><div class="story-paragraph-tools"><span>段落 ${i+1}</span><div class="row">${button('▶ 朗读','speak',`data-text="${e(p.ja)}" aria-label="朗读第 ${i+1} 段"`,'small')}${button(mark===i?'✓ 书签':'记到这里','novel-mark',`data-paragraph="${i}" aria-label="将第 ${i+1} 段设为小说书签" aria-pressed="${mark===i}"`,'small')}</div></div><p class="passage-text" lang="ja" data-novel-text="${i}">${e(p.ja)}</p></section>`).join('')}<details class="note-editor"><summary>✎ 本节阅读笔记（自动保存）</summary><textarea data-novel-note maxlength="10000" placeholder="记下喜欢的句子、情节线索或不明白的表达…">${e(r.note||'')}</textarea></details><div class="content-footer">${button(r.done?'✓ 本节已读完':'标记本节已读完','novel-done',`aria-pressed="${r.done}"`,'primary')}<a class="button subtle" href="${bookHref(book.id)}">返回目录</a></div><nav class="section-neighbors" aria-label="小说翻节">${index>0?`<a href="${chapterHref(book.id,book.chapters[index-1].id)}">← 上一节：${e(book.chapters[index-1].title)}</a>`:'<span></span>'}${index+1<book.chapters.length?`<a href="${chapterHref(book.id,book.chapters[index+1].id)}">下一节：${e(book.chapters[index+1].title)} →</a>`:'<a href="#novels">读完了，返回书库 →</a>'}</nav></article>`;
}
function startTracking(env,scope){
 const paragraphs=[...env.main.querySelectorAll('.novel-paragraph')];
 function update(leaving=false){
  if((!leaving&&!isCurrent(env,scope))||document.visibilityState==='hidden')return;
  const anchor=env.main.querySelector('.novel-reading-tools')?.getBoundingClientRect().bottom||80;
  const workspace=document.querySelector('.workspace'),bottom=Math.min(window.innerHeight,workspace?.getBoundingClientRect().bottom||window.innerHeight);const target=paragraphs.find(p=>{const box=p.getBoundingClientRect();return box.bottom>anchor+35&&box.top<bottom;});
  if(target)rememberPosition(env,scope,Number(target.dataset.novelParagraph),leaving);
 }
 scope.flushPosition=()=>update(true);
 scope.onScroll=()=>{clearTimeout(scope.scrollTimer);scope.scrollTimer=setTimeout(()=>{scope.scrollTimer=null;update();},180);};
 window.addEventListener('scroll',scope.onScroll,{passive:true});document.querySelector('.workspace')?.addEventListener('scroll',scope.onScroll,{passive:true});
 if(typeof IntersectionObserver==='function'){
  scope.observer=new IntersectionObserver(()=>scope.onScroll(),{rootMargin:'-15% 0px -60% 0px'});
  for(const p of paragraphs)scope.observer.observe(p);
 }
}
async function annotate(env,scope){
 if(scope.annotating)return;scope.annotating=true;
 const status=env.main.querySelector('[data-novel-annotation-status]'),retry=env.main.querySelector('[data-action="novel-annotate-retry"]');if(retry)retry.hidden=true;
 if(status)status.textContent='正在本地准备注音与查词…';
 try{
  const result=await env.annotateNovel(scope.chapter.paragraphs,{signal:scope.controller.signal,onProgress:progress=>{
   if(!isCurrent(env,scope)||!status?.isConnected)return;
   const value=typeof progress==='number'?progress:progress?.completed??progress?.done;
   const total=progress?.total||scope.chapter.paragraphs.length;
   status.textContent=Number.isFinite(value)?`本地注音中 · ${Math.min(total,value)} / ${total} 段`:'正在本地准备注音与查词…';
  }});
  if(!isCurrent(env,scope))return;
  const fields=[...env.main.querySelectorAll('[data-novel-text]')],visible=fields.find(p=>p.getBoundingClientRect().bottom>110),top=visible?.getBoundingClientRect().top;
  let linked=0,rubies=0;
  for(let i=0;i<fields.length;i++)if(hasReaderParagraph(result[i],scope.chapter.paragraphs[i].ja)){
   fields[i].innerHTML=readerParagraphHTML(result[i]);linked+=result[i].segments.filter(s=>s.wordId).length;rubies+=result[i].segments.filter(s=>s.reading&&/[\p{Script=Han}々〆]/u.test(s.text)).length;
  }
  env.applyPreferences();if(visible&&top!==undefined)window.scrollBy({top:visible.getBoundingClientRect().top-top,behavior:'instant'});
  if(status)status.textContent=`注音已就绪 · ${rubies} 处注音 · ${linked} 处可查词`;
 }catch(error){
  if(!isCurrent(env,scope)||error.name==='AbortError')return;
  if(status)status.textContent='注音暂未就绪：'+error.message+'。正文仍可阅读。';if(retry)retry.hidden=false;
 }finally{scope.annotating=false;}
}
export async function renderNovels(env){
 cleanupNovels();const scope={generation,route:env.state.route,controller:new AbortController()};active=scope;
 const [,bookId,chapterId]=scope.route.split('/');
 env.main.innerHTML=heading('本机阅读','正在载入书库…')+`<p class="novel-loading" role="status">正在读取本机保存的内容…</p>`;
 try{
  const index=await env.json('/api/novels',{signal:scope.controller.signal});if(!isCurrent(env,scope))return;
  env.data.importedNovels=Array.isArray(index.books)?index.books:[];
  if(!bookId){env.main.innerHTML=library(env);env.applyPreferences();return;}
  const book=env.data.importedNovels.find(b=>b.id===bookId);if(!book)throw new Error('这本书尚未导入，或本机文件不可用。请返回书库重新导入。');
  if(!chapterId){scope.book=book;env.main.innerHTML=contents(book,env,scope);env.applyPreferences();return;}
  const response=await env.json(`/api/novels/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}`,{signal:scope.controller.signal});if(!isCurrent(env,scope))return;
  const chapter=response.chapter;if(!chapter||!Array.isArray(chapter.paragraphs)||!chapter.paragraphs.length)throw new Error('这一节没有可阅读的正文。');
  scope.book=book;scope.chapter=chapter;scope.record=readingRecord(env.store.data,recordKey(bookId,chapterId));
  scope.record.paragraph=Math.max(0,Math.min(chapter.paragraphs.length-1,scope.record.paragraph||0));
  rememberNovelChapter(env.store.data,bookId,chapterId);env.store.save();
  env.main.innerHTML=reader(book,chapter,env,scope);env.applyPreferences();context(env,scope);
  scope.frame=requestAnimationFrame(()=>{if(!isCurrent(env,scope))return;if(scope.record.paragraph>0)env.main.querySelector('#novel-paragraph-'+scope.record.paragraph)?.scrollIntoView({block:'start',behavior:'instant'});startTracking(env,scope);});
  await annotate(env,scope);
 }catch(error){
  if(!isCurrent(env,scope)||error.name==='AbortError')return;
  env.main.innerHTML=heading('暂时无法打开阅读内容')+`<div class="alert-error" role="alert"><p>${e(error.message)}</p><div class="row">${button('重试','novel-reload','','primary')}<a class="button subtle" href="#novels">返回书库</a></div></div>`;
 }
}
function base64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error('文件读取失败，请重新选择。'));r.onabort=()=>reject(new Error('文件读取已取消。'));r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.readAsDataURL(file);});}
async function importBook(env,scope){
 const form=env.main.querySelector('#novel-import-form');if(!form||scope.importing)return;
 const file=form.elements['novel-file'].files?.[0],status=form.querySelector('[data-novel-import-status]'),errorBox=form.querySelector('[data-novel-import-error]'),submit=form.querySelector('[data-action="novel-import"]');
 errorBox.hidden=true;errorBox.textContent='';
 try{
  if(!file)throw new Error('先选择一个 TXT 或 EPUB 文件。');
  if(!/\.(txt|epub)$/i.test(file.name))throw new Error('目前支持 TXT 和无 DRM 的 EPUB 文件。');
  if(!file.size)throw new Error('这个文件为空，请选择含正文的文件。');
  if(file.size>64*1024*1024)throw new Error('文件超过 64 MB。请按卷或章节分开导入。');
  scope.importing=true;submit.disabled=true;submit.textContent='正在导入…';status.textContent='正在读取文件…';
  const payload={filename:file.name,linkedId:form.elements['novel-linked'].value,title:form.elements['novel-title'].value.trim(),encoding:form.elements['novel-encoding'].value,contentBase64:await base64(file)};
  if(!isCurrent(env,scope))return;
  status.textContent='正在本机整理章节并保存…';
  const response=await env.json('/api/novels/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:scope.controller.signal});
  if(!isCurrent(env,scope))return;
  const book=response.book;if(!book?.id)throw new Error('导入完成，但服务未返回可打开的书籍，请刷新书库。');
  env.data.importedNovels=[book,...(env.data.importedNovels||[]).filter(b=>b.id!==book.id)];
  env.toast(`已导入「${book.title}」，共 ${book.chapters.length} 个阅读小节`);env.navigate('novel/'+book.id);
 }catch(error){if(isCurrent(env,scope)&&error.name!=='AbortError'){errorBox.textContent=error.message;errorBox.hidden=false;status.textContent='';}}
 finally{scope.importing=false;if(submit.isConnected){submit.disabled=false;submit.textContent='导入并打开';}}
}
export async function novelEvents(env,event,target){
 if(!/^(novels|novel)(\/|$)/.test(env.state.route)||!active)return false;
 const scope=active;if(!isCurrent(env,scope))return false;
 if(event.type==='submit'&&target.id==='novel-import-form'){event.preventDefault();await importBook(env,scope);return true;}
 if(['input','change'].includes(event.type)){
  if(target.hasAttribute('data-novel-note')&&scope.record){scope.record.note=target.value;env.store.save();context(env,scope);return true;}
  if(target.hasAttribute('data-novel-font')){env.store.data.settings.fontSize=Math.max(14,Math.min(26,Number(target.value)||17));env.store.save();env.applyPreferences();return true;}
  if(target.hasAttribute('data-novel-chapter-search')){scope.tocQuery=target.value.trim();scope.tocPage=1;env.main.querySelector('#novel-toc-results').innerHTML=tocResults(scope.book,env,scope);return true;}
  if(target.name==='novel-linked'){
   const title=env.main.querySelector('[name="novel-title"]'),book=env.data.externalNovels.find(b=>b.id===target.value),value=book?.subtitle||book?.title||'';
   if(!title.value||title.value===title.dataset.autoTitle){title.value=value;title.dataset.autoTitle=value;}return true;
  }
  if(target.name==='novel-file'||target.name==='novel-title'||target.name==='novel-encoding')return true;
  return false;
 }
 const action=target.dataset.action;
 if(action==='novel-import'){await importBook(env,scope);return true;}
 if(action==='novel-reload'){env.render();return true;}
 if(action==='novel-toc-page'&&scope.book){scope.tocPage=Number(target.dataset.page)||1;env.main.querySelector('#novel-toc-results').innerHTML=tocResults(scope.book,env,scope);env.main.querySelector('.novel-toc-search')?.scrollIntoView({block:'start',behavior:'smooth'});return true;}
 if(action==='novel-annotate-retry'){await annotate(env,scope);return true;}
 if(!scope.chapter)return false;
 if(action==='novel-mark'){
  const index=Math.max(0,Math.min(scope.chapter.paragraphs.length-1,Number(target.dataset.paragraph)||0));scope.record.bookmark=index;rememberPosition(env,scope,index);env.store.save();
  for(const p of env.main.querySelectorAll('.novel-paragraph'))p.classList.toggle('is-reading-mark',Number(p.dataset.novelParagraph)===index);
  for(const b of env.main.querySelectorAll('[data-action="novel-mark"]')){const selected=Number(b.dataset.paragraph)===index;b.textContent=selected?'✓ 书签':'记到这里';b.setAttribute('aria-pressed',String(selected));}
  const resume=env.main.querySelector('[data-action="novel-bookmark-resume"]');resume.disabled=false;resume.textContent='书签 · 第 '+(index+1)+' 段';env.toast('已将第 '+(index+1)+' 段设为书签');return true;
 }
 if(action==='novel-bookmark-resume'){if(Number.isInteger(scope.record.bookmark))env.main.querySelector('#novel-paragraph-'+Math.min(scope.chapter.paragraphs.length-1,scope.record.bookmark))?.scrollIntoView({block:'start',behavior:'smooth'});return true;}
 if(action==='novel-done'){scope.record.done=!scope.record.done;scope.record.completedAt=scope.record.done?Date.now():null;env.store.activity();env.store.save();target.textContent=scope.record.done?'✓ 本节已读完':'标记本节已读完';target.setAttribute('aria-pressed',String(scope.record.done));env.toast(scope.record.done?'已记录本节读完':'已设为继续阅读');return true;}
 return false;
}
