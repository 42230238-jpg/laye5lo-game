const BACKEND_URL = "https://laye5lo-game.onrender.com";
const socket = io(BACKEND_URL);

socket.on("connect", () => {
  console.log("Connected to multiplayer server:", socket.id);
});

socket.on("disconnect", () => {
  console.log("Disconnected from multiplayer server");
});

socket.on("roomCreated", (data) => {
  console.log("Room created:", data);
  alert("Room created! Code: " + data.roomCode);
});

socket.on("roomUpdated", (data) => {
  console.log("Room updated:", data);
  alert("Room updated. Players: " + data.players.length);
});

socket.on("joinError", (message) => {
  alert(message);
});
const COLOR_ORDER=['red','blue','green','yellow'];
const STRENGTH={'1':13,'skip':12,'draw2':11,'reverse':10,'0':9,'9':8,'8':7,'7':6,'6':5,'5':4,'4':3,'3':2,'2':1};
const COLOR_CLASS={red:'cr',blue:'cb',green:'cg',yellow:'cy'};
const AVATARS=['Y','B1','B2','B3'];
const DEFAULT_NAMES=['You','Bot 1','Bot 2','Bot 3'];

function buildDeck(){
  const d=[];
  COLOR_ORDER.forEach(col=>['0','1','2','3','4','5','6','7','8','9','skip','draw2','reverse'].forEach(t=>d.push({color:col,type:t,id:`${col}-${t}`})));
  return d;
}
function shuffle(a){const b=[...a];for(let i=b.length-1;i>0;i--){const j=0|Math.random()*(i+1);[b[i],b[j]]=[b[j],b[i]]}return b;}
function str(c){return STRENGTH[c.type]||0;}
function pts(c){if(c.color==='blue'&&c.type==='draw2')return 13;if(c.color==='yellow'&&c.type==='0')return 10;if(c.color==='red')return 1;return 0;}
function isLee(c){return(c.color==='blue'&&c.type==='draw2')||(c.color==='yellow'&&c.type==='0');}
function lbl(c){if(c.type==='draw2')return '+2';if(c.type==='skip')return '&#8856;';if(c.type==='reverse')return '&#8634;';return c.type;}
function sortHand(h){return[...h].sort((a,b)=>{const ci=COLOR_ORDER.indexOf(a.color)-COLOR_ORDER.indexOf(b.color);return ci||str(b)-str(a);});}

function giftViolatesColor(hand,sel){
  if(!hand.some(c=>isLee(c)))return false;
  const selIds=new Set(sel.map(c=>c.id));
  const groups={};
  hand.forEach(c=>{(groups[c.color]=groups[c.color]||[]).push(c);});
  return Object.values(groups).some(cards=>cards.every(c=>selIds.has(c.id)));
}
function colorCounts(hand){
  return COLOR_ORDER.reduce((m,col)=>{m[col]=hand.filter(c=>c.color===col).length;return m;},{});
}
function isLeeColor(color){return color==='blue'||color==='yellow';}
function isProtectedLee(card,counts){
  return isLee(card)&&counts[card.color]>=4;
}
function scoreGiftCandidate(card,hand,selected,difficulty){
  const counts=colorCounts(hand);
  const selectedColorCount=selected.filter(c=>c.color===card.color).length;
  const afterColorCount=counts[card.color]-selectedColorCount-1;
  const hasLee=hand.some(isLee);
  const hasLeeInColor=hand.some(c=>isLee(c)&&c.color===card.color);
  const unknownSameColor=13-counts[card.color];
  const avgPerOpponent=unknownSameColor/3;
  let score=pts(card)*3.5+str(card)*0.18;

  if(difficulty==='medium')score+=Math.random()*0.4;
  if(hasLee){
    if(isLee(card)){
      if(counts[card.color]<=3)score+=22;
      else if(counts[card.color]===4)score-=46;
      else score-=48;
      if(afterColorCount<=1)score-=8;
    } else if(hasLeeInColor){
      score-=counts[card.color]>=4?10:24;
      if(pts(card)>0)score+=10;
      if(counts[card.color]>5)score+=3;
    } else {
      if(card.color==='green')score+=6;
      else if(card.color==='red')score+=3;
      else score+=2;
    }
    if(afterColorCount<=1)score-=difficulty==='hard'?12:6;
    if(difficulty==='hard'&&hasLeeInColor){
      score+=counts[card.color]>avgPerOpponent+1?4:-8;
    }
  } else {
    if(isLeeColor(card.color)){
      score+=counts[card.color]<=3?-12:2;
      if(difficulty==='hard'&&counts[card.color]<avgPerOpponent)score-=8;
    } else {
      score+=card.color==='green'?5:4;
    }
    if(afterColorCount===0)score-=difficulty==='hard'?12:6;
  }
  return score;
}
function chooseSmartGift(hand,difficulty){
  if(difficulty==='easy'){
    const hasLee=hand.some(c=>isLee(c));
    const sorted=[...hand].sort((a,b)=>pts(b)-pts(a)||str(b)-str(a));
    if(hasLee){
      const chosen=[];
      for(const c of sorted){if(chosen.length===3)break;if(!giftViolatesColor(hand,[...chosen,c]))chosen.push(c);}
      while(chosen.length<3){const c=sorted.find(x=>!chosen.includes(x));if(c)chosen.push(c);else break;}
      return chosen;
    }
    return sorted.slice(0,3);
  }
  const chosen=[];
  while(chosen.length<3){
    const candidates=hand.filter(c=>!chosen.includes(c)&&!giftViolatesColor(hand,[...chosen,c]));
    const pool=candidates.length?candidates:hand.filter(c=>!chosen.includes(c));
    if(!pool.length)break;
    pool.sort((a,b)=>scoreGiftCandidate(b,hand,chosen,difficulty)-scoreGiftCandidate(a,hand,chosen,difficulty));
    chosen.push(pool[0]);
  }
  return chosen;
}

function trickWinner(table,leadColor){
  const lead=table.filter(t=>t.card.color===leadColor);
  let w=lead[0];
  lead.forEach(t=>{if(str(t.card)>str(w.card))w=t;});
  return w;
}
function hasBothLees(table){return table.filter(t=>isLee(t.card)).length===2;}
function hasNextTrickPlayer(p){
  const alreadyPlayed=new Set(G.table.map(t=>t.pi));
  for(let i=1;i<=4;i++){
    const n=(p+i)%4;
    if(G.hands[n].length>0&&!alreadyPlayed.has(n))return true;
  }
  return false;
}

