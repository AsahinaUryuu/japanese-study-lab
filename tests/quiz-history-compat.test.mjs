import test from 'node:test';
import assert from 'node:assert/strict';
import {gradeQuestions,newProgress,normalizeProgress,lessonQuizAttempt} from '../public/learning-core.js';
import {saveQuizSnapshot,collectObjectiveMistakes} from '../public/learning-center-core.js';

const q=(id,extra={})=>({id,type:'choice',prompt:id+' 原题',options:['正解','誤り'],answer:0,explanation:'原解释',...extra});
const old=[q('a'),q('b')],fresh=q('new',{introducedIn:'1.7.0'}),lesson={id:'compat',title:'旧课',level:'N5',quiz:[fresh,old[1],old[0]]};

test('legacy result IDs define the old denominator and exclude new unanswered questions from mistakes',()=>{
 const p=newProgress();p.lessons.compat={answers:{a:0,b:0},submittedAnswers:{a:0,b:0},quizResult:gradeQuestions(old,{a:0,b:0}),quizAt:1};
 const a=lessonQuizAttempt(lesson,normalizeProgress(p).lessons.compat);assert.equal(a.result.score,100);assert.equal(a.result.total,2);assert.deepEqual(a.questions.map(q=>q.id),['a','b']);assert.deepEqual(a.newQuestions.map(q=>q.id),['new']);assert.equal(collectObjectiveMistakes({lessons:[lesson]},p).length,0);
});

test('first post-upgrade submission migrates old result with only its old question set',()=>{
 const p=newProgress(),r=p.lessons.compat={answers:{a:0,b:1},submittedAnswers:{a:0,b:1},quizResult:gradeQuestions(old,{a:0,b:1}),quizAt:1};
 saveQuizSnapshot(r,lesson.quiz,{a:0,b:0,new:0},2);
 assert.equal(r.quizHistory.length,2);assert.deepEqual(r.quizHistory[0].questions.map(q=>q.id),['a','b']);assert.equal(r.quizHistory[0].result.score,50);assert.equal(r.quizHistory[1].result.score,100);assert.equal(r.quizHistory[1].result.total,3);
 const rows=collectObjectiveMistakes({lessons:[lesson]},normalizeProgress(p),{scope:'history'});assert.equal(rows.length,1);assert.equal(rows[0].question.id,'b');assert.equal(rows[0].attemptId,'legacy-1');
});

test('new snapshots preserve original question wording and grades after live questions change or vanish',()=>{
 const p=newProgress(),r=p.lessons.compat={};saveQuizSnapshot(r,old,{a:0,b:1},1);
 const changed={...lesson,quiz:[q('b',{answer:1,options:['新0','新1']}),fresh]};
 const a=lessonQuizAttempt(changed,normalizeProgress(p).lessons.compat);assert.equal(a.result.score,50);assert.equal(a.result.total,2);assert.deepEqual(a.questions[1].options,['正解','誤り']);assert.equal(a.questions[0].id,'a');
 const rows=collectObjectiveMistakes({lessons:[changed]},p);assert.equal(rows.length,1);assert.equal(rows[0].question.id,'b');assert.equal(rows[0].answerText,'誤り');
});

test('saved per-question verdicts are retained instead of deriving a new score from a changed answer key',()=>{
 const p=newProgress(),r=p.lessons.compat={};saveQuizSnapshot(r,old,{a:0,b:1},1);
 r.quizHistory[0].questions[1].answer=1;const a=lessonQuizAttempt(lesson,normalizeProgress(p).lessons.compat);
 assert.equal(a.result.score,50);assert.equal(a.result.items[1].correct,false);assert.equal(collectObjectiveMistakes({lessons:[lesson]},p).length,1);
});

test('self-check and original historical results survive normalizing a cloud/imported record',()=>{
 const p=newProgress();p.lessons.compat={studyCheck:{reflection:'自分の言葉で説明する',rating:'explain',dueAt:123,extra:'discard'}};
 const r=normalizeProgress(p).lessons.compat;assert.equal(r.studyCheck.reflection,'自分の言葉で説明する');assert.equal(r.studyCheck.dueAt,123);assert.equal(r.studyCheck.extra,undefined);
});

test('score-only records recover only known answered IDs and retain the incompleteness marker in history',()=>{
 const p=newProgress(),r=p.lessons.compat={answers:{a:0},submittedAnswers:{a:0},quizAt:1,quizResult:{score:100}};
 const a=lessonQuizAttempt(lesson,r);assert.equal(a.result.total,1);assert.equal(a.result.score,100);assert.equal(a.incomplete,true);
 saveQuizSnapshot(r,lesson.quiz,{a:0,b:0,new:0},2);assert.equal(r.quizHistory[0].incomplete,true);assert.equal(r.quizHistory[0].result.total,1);assert.equal(normalizeProgress(p).lessons.compat.quizHistory[0].incomplete,true);
});

test('original score-only marks are kept separate from reconstruction through repeated imports and migration',()=>{
 for(const [originalScore,answer,recoveredScore] of [[100,1,0],[0,0,100]]){
  let p=newProgress();p.lessons.compat={answers:{a:answer},submittedAnswers:{a:answer},quizAt:1,quizResult:{score:originalScore}};
  for(let i=0;i<4;i++){p=normalizeProgress(p);const a=lessonQuizAttempt(lesson,p.lessons.compat);assert.equal(a.originalScore,originalScore);assert.equal(a.result.score,recoveredScore);}
  saveQuizSnapshot(p.lessons.compat,lesson.quiz,{a:0,b:0,new:0},2);p=normalizeProgress(p);
  const legacy=p.lessons.compat.quizHistory[0];assert.equal(legacy.incomplete,true);assert.equal(legacy.originalScore,originalScore);assert.equal(legacy.result.score,recoveredScore);
  if(recoveredScore===0){const row=collectObjectiveMistakes({lessons:[lesson]},p,{scope:'history'})[0];assert.equal(row.incomplete,true);assert.equal(row.originalScore,originalScore);}
 }
});
