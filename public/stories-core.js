import {gradeQuestions} from './learning-core.js';

export function chapterChars(chapter){return (chapter.paragraphs||[]).reduce((sum,p)=>sum+[...p.ja.replace(/\s/g,'')].length,0);}
export function findStory(series,chapterId){
 for(const book of series){const index=book.chapters.findIndex(c=>c.id===chapterId);if(index>=0)return {book,chapter:book.chapters[index],index};}
 return null;
}
export function readingRecord(progress,id){
 progress.readings||={};
 const record=progress.readings[id]||={paragraph:0,done:false,answers:{},note:''};
 return record;
}
export function readingQuestions(chapter){return (chapter.questions||[]).map(q=>({...q,type:'choice'}));}
export function gradeReading(chapter,record,now=Date.now()){
 const questions=readingQuestions(chapter);
 const result=gradeQuestions(questions,record.answers);
 if(result.unanswered)return null;
 record.submittedAnswers=structuredClone(record.answers);record.result=result;record.gradedAt=now;return result;
}
// Imported feedback is not authoritative. Match question IDs, then regrade the
// saved submission so an old or malformed result cannot break a reading page.
export function validatedReadingResult(chapter,record){
 const questions=readingQuestions(chapter),items=record.result?.items,answers=record.submittedAnswers;
 if(!questions.length||!Array.isArray(items)||items.length!==questions.length||!answers||typeof answers!=='object'||Array.isArray(answers))return null;
 const ids=new Set(items.map(item=>item&&typeof item.id==='string'?item.id:null));
 if(ids.size!==questions.length||!questions.every(q=>ids.has(q.id)&&Number.isInteger(answers[q.id])&&answers[q.id]>=0&&answers[q.id]<q.options.length))return null;
 const result=gradeQuestions(questions,answers);return result.unanswered?null:result;
}
export function readingContext(book,chapter,record){
 return {storyTitle:book.title,chapterTitle:chapter.title,level:book.level,paragraphs:chapter.paragraphs,
  vocabulary:chapter.vocabulary,questions:chapter.questions,answers:record.submittedAnswers||{},result:validatedReadingResult(chapter,record),note:record.note||''};
}
