import {e,heading,button,empty,questionHTML} from '../ui.js';
import {hasReaderParagraph,readerParagraphHTML} from '../reader-core.js';
import {annotatedText,furiganaButton} from '../reader-text.js';
import {chapterChars,findStory,readingRecord,readingQuestions,gradeReading,readingContext,validatedReadingResult} from '../stories-core.js';
import {wordKey} from '../curriculum-core.js';
import {novelResumeChapter} from '../novel-progress.js';

function sourceDetails(book){return book.kind==='classic'?`<details class="story-source"><summary>关于这部原著与版本</summary><p>${e(book.sourceNote)}</p><p>${e(book.attribution)}</p><p><a href="${e(book.sourceUrl)}" target="_blank" rel="noopener noreferrer">青空文库图书卡</a> · <a href="${e(book.sourceTextUrl)}" target="_blank" rel="noopener noreferrer">原版全文</a> · <a href="${e(book.noticeUrl||'/data/licenses/aozora-ginga-NOTICE.md')}" target="_blank" rel="noopener noreferrer">来源与转换说明</a></p></details>`:'';}
const chapterHref=id=>'#story/'+encodeURIComponent(id);
const bookHref=id=>'#stories/'+encodeURIComponent(id);
function progress(book,env){return book.chapters.filter(c=>env.store.data.readings?.[c.id]?.done).length;}
function continueChapter(book,env){
 const last=env.store.data.lastReading;
 const current=book.chapters.find(c=>c.id===last);
 return current&&!env.store.data.readings?.[current.id]?.done?current:book.chapters.find(c=>!env.store.data.readings?.[c.id]?.done)||current||book.chapters[0];
}
function shelfTabs(kind='all'){
 return `<nav class="reading-shelf-tabs" aria-label="书架分类"><a class="button subtle" href="#novels">全文小说</a>${[['all','课外故事'],['classic','完整名作'],['original','原创分级'],['online','自备轻小说']].map(([key,label])=>`<a class="button ${kind===key?'primary':'subtle'}" href="#stories${key==='all'?'':'?kind='+key}" ${kind===key?'aria-current="page"':''}>${label}</a>`).join('')}</nav>`;
}
function onlineShelf(env){
 const novels=env.data.externalNovels||[],imported=env.data.importedNovels||[];
 const card=b=>{
  const local=imported.filter(x=>x.linkedId===b.id).sort((x,y)=>(Number(y.importedAt)||0)-(Number(x.importedAt)||0))[0];
  const resume=local?novelResumeChapter(local,env.store.data):null,href=local?'#novel/'+encodeURIComponent(local.id)+(resume?'/'+encodeURIComponent(resume.id):''):'#novels?link='+encodeURIComponent(b.id);
  return `<article class="card story-book"><div class="story-spine"><span>${e(b.level)}</span><span>${e(b.genre)}</span></div><h2 lang="ja">${e(b.title)}</h2><h3>${e(b.subtitle)}</h3><small>${local?'✓ 已导入 · '+local.chapters.length+' 个阅读小节':'需要自备电子书 · '+e(b.edition)}</small><p>${e(b.description)}</p><div class="row"><a class="button primary" href="${href}">${local?'在软件内继续阅读 →':'导入这部作品'}</a>${local?'':`<a class="button subtle" href="${e(b.url)}" target="_blank" rel="noopener noreferrer">官方介绍 ↗</a>`}</div></article>`;
 };
 const available=novels.filter(b=>imported.some(x=>x.linkedId===b.id)),pending=novels.filter(b=>!imported.some(x=>x.linkedId===b.id));
 return heading('自备轻小说','已有电子书也可以在这里读，与你的学习进度共用一套词卡。')+shelfTabs('online')+
 `<div class="reading-intro"><p>想直接开始阅读？已下载的完整小说就在全文书架，不需要自己再找文件。</p><div class="row"><a class="button primary" href="#novels">打开全文小说书架${imported.length?' · '+imported.length+' 部':''} →</a></div></div>`+
 (available.length?`<div class="cards story-shelf">${available.map(card).join('')}</div>`:'')+
 (pending.length?`<details class="novel-import-disclosure"><summary>可关联的轻小说 · ${pending.length} 部（需自备正文）</summary><p class="hint">下列条目仅供关联自备文件。导入后共用注音、查词、复习和进度保存。</p><div class="cards story-shelf">${pending.map(card).join('')}</div></details>`:'');
}
function shelf(env){
 const kind=env.state.params.get('kind')||'all';if(kind==='online')return onlineShelf(env);
 const query=env.state.params.get('q')||'',level=env.state.params.get('level')||'all',genre=env.state.params.get('genre')||'all',books=env.data.stories;
 const filtered=books.filter(b=>(kind==='all'||(kind==='classic'?b.kind==='classic':b.kind!=='classic'))&&(level==='all'||b.level===level)&&(genre==='all'||b.genre===genre)&&(!query||[b.title,b.subtitle,b.description,b.genre].join(' ').toLowerCase().includes(query.toLowerCase())));
 const last=findStory(books,env.store.data.lastReading);
 return heading('课外阅读','把日语读成故事：从日常小事到连载小说，跟着人物读下去。')+shelfTabs(kind)+
 `<div class="reading-intro"><p>每部故事分章连续展开。点击正文查词，按需打开中文对照，读完再做理解题；与课程共用假名开关和复习计划。</p><small>原创故事配中文对照，另有完整公版文学原著可供精读。难度为教学建议，非官方 JLPT 分级。</small><div class="row"><a class="button primary" href="#novels">打开全文小说书架${env.data.importedNovels?.length?' · '+env.data.importedNovels.length+' 部':''} →</a></div></div>`+
 (last?`<div class="reading-continue"><span>上次读到 · ${e(last.book.subtitle)} / ${e(last.chapter.title)}</span><a class="button primary" href="${chapterHref(last.chapter.id)}">继续阅读 →</a></div>`:'')+
 `<form id="filter-form" class="toolbar"><input type="hidden" name="kind" value="${e(kind)}"><input name="q" type="search" value="${e(query)}" aria-label="搜索课外故事" placeholder="搜索故事、题材或简介"><select name="level" aria-label="故事难度">${['all','N5','N4','N3','N2','N1'].map(x=>`<option value="${x}" ${x===level?'selected':''}>${x==='all'?'全部难度':x}</option>`).join('')}</select><select name="genre" aria-label="故事题材">${['all',...new Set(books.map(b=>b.genre))].map(x=>`<option value="${e(x)}" ${x===genre?'selected':''}>${x==='all'?'全部题材':e(x)}</option>`).join('')}</select><button class="button">筛选</button>${query||level!=='all'||genre!=='all'?'<a class="button subtle" href="#stories">清除筛选</a>':''}</form><p class="hint">${filtered.length} 部作品 · ${filtered.reduce((n,b)=>n+b.chapters.length,0)} 个阅读小节</p><div class="cards story-shelf">${filtered.map(b=>`<article class="card story-book"><div class="story-spine"><span>${e(b.level)}</span><span>${e(b.genre)}</span></div><h2>${e(b.title)}</h2><h3>${e(b.subtitle)}</h3><small>${e(b.author)}${b.kind==='classic'?' · 完整原著':' · 中文对照'}</small><p>${e(b.description)}</p><small>${b.chapters.length} 节 · ${b.chapters.reduce((n,c)=>n+chapterChars(c),0).toLocaleString()} 字 · 已读 ${progress(b,env)} 节</small><div class="row"><a class="button primary" href="${chapterHref(continueChapter(b,env).id)}">${progress(b,env)||b.chapters.some(c=>env.store.data.readings?.[c.id])?'继续阅读':'开始阅读'} →</a><a class="button subtle" href="${bookHref(b.id)}">章节目录</a></div></article>`).join('')}</div>${filtered.length?'':empty('没有匹配的故事，试试其他难度或题材。')}`;
}
function contents(book,env){
 return `<nav class="crumb"><a href="#stories">课外阅读</a><span>›</span><span>${e(book.subtitle)}</span></nav>`+heading(book.title,book.subtitle,`<span class="pill">${e(book.level)}</span><span class="pill">${e(book.genre)}</span>`)+
 `<p class="story-description">${e(book.description)}</p><p class="hint">${e(book.author)} · ${e(book.license)} · 已读 ${progress(book,env)} / ${book.chapters.length} 节</p>${sourceDetails(book)}<div class="story-toc">${book.chapters.map((c,i)=>`<article><span class="story-chapter-number">${String(i+1).padStart(2,'0')}</span><div><h2><a href="${chapterHref(c.id)}">${e(c.title)}</a></h2><p>${e(c.summary)}</p><small>${chapterChars(c)} 字 · ${env.store.data.readings?.[c.id]?.done?'✓ 已读':'未读完'}</small></div><a class="button subtle" href="${chapterHref(c.id)}">阅读 →</a></article>`).join('')}</div>`;
}
function feedback(chapter,record){
 if(!record.result)return '';
 const result=validatedReadingResult(chapter,record);
 if(!result)return '<p class="hint">旧的理解检查结果与本章题目不匹配，请重新检查。你的答案、笔记和书签仍保留。</p>';
 const changed=JSON.stringify(record.submittedAnswers)!==JSON.stringify(record.answers);
 return `<div class="story-result" role="status"><h3>理解检查 · ${result.correct} / ${result.total} 题正确</h3>${changed?'<p class="hint">答案已修改，下面保留的是上次提交结果；可重新检查。</p>':''}${result.items.map((item,i)=>`<div class="feedback-item ${item.correct?'':'wrong'}"><b>${item.correct?'✓':'○'} 第 ${i+1} 题</b><p>${e(chapter.questions.find(q=>q.id===item.id).explanation)}</p></div>`).join('')}</div>`;
}
function readChapter(book,chapter,index,env){
 const record=readingRecord(env.store.data,chapter.id),annotation=env.data.supplement?.stories?.[chapter.id],show=env.store.data.settings.showFurigana!==false;
 env.store.data.lastReading=chapter.id;env.store.save();
 env.state.viewData.contextId=chapter.id;env.state.viewData.contextLabel=book.subtitle+' · '+chapter.title;
 env.state.viewData.context={reading:readingContext(book,chapter,record)};
 const mark=Math.max(0,Math.min(chapter.paragraphs.length-1,record.paragraph||0));
 return `<nav class="crumb"><a href="#stories">课外阅读</a><span>›</span><a href="${bookHref(book.id)}">${e(book.subtitle)}</a><span>›</span><span>第 ${index+1} ${book.kind==='classic'?'节':'章'}</span></nav>`+
 `<header class="story-heading"><p class="eyebrow">${e(book.level)} · ${e(book.genre)} · 第 ${index+1} / ${book.chapters.length} ${book.kind==='classic'?'阅读节':'章'}</p><h1>${annotatedText(chapter.title,env)}</h1><p>${e(chapter.summary)}</p>${book.kind==='classic'?`<p class="hint">${e(book.translationNote)} · 原著第 ${chapter.sourceChapter} 章</p>`:''}</header>`+
 `<div class="story-reading-tools"><div class="row">${furiganaButton(show)}${button('跳到书签 · 第 '+(mark+1)+' 段','story-resume','','small')}${button('停止朗读','stop-speech','','small')}</div><div class="row"><label class="story-font">字号<select data-story-font aria-label="故事正文字号">${[14,16,17,18,20,22,24,26].map(n=>`<option value="${n}" ${n===env.store.data.settings.fontSize?'selected':''}>${n}px</option>`).join('')}</select></label>${button('问助教','ask','','small')}</div></div>`+
 `<article class="story-reader lesson-body"><p class="reader-help">点击点线下的词查看释义；${book.kind==='classic'?'每段可朗读和设为书签；保留文学原文，用词语释义辅助理解。':'每段可朗读、展开中文或设为书签。'}假名设置与教学讲解共用。</p>${chapter.paragraphs.map((p,i)=>`<section class="story-paragraph ${mark===i?'is-reading-mark':''}" id="story-paragraph-${i}"><div class="story-paragraph-tools"><span>段落 ${i+1}</span><div class="row">${button('▶ 朗读','speak',`data-text="${e(p.ja)}" aria-label="朗读第 ${i+1} 段"`,'small')}${button(mark===i?'✓ 书签':'记到这里','story-mark',`data-paragraph="${i}" aria-label="将第 ${i+1} 段设为阅读书签" aria-pressed="${mark===i}"`,'small')}</div></div><p lang="ja" class="passage-text">${hasReaderParagraph(annotation?.paragraphs?.[i],p.ja)?readerParagraphHTML(annotation.paragraphs[i]):e(p.ja)}</p>${p.zh?`<details class="story-translation"><summary>展开第 ${i+1} 段中文对照</summary><p>${e(p.zh)}</p></details>`:''}</section>`).join('')}${chapter.vocabulary.length?`<details class="story-vocabulary"><summary>本章重点词汇 · ${chapter.vocabulary.length} 个</summary><div class="story-word-list">${chapter.vocabulary.map(w=>{const entry=env.data.wordByKey.get(wordKey(w));return `<div><span lang="ja">${e(w.word)} <small>（${e(w.reading)}）</small></span><span>${e(w.meaning)}</span>${entry?button(env.store.data.words[entry.id]?'已加入':'＋复习','add-word',`data-id="${e(entry.id)}" ${env.store.data.words[entry.id]?'disabled':''}`,'small'):''}</div>`;}).join('')}</div></details>`:''}${chapter.questions.length?`<section class="story-comprehension"><h2>读完想一想</h2><p class="hint">先独立回答，再一次检查本章全部题目；不会调用模型。</p>${readingQuestions(chapter).map((q,i)=>questionHTML(q,i,record.answers)).join('')}${button('检查本章理解','story-check','','primary')}<div id="story-feedback">${feedback(chapter,record)}</div></section>`:''}${sourceDetails(book)}<details class="note-editor"><summary>✎ 本章阅读笔记（自动保存）</summary><textarea data-story-note maxlength="10000" placeholder="写下喜欢的句子、情节线索或还没弄懂的表达…">${e(record.note)}</textarea></details><div class="content-footer">${button(record.done?'✓ 已读完本章':'标记本章已读完','story-done',`aria-pressed="${record.done}"`,'primary')}<a class="button subtle" href="${bookHref(book.id)}">返回章节目录</a></div><nav class="section-neighbors" aria-label="故事翻章">${index>0?`<a href="${chapterHref(book.chapters[index-1].id)}">← 上一章：${e(book.chapters[index-1].title)}</a>`:'<span></span>'}${index+1<book.chapters.length?`<a href="${chapterHref(book.chapters[index+1].id)}">下一章：${e(book.chapters[index+1].title)} →</a>`:'<a href="#stories">全篇读完，挑选下一部故事 →</a>'}</nav></article>`;
}
export function renderStories(env){
 const [route,id]=env.state.route.split('/');
 if(route==='stories'&&!id){env.main.innerHTML=shelf(env);return;}
 if(route==='stories'){const book=env.data.stories.find(b=>b.id===id);env.main.innerHTML=book?contents(book,env):empty('这部故事暂未载入，请返回课外阅读书架。');return;}
 const result=findStory(env.data.stories,id);
 env.main.innerHTML=result?readChapter(result.book,result.chapter,result.index,env):empty('没有找到这一章，请返回课外阅读书架。');
}
export function storyEvents(env,event,target){
 if(!env.state.route.startsWith('story/'))return false;
 const current=findStory(env.data.stories,env.state.route.split('/')[1]);if(!current)return false;
 const {book,chapter}=current,record=readingRecord(env.store.data,chapter.id);
 if(['input','change'].includes(event.type)){
  if(target.dataset.question){record.answers[target.dataset.question]=Number(target.value);env.store.save();if(record.result)env.main.querySelector('#story-feedback').innerHTML=feedback(chapter,record);return true;}
  if(target.hasAttribute('data-story-note')){record.note=target.value;env.store.save();env.state.viewData.context={reading:readingContext(book,chapter,record)};return true;}
  if(target.hasAttribute('data-story-font')){env.store.data.settings.fontSize=Math.max(14,Math.min(26,Number(target.value)||17));document.documentElement.style.setProperty('--lesson-font',env.store.data.settings.fontSize+'px');env.store.save();return true;}
  return false;
 }
 const action=target.dataset.action;
 if(action==='story-mark'){
  record.paragraph=Number(target.dataset.paragraph);env.store.save();
  for(const section of env.main.querySelectorAll('.story-paragraph'))section.classList.toggle('is-reading-mark',section.id==='story-paragraph-'+record.paragraph);
  for(const b of env.main.querySelectorAll('[data-action="story-mark"]')){const selected=Number(b.dataset.paragraph)===record.paragraph;b.textContent=selected?'✓ 书签':'记到这里';b.setAttribute('aria-pressed',String(selected));}
  env.main.querySelector('[data-action="story-resume"]').textContent='跳到书签 · 第 '+(record.paragraph+1)+' 段';env.toast('已记住第 '+(record.paragraph+1)+' 段，下次可从这里继续');return true;
 }
 if(action==='story-resume'){env.main.querySelector('#story-paragraph-'+Math.min(chapter.paragraphs.length-1,record.paragraph||0))?.scrollIntoView({block:'start',behavior:'smooth'});return true;}
 if(action==='story-check'){
  if(!gradeReading(chapter,record)){env.toast('请先回答本章全部理解题，再统一检查');return true;}
  env.store.activity();env.store.save();env.main.querySelector('#story-feedback').innerHTML=feedback(chapter,record);env.state.viewData.context={reading:readingContext(book,chapter,record)};env.refreshTutor();return true;
 }
 if(action==='story-done'){record.done=!record.done;record.completedAt=record.done?Date.now():null;env.store.activity();env.store.save();target.textContent=record.done?'✓ 已读完本章':'标记本章已读完';target.setAttribute('aria-pressed',String(record.done));env.toast(record.done?'本章阅读进度已保存':'本章已设为继续阅读');return true;}
 return false;
}
