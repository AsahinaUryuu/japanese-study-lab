const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const reasons={auto:'自动还原点',manual:'手动还原点','before-restore':'恢复前的记录'};
export function summarizeProgress(progress){
 const p=object(progress)?progress:{},japanese=object(p.lessons)&&p.version===1;
 const lessons=japanese?Object.values(p.lessons):Object.entries(p).filter(([key,value])=>!key.startsWith('_')&&object(value)).map(([,value])=>value);
 const completed=lessons.filter(x=>japanese?x.done:x.completed).length;
 const notes=japanese?[...Object.values(p.notes||{}),...Object.values(p.readings||{}).map(x=>x?.note)].filter(x=>typeof x==='string'&&x.trim()).length:lessons.filter(x=>typeof x.notes==='string'&&x.notes.trim()).length;
 const threads=japanese?Object.values(p.threads||{}):lessons.flatMap(x=>Object.values(x.tutorThreads||{}));
 return {japanese,lessons:lessons.length,completed,notes,messages:threads.reduce((n,t)=>n+(Array.isArray(t.messages)?t.messages.length:0),0),words:japanese?Object.keys(p.words||{}).length:0,readings:japanese?Object.keys(p.novelPositions||{}).length:0};
}
export function checkpointExport(snapshot){
 const p=snapshot.progress;
 return summarizeProgress(p).japanese?p:{version:1,exportedAt:snapshot.createdAt,progress:p};
}
export function installBackupManager({prepare=async()=>true,onRestored=async()=>location.reload()}={}){
 const dialog=document.createElement('dialog');dialog.className='backup-dialog';dialog.setAttribute('aria-labelledby','backup-title');
 dialog.innerHTML=`<header><div><h2 id="backup-title">学习记录还原点</h2><p>找回误清空或误导入前的记录</p></div><button type="button" class="backup-close" aria-label="关闭还原点">×</button></header><div class="backup-body"><p class="backup-help">保存旧记录时自动留存还原点；也可以手动创建。最多保留 20 份，总计不超过 80 MB，旧版本会轮换。只包含学习进度、草稿和对话，不包含模型密钥或小说原文件。</p><div class="backup-toolbar"><button type="button" data-backup-create>保存当前还原点</button><button type="button" data-backup-refresh>刷新列表</button></div><p class="backup-status" role="status" aria-live="polite"></p><div class="backup-list"></div><section class="backup-preview" hidden></section></div>`;
 document.body.append(dialog);
 let busy=false,ready=false,revision=0,selected=null,restored=false;
 const status=(message,error=false)=>{const el=dialog.querySelector('.backup-status');el.textContent=message;el.classList.toggle('error',error);};
 function controls(){for(const b of dialog.querySelectorAll('button'))b.disabled=busy;dialog.querySelector('[data-backup-create]').disabled=busy||!ready;const confirm=dialog.querySelector('[data-backup-confirm]');if(confirm)confirm.disabled=busy||!ready||!dialog.querySelector('[data-backup-ack]')?.checked;}
 async function request(route='',body){const response=await fetch('/api/progress/history'+route,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});let value;try{value=await response.json();}catch{throw new Error('还原点服务未返回有效数据，请确认软件已更新。');}if(!response.ok){const error=new Error(value.error||'还原点操作失败');error.status=response.status;throw error;}return value;}
 async function run(operation){if(busy)return;busy=true;controls();try{await operation();}catch(error){status(error.message||'操作失败，原记录保持不变。',true);}finally{busy=false;controls();}}
 async function sync(){ready=await prepare()!==false;if(!ready)status('本页还有未同步的草稿。请先处理同步提示；现在仍可预览或下载已有还原点。',true);return ready;}
 function renderList(items){dialog.querySelector('.backup-list').innerHTML=items.length?items.map(item=>`<article class="backup-item"><div><strong>${escape(reasons[item.reason]||'学习记录')}</strong><time>${escape(new Date(item.createdAt).toLocaleString())}</time><small>版本 ${Number(item.sourceRevision)||0} · ${(Number(item.bytes||0)/1024).toFixed(1)} KB</small></div><button type="button" data-backup-preview="${escape(item.id)}">查看与恢复</button><button type="button" data-backup-download="${escape(item.id)}">下载 JSON</button></article>`).join(''):'<div class="backup-empty">暂时没有还原点。点击「保存当前还原点」留下一份记录；后续保存也会定时备份旧版本。</div>';}
 async function refresh(){const value=await request();revision=value.revision;renderList(value.items||[]);}
 async function checkpoint(){if(await prepare()===false)throw new Error('请先完成学习记录同步，再创建还原点。');return request('',{reason:'manual'});}
 async function open(){if(!dialog.open)dialog.showModal();selected=null;dialog.querySelector('.backup-preview').hidden=true;await run(async()=>{status('正在检查学习记录…');await sync();await refresh();if(ready)status('记录已同步，可创建或恢复还原点。');});}
 function preview(snapshot){selected=snapshot;const s=summarizeProgress(snapshot.progress),panel=dialog.querySelector('.backup-preview');panel.hidden=false;panel.innerHTML=`<h3>这份记录包含什么？</h3><p>${escape(new Date(snapshot.createdAt).toLocaleString())} · ${escape(reasons[snapshot.reason]||'学习记录')}</p><dl><div><dt>课程记录</dt><dd>${s.lessons}</dd></div><div><dt>已完成</dt><dd>${s.completed}</dd></div><div><dt>笔记</dt><dd>${s.notes}</dd></div><div><dt>对话消息</dt><dd>${s.messages}</dd></div>${s.japanese?`<div><dt>复习词条</dt><dd>${s.words}</dd></div><div><dt>小说进度</dt><dd>${s.readings}</dd></div>`:''}</dl><p>恢复时会先备份当前记录，然后替换学习进度。其他设备若刚刚保存了新内容，本次恢复会停止，避免覆盖。</p><label class="backup-confirm"><input type="checkbox" data-backup-ack>我确认使用这份记录，并保留恢复前的还原点。</label><button type="button" data-backup-confirm disabled>恢复这份记录</button>`;panel.scrollIntoView({block:'nearest'});}
 dialog.querySelector('.backup-close').onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 dialog.addEventListener('change',event=>{if(event.target.matches('[data-backup-ack]'))controls();});
 dialog.addEventListener('click',event=>{const b=event.target.closest('button');if(!b||b.disabled)return;
  if(b.hasAttribute('data-backup-refresh'))return run(async()=>{await sync();await refresh();if(ready)status('列表已更新。');});
  if(b.hasAttribute('data-backup-create'))return run(async()=>{await checkpoint();await refresh();status('已保存当前还原点。');});
  if(b.dataset.backupPreview)return run(async()=>{const snapshot=await request('/'+encodeURIComponent(b.dataset.backupPreview));preview(snapshot);status('请核对摘要；下载 JSON 可以离线保留完整记录。');});
  if(b.dataset.backupDownload)return run(async()=>{const snapshot=await request('/'+encodeURIComponent(b.dataset.backupDownload));const url=URL.createObjectURL(new Blob([JSON.stringify(checkpointExport(snapshot),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='学习还原点-'+snapshot.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('还原点已下载，不包含接口密钥。');});
  if(b.hasAttribute('data-backup-confirm'))return run(async()=>{if(!selected||!dialog.querySelector('[data-backup-ack]').checked)return;if(!await sync())return;const latest=await request();if(latest.revision!==revision){await refresh();throw new Error('其他页面刚刚更新了记录，列表已刷新。请重新核对后恢复。');}await request('/'+encodeURIComponent(selected.id)+'/restore',{baseRevision:revision});restored=true;try{await onRestored();}catch{dialog.querySelector('.backup-preview').innerHTML='<button type="button" data-reload-restored>载入已恢复的记录</button>';throw new Error('服务器已恢复记录。本页尚未完成载入，请点击「载入已恢复的记录」，不要继续编辑旧内容。');}selected=null;dialog.querySelector('.backup-preview').hidden=true;await refresh();status('已恢复选定记录；恢复前的内容也已留存。');});
  if(b.hasAttribute('data-reload-restored')&&restored)return run(async()=>{await onRestored();dialog.querySelector('.backup-preview').hidden=true;await refresh();status('已载入恢复后的记录。');});
 });
 const listener=event=>{if(event.target.closest('[data-backup-manager]')){event.preventDefault();void open();}};document.addEventListener('click',listener);
 const settings=document.querySelector('#settings-dialog form');if(settings){const row=document.createElement('div');row.className='backup-settings-entry';row.innerHTML='<button type="button" data-backup-manager>学习记录还原点</button><small>误清空或误导入后，可找回此前的学习记录。</small>';settings.append(row);}
 return {open,checkpoint,destroy(){document.removeEventListener('click',listener);dialog.remove();}};
}
