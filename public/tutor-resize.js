export const TUTOR_WIDTH_KEY='kotoba-tutor-width';
const DEFAULT_WIDTH=340, MIN_WIDTH=300, MAX_WIDTH=760, MIN_CONTENT=400, DOCK_BREAKPOINT=700;

/** Preference and visible width are separate: shrinking the window never
 * overwrites the width that should return when the window becomes wider. */
export function tutorWidthLayout(viewportWidth,preferredWidth=DEFAULT_WIDTH,opened=true,availableWidth=viewportWidth){
  const viewport=Math.max(0,Number(viewportWidth)||0);
  const available=Number(availableWidth),usable=Number.isFinite(available)&&available>0?Math.min(viewport,available):viewport;
  const requested=Number(preferredWidth);
  const preference=Number.isFinite(requested)?Math.min(MAX_WIDTH,Math.max(MIN_WIDTH,requested)):DEFAULT_WIDTH;
  const mobile=viewport<=DOCK_BREAKPOINT;
  // Around the desktop breakpoint a scrollbar may leave slightly less than
  // 700px. The content guarantee takes priority over the approximate 300px rail.
  const minimum=mobile?MIN_WIDTH:Math.min(MIN_WIDTH,Math.max(0,usable-MIN_CONTENT));
  const maximum=mobile?MAX_WIDTH:Math.max(minimum,Math.min(MAX_WIDTH,usable-MIN_CONTENT));
  const width=Math.round(Math.max(minimum,Math.min(maximum,preference)));
  const sidebar=viewport<=1200?220:246;
  return {width,minimum,maximum:Math.floor(maximum),mobile,wideLayout:!!opened&&!mobile&&viewport>1100&&usable-sidebar-width<MIN_CONTENT};
}

export function installTutorResize({panel,handle,win=globalThis.window,doc=globalThis.document}={}){
  if(!panel||!handle||!win||!doc?.documentElement)throw new TypeError('调整助教宽度需要面板、边界和窗口。');
  const root=doc.documentElement,body=doc.body;
  const previousWidth=root.style.getPropertyValue('--tutor-width'),previousPriority=root.style.getPropertyPriority('--tutor-width');
  const originalAttributes=new Map(['hidden','aria-valuemin','aria-valuemax','aria-valuenow','aria-valuetext','aria-label','title'].map(name=>[name,handle.getAttribute(name)]));
  let preferred=DEFAULT_WIDTH,destroyed=false,drag=null,layout=tutorWidthLayout(win.innerWidth);
  try{const saved=Number(win.localStorage.getItem(TUTOR_WIDTH_KEY));if(Number.isFinite(saved)&&saved>0)preferred=Math.max(MIN_WIDTH,Math.min(MAX_WIDTH,saved));}catch{}
  handle.setAttribute('aria-label','调整 AI 助教宽度');
  handle.title='拖动调整宽度；← 加宽，→ 缩窄，Home 最窄，End 最宽；双击恢复默认';
  function persist(){try{win.localStorage.setItem(TUTOR_WIDTH_KEY,String(preferred));}catch{}}
  function isOpen(){return body.classList.contains('tutor-open')&&!panel.hidden;}
  function availableWidth(){return root.clientWidth>0?Math.min(root.clientWidth,win.innerWidth):win.innerWidth;}
  function refresh(){
    if(destroyed)return;
    const opened=isOpen();layout=tutorWidthLayout(win.innerWidth,preferred,opened,availableWidth());
    root.style.setProperty('--tutor-width',layout.width+'px');
    body.classList.toggle('tutor-wide-layout',layout.wideLayout);
    handle.hidden=layout.mobile||!opened;
    handle.setAttribute('aria-valuemin',String(layout.minimum));handle.setAttribute('aria-valuemax',String(layout.maximum));
    handle.setAttribute('aria-valuenow',String(layout.width));handle.setAttribute('aria-valuetext',layout.width+' 像素');
    if(drag&&(layout.mobile||!opened))endDrag();
  }
  function update(value){
    const next=tutorWidthLayout(win.innerWidth,value,isOpen(),availableWidth());preferred=next.width;refresh();
  }
  function endDrag(){
    if(!drag)return;
    const previous=drag;drag=null;
    win.removeEventListener('pointermove',move,true);win.removeEventListener('pointerup',up,true);win.removeEventListener('pointercancel',cancel,true);win.removeEventListener('blur',cancel);
    body.classList.remove('tutor-resizing');
    try{if(handle.hasPointerCapture?.(previous.id))handle.releasePointerCapture(previous.id);}catch{}
    if(!destroyed)persist();
  }
  function move(event){
    if(!drag||event.pointerId!==drag.id)return;
    if(!Number.isFinite(event.clientX))return;
    event.preventDefault();update(drag.width+drag.x-event.clientX);
  }
  function up(event){if(drag&&event.pointerId===drag.id)endDrag();}
  function cancel(event){if(!event||event.type==='blur'||(drag&&event.pointerId===drag.id))endDrag();}
  function start(event){
    if(destroyed||event.button!==0||event.isPrimary===false||!Number.isFinite(event.clientX))return;
    refresh();if(handle.hidden)return;
    event.preventDefault();endDrag();
    drag={id:event.pointerId,x:event.clientX,width:layout.width};body.classList.add('tutor-resizing');
    win.addEventListener('pointermove',move,{capture:true,passive:false});win.addEventListener('pointerup',up,true);win.addEventListener('pointercancel',cancel,true);win.addEventListener('blur',cancel);
    try{handle.setPointerCapture(event.pointerId);}catch{/* Window listeners still cover ordinary same-page drags. */}
    handle.focus({preventScroll:true});
  }
  function key(event){
    if(destroyed)return;
    refresh();if(handle.hidden)return;
    if(event.key==='Escape'&&drag){event.preventDefault();endDrag();return;}
    const next={ArrowLeft:layout.width+20,ArrowRight:layout.width-20,Home:layout.minimum,End:layout.maximum}[event.key];
    if(next===undefined)return;
    event.preventDefault();endDrag();update(next);persist();
  }
  function reset(event){refresh();if(handle.hidden)return;event.preventDefault();endDrag();preferred=DEFAULT_WIDTH;refresh();persist();}
  function viewportChanged(){endDrag();refresh();}
  handle.addEventListener('pointerdown',start);handle.addEventListener('lostpointercapture',cancel);handle.addEventListener('keydown',key);handle.addEventListener('dblclick',reset);
  win.addEventListener('resize',viewportChanged);
  refresh();
  return {
    refresh,
    destroy(){
      if(destroyed)return;destroyed=true;endDrag();
      handle.removeEventListener('pointerdown',start);handle.removeEventListener('lostpointercapture',cancel);handle.removeEventListener('keydown',key);handle.removeEventListener('dblclick',reset);win.removeEventListener('resize',viewportChanged);
      body.classList.remove('tutor-wide-layout','tutor-resizing');
      if(previousWidth)root.style.setProperty('--tutor-width',previousWidth,previousPriority);else root.style.removeProperty('--tutor-width');
      for(const [name,value] of originalAttributes){if(value===null)handle.removeAttribute(name);else handle.setAttribute(name,value);}
    }
  };
}
