/* v2 shared authoritative simulation. Runs unchanged in browser and Node. */
(function(root){
'use strict';
const A=root.Apocalypse||(typeof require==='function'?require('./engine.js'):null),Base=A.Survival,{DAY,SIZE,dist,clamp,RECIPES}=A;
const ITEMS={
 axe:{name:'생존 도끼',slot:'weapon',damage:23,range:88,cool:.58,rarity:'기본',color:'#b4c3b4',motion:'chop'},
 spear:{name:'강철 창',slot:'weapon',damage:43,range:130,cool:.57,rarity:'제작',color:'#a8c5d3',motion:'thrust'},
 sword:{name:'사냥꾼의 검',slot:'weapon',damage:56,range:108,cool:.44,rarity:'희귀',color:'#87d2e4',motion:'slash'},
 hammer:{name:'황혼의 망치',slot:'weapon',damage:105,range:115,cool:.95,rarity:'영웅',color:'#e8b371',motion:'slam'},
 bow:{name:'강철 쇠뇌',slot:'weapon',damage:65,range:400,cool:.72,rarity:'제작',color:'#bec999',motion:'shoot'},
 voidblade:{name:'블수구 학살검',slot:'weapon',damage:115,range:135,cool:.48,rarity:'전설',color:'#c4a1ed',motion:'slash'},
 cloth:{name:'여행자 의복',slot:'armor',reduce:0,rarity:'기본',color:'#c3a260'},
 armor:{name:'생존자 방어구',slot:'armor',reduce:.35,rarity:'제작',color:'#779b9d'},
 hunter:{name:'추적자의 외투',slot:'armor',reduce:.45,rarity:'희귀',color:'#778f70'},
 plate:{name:'강철 중갑',slot:'armor',reduce:.58,rarity:'영웅',color:'#a3b7c4'},
 voidarmor:{name:'새벽의 수호갑',slot:'armor',reduce:.68,rarity:'전설',color:'#b6a4db'}
};
const MONSTERS={
 stalker:{name:'블수구',hp:65,speed:72,r:16,damage:9,color:'#648f90',coins:5},
 runner:{name:'질주 블수구',hp:48,speed:128,r:14,damage:8,color:'#a4bb77',coins:7},
 brute:{name:'철갑 블수구',hp:180,speed:52,r:23,damage:17,color:'#97a6b4',coins:14},
 spitter:{name:'독침 블수구',hp:68,speed:62,r:16,damage:7,color:'#ba8dcd',coins:10},
 wraith:{name:'그림자 블수구',hp:85,speed:96,r:17,damage:12,color:'#8db2e0',coins:12},
 boss:{name:'대형 블수구',hp:360,speed:60,r:31,damage:27,color:'#d39e72',coins:55}
};
const FURNITURE={bed:{name:'침대',cost:{wood:8},w:62,h:92},table:{name:'작업 탁자',cost:{wood:6},w:80,h:55},rug:{name:'카펫',cost:{food:2,wood:2},w:130,h:88},shelf:{name:'수납장',cost:{wood:7,scrap:2},w:78,h:40},lamp:{name:'실내 조명',cost:{scrap:3,stone:2},w:28,h:28},plant:{name:'화분',cost:{wood:3,stone:2},w:32,h:32}};
const PLAYER_KEYS=['p','bag','gear','inventory','equipment','nickname','kills','harvests','dead','score','joinedDay','survived','events'];
RECIPES.spear.desc='제작 무기 · 공격력 43, 사거리 130. 장비 보관함에서 교체할 수 있습니다.';
RECIPES.bow.desc='제작 무기 · 공격력 65. 돌 1개를 사용해 원거리로 발사합니다.';
RECIPES.armor.desc='제작 방어구 · 받는 피해 35% 감소. 장비 보관함에서 교체할 수 있습니다.';
RECIPES.cabin.desc='넓은 실내가 있는 집 · 가구 배치와 12초 수면. 외벽은 수리하세요.';
class Survival extends Base{
 constructor(seed,difficulty='normal',nickname='생존자'){super(seed,difficulty);this.edition=2;this.nickname=Survival.nick(nickname);this.inventory=['axe','cloth'];this.equipment={weapon:'axe',armor:'cloth'};this.score=0;this.survived=0;this.joinedDay=1;this.bag.coins=0;this.shots=[];this.sleeping=null;this.actors=null;this.actorId='local';this.initPlayer();}
 static nick(s){return String(s||'생존자').normalize('NFC').replace(/[^\p{L}\p{N} _-]/gu,'').trim().slice(0,12)||'생존자';}
 initPlayer(){Object.assign(this.p,{ix:this.p.ix||0,iy:this.p.iy||0,inside:this.p.inside||null,exitCool:0,walk:0,attackClock:0,attackTotal:.5,attackMotion:'chop',swing:0,hitstop:0,sleep:null});}
 get shelter(){return this.buildings.find(b=>b.type==='cabin'&&b.id===this.p.inside)||this.buildings.find(b=>b.type==='cabin'&&dist(b,this.p)<49);}
 packPlayer(){let p={};for(let k of PLAYER_KEYS)p[k]=this[k];return p;}
 withActor(actor,fn){let old=this.packPlayer(),oldId=this.actorId;for(let k of PLAYER_KEYS)this[k]=actor[k];this.actorId=actor.id;try{return fn();}finally{for(let k of PLAYER_KEYS)actor[k]=this[k];for(let k of PLAYER_KEYS)this[k]=old[k];this.actorId=oldId;}}
 liveActors(){return this.actors?this.actors.filter(a=>a.connected&&!a.dead):[{...this.packPlayer(),id:'local',connected:true}];}
 grant(id){if(!this.inventory.includes(id)){this.inventory.push(id);this.note(ITEMS[id].rarity+' 장비 획득: '+ITEMS[id].name+' · 장비 메뉴에서 착용');}else{this.bag.coins+=12;this.note('중복 장비 → 생존 코인 +12');}}
 equip(id){if(!ITEMS[id]||!this.inventory.includes(id))return false;this.equipment[ITEMS[id].slot]=id;this.gear={spear:['spear','sword','hammer','voidblade'].includes(this.equipment.weapon),bow:this.equipment.weapon==='bow',armor:this.equipment.armor!=='cloth'};this.note(ITEMS[id].name+' 착용');return true;}
 craft(type,x,y){if(this.p.sleep)return false;if(this.p.inside&&!RECIPES[type]?.gear&&!RECIPES[type]?.item){this.note('실내에서는 집 꾸미기를 사용하세요.');return false;}let ok=super.craft(type,x,y);if(ok){if(RECIPES[type]?.gear){this.grant(type);this.equip(type);}if(type==='cabin'){let b=this.buildings[this.buildings.length-1];b.owner=this.actorId;b.theme='wood';b.furniture=[{id:this.serial++,type:'bed',x:-220,y:-140},{id:this.serial++,type:'table',x:160,y:-110},{id:this.serial++,type:'rug',x:0,y:35},{id:this.serial++,type:'lamp',x:230,y:100}];}}
  return ok;}
 decorate(action,type,x,y,id){let b=this.shelter;if(!b||this.p.inside!==b.id||this.dead||this.p.sleep)return false;b.furniture??=[];
  if(action==='theme'){if(!['wood','stone','blue'].includes(type))return false;b.theme=type;return true;}
  if(action==='remove'){let f=b.furniture.find(f=>f.id===id);if(!f)return false;if(f.type==='bed'&&b.furniture.filter(f=>f.type==='bed').length===1){this.note('마지막 침대는 남겨두세요.');return false;}b.furniture=b.furniture.filter(f=>f.id!==id);return true;}
  let def=FURNITURE[type];if(!def||!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>305-def.w/2||Math.abs(y)>220-def.h/2||Math.abs(x)<55&&y>155)return false;
  let moving=action==='move'?b.furniture.find(f=>f.id===id&&f.type===type):null;if(action==='move'&&!moving)return false;
  if(b.furniture.some(f=>f.id!==id&&f.type!=='rug'&&type!=='rug'&&Math.abs(f.x-x)<(FURNITURE[f.type].w+def.w)/2+5&&Math.abs(f.y-y)<(FURNITURE[f.type].h+def.h)/2+5)){this.note('가구 사이에 공간을 남기세요.');return false;}
  if(moving){moving.x=x;moving.y=y;return true;}
  if(b.furniture.length>=24){this.note('한 집에는 가구를 24개까지 놓을 수 있습니다.');return false;}
  if(!Object.entries(def.cost).every(([k,v])=>this.bag[k]>=v)){this.note('가구 재료가 부족합니다.');return false;}for(let[k,v]of Object.entries(def.cost))this.bag[k]-=v;b.furniture.push({id:this.serial++,type,x,y});return true;
 }
 enter(){if(this.dead||this.p.inside||this.p.exitCool>0)return false;let b=this.buildings.find(b=>b.type==='cabin'&&dist(b,this.p)<100);if(!b){this.note('오두막 가까이에서 들어가세요.');return false;}b.furniture??=[{id:this.serial++,type:'bed',x:-220,y:-140}];this.p.inside=b.id;this.p.ix=0;this.p.iy=185;this.p.x=b.x;this.p.y=b.y;this.note('피난처에 들어왔습니다. 집 꾸미기로 내부를 바꿀 수 있습니다.');return true;}
 exit(){let b=this.shelter;if(!this.p.inside)return false;this.p.x=b?b.x:1700;this.p.y=b?b.y+95:1700;this.p.inside=null;this.p.sleep=null;this.p.exitCool=1.2;return true;}
 interact(){if(this.p.sleep)return;if(this.p.inside){let b=this.shelter,f=b?.furniture?.find(f=>f.type==='bed'&&Math.hypot(f.x-this.p.ix,f.y-this.p.iy)<100);if(f)this.sleep();else this.note('침대 옆에서 잠을 자거나 집 꾸미기를 열어보세요.');return;}super.interact();}
 sleep(){if(this.dead||this.p.sleep)return false;let b=this.shelter;if(!this.p.inside||!b){this.note('집 안의 침대 옆으로 가세요.');return false;}let bed=b.furniture?.find(f=>f.type==='bed'&&Math.hypot(f.x-this.p.ix,f.y-this.p.iy)<110);if(!bed){this.note('침대 옆에서 수면 버튼을 누르세요.');return false;}if(!this.night){this.note('저녁이나 밤에 잠들 수 있습니다.');return false;}if(this.raid){this.note('습격의 밤에는 잠들 수 없습니다.');return false;}if(this.p.hunger<25||this.p.thirst<25){this.note('식량과 물을 먼저 보충하세요.');return false;}this.p.ix=bed.x;this.p.iy=bed.y;this.p.sleep={remaining:12,day:this.day};this.note('12초 동안 잠듭니다. 이동하면 취소됩니다.');return true;}
 cancelSleep(){this.p.sleep=null;}
 attack(){
  let p=this.p,w=ITEMS[this.equipment.weapon]||ITEMS.axe;if(this.dead||p.inside||p.sleep||p.attack>0||p.stamina<7)return;
  if(w.motion==='shoot'&&this.bag.stone<1){this.note('쇠뇌 탄환으로 쓸 돌이 없습니다.');return;}
  p.stamina-=w.motion==='slam'?14:7;p.attack=w.cool;p.attackClock=w.cool;p.attackTotal=w.cool;p.attackMotion=w.motion;p.swing=(p.swing||0)+1;
  let nearest=this.enemies.filter(e=>e.hp>0&&dist(e,p)<w.range).sort((a,b)=>dist(a,p)-dist(b,p))[0];if(nearest)p.angle=Math.atan2(nearest.y-p.y,nearest.x-p.x);
  if(w.motion==='shoot'){this.bag.stone--;this.shots.push({x:p.x,y:p.y,vx:Math.cos(p.angle)*560,vy:Math.sin(p.angle)*560,life:.85,damage:w.damage,owner:this.actorId,color:w.color,enemy:false});return;}
  for(let e of this.enemies){let angle=Math.atan2(e.y-p.y,e.x-p.x),diff=Math.atan2(Math.sin(angle-p.angle),Math.cos(angle-p.angle));if(e.hp>0&&dist(e,p)<w.range&&Math.abs(diff)<(w.motion==='slam'?2.5:1.5)){this.damageEnemy(e,w.damage,this.actorId,w.motion==='slam'?35:17);p.hitstop=.065;}}
 }
 damageEnemy(e,damage,owner,knock=0){let armor=e.type==='brute'?.7:1;e.hp-=damage*armor;e.hurt=.18;e.lastHit=owner;let actor=this.actors?.find(a=>a.id===owner),p=actor?.p||this.p;let a=Math.atan2(e.y-p.y,e.x-p.x);this.move(e,Math.cos(a)*knock,Math.sin(a)*knock,false);this.burst(e.x,e.y,'#e5c193',7);this.particles.push({x:e.x,y:e.y-55,vx:0,vy:-25,life:.7,max:.7,color:'#fff0bb',text:String(Math.round(damage*armor))});}
 spawn(boss=false){if(!this.night)return;let actors=this.liveActors(),a=actors[Math.floor(this.random()*actors.length)];if(!a)return;let p=a.p,angle=this.random()*Math.PI*2,r=570+this.random()*240,x=clamp(p.x+Math.cos(angle)*r,35,SIZE-35),y=clamp(p.y+Math.sin(angle)*r,35,SIZE-35);if(this.waterAt(x,y))return;
  let pool=['stalker','stalker','runner'];if(this.day>=3)pool.push('spitter');if(this.day>=5)pool.push('brute');if(this.day>=8)pool.push('wraith');let type=boss?'boss':pool[Math.floor(this.random()*pool.length)],m=MONSTERS[type],level=1+Math.min(2.5,this.day/60),hp=m.hp*level*this.factor;
  this.enemies.push({id:this.serial++,type,x,y,hp,maxHp:hp,r:m.r,speed:m.speed,cool:0,wander:angle,hurt:0,telegraph:0,lastHit:null});}
 dawn(){for(let e of this.enemies)this.burst(e.x,e.y,MONSTERS[e.type]?.color||'#b9cfff',12);this.enemies=[];this.shots=[];this.note('해가 떠올랐습니다. 몬스터들이 빛 속으로 사라집니다.');}
 reward(e){if(!this.night||!e.lastHit)return;let apply=()=>{this.kills++;let m=MONSTERS[e.type],coins=m.coins;this.bag.coins=(this.bag.coins||0)+coins;this.bag.scrap+=e.type==='boss'?12:2;this.score+=coins*10;this.note(m.name+' 처치 · 코인 +'+coins+' / 고철 +'+(e.type==='boss'?12:2));let roll=this.random();if(e.type==='boss'){this.bag.med+=2;this.grant(this.random()<.5?'voidblade':'voidarmor');}else if(roll<.24){let pool=e.type==='brute'?['hammer','plate']:e.type==='wraith'?['sword','hunter','plate']:['sword','hunter'];this.grant(pool[Math.floor(this.random()*pool.length)]);}};
  if(this.actors){let actor=this.actors.find(a=>a.id===e.lastHit);if(actor)this.withActor(actor,apply);}else apply();}
 playerTick(dt,input={}){
  if(this.dead)return;let p=this.p;p.attack=Math.max(0,p.attack-dt);p.attackClock=Math.max(0,p.attackClock-dt);p.hurt=Math.max(0,p.hurt-dt);p.hitstop=Math.max(0,p.hitstop-dt);p.exitCool=Math.max(0,p.exitCool-dt);
  let mx=clamp(Number(input.x)||0,-1,1),my=clamp(Number(input.y)||0,-1,1),l=Math.hypot(mx,my);if(p.sleep){if(l>.1||input.attack||input.cancelSleep)p.sleep=null;else p.sleep.remaining=Math.max(0,p.sleep.remaining-dt);}
  if(!p.sleep){let sprint=!!input.sprint&&p.stamina>3&&l>.1;if(l>.1&&p.hitstop<=0){mx/=Math.max(1,l);my/=Math.max(1,l);p.angle=Math.atan2(my,mx);let speed=(sprint?225:141)*(p.inside?.9:1);p.walk+=dt*(sprint?19:12);if(p.inside){p.ix=clamp(p.ix+mx*speed*dt,-295,295);p.iy=clamp(p.iy+my*speed*dt,-212,250);if(Math.abs(p.ix)<48&&p.iy>235)this.exit();}else this.move(p,mx*speed*dt,my*speed*dt);}p.moving=l>.1;
   p.stamina=clamp(p.stamina+(sprint?-21:15)*dt,0,100);p.hunger=clamp(p.hunger-dt*(.155+(sprint?.045:0)),0,100);p.thirst=clamp(p.thirst-dt*(.195+(sprint?.075:0)),0,100);
   if(input.attack)this.attack();if(input.interact)this.interact();
  }
  if(p.hunger===0||p.thirst===0)p.hp-=dt*(p.thirst===0?2.3:1.5);
  let home=this.shelter;if((home||this.buildings.some(b=>b.type==='fire'&&dist(b,p)<100))&&p.hunger>15&&p.thirst>15)p.hp=Math.min(100,p.hp+dt*1.4);
  if(p.inside&&!home){p.inside=null;p.sleep=null;p.hp-=20;p.hurt=.4;this.note('집이 무너졌습니다!');}
  if(!p.inside&&p.exitCool===0&&this.buildings.some(b=>b.type==='cabin'&&dist(b,p)<33))this.enter();
  let cell=Math.floor(p.x/170)+20*Math.floor(p.y/170);if(!this.explored.includes(cell))this.explored.push(cell);
  this.survived+=dt;if(p.hp<=0){p.hp=0;this.dead=true;p.sleep=null;this.note('생존 기록이 끝났습니다.');}
 }
 hurtActor(actor,damage){this.withActor(actor,()=>{let armor=ITEMS[this.equipment.armor]?.reduce||0;this.p.hp-=damage*this.factor*(1-armor);this.p.hurt=.35;this.p.sleep=null;this.burst(this.p.x,this.p.y,'#ef9478',5);if(this.p.hp<=0){this.p.hp=0;this.dead=true;}});}
 update(dt,input={}){dt=clamp(dt,0,.1);if(this.actors){let active=this.liveActors();if(!active.length)return;for(let a of active)this.withActor(a,()=>this.playerTick(dt,a.input||{}));}else{if(this.dead)return;this.playerTick(dt,input);}this.worldTick(dt);}
 worldTick(dt){
  this.elapsed+=dt;let night=this.night;this.time+=dt;if(this.time>=DAY){this.time-=DAY;this.nextDay();}
  if(night&&!this.night)this.dawn();if(!night&&this.night){this.note(this.raid?'대형 블수구 습격!':'해가 졌습니다. 밤 사냥 보상이 활성화됩니다.');if(this.raid)this.spawn(true);}
  let actors=this.liveActors();if(actors.length&&actors.every(a=>a.p.sleep&&a.p.sleep.remaining===0)){
   if(this.night){if(this.phase>=.68)this.nextDay();this.time=DAY*.24;this.dawn();}
   for(let a of actors){let finish=()=>{this.p.sleep=null;this.p.hunger=Math.max(0,this.p.hunger-15);this.p.thirst=Math.max(0,this.p.thirst-18);this.p.hp=Math.min(100,this.p.hp+30);this.note('12초 수면 완료 · 다음 아침이 왔습니다.');};if(this.actors)this.withActor(a,finish);else finish();}
  }else if(!this.night){for(let a of actors)if(a.p.sleep){a.p.sleep=null;}}
  this.spawnTimer-=dt;if(this.spawnTimer<=0){this.spawnTimer=Math.max(2.5,8-this.day*.035);if(this.night&&this.enemies.length<Math.min(48,8+Math.floor(this.day/3)+actors.length*3))this.spawn();}
  for(let e of this.enemies){if(e.hp<=0)continue;let targets=actors.filter(a=>!a.dead).sort((a,b)=>dist(a.p,e)-dist(b.p,e)),target=targets[0];if(!target)continue;let p=target.p,m=MONSTERS[e.type]||MONSTERS.stalker,home=this.buildings.find(b=>b.id===p.inside)||this.buildings.find(b=>b.type==='cabin'&&dist(b,p)<49);e.cool=Math.max(0,e.cool-dt);e.hurt=Math.max(0,(e.hurt||0)-dt);let d=dist(e,p),angle=Math.atan2(p.y-e.y,p.x-e.x);e.angle=angle;
   if(e.telegraph>0){e.telegraph-=dt;if(e.telegraph<=0){let block=this.buildings.find(b=>['wall','tower','well'].includes(b.type)&&dist(b,e)<b.r+e.r+12)||home&&dist(e,home)<home.r+e.r+12&&home;if(block){block.hp-=(e.type==='boss'?55:m.damage*2)*this.factor;this.burst(block.x,block.y,'#bcb184',7);}else if(dist(e,p)<e.r+42&&!home){if(this.actors)this.hurtActor(target,m.damage);else{let armor=ITEMS[this.equipment.armor]?.reduce||0;this.p.hp-=m.damage*this.factor*(1-armor);this.p.hurt=.35;this.p.sleep=null;}}e.cool=e.type==='boss'?1.25:.8;}continue;}
   if(e.type==='spitter'&&d<400&&d>110&&!home&&e.cool===0){this.shots.push({x:e.x,y:e.y,vx:Math.cos(angle)*225,vy:Math.sin(angle)*225,life:2.2,damage:10,enemy:true,color:'#c19fe0'});e.cool=2;}
   let block=this.buildings.find(b=>['wall','tower','well'].includes(b.type)&&dist(b,e)<b.r+e.r+9)||home&&dist(e,home)<home.r+e.r&&home;
   if((block||d<e.r+25&&!home)&&e.cool===0){e.telegraph=e.type==='boss'?.7:.32;continue;}
   if(d>(e.type==='spitter'&&!home?200:22)&&e.hurt===0){let oldX=e.x,oldY=e.y,s=e.speed*dt;this.move(e,Math.cos(angle)*s,Math.sin(angle)*s,false);if(Math.hypot(e.x-oldX,e.y-oldY)<s*.2)this.move(e,Math.cos(angle+1.2)*s,Math.sin(angle+1.2)*s,false);}
   for(let b of this.buildings)if(b.type==='spikes'&&dist(b,e)<b.r+e.r){e.hp-=dt*40;b.hp-=dt*5;e.lastHit=b.owner||'local';}
  }
  for(let s of this.shots){s.life-=dt;s.x+=s.vx*dt;s.y+=s.vy*dt;if(s.life<=0)continue;if(s.enemy){let a=actors.find(a=>!a.p.inside&&dist(a.p,s)<22);let block=this.buildings.find(b=>['wall','cabin'].includes(b.type)&&dist(b,s)<b.r);if(block){block.hp-=s.damage;s.life=0;}else if(a){if(this.actors)this.hurtActor(a,s.damage);else{this.p.hp-=s.damage*this.factor*(1-(ITEMS[this.equipment.armor]?.reduce||0));this.p.hurt=.3;}s.life=0;}}else{let e=this.enemies.find(e=>e.hp>0&&dist(e,s)<e.r+10);if(e){this.damageEnemy(e,s.damage,s.owner);s.life=0;}}}
  this.shots=this.shots.filter(s=>s.life>0);
  for(let b of this.buildings){if(b.type==='tower'){b.cool=Math.max(0,b.cool-dt);let target=this.enemies.find(e=>e.hp>0&&dist(e,b)<320),owner=this.actors?.find(a=>a.id===b.owner),bag=owner?.bag||this.bag;if(target&&b.cool===0&&bag.stone>0){bag.stone--;b.cool=1.6;this.damageEnemy(target,75,b.owner||'local');this.particles.push({x:b.x,y:b.y,tx:target.x,ty:target.y,beam:true,life:.18,max:.18,color:'#eccd86'});}}}
  for(let e of this.enemies)if(e.hp<=0){this.reward(e);this.burst(e.x,e.y,MONSTERS[e.type]?.color||'#a1b4bc',12);}
  this.enemies=this.enemies.filter(e=>e.hp>0);this.buildings=this.buildings.filter(b=>b.hp>0);this.particles=this.particles.filter(v=>(v.life-=dt)>0);for(let v of this.particles)if(!v.beam){v.x+=v.vx*dt;v.y+=v.vy*dt;}
  if(!this.actors&&this.p.hp<=0){this.p.hp=0;this.dead=true;}
 }
 serialize(){let d=JSON.parse(super.serialize());for(let k of ['edition','nickname','inventory','equipment','score','survived','joinedDay','shots'])d[k]=this[k];return JSON.stringify(d);}
 static load(json){let d=JSON.parse(json);if(d.edition!==2){let base=Base.load(json),g=new Survival(base.seed,base.difficulty);Object.assign(g,base);g.initPlayer();g.bag.coins=0;g.inventory=['axe','cloth',...Object.keys(g.gear).filter(k=>g.gear[k]&&ITEMS[k])];g.equipment={weapon:g.gear.bow?'bow':g.gear.spear?'spear':'axe',armor:g.gear.armor?'armor':'cloth'};return g;}
  // Validate old shared fields without rejecting new monster species.
  let validation={...d,enemies:[],p:{...d.p}};Base.load(JSON.stringify(validation));if(!Array.isArray(d.inventory)||d.inventory.length>30||d.inventory.some(id=>!ITEMS[id])||!ITEMS[d.equipment?.weapon]||ITEMS[d.equipment.weapon].slot!=='weapon'||!ITEMS[d.equipment?.armor]||ITEMS[d.equipment.armor].slot!=='armor'||!d.inventory.includes(d.equipment.weapon)||!d.inventory.includes(d.equipment.armor))throw Error('장비 기록이 손상되었습니다.');
  if(d.enemies.length>100||d.enemies.some(e=>!MONSTERS[e.type]||!Number.isFinite(e.x)||!Number.isFinite(e.y)||!Number.isFinite(e.hp)))throw Error('몬스터 기록이 손상되었습니다.');
  for(let b of d.buildings)if(b.furniture&&(!Array.isArray(b.furniture)||b.furniture.length>24||b.furniture.some(f=>!FURNITURE[f.type]||!Number.isFinite(f.x)||!Number.isFinite(f.y))))throw Error('가구 기록이 손상되었습니다.');
  let g=new Survival(d.seed,d.difficulty,d.nickname);for(let k of Object.keys(JSON.parse(g.serialize())))if(k in d)g[k]=d[k];g.nickname=Survival.nick(d.nickname);g.shots=[];g.p.sleep=null;g.events=[];g.particles=[];g.note(g.nickname+' · '+g.day+'일 기록을 불러왔습니다.');return g;
 }
}
Object.assign(A,{Survival,ITEMS,MONSTERS,FURNITURE,PLAYER_KEYS});root.Apocalypse=A;if(typeof module!=='undefined')module.exports=A;
})(typeof window!=='undefined'?window:globalThis);
