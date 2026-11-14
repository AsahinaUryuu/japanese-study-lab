import {escapeHTML as e} from './learning-core.js';

export function hasReaderParagraph(paragraph,text){
 return paragraph?.text===text&&Array.isArray(paragraph.segments)&&paragraph.segments.every(s=>s&&typeof s.text==='string')&&paragraph.segments.map(s=>s.text).join('')===text;
}
export function mergeReaderWords(words,extra=[]){
 const result=[...words],ids=new Set(words.map(w=>w.id));
 for(const w of Array.isArray(extra)?extra:[])if(w&&typeof w.id==='string'&&w.id&&typeof w.word==='string'&&typeof w.reading==='string'&&typeof w.meaning==='string'&&!ids.has(w.id)){result.push(w);ids.add(w.id);}
 return result;
}
export function addReaderReview(records,id,now=Date.now()){
 if(!id||Object.hasOwn(records,id))return false;
 records[id]={due:now,interval:0,reviews:0};return true;
}
export function focusRanges(text,focus=[]){
 const ranges=[];
 for(const quote of new Set(focus.map(f=>f.quote).filter(Boolean))){let start=0;while((start=text.indexOf(quote,start))!==-1){ranges.push([start,start+quote.length]);start+=quote.length;}}
 ranges.sort((a,b)=>a[0]-b[0]);const merged=[];
 for(const range of ranges){const last=merged.at(-1);if(last&&last[1]>=range[0])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}
 return merged;
}
function markedPart(text,start,ranges){
 let result='',position=start,end=start+text.length;
 for(const [a,b] of ranges){if(b<=position||a>=end)continue;const from=Math.max(position,a),to=Math.min(end,b);result+=e(text.slice(position-start,from-start))+'<mark>'+e(text.slice(from-start,to-start))+'</mark>';position=to;}
 return result+e(text.slice(position-start));
}
export function readerParagraphHTML(paragraph,focus=[]){
 const ranges=focusRanges(paragraph.text,focus);let position=0;
 return paragraph.segments.map(segment=>{
  const text=segment.text,reading=typeof segment.reading==='string'?segment.reading:'',base=markedPart(text,position,ranges);position+=text.length;
  const content=reading&&/[\p{Script=Han}々〆]/u.test(text)?`<ruby>${base}<rp>（</rp><rt aria-hidden="true">${e(reading)}</rt><rp>）</rp></ruby>`:base;
  return segment.wordId?`<button type="button" class="passage-word" data-action="reader-word" data-word-id="${e(segment.wordId)}" data-surface="${e(text)}" data-reading="${e(reading)}" aria-label="${e(text)}${reading?'（'+e(reading)+'）':''}，查看词义" aria-haspopup="dialog" aria-expanded="false">${content}</button>`:content;
 }).join('');
}

export function readerCardHTML(entry,{surface='',reading='',meaning='',note='',meaningLabel='本课含义',added=false}={}){
 const contextMeaning=meaning&&meaning!==entry.meaning?meaning:'';
 return `<div class="reader-card-heading"><h2 id="reader-word-title" lang="ja">${e(entry.word)}</h2><button type="button" class="reader-close" data-reader="close" aria-label="关闭词卡">×</button></div><div class="reader-pronunciation" lang="ja">${e(entry.reading)}</div>${surface&&surface!==entry.word?`<p class="reader-inflection">文中形式：<span lang="ja">${e(surface)}${reading?'（'+e(reading)+'）':''}</span><br>上方显示词典原形</p>`:''}${entry.pos?`<small class="reader-pos">${e(entry.pos)}</small>`:''}<p class="reader-definition">${contextMeaning?'<span class="reader-definition-label">'+e(meaningLabel)+'</span>':''}${e(contextMeaning||entry.meaning)}</p>${!contextMeaning&&Array.isArray(entry.entryIds)&&entry.entryIds.length>1?'<small class="reader-note">词典可能包含同音／多义解释，请结合本句和中文对照选择。</small>':''}${note?`<p class="reader-note">${e(note)}</p>`:''}${contextMeaning?`<details><summary>词典释义</summary><p>${e(entry.meaning)}</p></details>`:''}<div class="reader-card-actions"><button type="button" class="button small" data-reader="speak">▶ 朗读</button><button type="button" class="button primary small" data-reader="add" ${added?'disabled':''}>${added?'✓ 已加入复习':'＋ 加入复习'}</button></div><p class="reader-status" role="status">${added?'已在复习计划中，原有复习进度保留。':'加入后可在「词汇复习」中练习。'}</p>`;
}
