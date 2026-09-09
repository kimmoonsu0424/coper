(function(root){
'use strict';
class CoopConnection{
 constructor(url){let u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('올바른 서버 주소를 입력하세요.');if(location.protocol==='https:'&&u.protocol!=='https:')throw Error('HTTPS 서버 주소가 필요합니다.');this.url=u.origin;this.token='';this.seq=0;this.commands=[];this.running=false;this.timer=null;this.inflight=false;this.last=0;this.onstate=()=>{};this.onerror=()=>{};this.input=()=>({});}
 async api(path,body,timeout=9000){let controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);try{let res=await fetch(this.url+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(this.token?{Authorization:'Bearer '+this.token}:{})},body:body?JSON.stringify(body):undefined,signal:controller.signal});let data=await res.json();if(!res.ok)throw Error(data.error||'서버 요청에 실패했습니다.');return data;}finally{clearTimeout(timer);}}
 async join(nickname,room,difficulty,token){let d=await this.api('/join',{nickname,room,difficulty,token});if(d.protocol!==2)throw Error('서버와 게임 버전이 다릅니다.');this.token=d.token;this.id=d.id;this.room=d.room;this.last=performance.now();this.seq=Date.now();return d;}
 start(){this.running=true;this.poll();}
 command(op,values={}){if(this.commands.length<24)this.commands.push({op,...values});}
 async poll(){if(!this.running||this.inflight)return;this.inflight=true;this.pending??={seq:++this.seq,input:this.input(),commands:this.commands.splice(0,8)};try{let d=await this.api('/input',this.pending);this.pending=null;this.last=performance.now();if(this.running)this.onstate(d);}catch(e){this.onerror(e);}finally{this.inflight=false;if(this.running)this.timer=setTimeout(()=>this.poll(),100);}}
 async leave(){this.running=false;clearTimeout(this.timer);try{await this.api('/leave',{});}catch{};}
}
root.CoopConnection=CoopConnection;
})(window);
