import test from 'node:test';
import assert from 'node:assert/strict';
import {newProgress,normalizeProgress,gradeQuestions} from '../public/learning-core.js';
import {saveQuizSnapshot,collectObjectiveMistakes,gradeRetry,collectNotes,updateCollectedNote,notesMarkdown,collectReviewWords,rememberWordSource,sourceForRoute} from '../public/learning-center-core.js';
import {renderLearningCenter,learningCenterEvents} from '../public/views/learning-center.js';

const question=(id='q')=>({id,type:'choice',prompt:'正しい文は？',options:['誤り','正解'],answer:1,explanation:'主語と動作の関係を確認する。'});
function fixture(){
 const q=question(),data={lessons:[{id:'a',title:'课程A',level:'N5',quiz:[q]},{id:'b',title:'课程B',level:'N4',quiz:[question()]}],stories:[{id:'s',title:'故事',level:'N4',chapters:[{id:'c',title:'第一章',questions:[question()]}]}],importedNovels:[{id:'book',title:'小说',chapters:[{id:'ch',title:'第二章'}]}],words:[{id:'w1',word:'学校',reading:'がっこう',meaning:'学校',level:'N5'},{id:'w2',word:'映画',reading:'えいが',meaning:'电影',level:'N4'},{id:'w3',word:'明日',reading:'あした',meaning:'明天',level:'N5'}]},p=newProgress();
 return {data,p,q};
}
function envFor(data,p,tab='mistakes'){
 const env={data,store:{data:p,save(){this.saves=(this.saves||0)+1;},activity(){},lesson(id){return p.lessons[id]||=( {answers:{},drafts:{},reviews:[]} );}},state:{route:'learning-center',params:new URLSearchParams({tab}),page:1,viewData:{}},main:{innerHTML:'',querySelectorAll(){return [];}},toast(){},render(){renderLearningCenter(env);},navigate(route,params){this.navigated={route,params};},refreshTutor(){},ask(text){this.asked=text;}};return env;
}
test('same question IDs across lessons and different exams stay separate',()=>{
 const {data,p,q}=fixture();
 for(const id of ['a','b']){p.lessons[id]={};saveQuizSnapshot(p.lessons[id],[q],{q:0},10);}
 p.exams=[{id:'exam-1',completedAt:20,level:'N5',questions:[q],answers:{q:0}},{id:'exam-2',completedAt:30,level:'N5',questions:[q],answers:{q:0}}];
 const rows=collectObjectiveMistakes(data,p);assert.equal(rows.length,4);assert.equal(new Set(rows.map(r=>r.key)).size,4);assert.equal(rows[0].attemptId,'exam-2');
});
test('new lesson submission does not overwrite older question wording or answer',()=>{
 const {data,p,q}=fixture();p.lessons.a={};saveQuizSnapshot(p.lessons.a,[q],{q:0},10);q.prompt='新版题目';q.options[0]='新版选项';saveQuizSnapshot(p.lessons.a,[q],{q:1},20);
 assert.equal(collectObjectiveMistakes(data,p).length,0);
 const old=collectObjectiveMistakes(data,p,{scope:'history'});assert.equal(old.length,1);assert.equal(old[0].question.prompt,'正しい文は？');assert.equal(old[0].answerText,'誤り');
});
test('legacy latest result migrates once and bounded history survives export/import',()=>{
 const {data,p,q}=fixture(),r=p.lessons.a={quizAt:10,quizResult:gradeQuestions([q],{q:0}),submittedAnswers:{q:0}};
 saveQuizSnapshot(r,[q],{q:1},20);assert.equal(r.quizHistory.length,2);assert.equal(r.quizHistory[0].legacy,true);
 for(let i=0;i<15;i++)saveQuizSnapshot(r,[q],{q:0},30+i);
 assert.equal(r.quizHistory.length,8);assert.equal(normalizeProgress(p).lessons.a.quizHistory.length,8);assert.equal(collectObjectiveMistakes(data,normalizeProgress(p),{scope:'history'}).length,8);
});
test('story feedback participates without leaking answers from current edits',()=>{
 const {data,p,q}=fixture();p.readings.c={result:gradeQuestions([q],{q:0}),submittedAnswers:{q:0},answers:{q:1},gradedAt:20};
 const rows=collectObjectiveMistakes(data,p);assert.equal(rows.length,1);assert.equal(rows[0].answer,0);assert.equal(rows[0].origin.kind,'story');
 const prior=structuredClone(p.readings.c);saveQuizSnapshot(prior,[q],{q:1},30);p.readings.c.quizHistory=prior.quizHistory;
 assert.equal(collectObjectiveMistakes(data,normalizeProgress(p)).length,0);assert.equal(collectObjectiveMistakes(data,normalizeProgress(p),{scope:'history'}).length,1);
});
test('single-question retry has separate persisted grading and leaves original score untouched',()=>{
 const {data,p,q}=fixture();p.lessons.a={answers:{q:0},quizResult:gradeQuestions([q],{q:0})};saveQuizSnapshot(p.lessons.a,[q],{q:0},10);
 const before=structuredClone(p.lessons),row=collectObjectiveMistakes(data,p)[0];assert.equal(gradeRetry(p,row,1,50).correct,true);assert.deepEqual(p.lessons,before);
 assert.equal(collectObjectiveMistakes(data,normalizeProgress(p),{status:'pending'}).length,0);assert.equal(collectObjectiveMistakes(data,normalizeProgress(p),{status:'recalled'}).length,1);
});
test('search combines source, level, old answer and Japanese kana variants',()=>{
 const {data,p,q}=fixture();p.lessons.a={};saveQuizSnapshot(p.lessons.a,[q],{q:0},10);
 assert.equal(collectObjectiveMistakes(data,p,{q:'课程A',source:'lesson',level:'N5'}).length,1);assert.equal(collectObjectiveMistakes(data,p,{source:'story'}).length,0);
 p.words.w1={due:1,lapses:2,reviews:3};p.words.w2={due:999,reviews:0};
 assert.equal(collectReviewWords(data.words,p.words,{q:'ガッコウ'})[0].word.id,'w1');assert.equal(collectReviewWords(data.words,p.words,{status:'due',now:20}).length,1);
});
test('word provenance records the actual lesson or novel while preserving spaced-repetition scheduling',()=>{
 const {data,p}=fixture(),r=p.words.w1={interval:30,due:100000,reviews:6};
 assert.equal(rememberWordSource(r,sourceForRoute(data,'novel/book/ch'),40),true);assert.equal(rememberWordSource(r,sourceForRoute(data,'novel/book/ch'),41),false);
 rememberWordSource(r,sourceForRoute(data,'lesson/a'),42);assert.equal(r.due,100000);assert.equal(r.interval,30);assert.equal(r.sources.length,2);
 assert.equal(collectReviewWords(data.words,p.words,{source:'novel',q:'第二章'}).length,1);assert.equal(normalizeProgress(p).words.w1.sources[0].title,'小说 · 第二章');
});
test('notes search spans lesson, story, imported book and temporarily unavailable originals',()=>{
 const {data,p}=fixture();p.notes={a:'敬语使用场景',gone:'暂存'};p.readings={c:{note:'故事里的敬语'},'novel:book:ch':{note:'小说关键句'},'novel:missing:x':{note:'不能丢掉'}};
 assert.equal(collectNotes(data,p).length,5);assert.equal(collectNotes(data,p,{q:'敬语'}).length,2);assert.equal(collectNotes(data,p,{source:'novel'})[0].href,'#novel/book/ch');assert.equal(collectNotes(data,p,{source:'unknown'}).length,2);
});
test('Markdown export preserves literal content, unsafe HTML and nested fences without executing them',()=>{
 const note={kind:'lesson',title:'标题 <img>',content:'<script>alert(1)</script>\n```js\nconst x = 1;\n```',href:'#lesson/a'};
 const md=notesMarkdown([note],new Date('2026-01-01T00:00:00Z'));assert.match(md,/````text/);assert.match(md,/const x = 1/);assert.match(md,/标题 \\<img\\>/);assert.ok(!md.includes('apiKey'));
});
test('review center chat payload identifies exactly one original submission and return targets its lesson question',()=>{
 const {data,p,q}=fixture();p.lessons.a={};p.lessons.b={};saveQuizSnapshot(p.lessons.a,[q],{q:0},10);saveQuizSnapshot(p.lessons.b,[q],{q:0},20);
 const env=envFor(data,p);env.render();const row=env.state.viewData.centerRows.find(r=>r.origin.id==='a');
 learningCenterEvents(env,{type:'click'},{dataset:{action:'center-ask',key:row.key}});assert.equal(env.state.viewData.context.objectiveReview.source.id,'a');assert.equal(env.state.viewData.context.objectiveReview.submittedAt,10);assert.ok(!JSON.stringify(env.state.viewData.context).includes('课程B'));
 learningCenterEvents(env,{type:'click'},{dataset:{action:'center-origin',key:row.key}});assert.deepEqual(env.navigated,{route:'lesson/a',params:{question:'q'}});assert.equal(p.lessons.a.stage,'quiz');
});
test('filtered word session includes only chosen learned vocabulary and is restorable',()=>{
 const {data,p}=fixture();p.words={w1:{due:1,reviews:3,lapses:2},w2:{due:2,reviews:1,lapses:0}};const env=envFor(data,p,'words');env.state.params.set('status','difficult');env.render();
 learningCenterEvents(env,{type:'click'},{dataset:{action:'center-review-words'}});assert.deepEqual(p.reviewSession.ids,['w1']);assert.equal(env.navigated.route,'review');assert.deepEqual(normalizeProgress(p).reviewSession.ids,['w1']);
});
test('editing central notes changes only the original note, and rendering escapes authored markup',()=>{
 const {data,p}=fixture();p.notes={a:'<img src=x onerror=alert(1)>',b:'保持原状'};const env=envFor(data,p,'notes');env.render();assert.ok(env.main.innerHTML.includes('&lt;img'));assert.ok(!env.main.innerHTML.includes('<img src=x'));
 learningCenterEvents(env,{type:'input'},{dataset:{centerNote:'lesson:a'},value:'改好的笔记'});assert.equal(p.notes.a,'改好的笔记');assert.equal(p.notes.b,'保持原状');assert.equal(env.store.saves,1);
});
test('listening checks are separate snapshots and return to the listening stage',()=>{
 const {data,p,q}=fixture();p.lessons.a={listenHistory:{audio:{}}};saveQuizSnapshot(p.lessons.a.listenHistory.audio,[q],{q:0},20);
 const restored=normalizeProgress(p),env=envFor(data,restored);env.render();const row=env.state.viewData.centerRows[0];assert.equal(row.origin.stage,'listen');
 learningCenterEvents(env,{type:'click'},{dataset:{action:'center-origin',key:row.key}});assert.equal(restored.lessons.a.stage,'listen');assert.deepEqual(env.navigated,{route:'lesson/a',params:{question:'q'}});
});
test('central word cards retain the common furigana and click-to-dictionary contracts',()=>{
 const {data,p}=fixture();p.words.w1={due:1};const env=envFor(data,p,'words');env.render();
 assert.match(env.main.innerHTML,/class="annotated-text"/);assert.match(env.main.innerHTML,/data-action="reader-word" data-word-id="w1"/);assert.match(env.main.innerHTML,/data-action="toggle-furigana"/);
});


