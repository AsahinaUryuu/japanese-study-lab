import {gradeQuestions,readingForm,objectiveAttempt,snapshotQuestions} from './learning-core.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const text=value=>typeof value==='string'?value:'';
const matches=(values,query)=>!query||readingForm(values.filter(Boolean).join(' ').toLowerCase()).includes(readingForm(query.toLowerCase()));
export const sourceLabels={lesson:'课程小节',story:'故事章节',novel:'全文小说',exam:'限时训练',dictionary:'词典',unknown:'原有记录'};
export function sourceForRoute(data,route){
 const [kind,id,chapterId]=route.split('/');
 if(kind==='lesson'){const lesson=data.lessons.find(l=>l.id===id);if(lesson)return {kind:'lesson',id,title:lesson.title,href:'#lesson/'+encodeURIComponent(id)};}
 if(kind==='story')for(const book of data.stories||[]){const chapter=book.chapters.find(c=>c.id===id);if(chapter)return {kind:'story',id,title:book.title+' · '+chapter.title,href:'#story/'+encodeURIComponent(id)};}
 if(kind==='novel'){const book=(data.importedNovels||[]).find(b=>b.id===id),chapter=book?.chapters?.find(c=>c.id===chapterId);if(book)return {kind:'novel',id:id+':'+(chapterId||''),title:book.title+(chapter?' · '+chapter.title:''),href:'#novel/'+encodeURIComponent(id)+(chapterId?'/'+encodeURIComponent(chapterId):'')};}
 return {kind:'dictionary',id:'dictionary',title:'词典查询',href:'#vocabulary'};
}
export function rememberWordSource(record,source,now=Date.now()){
 if(!record||!source)return false;
 const sources=Array.isArray(record.sources)?record.sources:[];
 if(sources.some(s=>s.kind===source.kind&&s.id===source.id))return false;
 record.sources=[...sources,{...source,at:now}].slice(-8);record.addedAt||=now;return true;
}
// Full question and submitted-answer snapshots avoid mixing old options with a new revision.
export function saveQuizSnapshot(record,questions,answers,at=Date.now()){
 const history=Array.isArray(record.quizHistory)?record.quizHistory:[];
 const previousResult=record.quizResult||record.result,previousAt=record.quizAt||record.gradedAt;
 if(!history.length&&previousResult&&(record.submittedAnswers||record.answers)&&previousAt){
  const previous=objectiveAttempt(questions,record);
  history.push({id:'legacy-'+previousAt,at:previousAt,questions:previous.questions,answers:previous.answers,result:previous.result,legacy:true,...(previous.incomplete?{incomplete:true,...(Number.isFinite(previous.originalScore)?{originalScore:previous.originalScore}:{})}:{})});
 }
 const snapshot={id:globalThis.crypto?.randomUUID?.()||String(at)+'-'+Math.random().toString(36).slice(2),at,questions:snapshotQuestions(questions),answers:copy(answers),result:gradeQuestions(questions,answers)};
 record.quizHistory=[...history,snapshot].slice(-8);return snapshot;
}
function questionText(question,answer){return question.type==='choice'?(question.options?.[answer]??'未作答'):(answer==null||answer===''?'未作答':String(answer));}
export {questionText};
export function collectObjectiveMistakes(data,progress,{scope='latest',source='all',level='all',q='',status='all'}={}){
 const rows=[];
 const append=(attempt,origin)=>{
  if(!Array.isArray(attempt.questions)||!attempt.answers||typeof attempt.answers!=='object')return;
  const recovered=objectiveAttempt(attempt.questions,attempt),result=recovered.result;
  for(const item of result.items){if(item.correct)continue;const question=attempt.questions.find(q=>q.id===item.id);if(!question)continue;
   const key=JSON.stringify([origin.kind,origin.id,String(attempt.id||attempt.at),question.id]);
   const retry=progress.learningCenter?.retries?.[key];
   rows.push({key,question,answer:item.answer,unanswered:item.unanswered,at:Number(attempt.at)||0,attemptId:String(attempt.id||attempt.at),origin,level:origin.level||'',retry,incomplete:recovered.incomplete===true,...(Number.isFinite(recovered.originalScore)?{originalScore:recovered.originalScore}:{}),reference:questionText(question,question.answer),answerText:questionText(question,item.answer)});
  }
 };
 for(const lesson of data.lessons||[]){const r=progress.lessons?.[lesson.id];if(!r)continue;let attempts=r.quizHistory?.length?r.quizHistory:[];
  if(!attempts.length&&r.quizResult)attempts=[{id:'legacy-'+r.quizAt,at:r.quizAt,...objectiveAttempt(lesson.quiz||[],r)}];
  for(const a of scope==='history'?attempts:attempts.slice(-1))append(a,{kind:'lesson',id:lesson.id,title:lesson.title,level:lesson.level,href:'#lesson/'+encodeURIComponent(lesson.id)});
  for(const [taskId,listening] of Object.entries(r.listenHistory||{}))for(const a of scope==='history'?(listening.quizHistory||[]):(listening.quizHistory||[]).slice(-1))append(a,{kind:'lesson',id:lesson.id+':listen:'+taskId,lessonId:lesson.id,stage:'listen',title:lesson.title+' · 听力理解',level:lesson.level,href:'#lesson/'+encodeURIComponent(lesson.id)});
 }
 for(const book of data.stories||[])for(const chapter of book.chapters||[]){const r=progress.readings?.[chapter.id];if(!r?.result)continue;
  const attempts=r.quizHistory?.length?r.quizHistory:[{id:'legacy-'+r.gradedAt,at:r.gradedAt,...objectiveAttempt((chapter.questions||[]).map(q=>({...q,type:'choice'})),r)}];
  for(const a of scope==='history'?attempts:attempts.slice(-1))append(a,{kind:'story',id:chapter.id,title:book.title+' · '+chapter.title,level:book.level,href:'#story/'+encodeURIComponent(chapter.id)});
 }
 const exams=progress.exams||[];
 for(const [index,exam] of exams.entries())append({id:exam.id||'exam-'+(exam.completedAt||0)+'-'+index,at:exam.completedAt,questions:exam.questions,result:exam.result,answers:exam.answers||Object.fromEntries((exam.result?.items||[]).map(i=>[i.id,i.answer]))},{kind:'exam',id:String(exam.id||exam.completedAt||index),title:'限时训练 · '+(exam.level||''),level:exam.level,href:'#exam'});
 return rows.filter(row=>(source==='all'||row.origin.kind===source)&&(level==='all'||row.level===level)&&(status==='all'||status==='pending'&&!row.retry?.correct||status==='recalled'&&row.retry?.correct)&&matches([row.question.prompt,row.question.explanation,row.origin.title,row.answerText],q)).sort((a,b)=>b.at-a.at||a.key.localeCompare(b.key));
}
export function gradeRetry(progress,row,answer,now=Date.now()){
 const item=gradeQuestions([row.question],{[row.question.id]:answer}).items[0];
 progress.learningCenter||={retries:{}};progress.learningCenter.retries||={};
 const previous=progress.learningCenter.retries[row.key];
 progress.learningCenter.retries[row.key]={answer:item.answer,correct:item.correct,at:now,count:(Number(previous?.count)||0)+1};
 const entries=Object.entries(progress.learningCenter.retries).sort((a,b)=>(b[1].at||0)-(a[1].at||0)).slice(0,1000);
 progress.learningCenter.retries=Object.fromEntries(entries);return item;
}
export function collectNotes(data,progress,{source='all',q=''}={}){
 const notes=[];const known=new Set();
 for(const lesson of data.lessons||[]){const content=text(progress.notes?.[lesson.id]);known.add(lesson.id);if(content.trim())notes.push({key:'lesson:'+lesson.id,kind:'lesson',id:lesson.id,title:lesson.title,level:lesson.level,content,href:'#lesson/'+encodeURIComponent(lesson.id)});}
 for(const [id,value] of Object.entries(progress.notes||{}))if(!known.has(id)&&text(value).trim())notes.push({key:'unknown:'+id,kind:'unknown',id,title:'暂未载入的课程 · '+id,content:value,href:''});
 const readingSources=new Map();
 for(const book of data.stories||[])for(const chapter of book.chapters||[])readingSources.set(chapter.id,{kind:'story',id:chapter.id,title:book.title+' · '+chapter.title,href:'#story/'+encodeURIComponent(chapter.id),level:book.level});
 for(const book of data.importedNovels||[])for(const chapter of book.chapters||[])readingSources.set('novel:'+book.id+':'+chapter.id,{kind:'novel',id:'novel:'+book.id+':'+chapter.id,title:book.title+' · '+chapter.title,href:'#novel/'+encodeURIComponent(book.id)+'/'+encodeURIComponent(chapter.id)});
 for(const [id,record] of Object.entries(progress.readings||{})){const content=text(record?.note);if(!content.trim())continue;const origin=readingSources.get(id)||{kind:'unknown',id,title:'暂未载入的阅读章节 · '+id,href:''};notes.push({...origin,key:'reading:'+id,content});}
 return notes.filter(n=>(source==='all'||n.kind===source)&&matches([n.title,n.content,n.level],q));
}
export function collectReviewWords(words,records,{q='',source='all',status='all',sort='due',now=Date.now()}={}){
 const list=words.filter(w=>records[w.id]).map(w=>({word:w,record:records[w.id]})).filter(({word,record})=>
  (source==='all'||source==='unknown'&&!record.sources?.length||record.sources?.some(s=>s.kind===source))&&
  (status==='all'||status==='due'&&record.due<=now||status==='difficult'&&record.lapses>0||status==='new'&&!record.reviews)&&
  matches([word.word,word.reading,word.meaning,...(record.sources||[]).map(s=>s.title)],q));
 return list.sort((a,b)=>sort==='lapses'?(b.record.lapses||0)-(a.record.lapses||0):sort==='recent'?(b.record.addedAt||b.record.introducedAt||0)-(a.record.addedAt||a.record.introducedAt||0):(a.record.due||0)-(b.record.due||0));
}
const mdHeading=s=>String(s).replace(/[\r\n]+/g,' ').replace(/([\\`*_{}\[\]<>])/g,'\\$1');
function verbatim(value){const text=String(value);const length=Math.max(2,...[...text.matchAll(/`+/g)].map(m=>m[0].length))+1;const fence='`'.repeat(length);return fence+'text\n'+text+'\n'+fence;}
export function notesMarkdown(notes,date=new Date()){
 return '# 我的日语学习笔记\n\n导出时间：'+date.toISOString()+'\n\n'+notes.map(n=>'## '+mdHeading(n.title)+'\n\n来源：'+sourceLabels[n.kind]+(n.level?' · '+mdHeading(n.level):'')+'\n\n'+(n.href?'软件内位置：`'+n.href.replace(/`/g,'')+'`\n\n':'')+verbatim(n.content)).join('\n\n---\n\n')+'\n';
}
export function wordsMarkdown(rows){return '# 我的生词本\n\n'+rows.map(({word,record})=>'## '+mdHeading(word.word)+'（'+mdHeading(word.reading)+'）\n\n'+verbatim(word.meaning||'')+'\n\n'+(record.sources||[]).map(s=>'来源：'+mdHeading(s.title)).join('\n\n')).join('\n\n---\n\n')+'\n';}
