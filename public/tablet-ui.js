export function viewportMetrics(width,height,visualHeight=height,offsetTop=0){
 const w=Math.max(0,Number(width)||0),h=Math.max(0,Number(height)||0),visible=Math.max(0,Math.min(h,Number(visualHeight)||h));
 return {drawer:w<=1210,compact:w<=700,height:visible,top:Math.max(0,Number(offsetTop)||0),keyboard:h-visible>140};
}
export function firstUnanswered(questions){return questions.findIndex(q=>!q.answered);}

export function installTabletUI({getStore=()=>null,toast=()=>{}}={}){
 const doc=document,win=window,body=doc.body,main=doc.querySelector('#main'),workspace=doc.querySelector('.workspace'),sidebar=doc.querySelector('.sidebar'),menu=doc.querySelector('.mobile-menu');
 const backdrop=doc.createElement('button');backdrop.className='navigation-backdrop';backdrop.type='button';backdrop.tabIndex=-1;backdrop.setAttribute('aria-label','关闭学习目录');backdrop.hidden=true;body.append(backdrop);
 const actions=doc.createElement('div');actions.className='tablet-reading-actions';actions.innerHTML='<button type="button" data-focus-reading aria-pressed="false" title="收起学习装饰，专注正文">专注阅读</button><button type="button" data-page-top hidden aria-label="返回本页顶部">↑ 顶部</button><button type="button" data-dismiss-keyboard hidden>收起键盘</button>';
 doc.querySelector('.topbar').append(actions);
 const announcer=doc.createElement('span');announcer.className='sr-only';announcer.setAttribute('role','status');announcer.setAttribute('aria-live','polite');body.append(announcer);
 const progress=doc.createElement('div');progress.className='page-reading-progress';progress.setAttribute('aria-hidden','true');progress.innerHTML='<i></i>';workspace.prepend(progress);
 let menuOpen=false,focusReading=false,lastTitle='',frame=0;
 try{focusReading=localStorage.getItem('kotoba-focus-reading')==='true';}catch{}
 function setFocus(value){focusReading=!!value;body.classList.toggle('focus-reading',focusReading);sidebar.inert=(win.innerWidth<=1210||focusReading)&&!menuOpen;actions.querySelector('[data-focus-reading]').setAttribute('aria-pressed',String(focusReading));actions.querySelector('[data-focus-reading]').textContent=focusReading?'退出专注':'专注阅读';try{localStorage.setItem('kotoba-focus-reading',String(focusReading));}catch{}}
 setFocus(focusReading);
 function setMenu(value,restore=false){menuOpen=!!value;body.classList.toggle('menu-open',menuOpen);backdrop.hidden=!menuOpen;sidebar.inert=!menuOpen&&(win.innerWidth<=1210||focusReading);workspace.inert=menuOpen;doc.querySelector('#tutor-panel')?.toggleAttribute('inert',menuOpen);menu.setAttribute('aria-expanded',String(menuOpen));if(menuOpen){sidebar.querySelector('.sidebar-close')?.focus();}else if(restore)menu.focus({preventScroll:true});}
 menu.onclick=()=>setMenu(!menuOpen);sidebar.querySelector('.sidebar-close').onclick=()=>setMenu(false,true);backdrop.onclick=()=>setMenu(false,true);
 sidebar.addEventListener('click',event=>{if(event.target.closest('a[href^="#"]'))setMenu(false);});
 doc.addEventListener('keydown',event=>{
  if(!menuOpen)return;
  if(event.key==='Escape'){event.preventDefault();setMenu(false,true);return;}
  if(event.key==='Tab'){
   const list=[...sidebar.querySelectorAll('a[href],button:not(:disabled),summary')].filter(el=>el.getClientRects().length),first=list[0],last=list.at(-1);
   if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus();}
  }
 });
 function viewport(){const vv=win.visualViewport,m=viewportMetrics(win.innerWidth,win.innerHeight,vv?.height,vv?.offsetTop);doc.documentElement.style.setProperty('--visible-height',m.height+'px');doc.documentElement.style.setProperty('--viewport-top',m.top+'px');body.classList.toggle('soft-keyboard-open',m.keyboard);if(!m.drawer&&menuOpen)setMenu(false);sidebar.inert=(m.drawer||focusReading)&&!menuOpen;actions.querySelector('[data-dismiss-keyboard]').hidden=!m.keyboard;}
 win.addEventListener('resize',viewport);win.visualViewport?.addEventListener('resize',viewport);win.visualViewport?.addEventListener('scroll',viewport);viewport();
 function scrollElement(){return getComputedStyle(workspace).overflowY==='auto'?workspace:doc.scrollingElement;}
 function scrollState(){const el=scrollElement(),max=el.scrollHeight-el.clientHeight;progress.firstElementChild.style.width=(max>0?Math.min(100,el.scrollTop/max*100):0)+'%';actions.querySelector('[data-page-top]').hidden=el.scrollTop<500;}
 win.addEventListener('scroll',scrollState,{passive:true});workspace.addEventListener('scroll',scrollState,{passive:true});
 actions.addEventListener('click',event=>{if(event.target.closest('[data-focus-reading]'))setFocus(!focusReading);if(event.target.closest('[data-page-top]'))scrollElement().scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});if(event.target.closest('[data-dismiss-keyboard]'))doc.activeElement?.blur();});
 function questions(){return [...main.querySelectorAll('.question')].map(el=>({el,answered:el.querySelector('input[type=radio]')?!!el.querySelector('input:checked'):[...el.querySelectorAll('input[type=text]')].some(input=>input.value.trim())}));}
 function quizStatus(){const rows=questions(),bar=main.querySelector('.quiz-position-tools');if(!bar)return;const count=rows.filter(q=>q.answered).length;bar.querySelector('span').textContent=`已答 ${count} / ${rows.length} 题`;bar.querySelector('button').disabled=count===rows.length;for(const row of rows)row.el.classList.toggle('question-answered',row.answered);}
 function enhance(){
  const title=main.querySelector('h1')?.textContent?.trim();if(title&&title!==lastTitle){lastTitle=title;doc.title=title+' · 言葉';announcer.textContent='已打开：'+title;}
  if(main.querySelector('.question')&&!main.querySelector('.quiz-position-tools')){const bar=doc.createElement('div');bar.className='quiz-position-tools';bar.innerHTML='<span role="status" aria-live="polite"></span><button type="button">跳到未答题</button>';const first=main.querySelector('.question');first.before(bar);bar.querySelector('button').onclick=()=>{const rows=questions(),index=firstUnanswered(rows);if(index<0)return;rows[index].el.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});rows[index].el.querySelector('input')?.focus({preventScroll:true});};}
  for(const field of main.querySelectorAll('input[type=search]')){if(!field.getAttribute('aria-label'))field.setAttribute('aria-label',field.placeholder||'搜索');field.enterKeyHint='search';}
  for(const field of main.querySelectorAll('textarea')){field.setAttribute('autocapitalize','off');field.spellcheck=false;}
  for(const table of main.querySelectorAll('table')){if(!table.parentElement.classList.contains('table-wrap')){const wrap=doc.createElement('div');wrap.className='table-wrap';table.before(wrap);wrap.append(table);}table.parentElement.tabIndex=0;table.parentElement.setAttribute('role','region');table.parentElement.setAttribute('aria-label','可横向滚动的数据表');}
  quizStatus();scrollState();
 }
 main.addEventListener('input',quizStatus);main.addEventListener('change',quizStatus);
 new MutationObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(enhance);}).observe(main,{childList:true});
 win.addEventListener('hashchange',()=>{setMenu(false);workspace.scrollTop=0;});
 // Retain drafts before iPad Safari suspends or returns the page to its cache.
 doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='hidden')void getStore()?.flush();});
 win.addEventListener('pageshow',()=>{viewport();scrollState();});
 enhance();
 return {refresh:enhance};
}