test('self-check reflections coexist with class notes and have their own search source and route',()=>{
 const {data,p}=fixture();p.notes.a='课堂笔记：敬语';p.lessons.a={studyCheck:{reflection:'回忆：いただく是自谦',rating:'again',dueAt:12}};
 const before=structuredClone(p),rows=collectNotes(data,p);assert.equal(rows.length,2);assert.equal(new Set(rows.map(n=>n.key)).size,2);
 assert.equal(rows.find(n=>n.kind==='reflection').href,'#lesson/a?stage=summary&check=1');
 assert.equal(collectNotes(data,p,{source:'lesson'})[0].content,p.notes.a);assert.equal(collectNotes(data,p,{source:'reflection',q:'イタダク'}).length,1);
 assert.equal(collectNotes(data,p,{q:'自检回忆'}).length,1);assert.deepEqual(p,before);
});

test('editing reflection changes only its source, retaining classroom notes, schedule and result',()=>{
 const {data,p}=fixture();p.notes.a='课堂原文';p.lessons.a={studyCheck:{reflection:'自检原文',rating:'again',dueAt:22,attempts:2},quizResult:{score:50}};p.lessons.b={studyCheck:{reflection:'另一课'}};
 const before=structuredClone(p),env=envFor(data,p,'notes');env.render();const markup=env.main.innerHTML;
 learningCenterEvents(env,{type:'input'},{dataset:{centerNote:'reflection:a'},value:'新回忆'});
 assert.equal(p.lessons.a.studyCheck.reflection,'新回忆');assert.equal(p.notes.a,'课堂原文');assert.equal(p.lessons.a.studyCheck.dueAt,22);assert.equal(p.lessons.a.studyCheck.rating,'again');assert.deepEqual(p.lessons.a.quizResult,before.lessons.a.quizResult);assert.deepEqual(p.lessons.b,before.lessons.b);
 assert.equal(env.main.innerHTML,markup);assert.equal(env.store.saves,1);
 learningCenterEvents(env,{type:'input'},{dataset:{centerNote:'lesson:a'},value:'新课堂笔记'});assert.equal(p.notes.a,'新课堂笔记');assert.equal(p.lessons.a.studyCheck.reflection,'新回忆');assert.equal(env.store.saves,2);
 const reflection=collectNotes(data,p).find(n=>n.key==='reflection:a');assert.equal(updateCollectedNote(p,reflection,'字'.repeat(3001)).length,3000);
 assert.equal(updateCollectedNote(p,{...reflection,key:'lesson:a'},'不合法'),null);assert.equal(updateCollectedNote(p,{...reflection,id:'missing',key:'reflection:missing'},'不合法'),null);
});