let G={phase:'menu',modal:null,roomCode:null,roomMsg:''};
let resolving=false;
let turnTimer=null;       // interval id for countdown
let turnTimeLeft=20;      // seconds remaining
let giftedIds=new Set();  // card ids that glow after gifting
let playerNames=[...DEFAULT_NAMES];
let nextRoundStarter=0;
let botDifficulty='easy';

function initMenu(){
  stopTimer();
  G={phase:'menu',modal:null,roomCode:null,roomMsg:''};
  resolving=false;giftedIds=new Set();render();
}

function initGame(names=[...DEFAULT_NAMES]){
  playerNames=[...names];
  nextRoundStarter=0;
  const deck=shuffle(buildDeck());
  const hands=[[],[],[],[]];
  deck.forEach((c,i)=>hands[i%4].push(c));
  G={phase:'gift',hands:hands.map(sortHand),gifts:[null,null,null,null],table:[],
     currentPlayer:0,leadColor:null,scores:[0,0,0,0],roundPts:[0,0,0,0],
     selected:[],statusMsg:`Choose 3 cards to gift to ${pname(1)}`,botThought:'',playedCards:[],knownGiftedLees:[],modal:null};
  resolving=false;giftedIds=new Set();stopTimer();render();
}

function getPlayable(idx){
  const h=G.hands[idx];
  if(!G.leadColor)return h;
  const s=h.filter(c=>c.color===G.leadColor);
  if(s.length)return s;
  const l=h.filter(c=>isLee(c));
  if(l.length)return l;
  return h;
}

