// Runtime-only annotation for user-imported Japanese text. No content is sent
// to a model or remote dictionary. The supplied word IDs belong to the existing
// review vocabulary, so imported books never invent a second review record.
export const novelHiragana=value=>String(value||'').normalize('NFKC').replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
const kana=value=>!!value&&/^[ぁ-ゖー]+$/u.test(value);
const key=(word,reading)=>String(word).normalize('NFKC')+'|'+novelHiragana(reading);
const lexical=new Set(['名詞','動詞','形容詞','副詞','連体詞','感動詞','接頭詞']);

export function createAnnotationEngine(tokenizer,words=[]){
 if(!tokenizer||typeof tokenizer.tokenize!=='function')throw new TypeError('日语分词器尚未就绪');
 const entries=new Map(),lemmaReadings=new Map();
 for(const word of words){
  if(!word||typeof word.id!=='string'||typeof word.word!=='string'||!kana(novelHiragana(word.reading)))continue;
  const k=key(word.word,word.reading);if(!entries.has(k))entries.set(k,word.id);
 }
 function tokenize(text){
  let cursor=0;const result=[];
  for(const raw of tokenizer.tokenize(text)){
   const surface=raw.surface_form;if(typeof surface!=='string'||!surface)throw new Error('分词器返回了无法识别的词语');
   const start=text.indexOf(surface,cursor);if(start<0)throw new Error('分词结果与原文不一致');
   if(start>cursor)result.push({text:text.slice(cursor,start),start:cursor,end:start,pos:'gap'});
   const candidate=novelHiragana(raw.reading),fallback=novelHiragana(surface);
   const reading=kana(candidate)?candidate:kana(fallback)?fallback:undefined;
   result.push({text:surface,start,end:start+surface.length,reading,pos:raw.pos,detail:raw.pos_detail_1,
    person:raw.pos_detail_2==='人名',lemma:raw.basic_form&&raw.basic_form!=='*'?raw.basic_form:surface,known:raw.word_type==='KNOWN'});
   cursor=start+surface.length;
  }
  if(cursor<text.length)result.push({text:text.slice(cursor),start:cursor,end:text.length,pos:'gap'});
  return result;
 }
 function lemmaReading(lemma){
  if(lemmaReadings.has(lemma))return lemmaReadings.get(lemma);
  const tokens=tokenize(lemma),value=tokens.length&&tokens.every(t=>t.reading)?tokens.map(t=>t.reading).join(''):undefined;
  // Bound the cache during long reading sessions.
  if(lemmaReadings.size>12000)lemmaReadings.clear();lemmaReadings.set(lemma,value);return value;
 }
 function dictionaryId(piece){
  if(piece.fragment||!piece.reading)return undefined;
  if(piece.ruby)return entries.get(key(piece.text,piece.reading));
  if(!lexical.has(piece.pos)||piece.person||piece.detail==='非自立'||piece.detail==='数')return undefined;
  const exact=entries.get(key(piece.text,piece.reading));if(exact)return exact;
  if(piece.known&&piece.lemma&&piece.lemma!==piece.text){
   // Retokenizing 空く alone may choose すく even when the actual phrase was
   // 空いた=あいた. Preserve the analyzer's contextual stem before matching.
   let reading;
   if(piece.lemma.endsWith('来る'))reading=lemmaReading(piece.lemma);
   else{
    let shared=0;while(shared<piece.text.length&&shared<piece.lemma.length&&piece.text[shared]===piece.lemma[shared])shared++;
    const surfaceTail=piece.text.slice(shared),lemmaTail=piece.lemma.slice(shared);
    if(/^[ぁ-ゖ]*$/u.test(surfaceTail)&&/^[ぁ-ゖ]*$/u.test(lemmaTail)&&piece.reading.endsWith(surfaceTail))
     reading=piece.reading.slice(0,piece.reading.length-surfaceTail.length)+lemmaTail;
   }
   if(kana(reading))return entries.get(key(piece.lemma,reading));
  }
 }
 function mergeCompounds(pieces){
  const merged=[];
  for(let i=0;i<pieces.length;i++){
   const first=pieces[i];let found=null;
   if(!first.ruby&&!first.fragment&&!first.person&&['名詞','接頭詞'].includes(first.pos)){
    let text='',reading='';
    for(let j=i;j<Math.min(i+5,pieces.length);j++){
     const next=pieces[j];if(next.ruby||next.fragment||next.person||!['名詞','接頭詞'].includes(next.pos)||!next.reading||j>i&&pieces[j-1].end!==next.start)break;
     text+=next.text;reading+=next.reading;if(text.length>24)break;
     const wordId=entries.get(key(text,reading));if(j>i&&wordId)found={...first,text,reading,lemma:text,end:next.end,wordId,last:j};
    }
   }
   if(found){merged.push(found);i=found.last;}else merged.push(first);
  }
  return merged;
 }
 function annotate(paragraph){
  const text=typeof paragraph==='string'?paragraph:paragraph?.ja;
  if(typeof text!=='string')throw new TypeError('阅读段落必须为日语文本');
  if(text.length>100000)throw new RangeError('单段过长，请先分段再阅读');
  const raw=tokenize(text),anchors=[];
  // Source offsets are UTF-16 offsets, the same coordinate system as JS strings.
  for(const r of paragraph?.sourceReadings||[]){
   const reading=novelHiragana(r?.reading);
   if(!r||!Number.isInteger(r.start)||!Number.isInteger(r.end)||r.start<0||r.end<=r.start||r.end>text.length||text.slice(r.start,r.end)!==r.text||!kana(reading))continue;
   if(anchors.some(a=>r.start<a.end&&r.end>a.start))continue;
   anchors.push({start:r.start,end:r.end,text:r.text,reading,ruby:true});
  }
  anchors.sort((a,b)=>a.start-b.start);
  const untouched=(start,end)=>raw.flatMap(t=>{
   if(t.end<=start||t.start>=end)return [];
   if(t.start>=start&&t.end<=end)return [t];
   const from=Math.max(start,t.start),to=Math.min(end,t.end);
   // An original ruby may split 好い into 好 + い. Do not turn that い into 居る.
   return tokenize(text.slice(from,to)).map(s=>({...s,start:from+s.start,end:from+s.end,fragment:true}));
  });
  let cursor=0;const pieces=[];
  for(const anchor of anchors){pieces.push(...untouched(cursor,anchor.start),anchor);cursor=anchor.end;}
  pieces.push(...untouched(cursor,text.length));
  const segments=mergeCompounds(pieces).map(piece=>{
   const segment={text:piece.text};if(piece.reading)segment.reading=piece.reading;
   const wordId=piece.wordId||dictionaryId(piece);if(wordId)segment.wordId=wordId;
   if(wordId&&piece.lemma&&piece.lemma!==piece.text)segment.lemma=piece.lemma;
   return segment;
  });
  if(segments.map(s=>s.text).join('')!==text)throw new Error('注音没有保持原文，请重新载入这一节');
  return {text,segments};
 }
 return {annotate};
}
