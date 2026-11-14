// Shared by lesson playback, draft collection and authoritative server grading.
export function dictationAnswer(task){return typeof task.dictation==='string'?task.dictation:task.dictation?.answer||task.script;}
export function listeningQuestions(lesson,task){return (task.questions||[]).filter(q=>!(lesson.quiz||[]).some(x=>x.id===q.id));}
export function listenTasks(lesson){
 if(lesson.listening?.length)return lesson.listening;
 const examples=(lesson.sections||[]).flatMap(s=>s.examples||[]).slice(0,4).map((x,i)=>({id:lesson.id+'-listening-'+i,title:'例句听写 '+(i+1),script:x.ja,translation:x.zh,questions:[]}));
 return lesson.textbook?[{id:lesson.id+'-textbook-listening',title:'课文精听 · '+lesson.textbook.title,script:lesson.textbook.paragraphs.map(p=>p.ja).join('\n'),translation:lesson.textbook.paragraphs.map(p=>p.zh).join('\n'),questions:[]},...examples]:examples;
}
