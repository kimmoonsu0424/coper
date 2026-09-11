'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {Survival,PLAYER_KEYS}=require('../dist/expansion.js');
const PORT=Number(process.env.PORT)||3000,DATA=process.env.DATA_DIR||path.join(__dirname,'data'),FILE=path.join(DATA,'worlds.json');
const rooms=new Map(),sessions=new Map(),ranks=new Map(),soloRanks=new Map(),limits=new Map();let dirty=false,lastSaved=0;
const duelRooms=new Map(),duelSessions=new Map(),duelQueue=[],duelPending=new Map(),duelRanks=new Map();
fs.mkdirSync(DATA,{recursive:true});
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const allowed=(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
const stamp=()=>Date.now(),maxRooms=Number(process.env.MAX_ROOMS)||20;
function touch(){dirty=true;}
let saving=false;
async function persist(){if(!dirty||saving)return;saving=true;dirty=false;const data={version:2,rooms:[...rooms.values()].map(r=>({code:r.code,created:r.created,updated:r.updated,game:JSON.parse(r.game.serialize()),actors:r.actors.map(a=>Object.fromEntries(Object.entries(a).filter(([k])=>!['input','connected','lastSeen','lastSeq'].includes(k))))})),ranks:[...ranks.values()],soloRanks:[...soloRanks.values()]};try{const json=JSON.stringify(data);await fs.promises.writeFile(FILE+'.tmp',json);await fs.promises.rename(FILE+'.tmp',FILE);lastSaved=stamp();}catch(e){console.error('Persistence failed:',e.message);dirty=true;}finally{saving=false;}}
if(fs.existsSync(FILE)){try{let saved=JSON.parse(fs.readFileSync(FILE,'utf8'));for(let r of saved.rooms||[]){let game=Survival.load(JSON.stringify(r.game));r.game=game;for(let a of r.actors){a.connected=false;a.input={};a.lastSeen=0;a.lastSeq=0;a.lastNodesVersion=a.lastNodesVersion||0;a.events=[];a.p.sleep=null;sessions.set(a.tokenHash,{room:r,actor:a});}game.actors=r.actors;rooms.set(r.code,r);}for(let rank of saved.ranks||[])ranks.set(rank.id,rank);for(let row of saved.soloRanks||[])soloRanks.set(row.id,row);}catch(e){console.error('Cannot load saved data:',e.message);process.exit(1);}}
function rank(a,r){let row={id:a.id,nickname:a.nickname,days:Math.floor(a.survived/110)+1,kills:a.kills,score:Math.floor(a.survived/110)*100+a.kills*25+(a.score||0),difficulty:r.game.difficulty,updated:stamp()};let old=ranks.get(a.id);if(!old||row.score>old.score){ranks.set(a.id,row);touch();}return row;}
function state(r,a){let world={...JSON.parse(r.game.serialize()),particles:r.game.particles,...Object.fromEntries(PLAYER_KEYS.filter(k=>k!=='events').map(k=>[k,a[k]])),nickname:a.nickname};if(a.lastNodesVersion===world.nodesVersion)delete world.nodes;else a.lastNodesVersion=world.nodesVersion;return {protocol:2,room:r.code,id:a.id,world,players:r.actors.filter(p=>p.connected).map(p=>({id:p.id,nickname:p.nickname,p:p.p,equipment:p.equipment,dead:p.dead,kills:p.kills})),messages:a.events.splice(0),serverTime:stamp()};}
function auth(req){let token=(req.headers.authorization||'').replace(/^Bearer /,'');let session=token.length===43?sessions.get(hash(token)):null;if(!session)throw Object.assign(Error('연결이 만료되었습니다. 방에 다시 접속하세요.'),{status:401});return session;}
async function body(req){let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)throw Object.assign(Error('요청이 너무 큽니다.'),{status:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw Object.assign(Error('올바른 JSON 요청이 아닙니다.'),{status:400});}}
function respond(req,res,status,data){let bytes=Buffer.from(JSON.stringify(data));res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');if(bytes.length>1024&&/gzip/.test(req.headers['accept-encoding']||'')){res.setHeader('Content-Encoding','gzip');res.end(zlib.gzipSync(bytes,{level:1}));}else res.end(bytes);}
function limit(req){let ip=req.socket.remoteAddress,now=stamp(),r=limits.get(ip);if(!r||now-r.t>1000){limits.set(ip,{t:now,n:1});return;}if(++r.n>100)throw Object.assign(Error('요청이 너무 빠릅니다.'),{status:429});}
const commands=new Set(['attack','interact','use','craft','equip','upgrade','enter','exit','sleep','cancelSleep','decorate','rank']);
function action(r,a,c){if(!c||!commands.has(c.op))return;if(a.dead&&c.op!=='rank')return;r.game.withActor(a,()=>{let g=r.game;
 switch(c.op){case'attack':g.attack();break;case'interact':g.interact();break;case'use':if(['food','water','med'].includes(c.type))g.use(c.type);break;case'craft':if(typeof c.type==='string'&&Object.hasOwn(require('../dist/engine.js').RECIPES,c.type))g.craft(c.type,Number(c.x),Number(c.y));break;case'equip':g.equip(c.id);break;case'upgrade':if(typeof c.id==='string')g.upgradeGear(c.id);break;case'enter':g.enter();break;case'exit':g.exit();break;case'sleep':g.sleep();break;case'cancelSleep':g.cancelSleep();break;case'decorate':g.decorate(c.action,c.type,Number(c.x),Number(c.y),c.id);break;case'rank':rank(a,r);g.note('공유 랭킹에 현재 기록을 등록했습니다.');break;}
 });touch();}
const DUEL_ROUND=180,DUEL_MAX_QUEUE=200,DUEL_QUEUE_TTL=45000,DUEL_PENDING_TTL=15000,DUEL_ROOM_TTL=600000;
const DUEL_W=1200,DUEL_H=800,DUEL_STATS={survivor:{hp:100,speed:168,range:52,damage:16,cool:.5,r:16},monster:{hp:150,speed:184,range:56,damage:20,cool:.55,r:18}};
const DUEL_VISION={survivor:{close:90,range:430,cone:.80,sound:320},monster:{close:100,range:520,cone:1.0,sound:210}};
function duelKey(req,nickname){return hash((req.socket.remoteAddress||'')+'|'+nickname);}
function duelRank(id,nickname,won){let row=duelRanks.get(id)||{id,nickname,wins:0,losses:0,streak:0,updated:0};row.nickname=nickname;if(won){row.wins++;row.streak=Math.max(0,row.streak)+1;}else{row.losses++;row.streak=Math.min(0,row.streak)-1;}row.updated=stamp();duelRanks.set(id,row);touch();return row;}
function duelCode(){let code;do{code=crypto.randomBytes(4).toString('hex').slice(0,6).toUpperCase();}while(duelRooms.has(code));return code;}
function duelRoomCreate(){let code=duelCode(),r={code,created:stamp(),updated:stamp(),players:[],state:'lobby',startedAt:0,winner:null,map:crypto.randomBytes(4).toString('hex'),obstacles:[]};duelRooms.set(code,r);return r;}
function duelAssignRoles(r){let roles=Math.random()<.5?['survivor','monster']:['monster','survivor'];r.players.forEach((p,i)=>p.role=roles[i]);}
function duelPlayer(nickname,tokenHash,rankKey){return{id:crypto.randomUUID(),tokenHash,rankKey,nickname:Survival.nick(nickname),role:null,ready:false,connected:true,lastSeen:stamp(),wantsRematch:false,input:{},p:null};}
function duelRng(seedHex){let t=parseInt(seedHex.slice(0,8),16)>>>0||1;return()=>{t+=0x6D2B79F5;let x=Math.imul(t^t>>>15,t|1);x^=x+Math.imul(x^x>>>7,x|61);return((x^x>>>14)>>>0)/4294967296;};}
function duelObstacles(seedHex){let rnd=duelRng(seedHex),list=[];for(let i=0;i<6;i++){let w=70+rnd()*90,h=70+rnd()*90,x=140+rnd()*(DUEL_W-280-w),y=140+rnd()*(DUEL_H-280-h);list.push({x,y,w,h});}return list;}
function duelBlocked(r,x,y,rad){if(x<rad||y<rad||x>DUEL_W-rad||y>DUEL_H-rad)return true;return r.obstacles.some(o=>x>o.x-rad&&x<o.x+o.w+rad&&y>o.y-rad&&y<o.y+o.h+rad);}
function duelSegBlocked(r,x1,y1,x2,y2){let steps=14;for(let i=1;i<steps;i++){let t=i/steps,x=x1+(x2-x1)*t,y=y1+(y2-y1)*t;if(r.obstacles.some(o=>x>o.x&&x<o.x+o.w&&y>o.y&&y<o.y+o.h))return true;}return false;}
function duelCanSee(r,observer,obsAngle,target,role){let v=DUEL_VISION[role],dx=target.x-observer.x,dy=target.y-observer.y,d=Math.hypot(dx,dy);if(d<=v.close)return true;if(d>v.range)return false;let ang=Math.atan2(dy,dx),diff=Math.abs(Math.atan2(Math.sin(ang-obsAngle),Math.cos(ang-obsAngle)));if(diff>v.cone)return false;return!duelSegBlocked(r,observer.x,observer.y,target.x,target.y);}
function duelSpawn(r){r.obstacles=duelObstacles(r.map);r.startedAt=stamp();r.winner=null;r.ranked=false;for(let p of r.players){let s=DUEL_STATS[p.role];p.p={x:p.role==='survivor'?110:DUEL_W-110,y:p.role==='survivor'?DUEL_H-110:110,hp:s.hp,maxHp:s.hp,angle:0,cool:0,special:0,specialClock:0,hurt:0};p.ready=false;p.wantsRematch=false;p.input={};}}
function duelTick(r,dt){
 if(r.state!=='playing')return;let[a,b]=r.players;if(!a||!b)return;
 for(let p of r.players)if(stamp()-p.lastSeen>8000){r.winner=p.role==='survivor'?'monster':'survivor';r.state='complete';p.connected=false;}
 if(r.state!=='playing')return;
 for(let p of r.players){let opp=r.players.find(x=>x!==p),s=DUEL_STATS[p.role],i=p.input||{},st=p.p;
  st.cool=Math.max(0,st.cool-dt);st.specialClock=Math.max(0,st.specialClock-dt);st.hurt=Math.max(0,st.hurt-dt);
  let boosted=p.role==='monster'&&st.special>0;if(boosted)st.special=Math.max(0,st.special-dt);
  let mx=Number(i.x)||0,my=Number(i.y)||0,l=Math.hypot(mx,my);
  if(l>.05){mx/=Math.max(1,l);my/=Math.max(1,l);st.angle=Math.atan2(my,mx);let sp=s.speed*(boosted?2:1)*dt;let nx=clampV(st.x+mx*sp,s.r,DUEL_W-s.r),ny=clampV(st.y+my*sp,s.r,DUEL_H-s.r);if(!duelBlocked(r,nx,st.y,s.r))st.x=nx;if(!duelBlocked(r,st.x,ny,s.r))st.y=ny;}
  if(i.special&&st.specialClock===0){st.specialClock=p.role==='monster'?7:14;if(p.role==='monster')st.special=.32;else st.hp=Math.min(s.hp,st.hp+22);}
  if(i.attack&&st.cool===0&&opp){st.cool=s.cool;if(Math.hypot(opp.p.x-st.x,opp.p.y-st.y)<=s.range+DUEL_STATS[opp.role].r){opp.p.hp=Math.max(0,opp.p.hp-s.damage);opp.p.hurt=.3;}}
 }
 for(let p of r.players)if(p.p.hp<=0){r.winner=p.role==='survivor'?'monster':'survivor';r.state='complete';}
 if(r.state==='playing'&&stamp()-r.startedAt>=DUEL_ROUND*1000){r.winner='survivor';r.state='complete';}
 if(r.state==='complete'&&!r.ranked){r.ranked=true;let elapsed=stamp()-r.startedAt;if(elapsed>=10000)for(let p of r.players)duelRank(p.rankKey,p.nickname,p.role===r.winner);}
}
function clampV(v,a,b){return Math.max(a,Math.min(b,v));}
function duelView(r,me){
 let opp=r.players.find(p=>p.id!==me.id),world=null;
 if(r.state!=='lobby'){
  let oppData=null,heard=null;
  if(opp){
   let reveal=r.state==='complete'||duelCanSee(r,me.p,me.p.angle,opp.p,me.role);
   if(reveal)oppData={x:opp.p.x,y:opp.p.y,hp:opp.p.hp,maxHp:opp.p.maxHp,angle:opp.p.angle,hurt:opp.p.hurt};
   else{let i=opp.input||{},loud=i.attack===true||Math.hypot(Number(i.x)||0,Number(i.y)||0)>.3,d=Math.hypot(opp.p.x-me.p.x,opp.p.y-me.p.y);if(loud&&d<=DUEL_VISION[me.role].sound)heard={dir:Math.atan2(opp.p.y-me.p.y,opp.p.x-me.p.x),dist:d};}
  }
  world={w:DUEL_W,h:DUEL_H,obstacles:r.obstacles,timeLeft:r.state==='playing'?Math.max(0,DUEL_ROUND-(stamp()-r.startedAt)/1000):0,me:me.p,opp:oppData,heard,vision:DUEL_VISION[me.role]};
 }
 return{protocol:1,room:r.code,map:r.map,id:me.id,role:me.role,ready:me.ready,wantsRematch:me.wantsRematch,state:r.state,duration:DUEL_ROUND,winner:r.winner,world,opponent:opp?{nickname:opp.nickname,role:opp.role,ready:opp.ready,wantsRematch:opp.wantsRematch,connected:opp.connected&&stamp()-opp.lastSeen<8000}:null,serverTime:stamp()};
}
function duelAuth(req){let token=(req.headers.authorization||'').replace(/^Bearer /,'');let s=token.length===43?duelSessions.get(hash(token)):null;if(!s||!duelRooms.has(s.room.code))throw Object.assign(Error('듀얼 연결이 만료되었습니다.'),{status:401});return s;}
function duelCleanup(){let now=stamp();for(let i=duelQueue.length-1;i>=0;i--)if(now-duelQueue[i].joinedAt>DUEL_QUEUE_TTL)duelQueue.splice(i,1);for(let[token,p]of duelPending)if(now-p.at>DUEL_PENDING_TTL)duelPending.delete(token);for(let[code,r]of duelRooms)if(now-r.updated>DUEL_ROOM_TTL||r.players.every(p=>!p.connected))duelRooms.delete(code);}
const server=http.createServer(async(req,res)=>{let origin=req.headers.origin||'';if(origin&&allowed.length&&!allowed.includes(origin)){respond(req,res,403,{error:'허용되지 않은 게임 주소입니다.'});return;}res.setHeader('Access-Control-Allow-Origin',origin||'*');res.setHeader('Vary','Origin, Accept-Encoding');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('X-Content-Type-Options','nosniff');if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 try{limit(req);let url=new URL(req.url,'http://local');
 if(req.method==='GET'&&url.pathname==='/health'){respond(req,res,200,{ok:true,protocol:2,rooms:rooms.size,lastSaved});return;}
 if(req.method==='GET'&&url.pathname==='/rankings'){respond(req,res,200,{rankings:[...ranks.values()].sort((a,b)=>b.score-a.score||b.days-a.days).slice(0,100),verified:true});return;}
 if(req.method==='GET'&&url.pathname==='/rankings/solo'){respond(req,res,200,{rankings:[...soloRanks.values()].sort((a,b)=>b.score-a.score||b.days-a.days).slice(0,100),verified:false});return;}
 if(req.method==='POST'&&url.pathname==='/soloRank'){
  let b=await body(req);let nickname=Survival.nick(b.nickname),day=Math.floor(Number(b.day)),kills=Math.floor(Number(b.kills)),score=Number(b.score),difficulty=['easy','normal','hard'].includes(b.difficulty)?b.difficulty:'normal';
  if(!Number.isFinite(day)||day<1||day>100000)throw Error('생존일 값이 올바르지 않습니다.');
  if(!Number.isFinite(kills)||kills<0||kills>1000000)throw Error('처치 수 값이 올바르지 않습니다.');
  if(!Number.isFinite(score)||score<0||score>50000000)throw Error('점수 값이 올바르지 않습니다.');
  let key=hash((req.socket.remoteAddress||'')+'|'+nickname),old=soloRanks.get(key),row={id:key,nickname,days:day,kills,score,difficulty,updated:stamp()};
  if(!old||row.score>old.score){soloRanks.set(key,row);touch();persist();}
  respond(req,res,200,{ok:true});return;
 }
 if(req.method==='POST'&&url.pathname==='/join'){
  let b=await body(req);if(b.token){let s=sessions.get(hash(String(b.token)));if(!s)throw Object.assign(Error('이 서버에 보관된 접속 기록이 없습니다.'),{status:401});let a=s.actor;if(a.dead)throw Error('이 캐릭터는 사망했습니다. 새 캐릭터로 입장하세요.');a.connected=true;a.lastSeen=stamp();a.input={};respond(req,res,200,{...state(s.room,a),token:b.token});return;}
  let code=String(b.room||'').trim().toUpperCase(),r;
  if(code){if(!/^[A-Z0-9]{6}$/.test(code)||!rooms.has(code))throw Error('방 코드를 확인하세요.');r=rooms.get(code);}else{if(rooms.size>=maxRooms)throw Error('서버의 방이 가득 찼습니다. 기존 방에 참가하세요.');do{code=crypto.randomBytes(4).toString('hex').slice(0,6).toUpperCase();}while(rooms.has(code));let difficulty=['easy','normal','hard'].includes(b.difficulty)?b.difficulty:'normal';r={code,created:stamp(),updated:stamp(),game:new Survival(Date.now(),difficulty),actors:[]};r.game.actors=r.actors;rooms.set(code,r);}
  if(r.actors.filter(a=>!a.dead).length>=4)throw Error('이 방에는 생존자 4명이 이미 등록되어 있습니다.');let nickname=Survival.nick(b.nickname);if(r.actors.some(a=>!a.dead&&a.nickname===nickname))throw Error('이 방에서 사용 중인 닉네임입니다. 다른 이름을 선택하세요.');
  let g=new Survival(1,r.game.difficulty,nickname),token=crypto.randomBytes(32).toString('base64url'),a={...g.packPlayer(),id:crypto.randomUUID(),tokenHash:hash(token),connected:true,lastSeen:stamp(),lastSeq:0,lastNodesVersion:0,input:{}};a.joinedDay=r.game.day;a.p.x=1700+r.actors.length*30;a.p.y=1730;r.actors.push(a);sessions.set(a.tokenHash,{room:r,actor:a});touch();persist();respond(req,res,200,{...state(r,a),token});return;
 }
 if(req.method==='POST'&&url.pathname==='/input'){
  let {room:r,actor:a}=auth(req),b=await body(req);a.lastSeen=stamp();a.connected=true;r.updated=stamp();let seq=Number(b.seq);if(Number.isSafeInteger(seq)&&seq>a.lastSeq){a.lastSeq=seq;let i=b.input||{};a.input={x:clampNum(i.x),y:clampNum(i.y),sprint:i.sprint===true,attack:i.attack===true,interact:i.interact===true};for(let c of Array.isArray(b.commands)?b.commands.slice(0,8):[])action(r,a,c);}respond(req,res,200,state(r,a));return;
 }
 if(req.method==='POST'&&url.pathname==='/leave'){let{room:r,actor:a}=auth(req);a.connected=false;a.input={};a.p.sleep=null;rank(a,r);touch();persist();respond(req,res,200,{ok:true});return;}
 if(req.method==='POST'&&url.pathname==='/rank'){let{room:r,actor:a}=auth(req);rank(a,r);persist();respond(req,res,200,{ok:true});return;}
 if(req.method==='GET'&&url.pathname==='/duel/rankings'){respond(req,res,200,{rankings:[...duelRanks.values()].filter(r=>r.wins+r.losses>0).sort((a,b)=>b.wins-a.wins||a.losses-b.losses).slice(0,10)});return;}
 if(req.method==='POST'&&url.pathname==='/duel/quick'){
  duelCleanup();let b=await body(req),nickname=Survival.nick(b.nickname),token=crypto.randomBytes(32).toString('base64url'),tokenHash=hash(token),rankKey=duelKey(req,nickname);
  let waiting=duelQueue.shift();
  if(waiting){let r=duelRoomCreate();let me=duelPlayer(nickname,tokenHash,rankKey),them=duelPlayer(waiting.nickname,waiting.tokenHash,waiting.rankKey);r.players=[them,me];duelAssignRoles(r);duelSessions.set(tokenHash,{room:r,player:me});duelSessions.set(waiting.tokenHash,{room:r,player:them});r.updated=stamp();
   duelPending.set(waiting.token,{at:stamp(),body:{...duelView(r,them),token:waiting.token}});
   respond(req,res,200,{...duelView(r,me),token});return;}
  if(duelQueue.length>=DUEL_MAX_QUEUE)throw Error('대기열이 가득 찼습니다. 잠시 후 다시 시도하세요.');
  duelQueue.push({token,tokenHash,nickname,rankKey,joinedAt:stamp()});respond(req,res,200,{status:'waiting',token});return;
 }
 if(req.method==='GET'&&url.pathname==='/duel/quick/poll'){
  let token=(req.headers.authorization||'').replace(/^Bearer /,'');if(token.length!==43)throw Error('유효하지 않은 대기 토큰입니다.');
  let match=duelPending.get(token);if(match){duelPending.delete(token);respond(req,res,200,match.body);return;}
  if(duelQueue.some(q=>q.token===token)){respond(req,res,200,{status:'waiting'});return;}
  respond(req,res,200,{status:'expired'});return;
 }
 if(req.method==='POST'&&url.pathname==='/duel/quick/cancel'){
  let token=(req.headers.authorization||'').replace(/^Bearer /,'');let i=duelQueue.findIndex(q=>q.token===token);if(i>=0)duelQueue.splice(i,1);respond(req,res,200,{ok:true});return;
 }
 if(req.method==='POST'&&url.pathname==='/duel/room'){
  duelCleanup();let b=await body(req),nickname=Survival.nick(b.nickname),code=String(b.room||'').trim().toUpperCase(),token=crypto.randomBytes(32).toString('base64url'),tokenHash=hash(token),r;
  if(code){if(!/^[A-Z0-9]{6}$/.test(code)||!duelRooms.has(code))throw Error('방 코드를 확인하세요.');r=duelRooms.get(code);if(r.players.filter(p=>p.connected).length>=2)throw Error('이미 두 명이 입장한 방입니다.');}
  else{r=duelRoomCreate();}
  let p=duelPlayer(nickname,tokenHash,duelKey(req,nickname));r.players.push(p);if(r.players.length===2)duelAssignRoles(r);duelSessions.set(tokenHash,{room:r,player:p});r.updated=stamp();
  respond(req,res,200,{...duelView(r,p),token});return;
 }
 if(req.method==='POST'&&url.pathname==='/duel/ready'){
  let{room:r,player:p}=duelAuth(req);p.ready=true;p.lastSeen=stamp();r.updated=stamp();
  if(r.state==='lobby'&&r.players.length===2&&r.players.every(x=>x.ready&&x.connected)){duelSpawn(r);r.state='playing';}
  respond(req,res,200,duelView(r,p));return;
 }
 if(req.method==='GET'&&url.pathname==='/duel/state'){
  let{room:r,player:p}=duelAuth(req);p.lastSeen=stamp();p.connected=true;
  respond(req,res,200,duelView(r,p));return;
 }
 if(req.method==='POST'&&url.pathname==='/duel/input'){
  let{room:r,player:p}=duelAuth(req),b=await body(req);p.lastSeen=stamp();p.connected=true;r.updated=stamp();
  if(r.state==='playing'){let i=b.input||{};p.input={x:clampNum(i.x),y:clampNum(i.y),attack:i.attack===true,special:i.special===true};}
  respond(req,res,200,duelView(r,p));return;
 }
 if(req.method==='POST'&&url.pathname==='/duel/rematch'){
  let{room:r,player:p}=duelAuth(req),b=await body(req);p.wantsRematch=true;p.lastSeen=stamp();
  if(r.players.length===2&&r.players.every(x=>x.wantsRematch)){
   if(b.newMap===false){r.players.forEach(x=>{x.role=x.role==='monster'?'survivor':'monster';});}else{r.map=crypto.randomBytes(4).toString('hex');duelAssignRoles(r);}
   duelSpawn(r);r.state='playing';}
  else r.state='lobby';
  r.updated=stamp();respond(req,res,200,duelView(r,p));return;
 }
 if(req.method==='POST'&&url.pathname==='/duel/leave'){
  let{room:r,player:p}=duelAuth(req);p.connected=false;p.ready=false;r.updated=stamp();
  if(r.players.every(x=>!x.connected))duelRooms.delete(r.code);
  respond(req,res,200,{ok:true});return;
 }
 if(req.method==='GET'&&(url.pathname==='/'||/^\/(index.html|style.css|engine.js|expansion.js|network.js|game.js)$/.test(url.pathname))){let name=url.pathname==='/'?'index.html':url.pathname.slice(1),p=path.join(__dirname,'../dist',name);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');fs.createReadStream(p).pipe(res);return;}
 respond(req,res,404,{error:'찾을 수 없습니다.'});
 }catch(e){respond(req,res,e.status||400,{error:e.message||'요청 처리 실패'});}
});
function clampNum(n){return Math.max(-1,Math.min(1,Number(n)||0));}
const ticker=setInterval(()=>{for(let r of rooms.values()){for(let a of r.actors){if(stamp()-a.lastSeen>600)a.input={};if(stamp()-a.lastSeen>5000){a.connected=false;a.p.sleep=null;}}if(r.actors.some(a=>a.connected&&!a.dead)){r.game.update(.05);for(let a of r.actors){if(a.connected)rank(a,r);}for(let event of r.game.events)for(let a of r.actors)if(a.connected)a.events.push(event);r.game.events=[];for(let a of r.actors)if(a.events.length>12)a.events=a.events.slice(-12);touch();}}for(let r of duelRooms.values())duelTick(r,.05);},50);
const saver=setInterval(persist,5000),cleanup=setInterval(()=>{for(let [key,r]of limits)if(stamp()-r.t>60000)limits.delete(key);duelCleanup();},60000);
async function stop(){clearInterval(ticker);clearInterval(saver);clearInterval(cleanup);dirty=true;await persist();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1500).unref();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);server.listen(PORT,'0.0.0.0',()=>console.log('BLSUGU cooperative server ready on port '+PORT));