function executePlay(pi,card,reason=''){
  stopTimer();
  G.botThought=pi!==0&&reason?`${pname(pi)} chose ${lbl(card)} because ${reason}.`:'';
  if(!G.playedCards)G.playedCards=[];
  G.playedCards.push(card);
  G.table.push({pi,card});
  G.hands[pi]=sortHand(G.hands[pi].filter(c=>c.id!==card.id));
  if(!G.leadColor)G.leadColor=card.color;
  G.selected=[];
  if(hasBothLees(G.table)||G.table.length===4||!hasNextTrickPlayer(G.currentPlayer)){
    resolving=true;G.statusMsg=hasBothLees(G.table)?'Both Lee5as taken! Round ends now.':'Trick complete...';render();
    setTimeout(finishTrick,1150);
  } else {
    G.currentPlayer=nextTrickP(G.currentPlayer);
    setStatus();render();
    if(G.currentPlayer===0){startTimer();}
    else{setTimeout(aiPlay,680);}
  }
}
function nextP(p){return(p+1)%4;}
function nextActiveP(p){
  for(let i=1;i<=4;i++){
    const n=(p+i)%4;
    if(G.hands[n].length>0)return n;
  }
  return p;
}
function rightOf(p){return(p+1)%4;}
function nextTrickP(p){
  const alreadyPlayed=new Set(G.table.map(t=>t.pi));
  for(let i=1;i<=4;i++){
    const n=(p+i)%4;
    if(G.hands[n].length>0&&!alreadyPlayed.has(n))return n;
  }
  return nextActiveP(p);
}
function currentWinnerInfo(card){
  if(!G.leadColor)return {winner:null,rank:0};
  const lead=G.table.filter(t=>t.card.color===G.leadColor);
  let winner=lead[0]||null;
  lead.forEach(t=>{if(str(t.card)>str(winner.card))winner=t;});
  const cardWins=card.color===G.leadColor&&(!winner||str(card)>str(winner.card));
  return {winner:cardWins?{pi:G.currentPlayer,card}:winner,rank:winner?str(winner.card):0};
}
function wouldWinTrick(card,isLast){
  if(!G.leadColor)return false;
  if(card.color!==G.leadColor)return false;
  const lead=G.table.filter(t=>t.card.color===G.leadColor);
  if(!lead.length)return true;
  return str(card)>Math.max(...lead.map(t=>str(t.card)));
}
function trickDangerWith(card){
  const cards=[...G.table.map(t=>t.card),card];
  const points=cards.reduce((s,c)=>s+pts(c),0);
  return cards.filter(c=>isLee(c)).length===2?37:points;
}
function playedCount(color){return (G.playedCards||[]).filter(c=>c.color===color).length;}
function cardWasPlayed(color,type){return (G.playedCards||[]).some(c=>c.color===color&&c.type===type);}
function hiddenLeeIntel(idx){
  const own=G.hands[idx]||[];
  return [
    {color:'blue',type:'draw2',name:'blue +2'},
    {color:'yellow',type:'0',name:'yellow 0'}
  ].map(lee=>{
    const ownCount=own.filter(c=>c.color===lee.color).length;
    const ownHas=own.some(c=>c.color===lee.color&&c.type===lee.type);
    const played=playedCount(lee.color);
    const leePlayed=cardWasPlayed(lee.color,lee.type);
    return {
      ...lee,
      played,
      ownCount,
      ownHas,
      hidden:!leePlayed&&!ownHas,
      unknown:Math.max(0,13-played-ownCount)
    };
  });
}
function knownGiftedLeeFor(idx,color){
  return (G.knownGiftedLees||[]).find(g=>g.from===idx&&g.color===color&&!cardWasPlayed(g.color,g.type));
}
function pickEasyCard(pl){
  let c;
  if(!G.leadColor){const ns=pl.filter(x=>pts(x)===0);c=(ns.length?ns:pl).sort((a,b)=>str(a)-str(b))[0];}
  else{
    const same=pl.filter(x=>x.color===G.leadColor);
    if(same.length){
      const tm=Math.max(...G.table.map(t=>str(t.card)));
      const safe=same.filter(x=>str(x)<tm);
      c=safe.length?safe.sort((a,b)=>str(b)-str(a))[0]:same.sort((a,b)=>str(a)-str(b))[0];
    } else {
      const sc=pl.filter(x=>pts(x)>0),isLast=G.table.length===3;
      if(isLast&&sc.length){
        const lp=G.table.filter(t=>t.card.color===G.leadColor);
        const lm=lp.length?Math.max(...lp.map(t=>str(t.card))):0;
        const ww=pl.filter(x=>x.color===G.leadColor&&str(x)>lm).length>0;
        c=ww?pl.sort((a,b)=>str(a)-str(b))[0]:sc.sort((a,b)=>pts(b)-pts(a))[0];
      } else if(sc.length)c=sc.sort((a,b)=>pts(b)-pts(a))[0];
      else c=pl.sort((a,b)=>str(b)-str(a))[0];
    }
  }
  return {card:c||pl[0],reason:'easy bot follows the basic safe-card rule'};
}
function scoreBotCard(card,idx,difficulty){
  const isLast=G.table.length===3||!hasNextTrickPlayer(idx);
  const danger=trickDangerWith(card);
  const wins=wouldWinTrick(card,isLast);
  const hasLeeOnTable=G.table.some(t=>isLee(t.card));
  const ownLeeInLead=G.leadColor&&G.hands[idx].some(c=>isLee(c)&&c.color===G.leadColor);
  const leadLeeStrength=G.leadColor==='blue'?str({type:'draw2'}):G.leadColor==='yellow'?str({type:'0'}):0;
  const currentLeadMax=G.leadColor&&G.table.length?Math.max(...G.table.filter(t=>t.card.color===G.leadColor).map(t=>str(t.card))):0;
  const intel=difficulty==='hard'?hiddenLeeIntel(idx):[];
  const hiddenLee=intel.filter(x=>x.hidden&&!knownGiftedLeeFor(idx,x.color));
  const pressuredGift=G.leadColor?knownGiftedLeeFor(idx,G.leadColor):null;
  let score=0;
  const reasons=[];
  if(!G.leadColor){
    score-=pts(card)*3;
    score-=str(card)*0.25;
    const giftedPressure=knownGiftedLeeFor(idx,card.color);
    if(difficulty==='hard'&&card.color==='green'){
      score+=str(card)*1.3+8;
      reasons.push('sheds a high green while no Lee5a can be attached to green');
    }
    if(difficulty==='hard'&&giftedPressure){
      score+=18+str(card)*0.35;
      reasons.push(`pressures ${pname(giftedPressure.to)} after gifting ${giftedPressure.name}`);
    }
    if(difficulty==='hard'){
      const sameHidden=hiddenLee.find(x=>x.color===card.color);
      if(sameHidden&&sameHidden.unknown<=2&&!isLee(card)){
        score+=str(card)<=4?12:-10;
        reasons.push(`counts ${sameHidden.name} as likely hidden`);
      }
      if(hiddenLee.length&&str(card)>=10&&card.color!=='green'&&!giftedPressure){
        score-=8;
        reasons.push('avoids leading high while hidden Lee5a cards remain');
      }
    }
    if(isLee(card)){score-=difficulty==='hard'?18:10;reasons.push('keeps Lee5a out of the lead');}
    else reasons.push('opens with a low-risk card');
  } else if(card.color===G.leadColor){
    if(ownLeeInLead&&!isLee(card)&&leadLeeStrength){
      if(str(card)>leadLeeStrength&&!wins){
        score+=difficulty==='hard'?16:6;
        reasons.push('sheds a high cover card under a stronger lead');
      } else if(str(card)>leadLeeStrength){
        score-=difficulty==='hard'?24:10;
        reasons.push('does not reveal Lee5a cover with a higher card');
      } else if(!wins){
        score+=difficulty==='hard'?12:5;
        reasons.push('uses a low cover card below its Lee5a');
      }
    }
    if(ownLeeInLead&&isLee(card)&&!isLast){
      score-=difficulty==='hard'?22:12;
      reasons.push('keeps the Lee5a protected for later');
    }
    if(wins){
      score-=danger*(difficulty==='hard'?5:3);
      score-=isLast?8:3;
      if(difficulty==='hard'&&!isLast&&hiddenLee.length){
        const leadPlayed=playedCount(G.leadColor);
        const pressure=leadPlayed>=8?18:leadPlayed>=6?10:4;
        score-=pressure+hiddenLee.reduce((s,x)=>s+(x.unknown<=2?10:4),0);
        reasons.push('counts hidden Lee5a risk before taking control');
      }
      if(difficulty==='hard'&&pressuredGift&&!hiddenLee.some(x=>x.color===G.leadColor&&x.unknown<=2)){
        score+=18+str(card)*0.4;
        reasons.push(`takes control to keep pressuring ${pressuredGift.name}`);
      }
      if(difficulty==='hard'&&G.leadColor==='green'){
        score+=10;
        reasons.push('can safely win green because green has no Lee5a');
      }
      if(!reasons.length)reasons.push(`avoids winning ${danger} point danger`);
    } else {
      score+=8+str(card)*0.2;
      if(!reasons.length)reasons.push('stays under the current winner');
    }
  } else {
    if(pts(card)>0&&!isLast){score+=pts(card)*4;reasons.push('feeds points to someone else');}
    if(hasLeeOnTable&&isLee(card)){score+=difficulty==='hard'?25:12;reasons.push('pushes the second Lee5a onto the current taker');}
    else if(isLee(card)){score+=difficulty==='hard'?8:4;reasons.push('gets rid of a dangerous Lee5a');}
    if(difficulty==='hard'&&hiddenLee.some(x=>x.color===card.color&&x.unknown<=2)){
      score+=10;
      reasons.push('uses counting to dump a likely hidden danger color');
    }
    score+=str(card)*0.1;
  }
  if(isLast&&wins)score-=danger*(difficulty==='hard'?7:4);
  if(difficulty==='hard'){
    const remainingLee=G.hands[idx].filter(isLee).length;
    if(remainingLee&&isLee(card)){score+=10;reasons.push('reduces future Lee5a risk');}
    if(!wins&&danger>0){score+=danger;reasons.push('lets another player absorb the points');}
  }
  return {card,score,reason:reasons[0]||'best expected risk score'};
}
function pickSmartCard(idx,pl,difficulty){
  const scored=pl.map(c=>scoreBotCard(c,idx,difficulty)).sort((a,b)=>b.score-a.score||pts(b.card)-pts(a.card)||str(a.card)-str(b.card));
  return scored[0]||{card:pl[0],reason:'no better move available'};
}

