import {readingForm} from './learning-core.js';
export const wordKey=word=>String(word.word).normalize('NFKC')+'|'+readingForm(word.reading);
export const PROGRAMS=[
 {id:'jlpt',title:'JLPT 考试',icon:'級',description:'从 N5 到 N1，按级别、主题章节和教材小节循序学习。',goal:'语言知识 · 阅读 · 听力'},
 {id:'business',title:'商务日语',icon:'礼',description:'从关系与敬语出发，完成职场协作、客户沟通与商务表达。',goal:'敬语 · 邮件 · 会议 · 协商'},
 {id:'it',title:'IT 日语',icon:'⌘',description:'沿着项目工作流程，练习需求、开发、评审、测试和交付沟通。',goal:'需求 · 开发 · 质量 · 运维'}
];
export function placement(lesson){
 const c=lesson.curriculum;if(c&&PROGRAMS.some(p=>p.id===c.program)&&c.chapterId&&c.moduleId)return c.program==='jlpt'?{...c,chapterTitle:({n5:'N5 · 日语入门',n4:'N4 · 日常表达',n3:'N3 · 语境理解',n2:'N2 · 综合运用',n1:'N1 · 深入理解'})[c.chapterId]||c.chapterTitle}:c;
 const program=lesson.track==='business'?'business':lesson.track==='it'?'it':'jlpt';
 const chapterId=program==='jlpt'?lesson.level.toLowerCase():'essentials';
 return {program,chapterId,chapterTitle:program==='jlpt'?lesson.level+' · 系统学习':'基础与运用',moduleId:chapterId+'-'+lesson.track,moduleTitle:({foundation:'日语基础',grammar:'句型与表达',reading:'阅读理解',listening:'听力理解',business:'商务沟通',it:'IT 沟通'})[lesson.track]||'综合运用',order:0};
}
export const programHref=id=>'#program/'+encodeURIComponent(id);
export const chapterHref=c=>'#chapter/'+encodeURIComponent(c.program)+'/'+encodeURIComponent(c.chapterId);
export const moduleHref=c=>'#module/'+encodeURIComponent(c.program)+'/'+encodeURIComponent(c.chapterId)+'/'+encodeURIComponent(c.moduleId);
export function buildCurriculum(lessons){
 return PROGRAMS.map(program=>{
  const chapters=new Map();
  for(const lesson of lessons){const c=placement(lesson);if(c.program!==program.id)continue;
   if(!chapters.has(c.chapterId))chapters.set(c.chapterId,{id:c.chapterId,title:c.chapterTitle,program:program.id,chapterId:c.chapterId,order:Number(c.order)||0,modules:[],lessons:[]});
   const chapter=chapters.get(c.chapterId);let module=chapter.modules.find(m=>m.id===c.moduleId);
   if(!module){module={id:c.moduleId,title:c.moduleTitle,...c,lessons:[],order:Number(c.order)||0};chapter.modules.push(module);}
   module.order=Math.min(module.order,Number(c.order)||0);chapter.order=Math.min(chapter.order,Number(c.order)||0);module.lessons.push(lesson);chapter.lessons.push(lesson);
  }
  for(const c of chapters.values()){c.modules.sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));for(const m of c.modules)m.lessons.sort((a,b)=>(Number(placement(a).order)||0)-(Number(placement(b).order)||0));c.lessons=c.modules.flatMap(m=>m.lessons);}
  const list=[...chapters.values()];if(program.id==='jlpt')list.sort((a,b)=>['n5','n4','n3','n2','n1'].indexOf(a.id)-['n5','n4','n3','n2','n1'].indexOf(b.id));else list.sort((a,b)=>a.order-b.order);
  return {...program,chapters:list,lessons:list.flatMap(c=>c.lessons)};
 });
}
export function currentPlacement(route,lessons){
 if(route.startsWith('lesson/')){const lesson=lessons.find(l=>l.id===route.slice(7));return lesson?placement(lesson):null;}
 const [kind,program,chapterId,moduleId]=route.split('/');return ['program','chapter','module'].includes(kind)?{program,chapterId,moduleId}:null;
}
export function chapterProgress(lessons,records){const done=lessons.filter(l=>records[l.id]?.done).length;return {done,total:lessons.length,percent:lessons.length?Math.round(done/lessons.length*100):0};}
export function textbookWords(lessons,words){
 const result=[...words],known=new Set(words.map(wordKey));
 for(const lesson of lessons)for(const word of lesson.textbook?.vocabulary||[]){const key=wordKey(word);if(known.has(key))continue;known.add(key);result.push({id:'textbook-'+encodeURIComponent(key),word:word.word,reading:word.reading,meaning:word.meaning,level:lesson.level,source:'小节教材词汇',lessonId:lesson.id,senses:[],tags:['教材词汇']});}
 return result;
}
