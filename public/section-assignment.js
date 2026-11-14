import {gradeQuestions,sameProgress} from './learning-core.js';
import {listenTasks,listeningQuestions,dictationAnswer} from './listening-tasks.js';
const filled=value=>typeof value==='string'&&!!value.trim();
const validAnswer=(q,value)=>q.type==='choice'?Number.isInteger(value)&&value>=0&&value<q.options.length:filled(value);
export function sectionReadiness(lesson,record){
 const translations=lesson.translation||[],quiz=lesson.quiz||[];
 const submitted=record.submittedAnswers||{},graded=gradeQuestions(quiz,submitted);
 const quizReady=!quiz.length||!!record.quizAt&&graded.unanswered===0&&quiz.every(q=>validAnswer(q,submitted[q.id])&&sameProgress(record.answers?.[q.id],submitted[q.id]));
 const translated=translations.filter(t=>filled(record.drafts?.[t.id])).length;
 return {ready:quizReady&&translated===translations.length,quizReady,quizAnswered:graded.total-graded.unanswered,quizTotal:quiz.length,translated,translationTotal:translations.length};
}
export function sectionAnswers(lesson,record){
 const listening={};
 for(const task of listenTasks(lesson)){
  const dictation=record.drafts?.[task.id]||'',answers=Object.fromEntries(listeningQuestions(lesson,task).filter(q=>validAnswer(q,record.listenAnswers?.[q.id])).map(q=>[q.id,record.listenAnswers[q.id]]));
  if(filled(dictation)||Object.keys(answers).length)listening[task.id]={...(filled(dictation)?{dictation}:{}),...(Object.keys(answers).length?{answers}:{})};
 }
 return {quiz:structuredClone(record.submittedAnswers||{}),translations:Object.fromEntries((lesson.translation||[]).map(t=>[t.id,record.drafts?.[t.id]||''])),speaking:Object.fromEntries((lesson.speaking||[]).map(t=>[t.id,record.drafts?.[t.id]||''])),...(Object.keys(listening).length?{listening:structuredClone(listening)}:{})};
}
export function buildSectionAssignment(lesson,answers){
 if(!answers||typeof answers!=='object'||Array.isArray(answers))throw new TypeError('小节作答格式无效');
 const result=gradeQuestions(lesson.quiz||[],answers.quiz||{});
 if(result.unanswered)throw new TypeError('请完成并提交本小节的全部客观题');
 if((lesson.quiz||[]).some(q=>!validAnswer(q,answers.quiz?.[q.id])))throw new TypeError('客观题作答格式无效，请重新选择或填写后提交');
 const translations=(lesson.translation||[]).map(t=>{const answer=answers.translations?.[t.id];if(!filled(answer))throw new TypeError('请先完成本小节的全部翻译题');if(answer.length>20000)throw new TypeError('单题译文过长，请精简到 20,000 字以内');return {...t,answer:answer.trim()};});
 const speaking=(lesson.speaking||[]).map(t=>({...t,answer:typeof answers.speaking?.[t.id]==='string'?answers.speaking[t.id].trim():''}));
 if(speaking.some(t=>t.answer.length>20000))throw new TypeError('口语文字过长，请精简后提交');
 const objective=(lesson.quiz||[]).map(q=>({id:q.id,prompt:q.prompt,answer:q.type==='choice'?q.options[answers.quiz[q.id]]:answers.quiz[q.id],correctAnswer:q.type==='choice'?q.options[q.answer]:q.answer,explanation:q.explanation,correct:result.items.find(r=>r.id===q.id).correct}));
 const listening=[];
 if(answers.listening!==undefined&&(!answers.listening||typeof answers.listening!=='object'||Array.isArray(answers.listening)))throw new TypeError('听力作答格式无效');
 for(const original of listenTasks(lesson)){
  const attempt=answers.listening?.[original.id];if(attempt===undefined)continue;
  if(!attempt||typeof attempt!=='object'||Array.isArray(attempt))throw new TypeError('听力作答格式无效');
  if(attempt.dictation!==undefined&&typeof attempt.dictation!=='string')throw new TypeError('听写内容应为文字');
  if((attempt.dictation||'').length>20000)throw new TypeError('单项听写过长，请精简到 20,000 字以内');
  if(attempt.answers!==undefined&&(!attempt.answers||typeof attempt.answers!=='object'||Array.isArray(attempt.answers)))throw new TypeError('听力理解作答格式无效');
  const dictation=(attempt.dictation||'').trim(),questions=listeningQuestions(lesson,original).filter(q=>{const value=attempt.answers?.[q.id];if(value===undefined||value===null||value==='')return false;if(!validAnswer(q,value))throw new TypeError('听力理解作答格式无效');return true;});
  if(!dictation&&!questions.length)continue;
  const graded=gradeQuestions(questions,attempt.answers||{}),objective=questions.map(q=>({id:q.id,prompt:q.prompt,answer:q.type==='choice'?q.options[attempt.answers[q.id]]:attempt.answers[q.id],correctAnswer:q.type==='choice'?q.options[q.answer]:q.answer,explanation:q.explanation,correct:graded.items.find(item=>item.id===q.id).correct}));
  listening.push({id:original.id,title:original.title,script:original.script,translation:original.translation,...(dictation?{dictation,dictationExpected:dictationAnswer(original)}:{}),objective});
 }
 const task={id:lesson.id+':section-assignment',kind:'section-assignment',lessonId:lesson.id,title:lesson.title+' · 全部作业',objective,translations,speaking,...(listening.length?{listening}: {})};
 const submission=[`小节：${lesson.title}`,`客观题：${result.correct}/${result.total}（系统判定）`,...objective.map((q,i)=>`客观题 ${i+1}：${q.prompt}\n我的答案：${q.answer}\n判定：${q.correct?'正确':'错误'}`),...translations.map((t,i)=>`翻译 ${i+1}（${t.direction==='ja-zh'?'日译中':'中译日'}）\n原文：${t.prompt}\n我的译文：${t.answer}`),...speaking.map((t,i)=>`口语文字 ${i+1}（可选）\n场景：${t.scene}\n我的表达：${t.answer||'未提交，不评分'}`),...listening.map((t,i)=>`听力文字 ${i+1}（可选）· ${t.title}\n${t.dictation?'我的听写：'+t.dictation+'\n':''}${t.objective.map(q=>`理解题：${q.prompt}\n我的答案：${q.answer}\n判定：${q.correct?'正确':'错误'}`).join('\n')}\n仅评阅以上文字与原文的对应关系，不含音频；未填项不评分，不推断发音、听觉识别或真实听力能力。`)].join('\n\n');
 if(submission.length>40000||JSON.stringify(task).length>60000)throw new TypeError('本小节作答总量过长，请精简后再统一提交');
 return {task,submission,result};
}
