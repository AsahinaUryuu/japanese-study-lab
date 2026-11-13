export const LEVELS=['N5','N4','N3','N2','N1'];
export const STAGES=[['learn','课文与讲解'],['words','课内词汇'],['quiz','客观练习'],['feedback','答题反馈'],['translate','双向翻译'],['listen','听力听写'],['speak','口语输出'],['summary','小节统一评阅']];
export const TRACKS={foundation:'发音与基础',grammar:'语法精讲',business:'商务与敬语',reading:'分级阅读',listening:'听力理解',it:'IT 日语'};
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function normalizeAnswer(value){return String(value??'').normalize('NFKC').trim().replace(/\s+/g,'').replace(/[。．.!！?？]+$/g,'');}
export function readingForm(value){return normalizeAnswer(value).replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));}
export function gradeQuestions(questions,answers={}){
  const items=questions.map(q=>{const a=answers[q.id],unanswered=a===undefined||a===null||typeof a==='string'&&!a.trim();
    const correct=!unanswered&&(q.type==='choice'?Number.isInteger(a)&&a===q.answer:[q.answer,...(q.accepted||[])].some(x=>normalizeAnswer(x)===normalizeAnswer(a)));
    return {id:q.id,correct,unanswered,answer:a??null};});
  const correct=items.filter(x=>x.correct).length;return {items,correct,total:items.length,unanswered:items.filter(x=>x.unanswered).length,score:items.length?Math.round(100*correct/items.length):0};
}
export function scheduleReview(previous={},rating,now=Date.now()){
  if(!['again','hard','good','easy'].includes(rating))throw new TypeError('无效复习等级');
  let interval=Number(previous.interval)||0,ease=Number(previous.ease)||2.5,streak=Number(previous.streak)||0,lapses=Number(previous.lapses)||0;
  if(rating==='again'){interval=0;streak=0;lapses++;ease=Math.max(1.3,ease-.2);}
  if(rating==='hard'){interval=Math.max(1,Math.round(interval*1.2));ease=Math.max(1.3,ease-.15);streak++;}
  if(rating==='good'){interval=streak===0?1:streak===1?3:Math.max(4,Math.round(interval*ease));streak++;}
  if(rating==='easy'){interval=Math.max(4,Math.round((interval||1)*ease*1.3));ease=Math.min(3,ease+.15);streak++;}
  return {interval,ease,streak,lapses,reviews:(previous.reviews||0)+1,lastReviewed:now,due:now+(rating==='again'?10*60000:interval*86400000)};
}
export function recallQueue(words,records={},level='all',limit=20,now=Date.now()){
  const candidates=words.filter(w=>level==='all'||w.level===level),due=candidates.filter(w=>records[w.id]&&records[w.id].due<=now).sort((a,b)=>records[a.id].due-records[b.id].due),fresh=candidates.filter(w=>!records[w.id]);return [...due,...fresh].slice(0,Math.max(1,Math.min(100,limit)));
}
export function shuffle(items,random=Math.random){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
export function compareDictation(expected,actual){
  const a=[...readingForm(expected).replace(/[、,「」『』（）()]/g,'')].slice(0,1500),b=[...readingForm(actual).replace(/[、,「」『』（）()]/g,'')].slice(0,1500);
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));previous=row;}
  const distance=previous[b.length];return {similarity:a.length||b.length?Math.max(0,Math.round(100*(1-distance/Math.max(a.length,b.length)))):100,distance,expectedLength:a.length,actualLength:b.length};
}
export function newProgress(){return {version:1,lessons:{},words:{},bookmarks:[],threads:{},notes:{},exams:[],activity:{},workDrafts:{},workReviews:[],activeExam:null,reviewSession:null,settings:{dailyWords:20,fontSize:17,showReading:true,showFurigana:true,speechRate:.9},lastLesson:null,readings:{},lastReading:null,novelLast:null,novelPositions:{}};}
// JSON object key order is not meaningful. A keepalive write may have reached
// disk before reload while the recovery copy still carries the old revision.
export function sameProgress(a,b){
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);if(keys.length!==Object.keys(b).length)return false;
  return keys.every(key=>Object.hasOwn(b,key)&&sameProgress(a[key],b[key]));
}
export function normalizeProgress(data){
  if(!data||typeof data!=='object'||Array.isArray(data)||data.version!==1)throw new TypeError('不是言葉学习记录文件');
  // Reject object-prototype keys at every depth before imported dictionaries are used.
  data=JSON.parse(JSON.stringify(data),(key,value)=>{if(['__proto__','constructor','prototype'].includes(key))throw new TypeError('学习记录包含无效字段');return value;});
  const p=newProgress();for(const key of ['lessons','words','threads','notes','activity','workDrafts'])if(data[key]&&typeof data[key]==='object'&&!Array.isArray(data[key]))p[key]=data[key];
  p.bookmarks=Array.isArray(data.bookmarks)?data.bookmarks.filter(x=>typeof x==='string').slice(0,10000):[];p.exams=Array.isArray(data.exams)?data.exams.slice(-100):[];
  p.workReviews=Array.isArray(data.workReviews)?data.workReviews.slice(-30):[];
  if(data.activeExam&&Array.isArray(data.activeExam.questions)&&data.activeExam.answers&&Number.isFinite(data.activeExam.endsAt))p.activeExam=data.activeExam;
  if(data.reviewSession&&Array.isArray(data.reviewSession.ids)&&Number.isInteger(data.reviewSession.index))p.reviewSession=data.reviewSession;
  for(const [id,l] of Object.entries(p.lessons)){if(!l||typeof l!=='object'||Array.isArray(l)){delete p.lessons[id];continue;}l.answers=l.answers&&typeof l.answers==='object'?l.answers:{};l.drafts=l.drafts&&typeof l.drafts==='object'?l.drafts:{};l.reviews=Array.isArray(l.reviews)?l.reviews.slice(-30):[];}
  for(const [id,t] of Object.entries(p.threads)){if(!t||typeof t!=='object'){delete p.threads[id];continue;}t.messages=Array.isArray(t.messages)?t.messages.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').slice(-20):[];t.draft=typeof t.draft==='string'?t.draft.slice(0,4000):'';}
  p.settings={...p.settings,...(data.settings||{})};p.settings.showFurigana=p.settings.showFurigana!==false;p.settings.dailyWords=Math.max(5,Math.min(100,Number(p.settings.dailyWords)||20));p.settings.fontSize=Math.max(14,Math.min(26,Number(p.settings.fontSize)||17));p.settings.speechRate=Math.max(.5,Math.min(1.4,Number(p.settings.speechRate)||.9));p.lastLesson=typeof data.lastLesson==='string'?data.lastLesson:null;
  p.lastReading=typeof data.lastReading==='string'?data.lastReading:null;
  if(data.novelLast&&['bookId','chapterId'].every(k=>typeof data.novelLast[k]==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(data.novelLast[k])))p.novelLast={bookId:data.novelLast.bookId,chapterId:data.novelLast.chapterId};
  if(data.novelPositions&&typeof data.novelPositions==='object'&&!Array.isArray(data.novelPositions))for(const [bookId,chapterId] of Object.entries(data.novelPositions).slice(0,5000)){
    if(/^[a-zA-Z0-9_-]{1,200}$/.test(bookId)&&typeof chapterId==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(chapterId))p.novelPositions[bookId]=chapterId;
  }
  if(p.novelLast&&!p.novelPositions[p.novelLast.bookId])p.novelPositions[p.novelLast.bookId]=p.novelLast.chapterId;
  if(data.readings&&typeof data.readings==='object'&&!Array.isArray(data.readings))for(const [id,r] of Object.entries(data.readings).slice(0,20000)){
    if(!r||typeof r!=='object'||Array.isArray(r))continue;
    p.readings[id]={paragraph:Math.max(0,Math.min(10000,Math.floor(Number(r.paragraph)||0))),done:r.done===true,answers:r.answers&&typeof r.answers==='object'&&!Array.isArray(r.answers)?r.answers:{},note:typeof r.note==='string'?r.note.slice(0,10000):''};
    if(r.result&&Array.isArray(r.result.items)){p.readings[id].result=r.result;p.readings[id].submittedAnswers=r.submittedAnswers&&typeof r.submittedAnswers==='object'?r.submittedAnswers:{};p.readings[id].gradedAt=Number(r.gradedAt)||0;}
    if(Number.isInteger(r.bookmark)&&r.bookmark>=0)p.readings[id].bookmark=Math.min(10000,r.bookmark);
    if(r.completedAt)p.readings[id].completedAt=Number(r.completedAt)||null;
  }
  return p;
}
export function makeVocabularyQuestions(words,count=10){
  const readingsByWord=new Map();for(const w of words){if(!readingsByWord.has(w.word))readingsByWord.set(w.word,new Set());readingsByWord.get(w.word).add(w.reading);}
  // Exclude homographs such as 生物 when the bare word has several valid readings.
  const unique=[...new Map(words.filter(w=>readingsByWord.get(w.word).size===1&&w.word!==w.reading).map(w=>[w.word+'|'+w.reading,w])).values()];
  return shuffle(unique).slice(0,count).map((w,index)=>{
    const readings=[...new Set(unique.map(x=>x.reading).filter(x=>x&&x!==w.reading))];
    const options=shuffle([w.reading,...shuffle(readings).slice(0,3)]);
    return {id:'vquiz-'+w.id,type:'choice',prompt:`「${w.word}」的读音是什么？`,options,answer:options.indexOf(w.reading),explanation:`${w.word}（${w.reading}）：${w.meaning}`,wordId:w.id};
  }).filter(q=>q.options.length>=2);
}
