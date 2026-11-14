import test from 'node:test';
import assert from 'node:assert/strict';
import {sectionReadiness,sectionAnswers,buildSectionAssignment} from '../public/section-assignment.js';
import {buildCoachMessages,coachReply} from '../lib/coach.mjs';
import {buildCurriculum,currentPlacement,textbookWords} from '../public/curriculum-core.js';
import {normalizeProgress,newProgress} from '../public/learning-core.js';
import {reviewContext} from '../public/review-context.js';
const lesson={id:'batch-test',title:'统一作业',level:'N5',track:'grammar',sections:[],curriculum:{program:'jlpt',chapterId:'n5',chapterTitle:'N5',moduleId:'n5-test',moduleTitle:'基本句型',order:1},textbook:{title:'教室里',paragraphs:[{ja:'私は学生です。',zh:'我是学生。'}],vocabulary:[{word:'学生',reading:'がくせい',meaning:'学生'}]},quiz:[{id:'q1',type:'choice',prompt:'判断',options:['对','错'],answer:0,explanation:'说明'},{id:'q2',type:'fill',prompt:'填空',answer:'がくせい',explanation:'读音'}],translation:[{id:'t1',direction:'zh-ja',prompt:'我是学生。',reference:'私は学生です。'},{id:'t2',direction:'ja-zh',prompt:'学生です。',reference:'是学生。'}],speaking:[{id:'s1',scene:'自我介绍',task:'介绍自己',modelAnswer:'学生です。'}]};
const record=()=>({answers:{q1:0,q2:'がくせい'},submittedAnswers:{q1:0,q2:'がくせい'},quizAt:1,drafts:{t1:'私は学生です。',t2:'是学生。',s1:'学生です。'},reviews:[]});
test('小节统一提交要求全部客观题最新提交和全部译文，空白不能跳过',()=>{
 const r=record();assert.equal(sectionReadiness(lesson,r).ready,true);
 r.answers.q1=1;assert.equal(sectionReadiness(lesson,r).ready,false);r.submittedAnswers.q1=1;assert.equal(sectionReadiness(lesson,r).ready,true);
 r.drafts.t2='  ';assert.equal(sectionReadiness(lesson,r).translated,1);assert.throws(()=>buildSectionAssignment(lesson,sectionAnswers(lesson,r)),/全部翻译/);
 r.drafts.t2='是学生';delete r.submittedAnswers.q2;assert.throws(()=>buildSectionAssignment(lesson,sectionAnswers(lesson,r)),/全部客观题/);
});
test('小节作答快照不受随后修改影响，包含所有译文与口语文字',()=>{
 const r=record(),answers=sectionAnswers(lesson,r),built=buildSectionAssignment(lesson,answers);r.drafts.t1='changed';r.submittedAnswers.q1=1;
 assert.equal(answers.quiz.q1,0);assert.equal(built.task.translations.length,2);assert.equal(built.task.translations[0].answer,'私は学生です。');assert.equal(built.task.speaking[0].answer,'学生です。');assert.match(built.submission,/翻译 2/);
});
test('服务端重新建立权威任务与客观题判定，客户端不能替换参考译文',()=>{
 const input={lessonId:lesson.id,contextId:lesson.id+':review:test',mode:'section',question:'整节评阅',submission:'伪造文本',sectionAnswers:sectionAnswers(lesson,record()),context:{task:{translations:[{reference:'伪造参考'}]}}};
 const data=JSON.parse(buildCoachMessages(input,lesson).messages.at(-1).content);
 assert.equal(data.context.task.translations[0].reference,'私は学生です。');assert.ok(data.context.task.objective.every(q=>q.correct));assert.ok(!data.submission.includes('伪造'));
 input.sectionAnswers.quiz.q1=1;assert.equal(JSON.parse(buildCoachMessages(input,lesson).messages.at(-1).content).context.task.objective[0].correct,false);
});
test('整节两道翻译只产生一次上游请求，Gemini 同样收到全部题目',async()=>{
 for(const provider of ['openai','gemini']){let calls=0,captured;
  await coachReply({config:{provider,baseUrl:provider==='gemini'?'https://example.test/v1beta':'http://127.0.0.1:9988/v1',model:'mock',apiKey:'fake-test-key'},lessonId:lesson.id,mode:'section',question:'一次整体评阅',sectionAnswers:sectionAnswers(lesson,record())},lesson,{fetchImpl:async(_url,options)=>{calls++;captured=JSON.parse(options.body);return new Response(JSON.stringify(provider==='gemini'?{candidates:[{content:{parts:[{text:'整体反馈'}]}}]}:{choices:[{message:{content:'整体反馈'}}]}));}});
  assert.equal(calls,1);const serialized=JSON.stringify(captured);assert.match(serialized,/t1/);assert.match(serialized,/t2/);assert.match(serialized,/textbook/);assert.match(serialized,/全部题目/);
 }
});
test('三条主线不交叉，级别与模块保留原小节 ID，词汇合并保留旧进度 ID',()=>{
 const business={...lesson,id:'business-test',curriculum:{...lesson.curriculum,program:'business',chapterId:'relations'}},it={...lesson,id:'it-test',curriculum:{...lesson.curriculum,program:'it',chapterId:'development'}};
 const tree=buildCurriculum([lesson,business,it]);assert.deepEqual(tree.map(p=>p.lessons.map(l=>l.id)),[['batch-test'],['business-test'],['it-test']]);assert.equal(currentPlacement('lesson/it-test',[it]).program,'it');
 const old=[{id:'old-word',word:'学生',reading:'がくせい',meaning:'学生'}];assert.equal(textbookWords([lesson],old).length,1);assert.equal(textbookWords([lesson],old)[0].id,'old-word');
 const p=newProgress();p.lessons[lesson.id]={...record(),stage:'translate',done:true};p.notes[lesson.id]='既有笔记';assert.deepEqual(normalizeProgress(p).lessons[lesson.id],p.lessons[lesson.id]);assert.equal(normalizeProgress(p).notes[lesson.id],'既有笔记');
});