test('reflection Markdown and editor escape markup, retain fences, and preserve original note export',()=>{
 const {data,p}=fixture();p.notes.a='旧课堂';p.lessons.a={studyCheck:{reflection:'</textarea><script>alert(1)</script>\n```js\nconst x = 1;\n```'}};
 const env=envFor(data,p,'notes');env.render();assert.ok(env.main.innerHTML.includes('&lt;/textarea&gt;&lt;script&gt;'));assert.ok(!env.main.innerHTML.includes('<script>alert(1)</script>'));assert.match(env.main.innerHTML,/data-center-note="reflection:a" maxlength="3000"/);assert.match(env.main.innerHTML,/stage=summary&amp;check=1/);
 const md=notesMarkdown(collectNotes(data,p));assert.match(md,/来源：课程小节/);assert.match(md,/来源：自检回忆/);assert.match(md,/stage=summary&check=1/);assert.match(md,/````text/);assert.ok(md.includes(p.notes.a));assert.ok(md.includes(p.lessons.a.studyCheck.reflection));
});

test('temporarily unavailable reflections remain searchable and editable without inventing a route',()=>{
 const {data,p}=fixture();p.lessons.missing={studyCheck:{reflection:'原有回忆',dueAt:123}};
 const row=collectNotes(data,p,{source:'reflection'})[0];assert.equal(row.href,'');assert.equal(updateCollectedNote(p,row,'修订回忆'),'修订回忆');assert.equal(p.lessons.missing.studyCheck.dueAt,123);
 assert.equal(updateCollectedNote(p,row,''),'');assert.equal(collectNotes(data,p,{source:'reflection'}).length,0);
});

