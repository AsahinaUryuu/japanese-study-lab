import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {buildCurriculum,placement,textbookWords,wordKey} from '../public/curriculum-core.js';
import {textbookHTML} from '../public/views/textbook.js';
import {buildSectionAssignment} from '../public/section-assignment.js';
const root=new URL('../',import.meta.url),files=(await readdir(new URL('public/data/',root))).filter(n=>/^(grammar-|business|foundation|reading|listening|it)/.test(n)&&n.endsWith('.json'));
const lessons=(await Promise.all(files.map(n=>readFile(new URL('public/data/'+n,root),'utf8').then(JSON.parse)))).flat();
test('每个小节都有教材正文、实际课文词汇、语法焦点与理解检查',()=>{
 for(const l of lessons){const b=l.textbook;assert.ok(b,l.id+' missing textbook');assert.ok(b.title&&b.scene,l.id);assert.ok(b.paragraphs.length,l.id);assert.ok(b.paragraphs.every(p=>p.ja&&p.zh),l.id);
  const ja=b.paragraphs.map(p=>p.ja).join('\n');assert.ok(ja.length>=35,l.id+' passage too short');assert.ok(b.vocabulary.length>=4,l.id+' vocabulary');
  for(const w of b.vocabulary){assert.ok(w.word&&w.reading&&w.meaning,l.id+' vocabulary fields');assert.ok(ja.includes(w.surface||w.word),l.id+' missing passage word '+w.word);}
  assert.ok(b.focus.length>=1,l.id+' focus');for(const f of b.focus)assert.ok(ja.includes(f.quote)&&f.explanation,l.id+' missing focus quotation');assert.ok(b.readingQuestions.every(q=>q.question&&q.answer)&&b.readingQuestions.length,l.id+' self checks');
  const html=textbookHTML(l);assert.match(html,/textbook-title/);assert.ok(!html.includes('[object Object]'),l.id);
 }
});
test('三条主线和每一级目录完整，所有小节只出现一次，原进度 ID 全保留',async()=>{
 const tree=buildCurriculum(lessons),ids=lessons.map(l=>l.id),old=JSON.parse(await readFile(new URL('tests/fixtures/v1-lesson-ids.json',root),'utf8'));
 assert.equal(new Set(ids).size,lessons.length);for(const id of old)assert.ok(ids.includes(id),id+' old progress ID missing');
 assert.deepEqual(tree.map(p=>p.id),['jlpt','business','it']);assert.deepEqual(tree[0].chapters.map(c=>c.id),['n5','n4','n3','n2','n1']);assert.ok(tree[1].chapters.length>=3);assert.ok(tree[2].lessons.length>=24);
 assert.equal(tree.flatMap(p=>p.chapters.flatMap(c=>c.modules.flatMap(m=>m.lessons))).length,lessons.length);
 for(const l of lessons){assert.ok(l.curriculum,l.id+' no explicit placement');assert.equal(placement(l).program,l.track==='business'?'business':l.track==='it'?'it':'jlpt');}
 const n5=tree[0].chapters[0];assert.ok(n5.modules[0].lessons.every(l=>l.track==='foundation'));assert.ok(n5.modules.at(-1).lessons.every(l=>l.track==='listening'));
});
test('所有课内词汇可纳入复习，既有词汇标识保持不变',async()=>{
 const words=JSON.parse(await readFile(new URL('public/data/vocabulary.json',root),'utf8')),merged=textbookWords(lessons,words),keys=new Set(merged.map(wordKey));
 for(const l of lessons)for(const w of l.textbook.vocabulary)assert.ok(keys.has(wordKey(w)),l.id+' missing review word');assert.deepEqual(merged.slice(0,words.length),words);
});

test('每一小节的完整作业都能以同一批次评阅，题目和参考答案没有遗漏',()=>{
 for(const lesson of lessons){
  const answers={quiz:Object.fromEntries(lesson.quiz.map(q=>[q.id,q.answer])),translations:Object.fromEntries(lesson.translation.map(t=>[t.id,t.reference])),speaking:{}};
  const built=buildSectionAssignment(lesson,answers);
  assert.equal(built.result.correct,lesson.quiz.length,lesson.id+' reference grading');
  assert.equal(built.task.translations.length,lesson.translation.length,lesson.id+' translations lost');
  assert.equal(built.task.objective.length,lesson.quiz.length,lesson.id+' objective answers lost');
  assert.ok(built.task.translations.every(t=>t.answer&&t.reference),lesson.id+' missing translation');
 }
});
