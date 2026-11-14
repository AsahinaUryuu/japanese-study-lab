import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderLesson,lessonEvents} from '../public/views/lessons.js';
import {gradeQuestions} from '../public/learning-core.js';
import {saveQuizSnapshot} from '../public/learning-center-core.js';
import {submittedAnswerText,questionFeedbackHTML,bindFeedbackTools,toggleFeedbackAnswers,toggleDeepTranslation} from '../public/views/lesson-recall.js';

const choice={id:'original',type:'choice',prompt:'原题第一行\n原题第二行',options:['选项零','选项一','选项二'],answer:1,explanation:'只有第二项符合原题条件。'};
const fill={id:'fill',type:'fill',prompt:'请填入原句',answer:'結果',explanation:'表示结果，而不是正在进行。'};
const course=JSON.parse(readFileSync(new URL('../public/data/business.json',import.meta.url),'utf8')).find(l=>l.id==='b-itadaku-kudasaru');
function disclosureHarness(states=[false,false]){
 const listeners=states.map(()=>[]);
 const details=states.map((open,i)=>({open,addEventListener(type,handler){assert.equal(type,'toggle');listeners[i].push(handler);}}));
 const control={textContent:'',disabled:false,attributes:{},setAttribute(key,value){this.attributes[key]=value;}};
 const root={querySelectorAll(selector){return selector==='[data-feedback-answer]'?details:selector==='[data-action="toggle-feedback-answers"]'?[control]:[];}};
 return {root,details,control,listeners};
}
function environment(lesson=structuredClone(course),stage='feedback',extra={}){
 const record={stage,answers:{},drafts:{},reviews:[],listenAnswers:{},...extra};
 let saves=0;
 const env={data:{lessons:[lesson],words:[],snippets:new Map()},state:{route:'lesson/'+lesson.id,viewData:{},params:new URLSearchParams(),busy:new Map()},
  store:{data:{settings:{showFurigana:true},notes:{},words:{}},lesson:()=>record,save(){saves++;},activity(){}},
  main:{innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]},markdown(){},toast(){},render(){},ask(){}};
 return {env,record,lesson,get saves(){return saves;}};
}

test('feedback preserves every original option and the submitted choice while references start closed',()=>{
 const answers={original:0},item=gradeQuestions([choice],answers).items[0];
 const before=JSON.stringify({choice,answers,item});const html=questionFeedbackHTML(choice,item,0,answers);
 for(const option of choice.options)assert.ok(html.includes(option));
 assert.match(html,/原题第一行\n原题第二行/);assert.match(html,/A · 选项零/);assert.equal((html.match(/你的选择/g)||[]).length,1);
 assert.match(html,/<details class="recall-answer" data-feedback-answer>/);assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
 assert.ok(html.indexOf('你的提交')<html.indexOf('查看参考答案与解析'));
 assert.ok(html.indexOf('参考答案</b>')>html.indexOf('<details'));assert.ok(html.includes(choice.explanation));
 assert.equal(JSON.stringify({choice,answers,item}),before);
});

test('submissions distinguish choice zero, empty answers, multiline text and unavailable legacy values',()=>{
 assert.equal(submittedAnswerText(choice,{original:0}),'A · 选项零');
 assert.equal(submittedAnswerText(choice,{original:''}),'未作答');assert.equal(submittedAnswerText(fill,{fill:'  '}),'未作答');
 assert.equal(submittedAnswerText(fill,{fill:'一行\n二行'}),'一行\n二行');
 assert.match(submittedAnswerText(choice,{original:99}),/99.*无法匹配/);
 const old={...fill,unavailable:true,answer:''};assert.match(questionFeedbackHTML(old,{correct:false,unanswered:false},0,{fill:0}),/旧记录未保留参考答案/);
});

test('question, option, answer and explanation text are escaped in read-only feedback',()=>{
 const q={...choice,prompt:'<script>alert(1)</script>',options:['<img src=x onerror=alert(1)>','安全'],answer:0,explanation:'<svg onload=alert(1)>'};
 const html=questionFeedbackHTML(q,{correct:true,unanswered:false},0,{original:0});
 assert.doesNotMatch(html,/<script|<img|<svg/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);
});

test('page-wide reveal handles individual open/close and binds each native disclosure once',()=>{
 const h=disclosureHarness();bindFeedbackTools(h.root);bindFeedbackTools(h.root);
 assert.deepEqual(h.listeners.map(x=>x.length),[1,1]);assert.equal(h.control.attributes['aria-expanded'],'false');
 assert.equal(toggleFeedbackAnswers(h.root),true);assert.ok(h.details.every(x=>x.open));assert.match(h.control.textContent,/收起/);
 h.details[0].open=false;h.listeners[0][0]();assert.match(h.control.textContent,/展开/);
 toggleFeedbackAnswers(h.root);assert.ok(h.details.every(x=>x.open));toggleFeedbackAnswers(h.root);assert.ok(h.details.every(x=>!x.open));
 assert.equal(h.control.attributes['aria-expanded'],'false');
});

test('translation reveal is confined to the selected example and does not change global reading settings',async()=>{
 const h=environment(undefined,'learn');const settingsBefore=JSON.stringify(h.env.store.data.settings);
 const translation={hidden:true},other={hidden:true},attributes={};
 const control={dataset:{action:'toggle-deep-translation'},textContent:'显示中文对照',setAttribute:(k,v)=>attributes[k]=v,closest:()=>({querySelector:()=>translation})};
 assert.equal(await lessonEvents(h.env,{type:'click'},control),true);assert.equal(translation.hidden,false);assert.equal(other.hidden,true);
 assert.equal(attributes['aria-expanded'],'true');assert.equal(control.textContent,'隐藏中文对照');
 assert.equal(toggleDeepTranslation(control),true);assert.equal(translation.hidden,true);
 assert.equal(JSON.stringify(h.env.store.data.settings),settingsBefore);assert.equal(h.saves,0);
});

