const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ratings={relearn:'还需要重新理解',explain:'能够用自己的话解释',apply:'能够独立举例运用'};
const stamp=value=>Number.isSafeInteger(value)&&value>0&&value<8640000000000000?value:0;
export function normalizeStudyCheck(value){
 const v=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 return {reflection:typeof v.reflection==='string'?v.reflection.slice(0,3000):'',rating:Object.hasOwn(ratings,v.rating)?v.rating:'',ratedAt:stamp(v.ratedAt),dueAt:stamp(v.dueAt),reviewedAt:stamp(v.reviewedAt)};
}
export function updateStudyCheck(value,action,payload,now=Date.now()){
 const next=normalizeStudyCheck(value);if(!stamp(now))throw new TypeError('无效日期');
 if(action==='reflection')next.reflection=String(payload??'').slice(0,3000);
 else if(action==='rating'){if(!Object.hasOwn(ratings,payload))throw new TypeError('无效自评');next.rating=payload;next.ratedAt=now;}
 else if(action==='schedule'){if(![1,3,7,14].includes(payload))throw new TypeError('无效复习间隔');const due=new Date(now);due.setDate(due.getDate()+payload);next.dueAt=due.getTime();}
 else if(action==='reviewed'){next.reviewedAt=now;next.dueAt=0;}
 else if(action==='cancel')next.dueAt=0;
 else throw new TypeError('无效自检操作');
 return next;
}
const when=value=>new Date(value).toLocaleString('zh-CN',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'});
export function studyCheckMarkup(value,{goals=[],kind='frontend'}={}){
 const s=normalizeStudyCheck(value),prompts=(Array.isArray(goals)?goals:[]).filter(x=>typeof x==='string'&&x.trim()).slice(0,3);
 return `<section class="study-check" aria-label="学习自检与复习安排"><h3>合上教材，做一次自检</h3><p>先尝试回忆，再展开本课参考内容对照。这里是你的自评，不改变测验分数或完成标记。</p>${prompts.length?`<ul>${prompts.map(x=>`<li>${escape(x)}</li>`).join('')}</ul>`:''}<ol><li>用自己的话说明核心概念、用法与适用条件。</li><li>${kind==='japanese'?'换一个人物关系或工作场景，独立写一句日语。':'换一个输入或使用场景，预测代码结果并验证。'}</li><li>说明一道错题为什么错，或记录仍不确定的地方。</li></ol><label>我的回忆与例子<textarea data-study-reflection maxlength="3000" rows="4" placeholder="核心意思：\n我自己的例子：\n仍有疑问：">${escape(s.reflection)}</textarea></label><div class="study-ratings" role="group" aria-label="当前理解程度">${Object.entries(ratings).map(([key,title])=>`<button type="button" data-study-rating="${key}" aria-pressed="${s.rating===key}">${title}</button>`).join('')}</div><h4>安排下一次回顾</h4><p>按自己的需要选择时间；到期课程会显示在学习回顾中心，不发送系统通知。</p><div class="study-schedule">${[1,3,7,14].map(days=>`<button type="button" data-study-days="${days}">${days===1?'明天':days+' 天后'}再看</button>`).join('')}<button type="button" data-study-action="reviewed">今天已完成回顾</button>${s.dueAt?'<button type="button" data-study-action="cancel">取消这次安排</button>':''}</div><p class="study-check-status" role="status" aria-live="polite">${s.dueAt?'下次回顾：'+escape(when(s.dueAt)):s.reviewedAt?'上次回顾：'+escape(when(s.reviewedAt))+'；可重新安排下一次。':'尚未安排回顾。'}${s.rating?' · 自评：'+ratings[s.rating]:''}</p><small>回忆文字、自评与安排随学习记录保存；不会自动发送给模型。</small></section>`;
}
export function bindStudyCheck(host,{record,save,goals=[],kind='frontend'}={}){
 if(!host)return;
 const render=()=>host.innerHTML=studyCheckMarkup(record.studyCheck,{goals,kind});render();
 host.addEventListener('input',event=>{if(!event.target.matches('[data-study-reflection]'))return;record.studyCheck=updateStudyCheck(record.studyCheck,'reflection',event.target.value);save();});
 host.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;let action,payload,selector;
  if(button.dataset.studyRating){action='rating';payload=button.dataset.studyRating;selector=`[data-study-rating="${payload}"]`;}
  else if(button.dataset.studyDays){action='schedule';payload=Number(button.dataset.studyDays);selector=`[data-study-days="${payload}"]`;}
  else if(button.dataset.studyAction){action=button.dataset.studyAction;selector='[data-study-action="reviewed"]';}else return;
  record.studyCheck=updateStudyCheck(record.studyCheck,action,payload);save();render();host.querySelector(selector)?.focus();
 });
}
export function scheduledReviews(lessons,records,now=Date.now()){
 return lessons.flatMap(lesson=>{const s=normalizeStudyCheck(records?.[lesson.id]?.studyCheck);return s.dueAt?[{id:lesson.id,title:lesson.tutorial?.title||lesson.title||lesson.id,dueAt:s.dueAt,due:s.dueAt<=now,rating:s.rating}]:[];}).sort((a,b)=>a.dueAt-b.dueAt||a.id.localeCompare(b.id));
}
export function studyQueueMarkup(lessons,records,{kind='frontend',now=Date.now()}={}){
 const rows=scheduledReviews(lessons,records,now),due=rows.filter(x=>x.due).length;
 return `<details class="study-queue"><summary>复习安排 · ${due} 课已到期 · ${rows.length-due} 课待回顾</summary><p>安排来自每课总结中的学习自检。打开课程并完成回忆后，可点击“今天已完成回顾”。</p>${rows.length?`<ul>${rows.slice(0,50).map(row=>`<li><div><strong>${escape(row.title)}</strong><small>${row.due?'已到期':'待回顾'} · ${escape(when(row.dueAt))}${row.rating?' · '+ratings[row.rating]:''}</small></div><a href="#lesson/${encodeURIComponent(row.id)}?stage=${kind==='japanese'?'summary':'conclusion'}&check=1">开始回顾 →</a></li>`).join('')}</ul>${rows.length>50?`<p>按时间显示最早 50 课；完成后会继续显示后面的安排。</p>`:''}`:'<p>还没有安排。学完一课后，在总结里记录自己的理解，选择明天、3 天、7 天或 14 天后再看。</p>'}</details>`;
}
