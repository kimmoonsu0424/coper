/* Apocalypse Survival — dependency-free game simulation */
(function(root){
'use strict';
const SIZE=3400, DAY=110, TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const RECIPES={
 cabin:{name:'오두막',desc:'집짓기 · 안에서 회복, 침대로 밤 건너뛰기. 블수구가 집을 공격하니 수리하세요.',cost:{wood:28,stone:12,scrap:3},hp:600,r:62},
 wall:{name:'방벽',desc:'몬스터의 진로를 막는 목재 방벽.',cost:{wood:7,stone:2},hp:280,r:24},
 spikes:{name:'가시 함정',desc:'지나가는 몬스터에게 지속 피해. 소모되면 수리하세요.',cost:{wood:8,stone:3},hp:180,r:22},
 fire:{name:'모닥불',desc:'근처에서 체력을 회복하고 밤을 밝힙니다.',cost:{wood:8,stone:6},hp:180,r:20},
 farm:{name:'텃밭',desc:'2일마다 식량 5개 생산. 가까이서 수확하세요.',cost:{wood:12,stone:4},hp:200,r:25},
 well:{name:'우물',desc:'하루마다 물 5개 생산. 가까이서 받으세요.',cost:{stone:20,scrap:5},hp:350,r:25},
 tower:{name:'수호 포탑',desc:'돌 1개를 써서 주변 적을 자동 공격합니다.',cost:{wood:20,stone:15,scrap:15},hp:400,r:26},
 spear:{name:'강철 창',desc:'영구 장비 · 근접 공격력 20 → 42, 사거리 증가.',cost:{wood:10,stone:8,scrap:6},gear:true},
 armor:{name:'생존자 방어구',desc:'영구 장비 · 받는 피해 35% 감소.',cost:{wood:8,scrap:18},gear:true},
 bow:{name:'쇠뇌',desc:'영구 장비 · 공격 시 돌 1개로 가장 가까운 적을 사격.',cost:{wood:16,stone:8,scrap:18},gear:true},
 med:{name:'구급약 × 2',desc:'구급약 1개로 체력 45 회복.',cost:{food:3,scrap:3},item:true}
};
class Survival {
 constructor(seed=Date.now(),difficulty='normal'){
  this.version=1;this.seed=seed>>>0;this.rng=this.seed||1;this.difficulty=difficulty;
  this.time=DAY*.24;this.day=1;this.elapsed=0;this.won=false;this.dead=false;
  this.p={x:1700,y:1730,hp:100,hunger:100,thirst:100,stamina:100,angle:0,attack:0,hurt:0};
  this.bag={wood:8,stone:5,scrap:2,food:6,water:6,med:2};this.gear={};
  this.nodes=[];this.buildings=[];this.enemies=[];this.particles=[];this.events=[];this.explored=[];
  this.spawnTimer=10;this.serial=1;this.kills=0;this.harvests=0;this.lastSave=0;this.weather='clear';
  this.places=[{x:1700,y:1700,name:'첫 번째 피난처',kind:'camp'},{x:850,y:800,name:'버려진 주거지',kind:'town'},{x:2650,y:1050,name:'철거된 공장',kind:'factory'},{x:820,y:2570,name:'푸른 물가',kind:'lake'},{x:2690,y:2630,name:'검은 숲',kind:'forest'}];
  this.generate();this.note('낮 동안 목재와 돌을 모아 오두막을 지으세요.');
 }
 random(){let t=this.rng+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;}
 note(text){this.events.push(text);if(this.events.length>8)this.events.shift();}
 get phase(){return this.time/DAY;}
 get night(){return this.phase<.2||this.phase>=.68;}
 get raid(){return this.day%10===0;}
 get factor(){return this.difficulty==='easy'?.65:this.difficulty==='hard'?1.3:1;}
 get shelter(){return this.buildings.find(b=>b.type==='cabin'&&dist(b,this.p)<49);}
 waterAt(x,y){return ((x-770)/335)**2+((y-2650)/440)**2<1;}
 roadAt(x,y){return Math.abs(x-1660)<57||Math.abs(y-1510)<52||Math.abs(x-y-30)<30;}
 generate(){
  const add=(type,x,y)=>this.nodes.push({id:this.serial++,type,x,y,hp:type==='tree'?3:type==='rock'?3:2,active:true,ready:0});
  for(let i=0;i<600;i++){
   let x=80+this.random()*(SIZE-160),y=80+this.random()*(SIZE-160);
   if(this.waterAt(x,y)||this.roadAt(x,y)||Math.hypot(x-1700,y-1700)<145)continue;
   let q=this.random();add(q<.59?'tree':q<.80?'rock':q<.94?'berry':'crate',x,y);
  }
  for(const place of this.places.filter(p=>['town','factory'].includes(p.kind))){
   for(let i=0;i<28;i++){let x=place.x+(this.random()-.5)*470,y=place.y+(this.random()-.5)*430;if(!this.waterAt(x,y))add('crate',x,y);}
  }
  [['tree',1590,1700],['tree',1600,1810],['tree',1840,1720],['rock',1740,1870],['rock',1840,1830],['berry',1580,1600],['crate',1790,1560]].forEach(a=>add(...a));
 }
 canAfford(type){return Object.entries(RECIPES[type].cost).every(([k,v])=>this.bag[k]>=v);}
 craft(type,x,y){
  const r=RECIPES[type];if(!r||this.dead)return false;
  if(r.gear&&this.gear[type]){this.note('이미 장착한 장비입니다.');return false;}
  if(!this.canAfford(type)){this.note('재료가 부족합니다.');return false;}
  if(!r.gear&&!r.item){const v=this.canBuild(type,x,y);if(v){this.note(v);return false;}}
  for(const [k,v]of Object.entries(r.cost))this.bag[k]-=v;
  if(r.gear){this.gear[type]=true;this.note(r.name+' 장착 완료');}
  else if(r.item){this.bag.med+=2;this.note('구급약 2개를 제작했습니다.');}
  else {this.buildings.push({id:this.serial++,type,x,y,hp:r.hp,maxHp:r.hp,r:r.r,ready:this.day+(type==='farm'?2:1),cool:0});this.note(r.name+' 건설 완료');}
  return true;
 }
 canBuild(type,x,y){
  if(!Number.isFinite(x)||!Number.isFinite(y))return '설치 위치를 선택하세요.';
  let r=RECIPES[type].r;if(x<r+30||y<r+30||x>SIZE-r-30||y>SIZE-r-30)return '맵 안에 설치하세요.';
  if(dist(this.p,{x,y})>235)return '조금 더 가까운 곳에 설치하세요.';
  if(this.waterAt(x,y)||this.waterAt(x+r,y)||this.waterAt(x,y+r)||this.waterAt(x-r,y)||this.waterAt(x,y-r))return '물 위에는 지을 수 없습니다.';
  if(this.buildings.some(b=>Math.hypot(x-b.x,y-b.y)<b.r+r+10))return '건물 사이에 공간이 필요합니다.';
  if(this.nodes.some(n=>n.active&&['tree','rock'].includes(n.type)&&Math.hypot(x-n.x,y-n.y)<r+16))return '나무나 바위를 먼저 채집하세요.';
  if(this.enemies.some(e=>Math.hypot(x-e.x,y-e.y)<r+e.r))return '몬스터가 너무 가깝습니다.';
  if(['wall','well','tower'].includes(type)&&dist(this.p,{x,y})<r+14)return '캐릭터와 겹치지 않는 곳에 설치하세요.';
  return '';
 }
 use(type){
  if(this.dead)return false;
  const stat={food:'hunger',water:'thirst',med:'hp'}[type];if(!stat)return false;
  if(this.bag[type]<1){this.note('남아 있는 '+({food:'식량',water:'물',med:'구급약'}[type])+'이 없습니다.');return false;}
  if(this.p[stat]>=99){this.note('아직 사용할 필요가 없습니다.');return false;}
  this.bag[type]--;this.p[stat]=Math.min(100,this.p[stat]+(type==='med'?45:38));this.note(({food:'식사',water:'수분 보충',med:'치료'}[type])+' 완료');return true;
 }
 nearest(){
  let list=this.nodes.filter(n=>n.active&&dist(n,this.p)<86).map(n=>({kind:'node',o:n,d:dist(n,this.p)}));
  for(let b of this.buildings)if(dist(b,this.p)<b.r+48)list.push({kind:'building',o:b,d:dist(b,this.p)});
  list.sort((a,b)=>a.d-b.d);return list[0];
 }
 interact(){
  if(this.dead||this.p.attack>.1)return;
  const target=this.nearest();
  if(!target){if(this.waterAt(this.p.x-30,this.p.y)||this.waterAt(this.p.x+30,this.p.y)||this.waterAt(this.p.x,this.p.y+30)||this.waterAt(this.p.x,this.p.y-30)){this.bag.water++;this.p.attack=.65;this.note('호수에서 물 1개를 얻었습니다.');return;}this.note('나무, 바위, 상자 또는 건물에 가까이 가세요.');return;}
  let o=target.o;this.p.angle=Math.atan2(o.y-this.p.y,o.x-this.p.x);this.p.attack=.32;
  if(target.kind==='node'){
   o.hp-=this.gear.spear?2:1;this.burst(o.x,o.y,o.type==='rock'?'#a9b7ba':'#b6ce74',6);
   if(o.hp<=0){o.active=false;o.ready=this.day+(o.type==='crate'?5:3);this.harvests++;
    if(o.type==='tree'){this.bag.wood+=7;this.note('+7 목재');}
    if(o.type==='rock'){this.bag.stone+=6;this.note('+6 돌');}
    if(o.type==='berry'){this.bag.food+=4;this.note('+4 식량');}
    if(o.type==='crate'){this.bag.scrap+=4;this.bag.food+=2;this.bag.water+=2;if(this.random()<.25)this.bag.med++;this.note('상자: 고철 +4 / 식량 +2 / 물 +2');}
   }
  }else{
   if((o.type==='farm'||o.type==='well')&&this.day>=o.ready){let k=o.type==='farm'?'food':'water';this.bag[k]+=5;o.ready=this.day+(o.type==='farm'?2:1);this.note((k==='food'?'식량':'물')+' +5');}
   else if(o.hp<o.maxHp&&this.bag.wood>=2&&this.bag.stone>=1){this.bag.wood-=2;this.bag.stone--;o.hp=Math.min(o.maxHp,o.hp+150);this.note('수리 +150 · 목재 2 / 돌 1 사용');}
   else if(o.type==='cabin')this.note('집 안은 회복 구역입니다. 밤에 침대 버튼으로 쉬세요.');
   else if(o.type==='farm'||o.type==='well')this.note(o.ready+'일에 다시 수확할 수 있습니다.');
   else this.note(o.hp<o.maxHp?'수리 재료: 목재 2 / 돌 1':'시설 상태가 좋습니다.');
  }
 }
 sleep(){
  if(this.dead)return false;
  if(!this.shelter){this.note('오두막 안에서만 잘 수 있습니다.');return false;}
  if(!this.night){this.note('밤에만 잠들 수 있습니다.');return false;}
  if(this.raid){this.note('습격의 밤에는 잠들 수 없습니다!');return false;}
  if(this.enemies.some(e=>dist(e,this.p)<340)){this.note('주변에 적이 있어 잠들 수 없습니다.');return false;}
  if(this.p.hunger<25||this.p.thirst<25){this.note('식량과 물을 먼저 보충하세요.');return false;}
  if(this.phase>=.68)this.nextDay();this.time=DAY*.24;this.p.hunger-=15;this.p.thirst-=18;this.p.hp=Math.min(100,this.p.hp+28);this.note('아침입니다. 체력을 회복했습니다.');return true;
 }
 attack(){
  if(this.dead||this.p.attack>0)return;
  let p=this.p; if(p.stamina<7)return;
  p.stamina-=7;p.attack=.43;let nearest=this.enemies.filter(e=>dist(e,p)<(this.gear.bow&&this.bag.stone>0?390:this.gear.spear?112:88)).sort((a,b)=>dist(a,p)-dist(b,p))[0];
  if(nearest){p.angle=Math.atan2(nearest.y-p.y,nearest.x-p.x);let range=this.gear.spear?112:88;
   if(dist(nearest,p)>range&&this.gear.bow&&this.bag.stone>0){this.bag.stone--;nearest.hp-=55;this.particles.push({x:p.x,y:p.y,tx:nearest.x,ty:nearest.y,life:.16,max:.16,beam:true,color:'#e6d69c'});}
   else for(let e of this.enemies)if(dist(e,p)<range){e.hp-=this.gear.spear?42:20;let a=Math.atan2(e.y-p.y,e.x-p.x);this.move(e,Math.cos(a)*14,Math.sin(a)*14,false);this.burst(e.x,e.y,'#da835b',6);}
  }
 }
 burst(x,y,color,n){for(let i=0;i<n;i++){let a=this.random()*TAU;this.particles.push({x,y,vx:Math.cos(a)*45,vy:Math.sin(a)*45,life:.45,max:.45,color});}}
 move(o,dx,dy,player=true){
  let blocked=(x,y)=>this.waterAt(x,y)||this.buildings.some(b=>['wall','well','tower'].includes(b.type)&&Math.hypot(x-b.x,y-b.y)<b.r+(player?10:o.r*.6));
  let x=clamp(o.x+dx,20,SIZE-20),y=clamp(o.y+dy,20,SIZE-20);
  if(!blocked(x,o.y))o.x=x;if(!blocked(o.x,y))o.y=y;
 }
 spawn(boss=false){
  let a=this.random()*TAU,p=this.p,r=580+this.random()*220;
  let x=clamp(p.x+Math.cos(a)*r,35,SIZE-35),y=clamp(p.y+Math.sin(a)*r,35,SIZE-35);
  if(this.waterAt(x,y))return;
  let type=boss?'boss':this.day>=5&&this.random()<.26?'runner':'stalker';
  let level=Math.min(4,1+this.day/50),hp=(boss?220:type==='runner'?40:60)*level*this.factor;
  this.enemies.push({id:this.serial++,type,x,y,hp,maxHp:hp,r:boss?29:16,speed:(boss?65:type==='runner'?118:72)*(1+Math.min(.28,this.day/400)),cool:0,wander:this.random()*TAU});
 }
 nextDay(){
  this.day++;this.weather=this.day%4===0?'rain':'clear';
  for(let n of this.nodes)if(!n.active&&this.day>=n.ready&&!this.buildings.some(b=>dist(n,b)<b.r+20)){n.active=true;n.hp=n.type==='tree'||n.type==='rock'?3:2;}
  this.note(this.day+'일째 생존 중'+(this.raid?' · 오늘 밤 대형 블수구 습격!':''));
  if(this.day>=101&&!this.won){this.won=true;this.note('101일 생존 성공! 계속해서 나만의 기지를 키울 수 있습니다.');}
 }
 update(dt,input={}){
  if(this.dead)return;dt=clamp(dt,0,.1);this.elapsed+=dt;
  let p=this.p,wasNight=this.night;this.time+=dt;if(this.time>=DAY){this.time-=DAY;this.nextDay();}
  if(!wasNight&&this.night){this.note(this.raid?'대형 블수구가 기지를 찾아옵니다!':'밤이 왔습니다. 블수구를 조심하세요.');if(this.raid)this.spawn(true);}
  p.attack=Math.max(0,p.attack-dt);p.hurt=Math.max(0,p.hurt-dt);
  let mx=input.x||0,my=input.y||0,l=Math.hypot(mx,my);let sprint=input.sprint&&p.stamina>3&&l>0;
  if(l>0){mx/=Math.max(1,l);my/=Math.max(1,l);p.angle=Math.atan2(my,mx);let speed=sprint?225:141;this.move(p,mx*speed*dt,my*speed*dt);}
  p.stamina=clamp(p.stamina+(sprint?-21:15)*dt,0,100);
  p.hunger=clamp(p.hunger-dt*(.155+(sprint?.045:0)),0,100);p.thirst=clamp(p.thirst-dt*(.195+(sprint?.075:0)),0,100);
  if(p.hunger===0||p.thirst===0)p.hp-=dt*(p.thirst===0?2.3:1.5);
  let home=this.shelter;if((home||this.buildings.some(b=>b.type==='fire'&&dist(b,p)<100))&&p.hunger>15&&p.thirst>15)p.hp=Math.min(100,p.hp+dt*1.7);
  if(input.attack)this.attack();if(input.interact)this.interact();
  this.spawnTimer-=dt;
  let maxEnemies=Math.min(32,3+Math.floor(this.day/4)+(this.night?8:0));
  if(this.spawnTimer<=0){this.spawnTimer=this.night?Math.max(3,10-this.day*.045):19;if(this.enemies.length<maxEnemies&&(this.day>1||this.night))this.spawn();}
  for(let e of this.enemies){
   e.cool=Math.max(0,e.cool-dt);let d=dist(e,p),chase=d<(this.night?900:330)||e.type==='boss';
   let a=chase?Math.atan2(p.y-e.y,p.x-e.x):e.wander;let speed=e.speed*(chase?1:.3);let oldX=e.x,oldY=e.y;
   this.move(e,Math.cos(a)*speed*dt,Math.sin(a)*speed*dt,false);
   if(Math.hypot(e.x-oldX,e.y-oldY)<speed*dt*.3){e.wander+=dt;this.move(e,Math.cos(a+1.3)*speed*dt,Math.sin(a+1.3)*speed*dt,false);}
   let obstruction=this.buildings.find(b=>['wall','tower','well'].includes(b.type)&&dist(b,e)<b.r+e.r+8);
   let cabin=home&&dist(e,home)<home.r+e.r?home:null;
   if((obstruction||cabin)&&e.cool===0){let b=obstruction||cabin;b.hp-=(e.type==='boss'?46:17)*this.factor;e.cool=.85;this.burst(e.x,e.y,'#bc9a62',3);}
   else if(d<e.r+17&&!home&&e.cool===0){p.hp-=(e.type==='boss'?24:9)*this.factor*(this.gear.armor?.65:1);p.hurt=.3;e.cool=.9;this.burst(p.x,p.y,'#ed7055',4);}
   for(let b of this.buildings)if(b.type==='spikes'&&dist(b,e)<b.r+e.r){e.hp-=dt*38;b.hp-=dt*5;}
  }
  for(let b of this.buildings){
   if(b.type==='tower'){b.cool=Math.max(0,b.cool-dt);let e=this.enemies.find(e=>dist(e,b)<300&&e.hp>0);if(e&&b.cool===0&&this.bag.stone>0){this.bag.stone--;e.hp-=75;b.cool=1.6;this.particles.push({x:b.x,y:b.y,tx:e.x,ty:e.y,color:'#f5c16a',beam:true,life:.14,max:.14});}}
   if(b.hp<=0){this.note(RECIPES[b.type].name+'이 파괴되었습니다!');this.burst(b.x,b.y,'#ad8355',12);}
  }
  this.buildings=this.buildings.filter(b=>b.hp>0);
  for(let e of this.enemies)if(e.hp<=0){this.kills++;this.bag.scrap+=e.type==='boss'?12:1;if(e.type==='boss')this.bag.med+=2;this.burst(e.x,e.y,'#78bac0',10);}
  this.enemies=this.enemies.filter(e=>e.hp>0&&dist(e,p)<1450);
  this.particles=this.particles.filter(v=>(v.life-=dt)>0);for(let v of this.particles)if(!v.beam){v.x+=v.vx*dt;v.y+=v.vy*dt;}
  let cell=Math.floor(p.x/170)+20*Math.floor(p.y/170);if(!this.explored.includes(cell))this.explored.push(cell);
  if(p.hp<=0){p.hp=0;this.dead=true;this.note(this.day+'일째, 여정이 끝났습니다.');}
 }
 serialize(){let data={};for(let k of ['version','seed','rng','difficulty','time','day','elapsed','won','dead','p','bag','gear','nodes','buildings','enemies','explored','serial','kills','harvests','weather'])data[k]=this[k];return JSON.stringify(data);}
 static load(json){
  const d=JSON.parse(json);if(!d||d.version!==1||!Number.isFinite(d.day)||d.day<1||d.day>100000||!Number.isFinite(d.time)||d.time<0||d.time>=DAY)throw Error('지원하지 않는 저장 파일입니다.');
  for(let k of ['hp','hunger','thirst','stamina','x','y','angle','attack','hurt'])if(!Number.isFinite(d.p?.[k]))throw Error('캐릭터 데이터가 손상되었습니다.');
  for(let k of ['wood','stone','scrap','food','water','med'])if(!Number.isFinite(d.bag?.[k])||d.bag[k]<0)throw Error('자원 데이터가 손상되었습니다.');
  for(let k of ['nodes','buildings','enemies','explored'])if(!Array.isArray(d[k])||d[k].length>10000)throw Error('맵 데이터가 손상되었습니다.');
  for(let k of ['nodes','buildings','enemies'])for(let o of d[k])if(!o||!Number.isFinite(o.x)||!Number.isFinite(o.y)||!Number.isFinite(o.hp))throw Error('오브젝트 데이터가 손상되었습니다.');
  if(d.buildings.some(b=>!RECIPES[b.type]||!Number.isFinite(b.r)||!Number.isFinite(b.maxHp))||d.nodes.some(n=>!['tree','rock','berry','crate'].includes(n.type))||d.enemies.some(e=>!['boss','runner','stalker'].includes(e.type)))throw Error('알 수 없는 오브젝트입니다.');
  let game=new Survival(d.seed,d.difficulty);for(let k of Object.keys(JSON.parse(game.serialize())))if(k in d)game[k]=d[k];game.events=[];game.particles=[];game.note(game.day+'일째 생존 기록을 불러왔습니다.');return game;
 }
}
root.Apocalypse={Survival,RECIPES,SIZE,DAY,dist,clamp};if(typeof module!=='undefined')module.exports=root.Apocalypse;
})(typeof window!=='undefined'?window:globalThis);