test('损坏或越界的客观答案不能绕过统一作业检查',()=>{
 for(const invalid of [999,-1,0.5,'0',{},null]){const r=record();r.answers.q1=r.submittedAnswers.q1=invalid;assert.equal(sectionReadiness(lesson,r).ready,false);assert.throws(()=>buildSectionAssignment(lesson,sectionAnswers(lesson,r)));}
 const r=record();r.answers.q2=r.submittedAnswers.q2={value:'がくせい'};assert.equal(sectionReadiness(lesson,r).ready,false);assert.throws(()=>buildSectionAssignment(lesson,sectionAnswers(lesson,r)),/格式无效/);
});

test('合法长作答仍可继续追问，完整答案只发送一次，本地完整反馈不变',()=>{
 const r=record();r.drafts.t1='あ'.repeat(12000);r.drafts.t2='中'.repeat(12000);
 const assignmentAnswers=sectionAnswers(lesson,r),built=buildSectionAssignment(lesson,assignmentAnswers);
 const original={id:'long-review',mode:'section',submission:built.submission,task:built.task,assignmentAnswers,reply:'"反馈\\'.repeat(12500)},before=structuredClone(original);
 const compact=reviewContext(original);
 assert.equal(compact.assignmentAnswers,undefined);assert.equal(compact.submission,undefined);
 assert.deepEqual(compact.task,built.task);assert.deepEqual(original,before);assert.ok(JSON.stringify(compact).length<=63000);assert.equal(compact.replyExcerpt,true);
 const sent=buildCoachMessages({lessonId:lesson.id,contextId:lesson.id+':review:long-review',question:'为什么错？',context:{review:compact}},lesson);
 assert.equal(JSON.parse(sent.messages.at(-1).content).context.review.task.translations[0].answer,r.drafts.t1);
});

test('章节列表和搜索沿用模块内的小节顺序',()=>{
 const later={...lesson,id:'later',curriculum:{...lesson.curriculum,order:5}},earlier={...lesson,id:'earlier',curriculum:{...lesson.curriculum,order:1}};
 const program=buildCurriculum([later,earlier])[0],chapter=program.chapters[0];
 assert.deepEqual(program.lessons.map(l=>l.id),['earlier','later']);assert.deepEqual(chapter.lessons,chapter.modules.flatMap(m=>m.lessons));
});