test('source-filtered notes keep pagination and editing does not clear source or query',()=>{
 const {data,p}=fixture();data.lessons=Array.from({length:18},(_,i)=>({id:'lesson-'+i,title:'课程 '+i,level:'N5',quiz:[]}));
 for(const lesson of data.lessons){p.notes[lesson.id]='课堂';p.lessons[lesson.id]={studyCheck:{reflection:'回忆 '+lesson.id}};}
 const env=envFor(data,p,'notes');env.state.params.set('source','reflection');env.state.params.set('q','回忆');env.state.page=2;env.render();
 assert.equal(env.state.viewData.centerNotes.length,18);assert.equal((env.main.innerHTML.match(/data-center-note="reflection:/g)||[]).length,2);assert.ok(env.main.innerHTML.includes('value="reflection" selected'));
 const before=env.main.innerHTML;learningCenterEvents(env,{type:'input'},{dataset:{centerNote:'reflection:lesson-16'},value:'更新内容'});
 assert.equal(env.main.innerHTML,before);assert.equal(env.state.page,2);assert.equal(env.state.params.get('source'),'reflection');assert.equal(env.state.params.get('q'),'回忆');assert.equal(p.notes['lesson-16'],'课堂');
});


test('clearing the final reflection updates status and export availability without rerendering',()=>{
 const {data,p}=fixture();p.lessons.a={studyCheck:{reflection:'唯一笔记'}};const env=envFor(data,p,'notes');env.render();
 const status={textContent:''},buttons=[{dataset:{action:'center-export-notes'}},{dataset:{action:'center-export-all-notes'}}];
 env.main.querySelectorAll=selector=>selector==='[data-center-notes-status]'?[status]:selector.includes('data-action=')?buttons:[];
 const rendered=env.main.innerHTML;
 learningCenterEvents(env,{type:'input'},{dataset:{centerNote:'reflection:a'},value:''});assert.match(status.textContent,/笔记 0 篇/);assert.equal(buttons[0].disabled,true);assert.equal(buttons[1].disabled,true);assert.equal(env.main.innerHTML,rendered);
 learningCenterEvents(env,{type:'input'},{dataset:{centerNote:'reflection:a'},value:'继续写'});assert.equal(buttons[0].disabled,false);assert.equal(buttons[1].disabled,false);
});
