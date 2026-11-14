import test from 'node:test';
import assert from 'node:assert/strict';
import {newProgress,normalizeProgress,gradeQuestions,lessonQuizAttempt} from '../public/learning-core.js';
import {buildCoachMessages} from '../lib/coach.mjs';
import {sectionAnswers} from '../public/section-assignment.js';
test('Japanese import retains personal reflection and an original grade after new questions arrive',()=>{
 const old=[{id:'one',type:'choice',prompt:'元の問題',options:['一','二'],answer:0}],p=newProgress();
 p.lessons.lesson={answers:{one:0},submittedAnswers:{one:0},quizResult:gradeQuestions(old,{one:0}),quizAt:1700000000000,studyCheck:{reflection:'别把敬语等同于越长越礼貌',rating:'explain',dueAt:1800000000000}};
 const record=normalizeProgress(p).lessons.lesson,attempt=lessonQuizAttempt({id:'lesson',quiz:[...old,{id:'new',type:'fill',prompt:'新しい問題',answer:'はい',introducedIn:'1.7.0'}]},record);
 assert.equal(attempt.result.score,100);assert.equal(attempt.result.total,1);assert.equal(attempt.newQuestions.length,1);assert.equal(record.studyCheck.reflection,p.lessons.lesson.studyCheck.reflection);
});
test('one server-built section request includes supplied listening, translation and speaking text without audio',()=>{
 const lesson={id:'lesson',title:'听说综合',quiz:[],translation:[{id:'tr',direction:'zh-ja',prompt:'你好',reference:'こんにちは'}],speaking:[{id:'sp',scene:'问候',task:'打招呼'}],listening:[{id:'li',script:'十時に集まります。',translation:'十点集合',questions:[{id:'time',type:'choice',prompt:'何時ですか。',options:['十時','十一時'],answer:0,explanation:'原文十时'}]}]};
 const answers=sectionAnswers(lesson,{submittedAnswers:{},drafts:{tr:'こんにちは',sp:'おはようございます',li:'十時'},listenAnswers:{time:0}});
 const result=buildCoachMessages({lessonId:'lesson',contextId:'lesson:review:new',mode:'section',question:'统一评阅',sectionAnswers:answers},lesson);
 assert.equal(result.messages.length,1);const material=JSON.parse(result.messages[0].content);
 assert.equal(material.context.task.translations[0].answer,'こんにちは');assert.equal(material.context.task.speaking[0].answer,'おはようございます');assert.equal(material.context.task.listening.length,1);
 assert.ok(material.submission.includes('十時'));assert.equal(material.context.task.audio,undefined);
});
