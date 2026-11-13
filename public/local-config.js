async function request(action,config){
  let response;
  try{response=await fetch('/api/local-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...(config?{config}:{})}),signal:AbortSignal.timeout(10000),cache:'no-store'});}
  catch{throw new Error('配置服务暂时无法连接，请检查网络连接和服务运行状态。');}
  if(response.status===404||response.status===405)throw new Error('配置服务版本尚未更新，请更新或重启学习服务后刷新页面。');
  let data;try{data=await response.json();}catch{throw new Error('配置服务返回异常，请稍后重试。');}
  if(!response.ok)throw new Error(data.error||'配置保存失败，请稍后重试。');
  if(!data?.config||!['openai','gemini'].includes(data.config.provider)||typeof data.config.apiKey!=='string')throw new Error('配置格式异常，请检查服务配置后重试。');
  return data;
}
export const readLocalConfig=()=>request('read');
export const saveLocalConfig=(config,apiKey)=>request('save',{...config,apiKey});
export const clearLocalKey=()=>request('clear-key');
export const resetLocalConfig=()=>request('reset');
