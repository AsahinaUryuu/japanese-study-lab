export function trimTutorHistory(messages=[]){
  const clean=(Array.isArray(messages)?messages:[]).filter(x=>x&&['user','assistant'].includes(x.role)&&typeof x.content==='string'&&x.content.trim()).slice(-20).map(x=>({role:x.role,content:x.content.slice(0,x.role==='user'?4000:30000)}));
  let size=clean.reduce((n,x)=>n+x.content.length,0);while(size>60000&&clean.length)size-=clean.shift().content.length;return clean;
}
