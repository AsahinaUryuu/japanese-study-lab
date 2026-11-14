import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const files=['foundation','business','reading','listening','it'];
const entries=await Promise.all(files.map(async name=>[name,JSON.parse(await readFile(new URL('../public/data/'+name+'.json',import.meta.url),'utf8'))]));
const data=Object.fromEntries(entries),all=entries.flatMap(([,a])=>a);
test('121节核心及IT课程都有可读原文、中文、词汇、精确引用与自检',()=>{
 assert.deepEqual(entries.map(([n,a])=>[n,a.length]),[['foundation',12],['business',50],['reading',20],['listening',15],['it',24]]);
 assert.equal(new Set(all.map(l=>l.id)).size,121);
 for(const l of all){const t=l.textbook;assert.ok(t,l.id);assert.ok(t.title&&t.scene,l.id);assert.ok(t.paragraphs.length,l.id);
  const text=t.paragraphs.map(p=>p.ja).join('\n');assert.ok(text.length>35,l.id);
  t.paragraphs.forEach(p=>assert.ok(p.ja&&p.zh&&/[\u4e00-\u9fff]/u.test(p.zh),l.id));
  assert.ok(t.vocabulary.length>=4&&t.vocabulary.length<=8,l.id);
  for(const v of t.vocabulary){assert.ok(v.word&&v.reading&&v.meaning,l.id);assert.match(v.reading,/^[ぁ-んァ-ヶー・\s]+$/u,l.id);assert.ok(text.includes(v.surface||v.word),l.id+' '+v.word);}
  assert.ok(t.focus.length>=1&&t.focus.length<=3,l.id);
  t.focus.forEach(f=>{assert.ok(text.includes(f.quote),l.id+' '+f.quote);assert.ok(f.explanation.length>20,l.id);});
  assert.ok(t.readingQuestions.length>=1&&t.readingQuestions.length<=2,l.id);
  t.readingQuestions.forEach(q=>assert.ok(q.question&&q.answer,l.id));
  assert.ok(!/TODO|待补充|占位/.test(JSON.stringify(t)),l.id);
 }
});
test('基础/商务/IT正文连贯且控制句数；原有读听全文未被截断或改写',()=>{
 for(const l of [...data.foundation,...data.business,...data.it]){const count=(l.textbook.paragraphs.map(p=>p.ja).join('').match(/[。！？]/gu)||[]).length;assert.ok(count>=3&&count<=6,l.id+' '+count);}
 for(const l of data.reading){assert.equal(l.textbook.reusedSectionIndex,0);assert.equal(l.textbook.paragraphs[0].ja,l.sections[0].body.join('\n\n'));assert.equal(l.textbook.paragraphs[0].zh,l.sections[0].translation);}
 for(const l of data.listening){assert.equal(l.textbook.reusedSectionIndex,undefined);assert.equal(l.textbook.paragraphs[0].ja,l.listening[0].script);assert.equal(l.textbook.paragraphs[0].zh,l.listening[0].translation);}
});
test('JLPT顺序与独立商务/IT章节模块完整且一致',()=>{
 const chapterTitles=new Map(),moduleTitles=new Map();
 for(const l of all){const c=l.curriculum;assert.ok(c,l.id);assert.ok(['jlpt','business','it'].includes(c.program));assert.ok(Number.isInteger(c.order));
  const ch=c.program+':'+c.chapterId,mod=ch+':'+c.moduleId;
  if(chapterTitles.has(ch))assert.equal(chapterTitles.get(ch),c.chapterTitle);chapterTitles.set(ch,c.chapterTitle);
  if(moduleTitles.has(mod))assert.equal(moduleTitles.get(mod),c.moduleTitle);moduleTitles.set(mod,c.moduleTitle);
 }
 data.foundation.forEach(l=>assert.ok(l.curriculum.order>=0&&l.curriculum.order<=11));data.reading.forEach(l=>assert.ok(l.curriculum.order>=900&&l.curriculum.order<1000));data.listening.forEach(l=>assert.ok(l.curriculum.order>=1000));
 assert.equal(new Set(data.business.map(l=>l.curriculum.chapterId)).size,3);assert.equal(new Set(data.business.map(l=>l.curriculum.moduleId)).size,9);
 const chapters=new Map(),modules=new Map();for(const l of data.it){const c=l.curriculum;if(!chapters.has(c.chapterId))chapters.set(c.chapterId,new Set());chapters.get(c.chapterId).add(c.moduleId);modules.set(c.moduleId,(modules.get(c.moduleId)||0)+1);}
 assert.equal(chapters.size,3);for(const m of chapters.values())assert.equal(m.size,2);assert.equal(modules.size,6);for(const count of modules.values())assert.equal(count,4);
});
test('24节IT课含完整教学、96道有效练习、双向翻译和角色任务',()=>{
 const ids=new Set();for(const l of data.it){assert.equal(l.track,'it');assert.ok(l.level==='N3'||l.level==='N2'||l.level==='N1');assert.ok(l.sections.length>=3,l.id);
  l.sections.forEach(s=>{assert.ok(s.heading);assert.ok(s.body.join('').length>55,l.id);});assert.equal(l.quiz.filter(q=>q.introducedIn!=='1.7.0').length,4);
  for(const q of l.quiz){assert.ok(!ids.has(q.id));ids.add(q.id);assert.ok(q.explanation.length>15);if(q.type==='choice'){assert.equal(new Set(q.options).size,q.options.length);assert.ok(Number.isInteger(q.answer)&&q.options[q.answer]);}else{assert.equal(q.type,'fill');assert.ok(q.accepted.includes(q.answer));}}
  assert.deepEqual(l.translation.filter(t=>t.introducedIn!=='1.7.0').map(t=>t.direction).sort(),['ja-zh','zh-ja']);l.translation.forEach(t=>assert.ok(t.prompt&&t.reference&&t.notes.length));
  assert.equal(l.speaking.length,1);assert.ok(l.speaking[0].task.length>30);assert.ok(l.speaking[0].checks.length>=3);assert.equal(l.speaking[0].modelAnswer,l.textbook.paragraphs[0].ja);assert.ok(l.summary.professional&&l.summary.plain);
 }
});