function finishTrick(){
  resolving=false;
  const lc=G.leadColor;
  const w=trickWinner(G.table,lc);
  const wi=w.pi;
  const tCards=G.table.map(t=>t.card);
  const leeCount=tCards.filter(c=>isLee(c)).length;
  const blueDraw2Taken=tCards.some(c=>c.color==='blue'&&c.type==='draw2');
  if(blueDraw2Taken)nextRoundStarter=rightOf(wi);
  let p=tCards.reduce((s,c)=>s+pts(c),0);
  if(leeCount===2)p=37;
  G.roundPts[wi]+=p;
  G.statusMsg=p===37?`${pname(wi)} took both Lee5as! +37 pts - round over!`:`${pname(wi)} wins trick${p>0?' (+'+p+'pts)':''}`;
  G.table=[];G.leadColor=null;
  if(leeCount===2){endRound();return;}
  if(G.hands.every(h=>h.length===0)){endRound();return;}
  G.currentPlayer=G.hands[wi].length>0?wi:nextActiveP(wi);setStatus();render();
  if(G.currentPlayer===0){startTimer();}
  else{setTimeout(aiPlay,720);}
}
function pname(i){return playerNames[i]||DEFAULT_NAMES[i];}
function setStatus(){
  G.statusMsg=G.currentPlayer===0?`Your turn!${G.leadColor?' - follow '+G.leadColor:''}`:pname(G.currentPlayer)+' is playing...';
}
function endRound(){
  G.scores=G.scores.map((s,i)=>s+G.roundPts[i]);
  const over=Math.max(...G.scores)>=101;
  G.modal={type:over?'gameEnd':'roundEnd',rp:[...G.roundPts],sc:[...G.scores]};
  G.roundPts=[0,0,0,0];G.phase=over?'gameEnd':'roundEnd';render();
}

function doGifts(){
  const nh=G.hands.map(h=>[...h]);
  const gs=[G.gifts[0]];
  for(let i=1;i<4;i++){
    gs.push(chooseSmartGift(nh[i],botDifficulty));
  }
  G.knownGiftedLees=[];
  for(let i=1;i<4;i++){
    gs[i].filter(isLee).forEach(c=>{
      G.knownGiftedLees.push({from:i,to:(i+1)%4,color:c.color,type:c.type,name:c.color==='blue'?'blue +2':'yellow 0'});
    });
  }
  for(let i=0;i<4;i++)gs[i].forEach(c=>{nh[i]=nh[i].filter(x=>x.id!==c.id);});
  for(let i=0;i<4;i++)gs[i].forEach(c=>nh[(i+1)%4].push(c));
  // capture the 3 cards that came to player 0 (gs[3] gifted to player 0 = gs[(3+1)%4=0])
  const incomingGift=gs[3]; // bot3 gifts to player 0
  G.hands=nh.map(sortHand);G.phase='play';G.currentPlayer=nextRoundStarter;G.leadColor=null;G.table=[];G.selected=[];
  // mark incoming cards for glow
  giftedIds=new Set(incomingGift.map(c=>c.id));
  setStatus();render();
  // clear glow after 5 seconds
  setTimeout(()=>{giftedIds=new Set();render();},5000);
  startTimer();
}

function aiPlay(){
  if(G.phase!=='play'||G.currentPlayer===0||resolving)return;
  const idx=G.currentPlayer,pl=getPlayable(idx);
  const choice=botDifficulty==='easy'?pickEasyCard(pl):pickSmartCard(idx,pl,botDifficulty);
  if(botDifficulty==='hard')G.statusMsg=`${pname(idx)}: ${choice.reason}.`;
  executePlay(idx,choice.card||pl[0],botDifficulty==='hard'?choice.reason:'');
}

// ── CARD HTML ──────────────────────────────────────────────
function cardEl(card,opts={}){
  const{selectable=false,playable=true,selected=false,rot=0,offsuit=false,small=false,gifted=false}=opts;
  const p=pts(card),ptag=p>0?`<span class="ptag">${p}</span>`:'';
  const l=lbl(card);
  const cc=COLOR_CLASS[card.color];
  const cls=['card',cc,selected?'selected':'',selectable&&playable?'playable':'',selectable&&!playable?'unplayable':'',offsuit?'offsuit':'',gifted?'gifted':''].filter(Boolean).join(' ');
  const w=small?40:54,h=small?62:82,fs=small?15:20;
  const style=`width:${w}px;height:${h}px;font-size:${fs}px;--rot:${rot}deg${rot?`;transform:rotate(${rot}deg)`:''}`;
  return `<div class="${cls}" style="${style}"
    ${selectable?`data-play="${card.id}"`:''}
    >
    ${ptag}
    <span class="corner tl">${l}</span>
    <div class="cnum">${l}</div>
    <div class="csym">${card.color}</div>
    <span class="corner br">${l}</span>
  </div>`;
}

function miniBackCards(n,vertical=false){
  if(vertical)return Array(Math.min(n,8)).fill(0).map(()=>`<div class="mini-back-v"></div>`).join('');
  return Array(Math.min(n,13)).fill(0).map((_,i)=>`<div class="mini-back" style="margin-right:${i<n-1?'-10px':'0'};z-index:${i}"></div>`).join('');
}

// ── RENDER ────────────────────────────────────────────────
function render(){
  document.getElementById('root').innerHTML=buildHTML();
  attachEvents();
  updateTimerBar();
}

