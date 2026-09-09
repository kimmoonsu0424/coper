'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {Survival,PLAYER_KEYS}=require('../dist/expansion.js');
const PORT=Number(process.env.PORT)||3000,DATA=process.env.DATA_DIR||path.join(__dirname,'data'),FILE=path.join(DATA,'worlds.json');
const rooms=new Map(),sessions=new Map(),ranks=new Map(),limits=new Map();let dirty=false,lastSaved=0;
fs.mkdirSync(DATA,{recursive:true});
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const allowed=(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
const stamp=()=>Date.now(),maxRooms=Number(process.env.MAX_ROOMS)||20;
function touch(){dirty=true;}
function persist(){if(!dirty)return;const data={version:2,rooms:[...rooms.values()].map(r=>({code:r.code,created:r.created,updated:r.updated,game:JSON.parse(r.game.serialize()),actors:r.actors.map(a=>Object.fromEntries(Object.entries(a).filter(([k])=>!['input','connected','lastSeen','lastSeq'].includes(k))))})),ranks:[...ranks.values()]};try{fs.writeFileSync(FILE+'.tmp',JSON.stringify(data));fs.renameSync(FILE+'.tmp',FILE);dirty=false;lastSaved=stamp();}catch(e){console.error('Persistence failed:',e.message);}}
if(fs.existsSync(FILE)){try{let saved=JSON.parse(fs.readFileSync(FILE,'utf8'));for(let r of saved.rooms||[]){let game=Survival.load(JSON.stringify(r.game));r.game=game;for(let a of r.actors){a.connected=false;a.input={};a.lastSeen=0;a.lastSeq=0;a.events=[];a.p.sleep=null;sessions.set(a.tokenHash,{room:r,actor:a});}game.actors=r.actors;rooms.set(r.code,r);}for(let rank of saved.ranks||[])ranks.set(rank.id,rank);}catch(e){console.error('Cannot load saved data:',e.message);process.exit(1);}}
function rank(a,r){let row={id:a.id,nickname:a.nickname,days:Math.floor(a.survived/110)+1,kills:a.kills,score:Math.floor(a.survived/110)*100+a.kills*25+(a.score||0),difficulty:r.game.difficulty,updated:stamp()};let old=ranks.get(a.id);if(!old||row.score>old.score){ranks.set(a.id,row);touch();}return row;}
function state(r,a){return {protocol:2,room:r.code,id:a.id,world:{...JSON.parse(r.game.serialize()),particles:r.game.particles,...Object.fromEntries(PLAYER_KEYS.filter(k=>k!=='events').map(k=>[k,a[k]])),nickname:a.nickname},players:r.actors.filter(p=>p.connected).map(p=>({id:p.id,nickname:p.nickname,p:p.p,equipment:p.equipment,dead:p.dead,kills:p.kills})),messages:a.events.splice(0),serverTime:stamp()};}
function auth(req){let token=(req.headers.authorization||'').replace(/^Bearer /,'');let session=token.length===43?sessions.get(hash(token)):null;if(!session)throw Object.assign(Error('연결이 만료되었습니다. 방에 다시 접속하세요.'),{status:401});return session;}
async function body(req){let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)throw Object.assign(Error('요청이 너무 큽니다.'),{status:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw Object.assign(Error('올바른 JSON 요청이 아닙니다.'),{status:400});}}
function respond(req,res,status,data){let bytes=Buffer.from(JSON.stringify(data));res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');if(bytes.length>1024&&/gzip/.test(req.headers['accept-encoding']||'')){res.setHeader('Content-Encoding','gzip');res.end(zlib.gzipSync(bytes,{level:1}));}else res.end(bytes);}
function limit(req){let ip=req.socket.remoteAddress,now=stamp(),r=limits.get(ip);if(!r||now-r.t>1000){limits.set(ip,{t:now,n:1});return;}if(++r.n>100)throw Object.assign(Error('요청이 너무 빠릅니다.'),{status:429});}
const commands=new Set(['attack','interact','use','craft','equip','enter','exit','sleep','cancelSleep','decorate','rank']);
function action(r,a,c){if(!c||!commands.has(c.op))return;if(a.dead&&c.op!=='rank')return;r.game.withActor(a,()=>{let g=r.game;
 switch(c.op){case'attack':g.attack();break;case'interact':g.interact();break;case'use':if(['food','water','med'].includes(c.type))g.use(c.type);break;case'craft':if(typeof c.type==='string'&&Object.hasOwn(require('../dist/engine.js').RECIPES,c.type))g.craft(c.type,Number(c.x),Number(c.y));break;case'equip':g.equip(c.id);break;case'enter':g.enter();break;case'exit':g.exit();break;case'sleep':g.sleep();break;case'cancelSleep':g.cancelSleep();break;case'decorate':g.decorate(c.action,c.type,Number(c.x),Number(c.y),c.id);break;case'rank':rank(a,r);g.note('공유 랭킹에 현재 기록을 등록했습니다.');break;}
 });touch();}
const server=http.createServer(async(req,res)=>{let origin=req.headers.origin||'';if(origin&&allowed.length&&!allowed.includes(origin)){respond(req,res,403,{error:'허용되지 않은 게임 주소입니다.'});return;}res.setHeader('Access-Control-Allow-Origin',origin||'*');res.setHeader('Vary','Origin, Accept-Encoding');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('X-Content-Type-Options','nosniff');if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 try{limit(req);let url=new URL(req.url,'http://local');
 if(req.method==='GET'&&url.pathname==='/health'){respond(req,res,200,{ok:true,protocol:2,rooms:rooms.size,lastSaved});return;}
 if(req.method==='GET'&&url.pathname==='/rankings'){respond(req,res,200,{rankings:[...ranks.values()].sort((a,b)=>b.score-a.score||b.days-a.days).slice(0,100),verified:true});return;}
 if(req.method==='POST'&&url.pathname==='/join'){
  let b=await body(req);if(b.token){let s=sessions.get(hash(String(b.token)));if(!s)throw Object.assign(Error('이 서버에 보관된 접속 기록이 없습니다.'),{status:401});let a=s.actor;if(a.dead)throw Error('이 캐릭터는 사망했습니다. 새 캐릭터로 입장하세요.');a.connected=true;a.lastSeen=stamp();a.input={};respond(req,res,200,{...state(s.room,a),token:b.token});return;}
  let code=String(b.room||'').trim().toUpperCase(),r;
  if(code){if(!/^[A-Z0-9]{6}$/.test(code)||!rooms.has(code))throw Error('방 코드를 확인하세요.');r=rooms.get(code);}else{if(rooms.size>=maxRooms)throw Error('서버의 방이 가득 찼습니다. 기존 방에 참가하세요.');do{code=crypto.randomBytes(4).toString('hex').slice(0,6).toUpperCase();}while(rooms.has(code));let difficulty=['easy','normal','hard'].includes(b.difficulty)?b.difficulty:'normal';r={code,created:stamp(),updated:stamp(),game:new Survival(Date.now(),difficulty),actors:[]};r.game.actors=r.actors;rooms.set(code,r);}
  if(r.actors.filter(a=>!a.dead).length>=4)throw Error('이 방에는 생존자 4명이 이미 등록되어 있습니다.');let nickname=Survival.nick(b.nickname);if(r.actors.some(a=>!a.dead&&a.nickname===nickname))throw Error('이 방에서 사용 중인 닉네임입니다. 다른 이름을 선택하세요.');
  let g=new Survival(1,r.game.difficulty,nickname),token=crypto.randomBytes(32).toString('base64url'),a={...g.packPlayer(),id:crypto.randomUUID(),tokenHash:hash(token),connected:true,lastSeen:stamp(),lastSeq:0,input:{}};a.joinedDay=r.game.day;a.p.x=1700+r.actors.length*30;a.p.y=1730;r.actors.push(a);sessions.set(a.tokenHash,{room:r,actor:a});touch();persist();respond(req,res,200,{...state(r,a),token});return;
 }
 if(req.method==='POST'&&url.pathname==='/input'){
  let {room:r,actor:a}=auth(req),b=await body(req);a.lastSeen=stamp();a.connected=true;r.updated=stamp();let seq=Number(b.seq);if(Number.isSafeInteger(seq)&&seq>a.lastSeq){a.lastSeq=seq;let i=b.input||{};a.input={x:clampNum(i.x),y:clampNum(i.y),sprint:i.sprint===true,attack:i.attack===true,interact:i.interact===true};for(let c of Array.isArray(b.commands)?b.commands.slice(0,8):[])action(r,a,c);}respond(req,res,200,state(r,a));return;
 }
 if(req.method==='POST'&&url.pathname==='/leave'){let{room:r,actor:a}=auth(req);a.connected=false;a.input={};a.p.sleep=null;rank(a,r);touch();persist();respond(req,res,200,{ok:true});return;}
 if(req.method==='POST'&&url.pathname==='/rank'){let{room:r,actor:a}=auth(req);rank(a,r);persist();respond(req,res,200,{ok:true});return;}
 if(req.method==='GET'&&(url.pathname==='/'||/^\/(index.html|style.css|engine.js|expansion.js|network.js|game.js)$/.test(url.pathname))){let name=url.pathname==='/'?'index.html':url.pathname.slice(1),p=path.join(__dirname,'../dist',name);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');fs.createReadStream(p).pipe(res);return;}
 respond(req,res,404,{error:'찾을 수 없습니다.'});
 }catch(e){respond(req,res,e.status||400,{error:e.message||'요청 처리 실패'});}
});
function clampNum(n){return Math.max(-1,Math.min(1,Number(n)||0));}
const ticker=setInterval(()=>{for(let r of rooms.values()){for(let a of r.actors){if(stamp()-a.lastSeen>600)a.input={};if(stamp()-a.lastSeen>5000){a.connected=false;a.p.sleep=null;}}if(r.actors.some(a=>a.connected&&!a.dead)){r.game.update(.05);for(let a of r.actors){if(a.connected)rank(a,r);}for(let event of r.game.events)for(let a of r.actors)if(a.connected)a.events.push(event);r.game.events=[];for(let a of r.actors)if(a.events.length>12)a.events=a.events.slice(-12);touch();}}},50);
const saver=setInterval(persist,5000),cleanup=setInterval(()=>{for(let [key,r]of limits)if(stamp()-r.t>60000)limits.delete(key);},60000);
function stop(){clearInterval(ticker);clearInterval(saver);clearInterval(cleanup);persist();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1500).unref();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);server.listen(PORT,'0.0.0.0',()=>console.log('BLSUGU cooperative server ready on port '+PORT));
