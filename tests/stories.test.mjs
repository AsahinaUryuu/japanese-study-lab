import test from 'node:test';
import assert from 'node:assert/strict';
import {newProgress,normalizeProgress} from '../public/learning-core.js';
import {snippetIndex,annotatedText} from '../public/reader-text.js';
import {chapterChars,readingRecord,findStory,gradeReading,readingContext,validatedReadingResult} from '../public/stories-core.js';
import {buildCoachMessages} from '../lib/coach.mjs';

const chapter={id:'test-one',title:'小さな店',paragraphs:[{ja:'今日は雨です。',zh:'今天下雨。'}],vocabulary:[{word:'雨',reading:'あめ',meaning:'雨'}],questions:[{id:'q1',prompt:'天气？',options:['晴','雨'],answer:1,explanation:'原文说明下雨。'},{id:'q2',prompt:'时间？',options:['今天','昨天'],answer:0,explanation:'今日是今天。'}]};
const book={id:'test',title:'町の店',level:'N5',chapters:[chapter,{...chapter,id:'test-two',title:'明日'}]};

test('reading bookmarks, answers, notes and completion persist without changing course/review progress',()=>{
 const p=newProgress();p.lessons.old={answers:{a:1},drafts:{text:'译文'},reviews:[]};p.words.old={due:123,reviews:8,interval:5};
 const r=readingRecord(p,chapter.id);r.paragraph=3;r.done=true;r.note='读书笔记';r.answers={q1:1,q2:0};gradeReading(chapter,r,1000);p.lastReading=chapter.id;
 const next=normalizeProgress(JSON.parse(JSON.stringify(p)));
 assert.deepEqual(next.readings,p.readings);assert.equal(next.lastReading,chapter.id);assert.deepEqual(next.words,p.words);assert.deepEqual(next.lessons,p.lessons);
 assert.deepEqual(normalizeProgress({version:1}).readings,{});assert.equal(normalizeProgress({version:1}).settings.showFurigana,true);
});
test('bad imported reading records cannot break the reading route',()=>{
 const p=normalizeProgress({version:1,readings:{a:null,b:[],c:{paragraph:-2,note:3,answers:[]},d:{paragraph:1e9}}});
 assert.equal(p.readings.a,undefined);assert.equal(p.readings.b,undefined);assert.equal(p.readings.c.paragraph,0);assert.equal(p.readings.c.note,'');assert.deepEqual(p.readings.c.answers,{});assert.equal(p.readings.d.paragraph,10000);
});
test('reading grading waits for the full chapter and preserves submitted answer snapshots',()=>{
 const r={answers:{q1:1}};assert.equal(gradeReading(chapter,r),null);assert.equal(r.result,undefined);
 r.answers.q2=1;assert.equal(gradeReading(chapter,r,900).correct,1);r.answers.q2=0;
 assert.equal(r.submittedAnswers.q2,1);assert.equal(r.result.correct,1);assert.equal(gradeReading(chapter,r,1000).correct,2);
});
test('story context binds only the active chapter including its submitted feedback',()=>{
 const r={answers:{q1:1,q2:0},note:'雨的用法'};gradeReading(chapter,r);
 const result=findStory([book],'test-one');assert.equal(result.chapter,chapter);assert.equal(result.index,0);assert.equal(findStory([book],'missing'),null);assert.equal(chapterChars(chapter),7);
 const context=readingContext(book,chapter,r);assert.equal(context.chapterTitle,'小さな店');assert.deepEqual(context.paragraphs,chapter.paragraphs);
 const message=buildCoachMessages({lessonId:'general',contextId:'general:story/test-one:test-one',question:'为什么第二题这样解释？',mode:'chat',context:{reading:context}},{id:'general',title:'自由学习'});
 const payload=JSON.parse(message.messages.at(-1).content);assert.equal(payload.context.reading.result.correct,2);assert.equal(payload.context.reading.chapterTitle,'小さな店');assert.ok(!JSON.stringify(payload).includes('test-two'));
});
test('mixed teaching text annotates only supplied Japanese spans and invalid old data safely falls back',()=>{
 const text='“学生です”说明身份。',s={text,segments:[{text:'“'},{text:'学生',reading:'がくせい',wordId:'v-gakusei'},{text:'です”说明身份。'}]};
 const env={data:{snippets:snippetIndex({snippets:[s,{text:'坏数据',segments:[{text:'别的内容'}]}]})}};
 const html=annotatedText(text,env);assert.match(html,/<ruby>学生/);assert.match(html,/说明身份。/);assert.ok(!html.includes('<ruby>说明'));assert.match(html,/data-word-id="v-gakusei"/);
 assert.equal(env.data.snippets.has('坏数据'),false);assert.match(annotatedText('<script>x</script>',env),/&lt;script&gt;/);assert.ok(!annotatedText('不同的文本',env).includes('<ruby>'));
});
test('imported feedback is matched by IDs and recomputed from the saved submission',()=>{
 const r={answers:{q1:1,q2:0}};gradeReading(chapter,r);
 r.result.correct='<img src=x onerror=alert(1)>';r.result.total='bad';r.result.items.reverse();
 assert.equal(validatedReadingResult(chapter,r).correct,2);
 assert.deepEqual(validatedReadingResult(chapter,r).items.map(x=>x.id),['q1','q2']);
 for(const items of [[null], [null,{id:'q2'}], [{id:'q1'},{id:'q1'}], [{id:'q1'},{id:'old-question'}], [...r.result.items,{id:'extra'}]]){
  const bad={...r,result:{items}};assert.equal(validatedReadingResult(chapter,bad),null);assert.equal(readingContext(book,chapter,bad).result,null);
 }
 r.submittedAnswers.q1=100;assert.equal(validatedReadingResult(chapter,r),null);
});