function buildHTML(){
  const modal=G.modal?buildModal():'';
  if(G.phase==='menu')return buildMenuHTML()+modal;
  if(G.phase==='quickSetup')return buildQuickSetupHTML()+modal;
  if(G.phase==='customRoom')return buildCustomRoomHTML()+modal;
  if(G.phase==='roomLobby')return buildRoomLobbyHTML()+modal;
  if(G.phase==='gift')return buildGiftHTML()+modal;

  const isMyTurn=G.currentPlayer===0&&!resolving&&G.phase==='play';
  const playableIds=new Set((isMyTurn?getPlayable(0):[]).map(c=>c.id));
  const selIds=new Set(G.selected.map(c=>c.id));

  // TABLE CENTER CARDS
  const rots=[5,-5,10,-10];
  const tableCards=G.table.length===0
    ?`<span style="font-size:12px;color:rgba(255,255,255,0.4)">Waiting for first card...</span>`
    :G.table.map((t,i)=>{
        const offsuit=G.leadColor&&t.card.color!==G.leadColor;
        return `<div class="played-slot">
          <span class="played-name">${pname(t.pi)}${offsuit?' *':''}</span>
          <div class="table-card" style="transform:rotate(${(i-1.5)*4}deg)">${cardEl(t.card,{offsuit})}</div>
        </div>`;
      }).join('');

  // MY HAND — fan slightly
  const myHand=G.hands[0];
  const n=myHand.length;
  const handHTML=myHand.map((c,i)=>{
    const offset=n>1?(i/(n-1)-0.5)*Math.min(n*2,24):0;
    const yOff=Math.abs(offset)*0.3;
    const sel=selIds.has(c.id);
    const play=playableIds.has(c.id);
    const gifted=giftedIds.has(c.id);
    return `<div style="transform:rotate(${offset}deg) translateY(${yOff}px);transform-origin:bottom center;display:inline-block">
      ${cardEl(c,{selectable:isMyTurn,playable:play,selected:sel,gifted})}
    </div>`;
  }).join('');

  // AVATAR ACTIVE STATE
  const av=(i,letter)=>{
    const active=G.currentPlayer===i&&!resolving&&G.phase==='play';
    return `<div class="avatar${active?' active':''}">${letter}</div>`;
  };

  // timer ring (shown only on player's turn)
  const isMyTurnNow=G.currentPlayer===0&&!resolving&&G.phase==='play';
  const myTimerId=isMyTurnNow?' id="turn-timer-ring"':'';
  const myTimerClass=isMyTurnNow?' timer-ring':'';

  return `
<button class="back-arrow" onclick="backToMenu()" aria-label="Back to menu">&lsaquo;</button>
<div id="table-wrap">

  <!-- TOP: Bot 2 -->
  <div class="tz-top2">
    <div class="player-zone">
      ${av(2,'B2')}
      <span class="pname">${pname(2)}</span>
      <span class="pscore">${G.scores[2]}pts</span>
      <div style="display:flex;margin-top:2px;width:120px;justify-content:center;overflow:hidden">${miniBackCards(G.hands[2].length)}</div>
    </div>
  </div>

  <!-- LEFT: Bot 3 -->
  <div class="tz-left">
    <div class="player-zone">
      ${av(3,'B3')}
      <span class="pname">${pname(3)}</span>
      <span class="pscore">${G.scores[3]}pts</span>
      <div style="display:flex;flex-direction:column;align-items:center;gap:1px;margin-top:2px;min-height:80px">
        ${Array(Math.min(G.hands[3].length,8)).fill(0).map((_,i)=>`<div class="mini-back-v" style="margin-bottom:-8px;z-index:${i}"></div>`).join('')}
      </div>
    </div>
  </div>

  <!-- CENTER: table -->
  <div class="tz-mid">
    ${G.leadColor?`<div class="lead-chip">Lead: ${G.leadColor}</div>`:''}
    <div class="table-played">${tableCards}</div>
    <div class="status-bar">${G.statusMsg}</div>
    ${G.botThought?`<div class="thought-chip">${G.botThought}</div>`:''}
  </div>

  <!-- RIGHT: Bot 1 -->
  <div class="tz-right">
    <div class="player-zone">
      ${av(1,'B1')}
      <span class="pname">${pname(1)}</span>
      <span class="pscore">${G.scores[1]}pts</span>
      <div style="display:flex;flex-direction:column;align-items:center;gap:1px;margin-top:2px;min-height:80px">
        ${Array(Math.min(G.hands[1].length,8)).fill(0).map((_,i)=>`<div class="mini-back-v" style="margin-bottom:-8px;z-index:${i}"></div>`).join('')}
      </div>
    </div>
  </div>

  <!-- BOTTOM: My area -->
  <div class="tz-btm">
    <div class="my-info">
      ${av(0,'You')}
      <div class="my-name-ring${myTimerClass}"${myTimerId}>
        <span class="pname">${pname(0)}</span>
        <span class="pscore">${G.scores[0]}pts</span>
      </div>
    </div>
    <div id="my-hand">${handHTML}</div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button class="chip-btn" onclick="showRules()">Rules</button>
<button class="chip-btn gold" onclick="createOnlineRoom()">Create Room</button>
<button class="chip-btn" onclick="joinOnlineRoom()">Join Room</button>
    </div>
  </div>

</div>
${modal}`;
}


