import {fetchViaProxy} from './proxy.mjs';
import {GradeError} from './config.mjs';
import {readLimited} from './response.mjs';

export function buildModelRequest(config,system,messages){
  const headers={'content-type':'application/json'};
  if(config.provider==='gemini'){
    if(config.apiKey)headers['x-goog-api-key']=config.apiKey;
    const contents=[];
    for(const message of messages){
      const role=message.role==='assistant'?'model':'user';
      if(contents.at(-1)?.role===role)contents.at(-1).parts.push({text:message.content});
      else contents.push({role,parts:[{text:message.content}]});
    }
    return {headers,body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents})};
  }
  if(config.apiKey)headers.Authorization=`Bearer ${config.apiKey}`;
  return {headers,body:JSON.stringify({model:config.model,messages:[{role:'system',content:system},...messages]})};
}

export async function requestModel(config,request,{fetchImpl=fetch,timeoutMs=90000,label='AI 评价',signal}={}){
  const controller=new AbortController();
  let cancelled=false;
  const cancel=()=>{cancelled=true;controller.abort();};
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)cancel();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    if(cancelled)throw new GradeError('已停止本次助教请求。',499);
    const send=config.proxyUrl?(url,options)=>fetchViaProxy(url,options,config.proxyUrl):fetchImpl;
    const response=await send(config.endpoint,{method:'POST',...request,redirect:'error',signal:controller.signal});
    if(cancelled){await response.body?.cancel();throw new GradeError('已停止本次助教请求。',499);}
    if(!response.ok){
      await response.body?.cancel();
      const errors={400:'模型服务拒绝了请求，请检查模型名、协议和接口地址。',401:'API Key 无效或已过期，请重新配置。',403:'当前密钥或地区没有访问该模型的权限。',404:'未找到模型或接口，请检查接口地址和模型名称。',429:'模型服务限流或额度不足，请稍后重试或检查账户额度。'};
      throw new GradeError(errors[response.status]||`模型服务返回 HTTP ${response.status}，请稍后重试。`,502);
    }
    let result;
    try{result=JSON.parse(await readLimited(response,1024*1024));}
    catch(error){if(error instanceof GradeError)throw error;throw new GradeError('接口未返回 JSON，请检查所选协议和地址。',502);}
    let content;
    if(config.provider==='gemini')content=result.candidates?.[0]?.content?.parts?.filter(part=>!part.thought).map(part=>part.text||'').join('\n');
    else{content=result.choices?.[0]?.message?.content;if(Array.isArray(content))content=content.map(part=>part.text||'').join('\n');}
    if(typeof content!=='string'||!content.trim())throw new GradeError('模型没有返回文字回复。请检查模型是否支持文本生成。',502);
    return content.trim();
  }catch(error){
    if(cancelled)throw new GradeError('已停止本次助教请求。',499);
    if(controller.signal.aborted)throw new GradeError(`${label}超时（${Math.round(timeoutMs/1000)} 秒）。请稍后重试，或选择响应更快的模型。`,504);
    if(error instanceof GradeError)throw error;
    throw new GradeError(config.proxyUrl?'通过本机 HTTP 代理连接模型失败。请检查代理是否运行、端口是否正确，以及模型地址；不接受跳转或无效证书。':'无法连接模型服务。请检查网络、代理、接口地址；服务不接受跳转地址。',502);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
