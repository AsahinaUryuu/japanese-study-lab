import {annotatedText} from '../reader-text.js';
import {wordKey} from '../curriculum-core.js';
import {e,button,reference} from '../ui.js';
import {hasReaderParagraph,readerParagraphHTML} from '../reader-core.js';
export function markedText(text,focus){
 const quotes=[...new Set((focus||[]).map(f=>f.quote).filter(Boolean))].sort((a,b)=>b.length-a.length);let out='',position=0;
 while(position<text.length){const quote=quotes.find(q=>text.startsWith(q,position));if(quote){out+='<mark>'+e(quote)+'</mark>';position+=quote.length;}else{out+=e(text[position]);position++;}}
 return out;
}
export function textbookHTML(lesson,{annotation,showFurigana=true,env}={}){
 const book=lesson.textbook;if(!book)return '';
 const ready=book.paragraphs.every((p,i)=>hasReaderParagraph(annotation?.paragraphs?.[i],p.ja));
 return `<section class="textbook-passage" aria-labelledby="textbook-title">
 <div class="row between passage-toolbar"><span class="eyebrow">本文 · 本小节课文</span><div class="row">${button(showFurigana?'隐藏假名':'显示假名','toggle-furigana',`aria-pressed="${showFurigana}" ${ready?'':'disabled title="本课注音暂未载入，请刷新重试"'}`,'small')}${button('▶ 朗读课文','speak',`data-text="${e(book.paragraphs.map(p=>p.ja).join('\n'))}"`,'small')}</div></div>
 <h2 id="textbook-title">${annotatedText(book.title,env)}</h2><p class="passage-scene">${e(book.scene)}</p>
 ${ready?'<p class="reader-help">点击点线下的词，可查读音、中文意思并加入复习。假名开关会自动记住。</p>':''}
 <div class="passage-text ${showFurigana?'':'furigana-hidden'}" lang="ja">${book.paragraphs.map((p,i)=>`<p>${ready?readerParagraphHTML(annotation.paragraphs[i],book.focus):markedText(p.ja,book.focus)}</p>`).join('')}</div>
 ${reference(book.paragraphs.map(p=>p.zh).join('\n\n'),'展开课文中文参考')}
 <div class="passage-guide"><b>在课文里观察</b>${book.focus.map(f=>`<div><span lang="ja">${annotatedText(f.quote,env)}</span><p>${annotatedText(f.explanation,env)}</p></div>`).join('')}</div>
 ${book.readingQuestions?.length?`<details class="passage-check"><summary>读完想一想 · ${book.readingQuestions.length} 个理解检查</summary>${book.readingQuestions.map((q,i)=>`<p><b>${i+1}. ${e(q.question)}</b></p>${reference(q.answer,'展开对照解释')}`).join('')}</details>`:''}
 <p class="hint">标出的表达会在下方讲解；相关词汇也集中在本小节「课内词汇」。先读懂情境，再整理规则。</p></section>`;
}
export function lessonWords(lesson,record,env){const words=lesson.textbook?.vocabulary||[];return `<h2>从课文里学习词汇</h2><p class="hint">本表只收录当前小节课文中的词语。先辨读音与语境义，再回到课文看它如何使用。</p><div class="row">${button('遮住释义，自测回想','toggle-word-meanings')}${button('将本小节词汇加入复习','add-section-words','','primary')}${button('回到课文','stage','data-stage="learn"')}</div><div class="section-words" id="section-words">${words.map((w,i)=>{const entry=env.data.words.find(x=>wordKey(x)===wordKey(w)),added=entry&&env.store.data.words[entry.id];return `<article class="section-word"><div><span class="word-number">${String(i+1).padStart(2,'0')}</span><strong lang="ja">${e(w.word)}</strong><span class="reading" lang="ja">${e(w.reading)}</span></div><div class="word-explanation"><p>${e(w.meaning)}</p>${w.surface&&w.surface!==w.word?`<small>课文中的形式：<span lang="ja">${e(w.surface)}</span></small>`:''}${w.note?`<p class="hint">${e(w.note)}</p>`:''}</div><div class="row">${button('▶','speak',`data-text="${e(w.reading)}" aria-label="朗读 ${e(w.word)}"`,'small')}${entry?button(added?'已加入':'＋复习','add-word',`data-id="${e(entry.id)}" ${added?'disabled':''}`,'small'):''}</div></article>`;}).join('')}</div><div class="notice">能用自己的话解释词义后，再回到课文连起来读。加入的词语会出现在辅助工具的「词汇复习」中，沿用已有复习计划。</div>`;}
