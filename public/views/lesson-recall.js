import {e,button} from '../ui.js';

const optionLabel=index=>index<26?String.fromCharCode(65+index):String(index+1);
const missing=value=>value==null||typeof value==='string'&&!value.trim();
const boundDisclosures=new WeakSet();

export function submittedAnswerText(question,answers={}){
 const value=answers[question.id];
 if(missing(value))return '未作答';
 if(question.type!=='choice')return String(value);
 if(Number.isInteger(value)&&value>=0&&value<question.options.length)
  return optionLabel(value)+' · '+question.options[value];
 return '原记录的选项值：'+String(value)+'（无法匹配原选项）';
}

// The caller supplies the submitted question snapshot and submitted answers.
// This read-only view never regrades against a newer course or editable drafts.
export function questionFeedbackHTML(question,item,index,answers={}){
 const own=answers[question.id],answer=question.unavailable?'旧记录未保留参考答案':question.type==='choice'?
  optionLabel(question.answer)+' · '+question.options[question.answer]:question.answer;
 return `<article class="feedback-item recall-feedback ${item.correct?'':'wrong'}" data-feedback-question="${e(question.id)}">
  <h3>${item.correct?'✓':'○'} 第 ${index+1} 题 · ${item.correct?'理解正确':item.unanswered?'尚未作答':'再想一想'}</h3>
  <p class="recall-original-prompt">${e(question.prompt)}</p>
  ${question.type==='choice'?`<ol class="recall-options" aria-label="本次提交时的原题选项">${question.options.map((option,i)=>`<li class="${own===i?'is-submitted':''}"><span class="recall-option-label">${optionLabel(i)}.</span><span>${e(option)}</span>${own===i?'<small>你的选择</small>':''}</li>`).join('')}</ol>`:''}
  <div class="recall-submission"><b>你的提交</b><p>${e(submittedAnswerText(question,answers))}</p></div>
  <details class="recall-answer" data-feedback-answer><summary>查看参考答案与解析</summary>
   <div class="recall-reference"><b>参考答案</b><p>${e(answer)}</p></div>
   <div class="recall-explanation"><b>为什么这样回答</b><p>${e(question.explanation||'本题暂无补充解析。')}</p></div>
  </details>
 </article>`;
}

export function feedbackToolsHTML(){
 return `<div class="recall-feedback-tools"><p class="hint">先对照原题和自己的提交，想一想理由，再展开参考答案。展开与收起不会改变分数。</p>${button('展开本页答案与解析','toggle-feedback-answers','aria-expanded="false"','small')}</div>`;
}

export function syncFeedbackTools(root){
 const details=[...root.querySelectorAll('[data-feedback-answer]')];
 const allOpen=details.length>0&&details.every(node=>node.open);
 for(const control of root.querySelectorAll('[data-action="toggle-feedback-answers"]')){
  control.textContent=allOpen?'收起本页答案与解析':'展开本页答案与解析';
  control.setAttribute('aria-expanded',String(allOpen));
  control.disabled=!details.length;
 }
 return allOpen;
}

export function bindFeedbackTools(root){
 for(const detail of root.querySelectorAll('[data-feedback-answer]')){
  if(boundDisclosures.has(detail))continue;
  boundDisclosures.add(detail);
  detail.addEventListener('toggle',()=>syncFeedbackTools(root));
 }
 syncFeedbackTools(root);
}

export function toggleFeedbackAnswers(root){
 const open=!syncFeedbackTools(root);
 for(const detail of root.querySelectorAll('[data-feedback-answer]'))detail.open=open;
 syncFeedbackTools(root);
 return open;
}

export function toggleDeepTranslation(control){
 const example=control.closest('.example');
 const translation=example?.querySelector('[data-deep-translation]');
 if(!translation)return false;
 translation.hidden=!translation.hidden;
 control.textContent=translation.hidden?'显示中文对照':'隐藏中文对照';
 control.setAttribute('aria-expanded',String(!translation.hidden));
 return true;
}