// ── GIFT PHASE ────────────────────────────────────────────
function buildGiftHTML(){
  const selSet=new Set(G.selected.map(c=>c.id));
  const hand=G.hands[0];
  const violation=G.selected.length>0&&giftViolatesColor(hand,G.selected);
  const n=hand.length;
  const handHTML=hand.map((c,i)=>{
    const offset=n>1?(i/(n-1)-0.5)*Math.min(n*2,24):0;
    const yOff=Math.abs(offset)*0.3;
    const sel=selSet.has(c.id);
    const p=pts(c);
    const ptag=p>0?`<span class="ptag">${p}</span>`:'';
    const cc=COLOR_CLASS[c.color];
    return `<div style="transform:rotate(${offset}deg) translateY(${yOff}px);transform-origin:bottom center;display:inline-block">
      <div class="card ${cc}${sel?' selected':''}" data-gift="${c.id}" style="cursor:pointer">
        ${ptag}
        <span class="corner tl">${lbl(c)}</span>
        <div class="cnum">${lbl(c)}</div>
        <div class="csym">${c.color}</div>
        <span class="corner br">${lbl(c)}</span>
      </div>
    </div>`;
  }).join('');

  return `
<button class="back-arrow" onclick="backToMenu()" aria-label="Back to menu">&lsaquo;</button>
<div id="table-wrap">

  <!-- TOP: Bot 2 -->
  <div class="tz-top2">
    <div class="player-zone">
      <div class="avatar">B2</div>
      <span class="pname">${pname(2)}</span>
      <span class="pscore">${G.scores[2]}pts</span>
      <div style="display:flex;margin-top:2px;width:120px;justify-content:center;overflow:hidden">${miniBackCards(G.hands[2].length)}</div>
    </div>
  </div>

  <!-- LEFT: Bot 3 -->
  <div class="tz-left">
    <div class="player-zone">
      <div class="avatar">B3</div>
      <span class="pname">${pname(3)}</span>
      <span class="pscore">${G.scores[3]}pts</span>
      <div style="display:flex;flex-direction:column;align-items:center;gap:1px;margin-top:2px;min-height:80px">
        ${Array(Math.min(G.hands[3].length,8)).fill(0).map((_,i)=>`<div class="mini-back-v" style="margin-bottom:-8px;z-index:${i}"></div>`).join('')}
      </div>
    </div>
  </div>

  <!-- CENTER: gift instructions -->
  <div class="tz-mid">
    <div style="background:rgba(0,0,0,0.4);border-radius:14px;padding:10px 20px;text-align:center;border:1px solid rgba(255,255,255,0.1)">
      <div style="color:rgba(255,220,100,0.9);font-size:13px;font-weight:600">Gift 3 cards to ${pname(1)}</div>
      <div style="color:rgba(255,255,255,0.6);font-size:11px;margin-top:2px">${G.selected.length}/3 selected</div>
      ${violation?`<div class="warn-chip" style="margin-top:6px">Warning: Holding Lee5a - can't empty a color</div>`:''}
    </div>
  </div>

  <!-- RIGHT: Bot 1 -->
  <div class="tz-right">
    <div class="player-zone">
      <div class="avatar">B1</div>
      <span class="pname">${pname(1)}</span>
      <span class="pscore">${G.scores[1]}pts</span>
      <div style="display:flex;flex-direction:column;align-items:center;gap:1px;margin-top:2px;min-height:80px">
        ${Array(Math.min(G.hands[1].length,8)).fill(0).map((_,i)=>`<div class="mini-back-v" style="margin-bottom:-8px;z-index:${i}"></div>`).join('')}
      </div>
    </div>
  </div>

  <!-- BOTTOM: My hand + gift button -->
  <div class="tz-btm">
    <div class="my-info">
      <div class="avatar">You</div>
      <span class="pname">${pname(0)}</span>
      <span class="pscore">${G.scores[0]}pts</span>
    </div>
    <div id="my-hand">${handHTML}</div>
    <button class="chip-btn gold" onclick="confirmGift()" ${G.selected.length!==3||violation?'disabled':''}>
      Gift selected ->
    </button>
  </div>

</div>`;
}


// ── MODAL ────────────────────────────────────────────────
function buildModal(){
  const m=G.modal;
  if(m.type==='rules')return`<div class="modal-bg" onclick="closeModal()"><div class="modal-box" onclick="event.stopPropagation()">
    <h3>Lee5a Rules</h3>
    <div style="font-size:12px;line-height:1.9;color:rgba(255,255,255,0.75)">
      <b style="color:#ffe066">Goal:</b> Avoid points. First to 101 loses.<br>
      <b style="color:#ffe066">Scoring:</b> Blue +2 = 13pts - Yellow 0 = 10pts - Red = 1pt each<br>
      <b style="color:#ffe066">Gifting:</b> Gift 3 cards right. Holding lee5a? Can't empty any color.<br>
      <b style="color:#ffe066">Winner:</b> Only lead-color cards compete for the trick.<br>
      <b style="color:#ffe066">Strength:</b> 1 > Skip > +2 > Rev > 0 > 9...2<br>
      <b style="color:#ffe066">Lee5a:</b> Both blue +2 and yellow 0 taken in the same trick = 37 pts, and the round ends immediately.
    </div>
    <div style="text-align:center;margin-top:12px"><button class="chip-btn" onclick="closeModal()">Close</button></div>
  </div></div>`;

  const isEnd=m.type==='gameEnd';
  const loserIdx=m.sc.indexOf(Math.max(...m.sc));
  const names=playerNames;
  const rows=names.map((n,i)=>`<div class="modal-row${m.sc[i]>=101?' danger':''}">
    <div class="mn">${n}</div>
    <div class="mv">${m.rp[i]>0?'+'+m.rp[i]:0} -> ${m.sc[i]}</div>
  </div>`).join('');
  return`<div class="modal-bg"><div class="modal-box">
    <h3>${isEnd?'Game Over!':'Round Over'}</h3>
    ${isEnd?`<div style="color:#ff6666;font-size:12px;text-align:center;margin-bottom:8px">${names[loserIdx]} reached 101+!</div>`:''}
    <div class="modal-rows">${rows}</div>
    <div style="display:flex;justify-content:center;margin-top:12px">
      ${isEnd?`<button class="chip-btn gold" onclick="newGame()">New Game</button>`:`<button class="chip-btn gold" onclick="nextRound()">Next Round</button>`}
    </div>
  </div></div>`;
}

function attachEvents(){
  document.querySelectorAll('[data-gift]').forEach(el=>{
    el.addEventListener('click',()=>{
      const id=el.dataset.gift,card=G.hands[0].find(c=>c.id===id);if(!card)return;
      const idx=G.selected.findIndex(c=>c.id===id);
      if(idx>=0)G.selected.splice(idx,1);else if(G.selected.length<3)G.selected.push(card);
      render();
    });
  });
  document.querySelectorAll('[data-play]').forEach(el=>{
    el.addEventListener('click',()=>{
      if(G.currentPlayer!==0||resolving)return;
      const id=el.dataset.play,card=G.hands[0].find(c=>c.id===id);if(!card)return;
      if(!getPlayable(0).find(c=>c.id===card.id))return;
      executePlay(0,card);
    });
  });
}

// ── TIMER ────────────────────────────────────────────────
function startTimer(){
  stopTimer();
  turnTimeLeft=20;
  updateTimerBar();
  turnTimer=setInterval(()=>{
    turnTimeLeft--;
    updateTimerBar();
    if(turnTimeLeft<=0){
      stopTimer();
      // auto-play: pick first playable card
      const pl=getPlayable(0);
      if(pl.length)executePlay(0,pl[0]);
    }
  },1000);
}
function stopTimer(){
  if(turnTimer!==null){clearInterval(turnTimer);turnTimer=null;}
  turnTimeLeft=20;
  updateTimerBar();
}
function updateTimerBar(){
  const ring=document.getElementById('turn-timer-ring');
  if(!ring)return;
  const pct=(turnTimeLeft/20)*100;
  const r=Math.round(255*(1-turnTimeLeft/20));
  const g=Math.round(200*(turnTimeLeft/20));
  ring.style.setProperty('--timer-pct',pct+'%');
  ring.style.setProperty('--timer-color',`rgb(${r},${g},40)`);
}

function buildMenuHTML(){
  return `
<div class="menu-screen">
  <div class="menu-mark">
    <div class="menu-card-stack">
      <div class="menu-card menu-card-red">+2</div>
      <div class="menu-card menu-card-blue">0</div>
      <div class="menu-card menu-card-gold">1</div>
    </div>
    <h1>Lee5a</h1>
    <p>Fast table play. Avoid the points.</p>
  </div>
  <div class="menu-actions">
    <button class="menu-btn primary" onclick="openQuickSetup()">Quick Play</button>
    <button class="menu-btn" onclick="openCustomRoom()">Custom Room</button>
    <button class="menu-btn" onclick="showRules()">Rules</button>
  </div>
</div>`;
}
function buildQuickSetupHTML(){
  return `
<button class="back-arrow" onclick="backToMenu()" aria-label="Back to menu">&lsaquo;</button>
<div class="menu-screen room-screen">
  <div class="room-panel quick-panel">
    <h1>Quick Play</h1>
    <p>Choose bot difficulty before the match starts.</p>
    ${buildDifficultyPicker()}
    <div class="room-actions">
      <button class="menu-btn primary" onclick="quickPlay()">Start Match</button>
      <button class="menu-btn subtle" onclick="backToMenu()">Back</button>
    </div>
  </div>
</div>`;
}
function buildDifficultyPicker(){
  const notes={
    easy:'basic safe-card play',
    medium:'protects suit cover and avoids Lee5a traps',
    hard:'counts dropped suits, tracks hidden Lee5as, and explains risky plays'
  };
  return `<div class="difficulty-box">
    <div class="difficulty-label">Bot difficulty</div>
    <div class="difficulty-options">
      ${['easy','medium','hard'].map(d=>`<button class="difficulty-btn ${botDifficulty===d?'active':''}" onclick="setBotDifficulty('${d}')">${d}</button>`).join('')}
    </div>
    <div class="difficulty-note">${notes[botDifficulty]}</div>
  </div>`;
}

function makeRoomCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code='';
  for(let i=0;i<6;i++)code+=chars[Math.floor(Math.random()*chars.length)];
  return code.slice(0,3)+'-'+code.slice(3);
}
function defaultRoomPlayers(){
  return [
    {type:'host',name:'You'},
    null,
    null,
    null
  ];
}

function buildCustomRoomHTML(){
  const mode=G.roomMode||'choice';
  if(mode==='create')return buildCreateRoomHTML();
  if(mode==='join')return buildJoinRoomHTML();
  return `
<div class="menu-screen room-screen">
  <div class="room-panel">
    <h1>Custom Room</h1>
    <p>Create a private room or join one with a shared code.</p>
    ${G.roomMsg?`<div class="room-msg">${G.roomMsg}</div>`:''}
    <div class="room-actions">
      <button class="menu-btn primary" onclick="createOnlineRoom()">Create Room</button>
<button class="menu-btn" onclick="joinOnlineRoom()">Join Room</button>
      <button class="menu-btn subtle" onclick="backToMenu()">Back</button>
    </div>
  </div>
</div>`;
}
function buildCreateRoomHTML(){
  const code=G.roomCode||'------';
  return `
<button class="back-arrow" onclick="openCustomRoom()" aria-label="Back to custom room">&lsaquo;</button>
<div class="menu-screen room-screen">
  <div class="room-panel">
    <h1>Make Room</h1>
    <p>Share this code with invited players.</p>
    <div class="room-code">${code}</div>
    ${G.roomMsg?`<div class="room-msg">${G.roomMsg}</div>`:''}
    <div class="room-actions">
      <button class="menu-btn primary" onclick="enterRoomLobby()">Enter Room</button>
      <button class="menu-btn" onclick="copyRoomCode()">Copy Code</button>
      <button class="menu-btn subtle" onclick="openCustomRoom()">Back</button>
    </div>
  </div>
</div>`;
}
function buildJoinRoomHTML(){
  return `
<button class="back-arrow" onclick="openCustomRoom()" aria-label="Back to custom room">&lsaquo;</button>
<div class="menu-screen room-screen">
  <div class="room-panel">
    <h1>Join Room</h1>
    <p>Enter the room code someone shared with you.</p>
    <input class="room-input" id="join-room-code" maxlength="7" placeholder="ABC-123" value="${G.joinCode||''}">
    ${G.roomMsg?`<div class="room-msg">${G.roomMsg}</div>`:''}
    <div class="room-actions">
      <button class="menu-btn primary" onclick="joinCustomRoom()">Join Room</button>
      <button class="menu-btn subtle" onclick="openCustomRoom()">Back</button>
    </div>
  </div>
</div>`;
}

function buildRoomLobbyHTML(){
  const players=G.roomPlayers||defaultRoomPlayers();
  const filled=players.filter(Boolean).length;
  const canStart=filled===4;
  const seats=players.map((p,i)=>{
    const label=p?p.name:'Empty';
    const kind=p?p.type:'empty';
    const canAddBot=!p;
    const canRemoveSeat=p&&p.type!=='host';
    return `<div class="seat-wrap">
    <div class="seat-number">Seat ${i+1}</div>
    <div class="seat-card ${kind}">
      <div class="seat-top">
        <div class="seat-avatar">${p?(p.type==='host'?'H':p.name.replace('Bot ','B')):'+'}</div>
        <div>
          <div class="seat-name">${label}</div>
          <div class="seat-role">${p?(p.type==='host'?'Host':p.type==='bot'?'Bot':'Player'):'Waiting'}</div>
        </div>
      </div>
      <div class="seat-controls">
        <button class="seat-btn" onclick="moveSeat(${i},-1)" ${i===0||kind==='host'?'disabled':''}>Up</button>
        <button class="seat-btn" onclick="moveSeat(${i},1)" ${i===3||kind==='host'?'disabled':''}>Down</button>
        ${canAddBot?`<button class="seat-btn" onclick="addPlayerToSeat(${i})">Player</button>`:''}
        ${canAddBot?`<button class="seat-btn gold" onclick="addBotToSeat(${i})">Bot</button>`:''}
        ${canRemoveSeat?`<button class="seat-btn danger" onclick="removeSeat(${i})">Remove</button>`:''}
      </div>
    </div>
    </div>`;
  }).join('');
  return `
<button class="back-arrow" onclick="backToMenu()" aria-label="Back to menu">&lsaquo;</button>
<div class="menu-screen lobby-screen">
  <div class="lobby-head">
    <h1>Room ${G.roomCode||'------'}</h1>
    <p>Host can arrange seats and fill missing spots with bots.</p>
  </div>
  ${buildDifficultyPicker()}
  <div class="seat-grid">${seats}</div>
  ${G.roomMsg?`<div class="room-msg">${G.roomMsg}</div>`:''}
  <div class="room-actions">
    <button class="menu-btn primary" onclick="startCustomRoom()" ${canStart?'':'disabled'}>Start Game</button>
    <button class="menu-btn" onclick="addNextBot()" ${filled>=4?'disabled':''}>Add Bot</button>
    <button class="menu-btn subtle" onclick="openCustomRoom()">Room Code</button>
  </div>
</div>`;
}

window.confirmGift=function(){
  if(G.selected.length!==3||giftViolatesColor(G.hands[0],G.selected))return;
  G.gifts[0]=[...G.selected];setTimeout(doGifts,300);
};
window.nextRound=function(){G.modal=null;newRound();};
window.newGame=function(){initGame();};
window.showRules=function(){G.modal={type:'rules'};render();};
window.closeModal=function(){G.modal=null;render();};
window.setBotDifficulty=function(level){botDifficulty=level;render();};
window.openQuickSetup=function(){stopTimer();G={phase:'quickSetup',modal:null};render();};
window.quickPlay=function(){initGame();};
window.openCustomRoom=function(){stopTimer();G={phase:'customRoom',modal:null,roomMode:'choice',roomCode:null,joinCode:'',roomMsg:''};render();};
window.showCreateRoom=function(){G.roomMode='create';G.roomCode=makeRoomCode();G.roomMsg='';render();};
window.showJoinRoom=function(){G.roomMode='join';G.joinCode='';G.roomMsg='';render();};
window.enterRoomLobby=function(){
  G={phase:'roomLobby',modal:null,roomCode:G.roomCode||makeRoomCode(),roomMsg:'',roomPlayers:defaultRoomPlayers()};
  render();
};
window.joinCustomRoom=function(){
  const input=document.getElementById('join-room-code');
  const raw=(input&&input.value?input.value:G.joinCode||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(raw.length<6){G.roomMsg='Enter a 6-character room code.';render();return;}
  const code=raw.slice(0,3)+'-'+raw.slice(3,6);
  G={phase:'roomLobby',modal:null,roomCode:code,roomMsg:'Joined room locally. Online joining needs the realtime server next.',roomPlayers:defaultRoomPlayers()};
  render();
};
window.startCustomRoom=function(){
  const players=G.roomPlayers||[];
  if(players.filter(Boolean).length<4){G.roomMsg='Fill all 4 seats before starting.';render();return;}
  initGame(players.map(p=>p.name));
};
window.backToMenu=function(){initMenu();};
window.moveSeat=function(i,dir){
  const players=[...(G.roomPlayers||defaultRoomPlayers())];
  const j=i+dir;
  if(j<0||j>=players.length)return;
  if((players[i]&&players[i].type==='host')||(players[j]&&players[j].type==='host'))return;
  [players[i],players[j]]=[players[j],players[i]];
  G.roomPlayers=players;G.roomMsg='Seats updated.';render();
};
window.addBotToSeat=function(i){
  const players=[...(G.roomPlayers||defaultRoomPlayers())];
  if(players[i])return;
  const botNum=players.filter(p=>p&&p.type==='bot').length+1;
  players[i]={type:'bot',name:`Bot ${botNum}`};
  G.roomPlayers=players;G.roomMsg=`Bot added to slot ${i+1}.`;render();
};
window.addPlayerToSeat=function(i){
  const players=[...(G.roomPlayers||defaultRoomPlayers())];
  if(players[i])return;
  const playerNum=players.filter(p=>p&&p.type==='player').length+2;
  players[i]={type:'player',name:`Player ${playerNum}`};
  G.roomPlayers=players;G.roomMsg=`Player joined slot ${i+1}.`;render();
};
window.addNextBot=function(){
  const players=[...(G.roomPlayers||defaultRoomPlayers())];
  const idx=players.findIndex(p=>!p);
  if(idx>=0){G.roomPlayers=players;addBotToSeat(idx);}
};
window.removeSeat=function(i){
  const players=[...(G.roomPlayers||defaultRoomPlayers())];
  if(players[i]&&players[i].type!=='host'){
    players[i]=null;G.roomPlayers=players;G.roomMsg=`Slot ${i+1} is open.`;render();
  }
};
window.copyRoomCode=function(){
  const code=G.roomCode||'';
  if(navigator.clipboard&&code){
    navigator.clipboard.writeText(code).then(()=>{G.roomMsg='Room code copied.';render();}).catch(()=>{G.roomMsg='Copy failed. Select the code manually.';render();});
  } else {
    G.roomMsg='Select the code manually.';
    render();
  }
};

function newRound(){
  const deck=shuffle(buildDeck());const hands=[[],[],[],[]];
  deck.forEach((c,i)=>hands[i%4].push(c));
  G.hands=hands.map(sortHand);G.phase='gift';G.gifts=[null,null,null,null];G.table=[];
  G.leadColor=null;G.selected=[];G.statusMsg=`Choose 3 cards to gift to ${pname(1)}`;G.botThought='';G.playedCards=[];G.knownGiftedLees=[];G.modal=null;G.roundPts=[0,0,0,0];
  resolving=false;giftedIds=new Set();stopTimer();render();
}

initMenu();
window.createOnlineRoom = function () {
  socket.emit("createRoom");
};

window.joinOnlineRoom = function () {
  const roomCode = prompt("Enter room code:");
  if (!roomCode) return;

  const name = prompt("Enter your name:") || "Player";

  socket.emit("joinRoom", {
    roomCode: roomCode.trim().toUpperCase(),
    name
  });
};