test('actual teaching view hides only the added second-scene translation while retaining ruby and original examples',()=>{
 const h=environment(undefined,'learn'),deep=h.lesson.sections.find(s=>s.id===h.lesson.id+'-deep-reading');
 const original=h.lesson.sections.find(s=>s.examples?.length&&!s.introducedIn).examples[0];
 // Matching ruby/word data must continue through the unchanged annotatedText path.
 h.env.data.snippets.set(deep.examples[0].ja,{text:deep.examples[0].ja,segments:[{text:deep.examples[0].ja,reading:'よみ',wordId:'test-word'}]});
 renderLesson(h.env);const html=h.env.main.innerHTML;
 assert.equal((html.match(/data-deep-translation hidden/g)||[]).length,deep.examples.length);
 assert.match(html,/aria-expanded="false" aria-controls="b-itadaku-kudasaru-deep-reading-translation-0"/);
 assert.ok(html.includes('<p class="translation">'+original.zh+'</p>'));assert.match(html,/<ruby>/);assert.match(html,/data-word-id="test-word"/);
 assert.match(html,/data-action="toggle-furigana"/);assert.equal(h.env.store.data.settings.showFurigana,true);
});

test('summary puts personal recall before a closed reference summary and retains unified review and completion',()=>{
 const h=environment(undefined,'summary');renderLesson(h.env);const html=h.env.main.innerHTML;
 assert.ok(html.indexOf('id="study-check-host"')<html.indexOf('<details class="recall-summary">'));
 assert.ok(html.indexOf('<details class="recall-summary">')<html.indexOf('class="section-assignment"'));
 assert.match(html,/<details class="recall-summary"><summary>对照参考总结<\/summary>/);
 assert.ok(html.includes(h.lesson.summary.professional));assert.ok(html.includes(h.lesson.summary.plain));
 for(const action of ['review-section','lesson-done'])assert.ok(html.includes('data-action="'+action+'"'));
 assert.match(html,/听写／听力文字/);
});

test('actual feedback uses submitted snapshot instead of edited drafts or expanded current question set',()=>{
 const h=environment();h.lesson.quiz=[{...choice,prompt:'新版改写题干',options:['新版零','新版一'],answer:0},{...fill,id:'new',introducedIn:'1.7.0'}];
 saveQuizSnapshot(h.record,[choice],{original:0},123);h.record.answers={original:1,new:'結果'};h.record.quizAt=123;
 const before=JSON.stringify(h.record);renderLesson(h.env);const html=h.env.main.innerHTML;
 assert.ok(html.includes(choice.prompt));assert.ok(html.includes('A · 选项零'));assert.ok(!html.includes('新版改写题干'));
 assert.match(html,/本课新增 1 道练习，尚未计入这次提交/);assert.match(html,/本次正确率 0%/);
 assert.match(html,/结合这次答题向助教提问/);assert.match(html,/data-stage="translate"/);
 assert.equal(JSON.stringify(h.record),before);
});

test('legacy incomplete result retains the original score notice without altering the record',()=>{
 const h=environment();h.lesson.quiz=[choice,{...fill,introducedIn:'1.7.0'}];
 h.record.quizAt=123;h.record.submittedAnswers={original:0};h.record.quizResult={score:100};
 const before=JSON.stringify(h.record);renderLesson(h.env);
 assert.match(h.env.main.innerHTML,/旧记录原分 100；已恢复题目当前核对 0%/);assert.match(h.env.main.innerHTML,/旧记录题集不完整/);
 assert.match(h.env.main.innerHTML,/不.*替换原分/);assert.equal(JSON.stringify(h.record),before);
});

test('listening feedback keeps original options and separate listening history for unified review',async t=>{
 const h=environment(undefined,'listen');h.lesson.listening=[{id:'audio-one',script:'日本語',title:'听力',translation:'中文',questions:[{...choice,id:'audio-question'}]}];
 h.record.listenAnswers={'audio-question':0};const answersBefore=JSON.stringify(h.record.answers),output={innerHTML:''};
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');globalThis.document={getElementById:()=>output};
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
 await lessonEvents(h.env,{type:'click'},{dataset:{action:'check-listening',task:'audio-one'}});
 assert.match(output.innerHTML,/本次提交时的原题选项/);assert.match(output.innerHTML,/data-feedback-answer/);
 assert.equal(h.record.listenHistory['audio-one'].quizHistory.length,1);
 assert.equal(h.record.listenHistory['audio-one'].quizHistory[0].answers['audio-question'],0);
 assert.equal(JSON.stringify(h.record.answers),answersBefore);assert.equal(h.record.quizHistory,undefined);
});

test('feedback expansion calls the view-only action without saving or changing the submission',async()=>{
 const h=environment(),d=disclosureHarness();h.env.main=d.root;const before=JSON.stringify(h.record);
 assert.equal(await lessonEvents(h.env,{type:'click'},{dataset:{action:'toggle-feedback-answers'}}),true);
 assert.ok(d.details.every(x=>x.open));assert.equal(h.saves,0);assert.equal(JSON.stringify(h.record),before);
});
