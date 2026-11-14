import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {snippetIndex} from '../public/reader-text.js';
import {hasReaderParagraph,readerParagraphHTML} from '../public/reader-core.js';
import {mixedJapaneseRanges,plausibleJapaneseTitle} from '../scripts/supplement-language-core.mjs';

const read=(path)=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const report=read('../public/data/content-updates-v1.7.json');
const baseline=read('./fixtures/content-before-v1.7.json');
const files=new Map([...new Set(report.lessons.map(l=>l.file))].map(file=>[file,read('../public/data/'+file)]));
const all=[...files.values()].flat();
const entries=report.lessons.map(entry=>({...entry,lesson:all.find(l=>l.id===entry.lessonId)}));
const version='1.7.0';
const sortKeys=value=>Array.isArray(value)?value.map(sortKeys):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(k=>[k,sortKeys(value[k])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(sortKeys(value))).digest('hex');
const supplement=read('../public/data/reader-supplement.json');
const snippets=snippetIndex(supplement);
const base=read('../public/data/reader.json');
const wordIds=new Set([...read('../public/data/vocabulary.json'),...base.words,...supplement.words].map(w=>w.id));
// Existing textbook IDs may originate in another lesson; base-reader validation
// already verifies them against the complete, stable curriculum vocabulary.
for(const record of Object.values(base.lessons))for(const p of record.paragraphs||[])
 for(const segment of p.segments||[])if(segment.wordId)wordIds.add(segment.wordId);

test('twenty authored expansions cover early and advanced JLPT, business and IT without adding empty lessons',()=>{
 assert.equal(entries.length,20);assert.equal(new Set(entries.map(e=>e.lessonId)).size,20);
 assert.deepEqual(report.counts,{lessons:20,sections:60,passages:20,objectiveQuestions:60,translations:40,translationRubricPoints:120});
 const levels=new Set(entries.map(e=>e.lesson.level));for(const l of ['N5','N4','N3','N2','N1'])assert.ok(levels.has(l));
 for(const track of ['grammar','reading','business','it'])assert.ok(entries.some(e=>e.lesson.track===track));
 assert.match(report.authorship,/原创/);assert.match(report.levelPolicy,/不是|不等于/);
});

test('all original question prompts, choices, answers, translations, textbook and curriculum IDs retain their exact contract',()=>{
 for(const {lesson,file} of entries){
  const oldQuiz=lesson.quiz.filter(q=>q.introducedIn!==version);
  const oldTranslation=lesson.translation.filter(q=>q.introducedIn!==version);
  const original=baseline[lesson.id];assert.equal(original.file+'.json',file);
  assert.deepEqual(oldQuiz.map(q=>q.id),original.questionIds,lesson.id);
  assert.deepEqual(oldTranslation.map(q=>q.id),original.translationIds,lesson.id);
  assert.equal(hash({quiz:oldQuiz,translation:oldTranslation,textbook:lesson.textbook,curriculum:lesson.curriculum}),original.sha256,lesson.id);
 }
});

test('new assessment identities are append-only, versioned, balanced and refer to a complete scenario',()=>{
 const ids=new Set();const positions=[0,0,0];
 for(const {lesson,newQuestionIds,newTranslationIds} of entries){
  const newQuiz=lesson.quiz.filter(q=>q.introducedIn===version);
  const translations=lesson.translation.filter(q=>q.introducedIn===version);
  assert.equal(newQuiz.length,3,lesson.id);assert.equal(translations.length,2,lesson.id);
  assert.deepEqual(newQuiz.map(q=>q.id),newQuestionIds);assert.deepEqual(translations.map(q=>q.id),newTranslationIds);
  assert.deepEqual(lesson.quiz.slice(-3),newQuiz);assert.deepEqual(lesson.translation.slice(-2),translations);
  for(const q of [...lesson.quiz,...lesson.translation]){assert.ok(!ids.has(q.id),q.id);ids.add(q.id);}
  for(const q of newQuiz){assert.equal(q.type,'choice');assert.equal(q.options.length,3);assert.equal(new Set(q.options).size,3);
   assert.ok(Number.isInteger(q.answer)&&q.answer>=0&&q.answer<3,q.id);positions[q.answer]++;
   assert.ok(q.explanation.includes(q.options[q.answer]),q.id);assert.ok(q.explanation.length>35,q.id);
   assert.match(q.prompt,/深化场景/);
  }
 }
 assert.deepEqual(positions,[20,20,20]);
});

test('each second scene contains connected original Japanese, full translation, stepwise explanation and nuanced contrasts',()=>{
 const passages=new Set();
 for(const {lesson,japaneseCharacters} of entries){
  const sections=lesson.sections.filter(s=>s.introducedIn===version);assert.equal(sections.length,3,lesson.id);
  const [reading,steps,contrast]=sections;const passage=reading.examples[0];
  assert.equal(passage.ja.length,japaneseCharacters);assert.ok(japaneseCharacters>=150,lesson.id);
  assert.ok((passage.ja.match(/。/g)||[]).length>=4,lesson.id);assert.ok(passage.zh.length>=100,lesson.id);
  assert.ok(!passages.has(passage.ja));passages.add(passage.ja);
  assert.equal(steps.body.length,3);assert.ok(steps.body.every(s=>s.length>45),lesson.id);
  assert.equal(steps.examples.length,2);assert.ok(contrast.body.join('').length>=100,lesson.id);
  assert.ok(sections.every(s=>s.id.startsWith(lesson.id+'-deep-')));
  assert.ok(!/TODO|待补充|占位|\ufffd/.test(JSON.stringify(sections)),lesson.id);
 }
});

test('new translations have individual 10-point rubrics and exact taught reference sentences',()=>{
 for(const {lesson} of entries){
  const taught=lesson.sections.find(s=>s.id===lesson.id+'-deep-reasoning').examples;
  const tasks=lesson.translation.filter(t=>t.introducedIn===version);
  assert.deepEqual(tasks.map(t=>t.direction),['ja-zh','zh-ja']);
  tasks.forEach((task,i)=>{
   assert.equal(task.prompt,i===0?taught[i].ja:taught[i].zh);assert.equal(task.reference,i===0?taught[i].zh:taught[i].ja);
   assert.equal(task.notes.length,4);assert.match(task.notes[0],/只评价本题/);
   assert.deepEqual(task.notes.slice(1).map(n=>Number(n.match(/([0-9]+)分/)[1])),[4,3,3]);
  });
  assert.notDeepEqual(tasks[0].notes,tasks[1].notes,lesson.id+' rubric must not assess unrelated sentence facts');
 }
});

test('new passages and example sentences have matching reusable ruby and dictionary links, while textbook indices still match',()=>{
 for(const {lesson} of entries){
  for(const p of lesson.textbook.paragraphs){
   assert.ok(base.lessons[lesson.id].paragraphs.some(old=>hasReaderParagraph(old,p.ja)),lesson.id+' original reader drift');
  }
  for(const section of lesson.sections.filter(s=>s.introducedIn===version))for(const example of section.examples){
   const annotation=snippets.get(example.ja);assert.ok(hasReaderParagraph(annotation,example.ja),lesson.id+' '+example.ja);
   assert.equal(annotation.segments.map(s=>s.text).join(''),example.ja);
   for(const segment of annotation.segments){
    if(/[\p{Script=Han}]/u.test(segment.text))assert.ok(segment.reading,lesson.id+' missing kana: '+segment.text);
    if(segment.wordId)assert.ok(wordIds.has(segment.wordId),lesson.id+' unknown word: '+segment.wordId);
   }
   const html=readerParagraphHTML(annotation);
   if(/[\p{Script=Han}]/u.test(example.ja))assert.match(html,/<ruby>/);
   assert.match(html,/data-word/);
  }
 }
});

test('public source records are bound to each lesson and explain their scope instead of claiming official textbooks',()=>{
 const domains=new Set(['www.jlpt.jp','www.jfstandard.jpf.go.jp','www.bunka.go.jp','www.kyozai.jpf.go.jp']);
 for(const {lesson,sources} of entries){assert.ok(sources.length);
  for(const url of sources){assert.ok(lesson.sourceRefs.includes(url),lesson.id);assert.equal(new URL(url).protocol,'https:');assert.ok(domains.has(new URL(url).hostname));}
  assert.match(lesson.sourceNote,/原创深化场景/);
 }
 for(const source of report.sources)assert.ok(source.scope.length>20);
});

test('Chinese conjunction between Japanese titles is never ruby or a dictionary word',()=>{
 const title='いただく与くださる：从谁的视角说感谢';
 const annotation=snippets.get(title);assert.ok(annotation);
 let offset=0;const at=title.indexOf('与');
 for(const segment of annotation.segments){
  if(offset<=at&&at<offset+segment.text.length){assert.equal(segment.reading,undefined);assert.equal(segment.wordId,undefined);}
  offset+=segment.text.length;
 }
 // Analyzer boundaries distinguish a standalone Chinese joiner from a Japanese
 // inflected verb. The real generated title above guards the production data.
 const tokens=text=>{
  const parts=text==='いただく与くださる'?['いただく','与','くださる']:
    text==='影響を与える'?['影響','を','与える']:[text];
  let start=0;return parts.map(part=>{const record={text:part,start,end:start+part.length,known:true,reading:'よみ'};start+=part.length;return record;});
 };
 assert.equal(plausibleJapaneseTitle('いただく与くださる',tokens),false);
 assert.equal(plausibleJapaneseTitle('影響を与える',tokens),true);
 const text='影響を与える';
 assert.deepEqual(mixedJapaneseRanges(text,{tokens,localWords:new Set(['影響']),allWords:new Set(['影響']),phrases:[text]}),[{start:0,end:text.length}]);
});
