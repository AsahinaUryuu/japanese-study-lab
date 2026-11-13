// Keep complete submissions once in a follow-up request. Full feedback stays local.
export function reviewContext(review){
 const result=structuredClone(review);
 delete result.assignmentAnswers;
 if(result.mode==='section'&&result.task?.kind==='section-assignment')delete result.submission;
 const fullReply=typeof result.reply==='string'?result.reply:'';
 const excerpt=length=>{
  if(length>=fullReply.length){result.reply=fullReply;delete result.replyExcerpt;delete result.excerptNote;return;}
  const head=Math.floor(length*.8);
  result.reply=fullReply.slice(0,head)+'\n[中间内容因上下文长度省略]\n'+fullReply.slice(fullReply.length-(length-head));
  result.replyExcerpt=true;
  result.excerptNote='这是原评阅的首尾摘录，完整反馈仍在学习页面中。请只依据所给原始作答与反馈解释，不要假定省略部分的具体内容。';
 };
 let low=0,high=Math.min(fullReply.length,24000);
 excerpt(high);
 if(JSON.stringify(result).length<=63000)return result;
 while(low<high){const mid=Math.ceil((low+high)/2);excerpt(mid);if(JSON.stringify(result).length<=63000)low=mid;else high=mid-1;}
 excerpt(low);
 return result;
}