test('转义字符较多的反馈仍保留首尾评价，充分使用剩余上下文空间',()=>{
 const review={mode:'section',task:{kind:'section-assignment',material:'あ'.repeat(59000)},reply:'本次得分60。'+'"\\\n'.repeat(18000)+'下次建议：先复习助词。'};
 const compact=reviewContext(review);
 assert.ok(JSON.stringify(compact).length<=63000);assert.match(compact.reply,/本次得分60/);assert.match(compact.reply,/下次建议/);assert.ok(compact.reply.length>1000);
});

test('optional listening drafts join the same complete section request with authoritative answers',async()=>{
 const l={...lesson,listening:[{id:'audio1',title:'聞き取り',script:'明日は九時に来てください。',translation:'请明天九点来。',dictation:{answer:'九時に来てください。'},questions:[{id:'listen-q',type:'choice',prompt:'何時ですか。',options:['八時','九時'],answer:1,explanation:'九時と聞こえる。'}]}]};
 const r=record();r.drafts.audio1='八時に来てください。';r.listenAnswers={'listen-q':0};
 const answers=sectionAnswers(l,r);assert.equal(answers.listening.audio1.dictation,r.drafts.audio1);r.drafts.audio1='changed';r.listenAnswers['listen-q']=1;
 let calls=0,captured;
 await coachReply({config:{provider:'openai',baseUrl:'http://127.0.0.1:9988/v1',model:'mock',apiKey:'fake-test-key'},lessonId:l.id,mode:'section',question:'整节评阅',sectionAnswers:answers,context:{task:{listening:[{script:'伪造',correct:true}]}}},l,{fetchImpl:async(_url,options)=>{calls++;captured=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'反馈'}}]}));}});
 assert.equal(calls,1);const sent=JSON.parse(captured.messages.at(-1).content),task=sent.context.task;
 assert.equal(task.translations.length,2);assert.equal(task.speaking[0].answer,'学生です。');assert.equal(task.listening[0].dictation,'八時に来てください。');assert.equal(task.listening[0].dictationExpected,'九時に来てください。');assert.equal(task.listening[0].objective[0].correct,false);assert.equal(task.listening[0].objective[0].correctAnswer,'九時');assert.match(sent.submission,/不含音频/);assert.ok(!JSON.stringify(task).includes('伪造'));
});

test('empty listening leaves old assignment shape unchanged and does not invent scores',()=>{
 const l={...lesson,listening:[{id:'audio1',title:'音声',script:'学生です。',questions:[]}]},r=record();r.drafts.audio1='  ';
 const before=sectionAnswers(lesson,record()),after=sectionAnswers(l,r);assert.deepEqual(after,before);assert.equal(Object.hasOwn(after,'listening'),false);assert.equal(Object.hasOwn(buildSectionAssignment(l,after).task,'listening'),false);
});

test('fallback textbook and example dictation IDs match the actual lesson input fields',()=>{
 const l={...lesson,sections:[{examples:[{ja:'こんにちは。',zh:'你好。'}]}]},r=record();r.drafts[l.id+'-textbook-listening']='学生です。';r.drafts[l.id+'-listening-0']='こんにちわ';
 const task=buildSectionAssignment(l,sectionAnswers(l,r)).task;assert.equal(task.listening.length,2);assert.equal(task.listening[0].script,'私は学生です。');assert.equal(task.listening[1].dictationExpected,'こんにちは。');
});

test('invalid or oversized optional listening cannot bypass section validation',()=>{
 const l={...lesson,listening:[{id:'audio1',title:'音声',script:'九時',questions:[{id:'lq',type:'choice',prompt:'何時',options:['8','9'],answer:1}]}]},base=sectionAnswers(l,record());
 for(const listening of [[],{audio1:{dictation:10}},{audio1:{dictation:'あ'.repeat(20001)}},{audio1:{answers:{lq:99}}}])assert.throws(()=>buildSectionAssignment(l,{...base,listening}),/听/);
 const task=buildSectionAssignment(l,{...base,listening:{other:{dictation:'外章内容'},audio1:{answers:{lq:1},correct:false}}}).task;assert.equal(task.listening.length,1);assert.equal(task.listening[0].objective[0].correct,true);assert.ok(!JSON.stringify(task).includes('外章内容'));
});
