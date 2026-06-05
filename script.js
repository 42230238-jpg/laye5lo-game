const BACKEND_URL = "https://laye5lo-game.onrender.com";
const socket = io(BACKEND_URL);

// ── SOUND SYSTEM ─────────────────────────────────────────────
const SFX = (() => {
  // Pre-load the 5 lee5a voice clips
  const leeSounds = [1,2,3,4,5].map(n => {
    const a = new Audio(`sounds/lee5a-${n}.m4a`);
    a.preload = 'auto';
    return a;
  });

  // Simple synthesised sound-effects using the Web Audio API
  let ctx = null;
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function playTone(freq, type, duration, gain=0.18, delay=0) {
    try {
      const ac = getCtx();
      const osc = ac.createOscillator();
      const gainNode = ac.createGain();
      osc.connect(gainNode);
      gainNode.connect(ac.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ac.currentTime + delay);
      gainNode.gain.setValueAtTime(0, ac.currentTime + delay);
      gainNode.gain.linearRampToValueAtTime(gain, ac.currentTime + delay + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + duration);
      osc.start(ac.currentTime + delay);
      osc.stop(ac.currentTime + delay + duration + 0.05);
    } catch(e) {}
  }

  // Play a random lee5a voice clip
  function playLee() {
    const idx = Math.floor(Math.random() * leeSounds.length);
    const snd = leeSounds[idx];
    snd.currentTime = 0;
    snd.play().catch(()=>{});
  }

  // Card-play whoosh: quick descending sweep
  function playCardPlay() {
    try {
      const ac = getCtx();
      const osc = ac.createOscillator();
      const gainNode = ac.createGain();
      osc.connect(gainNode);
      gainNode.connect(ac.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(200, ac.currentTime + 0.18);
      gainNode.gain.setValueAtTime(0.14, ac.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.22);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + 0.25);
    } catch(e) {}
  }

  // Your-turn chime: two quick ascending notes
  function playMyTurn() {
    playTone(520, 'sine', 0.12, 0.13, 0);
    playTone(780, 'sine', 0.18, 0.10, 0.13);
  }

  return { playLee, playCardPlay, playMyTurn };
})();

// ── ANIMATION SYSTEM ─────────────────────────────────────
const ANIM = (() => {
  // ── helpers ──────────────────────────────────────────────
  function colorClass(color){
    return {red:'cr',blue:'cb',green:'cg',yellow:'cy'}[color]||'cb';
  }
  function cardLabel(card){
    if(card.type==='draw2')return '+2';
    if(card.type==='skip')return '⊘';
    if(card.type==='reverse')return '↺';
    return card.type;
  }
  // Get the bounding rect of a CSS selector, return center {x,y}
  function center(sel){
    const el=document.querySelector(sel);
    if(!el)return null;
    const r=el.getBoundingClientRect();
    return{x:r.left+r.width/2, y:r.top+r.height/2};
  }
  // Get anim-layer (create if missing)
  function layer(){
    let el=document.getElementById('anim-layer');
    if(!el){
      el=document.createElement('div');
      el.id='anim-layer';
      const game=document.getElementById('game')||document.body;
      game.appendChild(el);
    }
    return el;
  }
  function clearLayer(){
    const l=document.getElementById('anim-layer');
    if(l)l.innerHTML='';
  }

  // ── SHUFFLE + DEAL ────────────────────────────────────────
  // Shows a shuffle animation then calls `done` when finished.
  // totalCards = 52, dealTo = array of 4 selector strings for player hand zones.
  function shuffleAndDeal(done){
    // Inject the overlay
    const game=document.getElementById('game')||document.body;
    const overlay=document.createElement('div');
    overlay.id='shuffle-overlay';

    const NSTACK=8; // visible stacked cards
    const deckHTML=Array(NSTACK).fill(0).map((_,i)=>`<div class="sdeck-card" style="transform:translate(${(i-NSTACK/2)*0.6}px,${-i*0.9}px);z-index:${i}"></div>`).join('');
    overlay.innerHTML=`<div id="shuffle-deck">${deckHTML}</div><div id="shuffle-label">Shuffling…</div>`;
    game.appendChild(overlay);

    const deck=overlay.querySelector('#shuffle-deck');
    const cards=[...deck.querySelectorAll('.sdeck-card')];

    // ── Phase 1: 3 quick shuffle pulses ──
    let pulse=0;
    function doPulse(){
      if(pulse>=3){afterShuffle();return;}
      cards.forEach((c,i)=>{
        const goLeft=i%2===0;
        c.style.animation='none';
        c.getBoundingClientRect(); // force reflow
        c.style.animation=`${goLeft?'shuffle-left':'shuffle-right'} 0.32s ease forwards`;
      });
      pulse++;
      setTimeout(doPulse, 340);
    }
    doPulse();

    // ── Phase 2: deal 4 cards outward ──
    function afterShuffle(){
      overlay.querySelector('#shuffle-label').textContent='Dealing…';
      // Positions relative to the overlay center
      const dirs=[
        {dx:0,   dy:-220, kf:'sdeal-top'},
        {dx:220, dy:0,    kf:'sdeal-right'},
        {dx:0,   dy:220,  kf:'sdeal-bottom'},
        {dx:-220,dy:0,    kf:'sdeal-left'},
      ];
      dirs.forEach((d,i)=>{
        setTimeout(()=>{
          const c=document.createElement('div');
          c.className='sdeck-card';
          c.style.cssText=`z-index:${NSTACK+i};animation:${d.kf} 0.42s cubic-bezier(.4,0,.2,1) forwards`;
          deck.appendChild(c);
        }, i*80);
      });
      // Fade out overlay after dealing done
      setTimeout(()=>{
        overlay.style.transition='opacity 0.35s';
        overlay.style.opacity='0';
        setTimeout(()=>{
          overlay.remove();
          done();
        },360);
      }, 4*80+440);
    }
  }

  // ── CARD FLY (drop onto table) ────────────────────────────
  // Animates a card flying from `fromRect` center → `toRect` center.
  // card = {color, type}. onDone called after animation.

  function flyCard(card, fromX, fromY, toX, toY, onDone){
    const lbl=cardLabel(card);
    const cc=colorClass(card.color);
    const el=document.createElement('div');
    el.className=`fly-card ${cc}`;
    el.innerHTML=`<span class="fly-label">${lbl}</span><span class="fly-sym">${card.color}</span>`;
    // Place at source, no transition yet, invisible
    el.style.left=fromX+'px';
    el.style.top=fromY+'px';
    el.style.opacity='0';
    el.style.transition='none';
    document.body.appendChild(el);
    // Read ACTUAL rendered size (respects CSS variables at current breakpoint)
    const fr=el.getBoundingClientRect();
    const hw=(fr.width||54)/2;
    const hh=(fr.height||82)/2;
    el.style.left=(fromX-hw)+'px';
    el.style.top=(fromY-hh)+'px';
    // Double rAF: enable transition then fly to destination in one clean step
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        el.style.transition='left 0.32s cubic-bezier(.4,0,.2,1),top 0.32s cubic-bezier(.4,0,.2,1),opacity 0.18s ease';
        el.style.opacity='1';
        el.style.left=(toX-hw)+'px';
        el.style.top=(toY-hh)+'px';
        setTimeout(()=>{
          if(onDone) onDone();
          el.style.opacity='0';
          setTimeout(()=>el.remove(), 150);
        },320);
      });
    });
  }

  // ── TRICK SWEEP ──────────────────────────────────────────
  // Animates all table cards flying toward winner's avatar, then calls onDone.
  // slots = array of {card, el: DOMRect of the played slot}
  // winnerRect = DOMRect of winner avatar
  function sweepTrick(slotRects, winnerX, winnerY, onDone){
    const animLayer=layer();
    const gEl=document.getElementById('game');
    const gr=gEl?gEl.getBoundingClientRect():{left:0,top:0};

    // Win burst ring at winner's avatar position (game-relative coords)
    const ring=document.createElement('div');
    ring.className='win-ring';
    ring.style.cssText=`left:${winnerX-gr.left-28}px;top:${winnerY-gr.top-28}px`;
    animLayer.appendChild(ring);
    setTimeout(()=>ring.remove(),700);

    // Sweep each card: read live positions or use pre-computed rects
    const liveSlots=document.querySelectorAll('.played-slot');
    const sources=liveSlots.length>0
      ? [...liveSlots].map(slot=>{
          const cardEl2=slot.querySelector('.card');
          if(!cardEl2)return null;
          const cr2=cardEl2.getBoundingClientRect();
          const colorCls=['cr','cb','cg','cy'].find(c=>cardEl2.classList.contains(c))||'cr';
          return{left:cr2.left,top:cr2.top,width:cr2.width,height:cr2.height,colorCls};
        }).filter(Boolean)
      : slotRects.map(({card,x,y})=>{
          const fr=document.querySelector('.fly-card');
          const w=(fr?fr.getBoundingClientRect().width:null)||54;
          const h=(fr?fr.getBoundingClientRect().height:null)||82;
          return{left:x-w/2,top:y-h/2,width:w,height:h,colorCls:colorClass(card.color)};
        });

    sources.forEach(({left,top,width,height,colorCls})=>{
      const sw=document.createElement('div');
      sw.className=`sweep-card ${colorCls}`;
      sw.style.cssText=`position:fixed;left:${left}px;top:${top}px;`+
                       `width:${width}px;height:${height}px;opacity:1;transition:none;border-radius:9px;`;
      document.body.appendChild(sw);
      void sw.offsetWidth; // force reflow before enabling transition
      sw.style.transition='transform 0.45s cubic-bezier(.4,0,.6,1),opacity 0.45s ease';
      const dx=winnerX-left, dy=winnerY-top;
      sw.style.transform=`translate(${dx}px,${dy}px) scale(0.25)`;
      sw.style.opacity='0';
      setTimeout(()=>sw.remove(),500);
    });

    setTimeout(()=>{if(onDone)onDone();},480);
  }

  // ── PUBLIC INTERFACE ─────────────────────────────────────
  return { shuffleAndDeal, flyCard, sweepTrick, center };
})();


socket.on("connect", () => {
  console.log("Connected to multiplayer server:", socket.id);
});

socket.on("disconnect", () => {
  console.log("Disconnected from multiplayer server");
});

socket.on("roomCreated", (data) => {
  console.log("Room created:", data);

  G = {
    ...G,
    phase: "roomLobby",
    modal: null,
    roomCode: data.roomCode,
    isHost: true,
    roomMsg: "Room created! Share this code: " + data.roomCode,
    roomPlayers: mapOnlineSeats(data.seats)
  };

  render();
});

socket.on("roomUpdated", (data) => {
  console.log("Room updated:", data);

  // Preserve isHost: true if our socket id matches the hostId the server sent
  const weAreHost = data.hostId === socket.id;

  G = {
    ...G,
    phase: "roomLobby",
    modal: null,
    roomCode: data.roomCode,
    isHost: weAreHost,
    roomMsg: weAreHost
      ? "Lobby updated. Players: " + data.seats.filter(Boolean).length
      : "Waiting for host...",
    roomPlayers: mapOnlineSeats(data.seats)
  };

  render();
});

socket.on("gameStarted", (data) => {
  console.log("Game started — seat", data.mySeatIndex, "room", data.roomCode);
  const gs = data.gameState;

  playerNames = [...gs.playerNames];
  mySeatIndex = data.mySeatIndex;
  nextRoundStarter = 0;
  resolving = false;
  giftedIds = new Set();
  stopTimer();

  // Show the same shuffle+deal animation as local Quick Play
  G = {
    ...gs,
    phase: 'shuffling',          // override so buildShufflingHTML() renders
    roomCode: data.roomCode,
    isHost: G.isHost,
    giftSubmitted: false,
    roomMsg: ''
  };
  render();
  ANIM.shuffleAndDeal(() => {
    G.phase = 'gift';
    render();
  });
});

// Live game state pushed after submitGift or playCard
socket.on("gameState", (data) => {
  console.log("Game state update — phase:", data.gameState.phase, "seat", data.mySeatIndex);
  const gs = data.gameState;
  const wasGift    = G.phase === 'gift';
  const wasRoundEnd= G.phase === 'roundEnd' || G.phase === 'gameEnd';
  const nowPlay    = gs.phase === 'play';
  const nowGift    = gs.phase === 'gift';

  playerNames  = [...gs.playerNames];
  mySeatIndex  = data.mySeatIndex;

  // ── Host pressed "Next Round" → show shuffle animation ──────
  if (wasRoundEnd && nowGift) {
    stopTimer();
    giftedIds = new Set();
    resolving = false;
    G = {
      ...gs,
      phase: 'shuffling',
      roomCode: data.roomCode,
      isHost: G.isHost,
      giftSubmitted: false,
      roomMsg: ''
    };
    render();
    ANIM.shuffleAndDeal(() => { G.phase = 'gift'; render(); });
    return;
  }

  // ── Pre-render snapshot — read DOM positions BEFORE wiping ──
  const prevTable      = G.table       ? [...G.table]       : [];
  const prevPlayed     = G.playedCards ? G.playedCards.length : 0;
  const prevLeadColor  = G.leadColor;
  const newTableLen    = (gs.table || []).length;
  const prevTableLen   = prevTable.length;
  const newPlayed      = (gs.playedCards || []).length;

  // Which event happened?
  const singleCardAdded = newTableLen > prevTableLen;            // normal play
  const trickEnded      = newTableLen === 0 && prevTableLen > 0  // trick resolved
                          && newPlayed > prevPlayed;

  // Identify the card that was just played and who played it
  const slotNames = ['slot-bottom','slot-right','slot-top','slot-left'];
  const avatarSels= ['.tz-btm .avatar','.tz-right .avatar','.tz-top2 .avatar','.tz-left .avatar'];

  let newEntry = null; // {pi, card}
  if (singleCardAdded && gs.table.length > 0) {
    newEntry = gs.table[gs.table.length - 1];
  } else if (trickEnded) {
    // Find which player hasn't played yet — that's the trick-ender
    const playedPis = new Set(prevTable.map(t => t.pi));
    const fourthPi  = [0,1,2,3].find(p => !playedPis.has(p));
    const lastCard  = gs.playedCards ? gs.playedCards[newPlayed - 1] : null;
    if (fourthPi !== undefined && lastCard) newEntry = { pi: fourthPi, card: lastCard };
  }

  // Capture old rendered slot positions while they still exist in the DOM
  let prevSlotRects = [];
  if (trickEnded && prevTableLen > 0) {
    prevSlotRects = prevTable.map(t => {
      const rp = (t.pi - data.mySeatIndex + 4) % 4;
      const el = document.querySelector('.' + slotNames[rp]);
      const r  = el && el.getBoundingClientRect();
      return {
        card: t.card,
        x: r ? r.left + r.width  / 2 : window.innerWidth  / 2,
        y: r ? r.top  + r.height / 2 : window.innerHeight / 2
      };
    });
  }

  // ── Update G ─────────────────────────────────────────────────
  G = {
    ...gs,
    roomCode:      data.roomCode,
    isHost:        G.isHost,
    giftSubmitted: gs.phase === 'gift' ? (G.giftSubmitted || false) : false,
    roomMsg:       gs.phase === 'gift' ? (G.roomMsg || '') : ''
  };

  // ── Sounds ───────────────────────────────────────────────────
  if (nowPlay && gs.currentPlayer === data.mySeatIndex) SFX.playMyTurn();
  if (newEntry && newEntry.pi !== data.mySeatIndex) {
    SFX.playCardPlay();
    if (isLee(newEntry.card)) setTimeout(() => SFX.playLee(), 120);
  }

  // ── Gift → Play transition ───────────────────────────────────
  if (wasGift && nowPlay) {
    resolving = false;
    stopTimer();
    if (gs.receivedGiftCardIdsBySeat && gs.receivedGiftCardIdsBySeat[data.mySeatIndex]) {
      giftedIds = new Set(gs.receivedGiftCardIdsBySeat[data.mySeatIndex]);
      setTimeout(() => { giftedIds = new Set(); render(); }, 3000);
    } else {
      giftedIds = new Set();
    }
    if (G.currentPlayer === mySeatIndex) startTimer();
  }

  // ── Render (DOM is now up-to-date) ───────────────────────────
  render();

  // ── Post-render animations ───────────────────────────────────

  if (singleCardAdded && newEntry && newEntry.pi >= 0) {
    // ── Card fly: avatar → its slot (slot now exists in DOM) ──
    const relPos  = (newEntry.pi - data.mySeatIndex + 4) % 4;
    const fromPt  = ANIM.center(avatarSels[relPos]) || {x:window.innerWidth/2, y:window.innerHeight/2};
    const slotEl  = document.querySelector('.' + slotNames[relPos]);
    if (slotEl) slotEl.style.opacity = '0';
    const r       = slotEl && slotEl.getBoundingClientRect();
    const toPt    = r
      ? {x: r.left + r.width/2, y: r.top + r.height/2}
      : ANIM.center('.tz-mid') || {x:window.innerWidth/2, y:window.innerHeight/2};
    ANIM.flyCard(newEntry.card, fromPt.x, fromPt.y, toPt.x, toPt.y, () => {
      if (slotEl) slotEl.style.opacity = '';
    });

  } else if (trickEnded && prevSlotRects.length > 0) {
    // ── Trick sweep: all played cards fly to winner ────────────
    // Determine trick winner
    let winnerPi;
    if (gs.phase === 'play') {
      winnerPi = gs.currentPlayer; // winner leads next trick
    } else {
      // roundEnd / gameEnd — compute from the full trick
      const fullTrick = [
        ...prevTable,
        ...(newEntry ? [{pi: newEntry.pi, card: newEntry.card}] : [])
      ];
      try {
        winnerPi = prevLeadColor && fullTrick.length
          ? trickWinner(fullTrick, prevLeadColor).pi
          : undefined;
      } catch(e) { winnerPi = undefined; }
    }
    const winRelPos = winnerPi !== undefined ? (winnerPi - data.mySeatIndex + 4) % 4 : 2;
    const winPt     = ANIM.center(avatarSels[winRelPos]) || {x:window.innerWidth/2, y:window.innerHeight/2};

    // Include the trick-ending card (starts at the player's avatar, never had a slot)
    let sweepRects = [...prevSlotRects];
    if (newEntry && newEntry.pi >= 0) {
      const relPos4 = (newEntry.pi - data.mySeatIndex + 4) % 4;
      const pt4     = ANIM.center(avatarSels[relPos4]) || {x:window.innerWidth/2, y:window.innerHeight/2};
      sweepRects.push({card: newEntry.card, x: pt4.x, y: pt4.y});
    }

    ANIM.sweepTrick(sweepRects, winPt.x, winPt.y, () => {});
  }
});

socket.on("lobbyError", (message) => {
  console.warn("Lobby error:", message);
  G.roomMsg = message;
  render();
});

// Maps server seats array (4-slot, nulls for empty) to G.roomPlayers format
function mapOnlineSeats(seats) {
  const mapped = (seats || []).map(s => {
    if (!s) return null;
    return { type: s.type, name: s.name, id: s.id };
  });
  while (mapped.length < 4) mapped.push(null);
  return mapped.slice(0, 4);
}

// Legacy helper kept for any local (non-online) usage
function mapOnlinePlayers(players) {
  const mapped = (players || []).map((p, index) => ({
    type: index === 0 ? "host" : "player",
    name: p.name || (index === 0 ? "Host" : `Player ${index + 1}`)
  }));
  while (mapped.length < 4) mapped.push(null);
  return mapped.slice(0, 4);
}
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
let mySeatIndex=0;        // which seat this client occupies; 0 for local Quick Play
let resolving=false;
let turnTimer=null;       // interval id for countdown
let turnTimeLeft=20;      // seconds remaining
let giftedIds=new Set();  // card ids that glow after gifting
let playerNames=[...DEFAULT_NAMES];
let nextRoundStarter=0;
let botDifficulty='easy';

function initMenu(){
  stopTimer();
  mySeatIndex=0;
  G={phase:'gameSelect',modal:null,roomCode:null,roomMsg:''};
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
  resolving=false;giftedIds=new Set();stopTimer();
  // Show shuffle+deal animation, then render gift phase
  G.phase='shuffling'; render();
  ANIM.shuffleAndDeal(()=>{ G.phase='gift'; render(); });
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
  // Sound effects
  SFX.playCardPlay();
  if(isLee(card)) setTimeout(()=>SFX.playLee(), 120);
  stopTimer();
  G.botThought=pi!==0&&reason?`${pname(pi)} chose ${lbl(card)} because ${reason}.`:'';

  // ── Fly animation ────────────────────────────────────────
  // 1. Capture avatar start position BEFORE render changes the DOM
  const relPos=(pi-mySeatIndex+4)%4;
  const avatarSels=['.tz-btm .avatar','.tz-right .avatar','.tz-top2 .avatar','.tz-left .avatar'];
  const slotClasses=['slot-bottom','slot-right','slot-top','slot-left'];
  const fromPt=ANIM.center(avatarSels[relPos])||{x:window.innerWidth/2,y:window.innerHeight/2};

  // 2. Update game state
  if(!G.playedCards)G.playedCards=[];
  G.playedCards.push(card);
  G.table.push({pi,card});
  G.hands[pi]=sortHand(G.hands[pi].filter(c=>c.id!==card.id));
  if(!G.leadColor)G.leadColor=card.color;
  G.selected=[];
  const trickDone=hasBothLees(G.table)||G.table.length===4||!hasNextTrickPlayer(G.currentPlayer);
  if(trickDone){
    resolving=true;
    G.statusMsg=hasBothLees(G.table)?'Both Lee5as taken! Round ends now.':'Trick complete...';
  } else {
    G.currentPlayer=nextTrickP(G.currentPlayer);
    setStatus();
  }

  // 3. Render so the slot exists in DOM, then hide it until the fly card lands
  render();
  const slotEl=document.querySelector('.'+slotClasses[relPos]);
  if(slotEl) slotEl.style.opacity='0';

  // 4. Read the exact rendered slot center as the fly target
  const toPt=slotEl
    ?(()=>{const r=slotEl.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()
    :ANIM.center('.tz-mid')||{x:window.innerWidth/2,y:window.innerHeight/2};

  // 5. Fly to that exact position; reveal slot on landing
  ANIM.flyCard(card, fromPt.x, fromPt.y, toPt.x, toPt.y, ()=>{
    if(slotEl) slotEl.style.opacity='';
    if(trickDone){
      setTimeout(finishTrick,900);
    } else {
      if(G.currentPlayer===mySeatIndex){startTimer();}
      else{setTimeout(aiPlay,300);}
    }
  });
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
  // Both-lee trick: winner gets 37 pts (+ any reds in that trick);
  // all other players' accumulated round points are wiped to 0.
  let p=tCards.reduce((s,c)=>s+pts(c),0);
  if(leeCount===2)p=37+tCards.filter(c=>c.color==='red').reduce((s,c)=>s+pts(c),0);
  G.roundPts[wi]+=p;
  if(leeCount===2)G.roundPts=G.roundPts.map((v,i)=>i===wi?v:0);
  G.statusMsg=leeCount===2?`${pname(wi)} took both Lee5as! +${p} pts - round over!`:`${pname(wi)} wins trick${p>0?' (+'+p+'pts)':''}`;
  // ── Sweep animation: fly table cards to winner before clearing ──
  const _slotNames=['slot-bottom','slot-right','slot-top','slot-left'];
  const _slotRects=G.table.map(t=>{
    const rp=(t.pi-mySeatIndex+4)%4;
    const el=document.querySelector('.'+_slotNames[rp]);
    const pt=el?(()=>{const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})():ANIM.center('.tz-mid')||{x:window.innerWidth/2,y:window.innerHeight/2};
    return{card:t.card,x:pt.x,y:pt.y};
  });
  const _winRp=(wi-mySeatIndex+4)%4;
  const _winSels=['.tz-btm .avatar','.tz-right .avatar','.tz-top2 .avatar','.tz-left .avatar'];
  const _winPt=ANIM.center(_winSels[_winRp])||{x:window.innerWidth/2,y:window.innerHeight/2};
  G.table=[];G.leadColor=null;
  render(); // clear table visually before sweep
  ANIM.sweepTrick(_slotRects,_winPt.x,_winPt.y,()=>{
    if(leeCount===2){endRound();return;}
    if(G.hands.every(h=>h.length===0)){endRound();return;}
    G.currentPlayer=G.hands[wi].length>0?wi:nextActiveP(wi);setStatus();render();
    if(G.currentPlayer===mySeatIndex){startTimer();}
    else{setTimeout(aiPlay,720);}
  });
}
function pname(i){return playerNames[i]||DEFAULT_NAMES[i];}
function setStatus(){
  G.statusMsg=G.currentPlayer===mySeatIndex?`Your turn!${G.leadColor?' - follow '+G.leadColor:''}`:pname(G.currentPlayer)+' is playing...';
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
  // Only start the human turn-timer when it's actually our turn.
  // If a bot starts the round, schedule its play instead.
  if(G.currentPlayer===mySeatIndex){startTimer();}
  else{setTimeout(aiPlay,720);}
}

function aiPlay(){
  if(G.roomCode)return;  // online: server drives turns, no local bots
  if(G.phase!=='play'||G.currentPlayer===mySeatIndex||resolving)return;
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
  // Use CSS classes for sizing — dimensions driven by CSS variables (responsive)
  const cls=['card',cc,small?'card-sm':'',selected?'selected':'',selectable&&playable?'playable':'',selectable&&!playable?'unplayable':'',offsuit?'offsuit':'',gifted?'gifted':''].filter(Boolean).join(' ');
  const style=rot?`transform:rotate(${rot}deg)`:'';
  return `<div class="${cls}"${style?` style="${style}"`:''}
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
  requestAnimationFrame(adjustHand);
}

function buildHTML(){
  const modal=G.modal?buildModal():'';
  if(G.phase==='gameSelect')return buildGameSelectHTML()+modal;
  if(G.phase==='menu')return buildMenuHTML()+modal;
  if(G.phase==='quickSetup')return buildQuickSetupHTML()+modal;
  if(G.phase==='customRoom')return buildCustomRoomHTML()+modal;
  if(G.phase==='roomLobby')return buildRoomLobbyHTML()+modal;
  if(G.phase==='gift')return buildGiftHTML()+modal;
  if(G.phase==='shuffling')return buildShufflingHTML();

  // rel(n): seat index at position n steps clockwise from my seat
  // bottom=me(0), right=+1, top=+2, left=+3
  const rel = n => (mySeatIndex + n) % 4;

  const isOnline = !!G.roomCode;
  const isMyTurn = G.currentPlayer === mySeatIndex && !resolving && G.phase === 'play';
  const playableIds = new Set((isMyTurn ? getPlayable(mySeatIndex) : []).map(c => c.id));
  const selIds = new Set(G.selected.map(c => c.id));

  // TABLE CENTER CARDS — diamond layout by relative seat position
  // relPos: 0=bottom(me), 1=right, 2=top(opposite), 3=left
  const slotClass  = ['slot-bottom','slot-right','slot-top','slot-left'];
  const slotRot    = [0, 6, 0, -6];  // subtle rotations per slot

  let tableCards;
  if(G.table.length===0){
    tableCards=`<div class="table-played-empty">Waiting for first card...</div>`;
  } else {
    const slots={};
    G.table.forEach(t=>{
      // Convert absolute seat index → relative visual position from this client's POV
      const relPos=(t.pi - mySeatIndex + 4)%4;
      const offsuit=G.leadColor&&t.card.color!==G.leadColor;
      const rot=slotRot[relPos];
      slots[relPos]=`<div class="played-slot ${slotClass[relPos]}">
        <span class="played-name">${pname(t.pi)}${offsuit?' ✦':''}</span>
        <div class="table-card" style="transform:rotate(${rot}deg)">${cardEl(t.card,{offsuit})}</div>
      </div>`;
    });
    tableCards=Object.values(slots).join('');
  }

  // MY HAND — cards rendered directly (no rotation wrappers), adjustHand handles overlap
  const myHand=G.hands[mySeatIndex];
  const handHTML=myHand.map((c)=>{
    const sel=selIds.has(c.id);
    const play=playableIds.has(c.id);
    const gifted=giftedIds.has(c.id);
    return cardEl(c,{selectable:isMyTurn,playable:play,selected:sel,gifted});
  }).join('');

  // AVATAR ACTIVE STATE
  const av=(i,letter)=>{
    const active=G.currentPlayer===i&&!resolving&&G.phase==='play';
    return `<div class="avatar${active?' active':''}">${letter}</div>`;
  };

  // timer ring shown only on this client's turn
  const isMyTurnNow=G.currentPlayer===mySeatIndex&&!resolving&&G.phase==='play';
  const myTimerId=isMyTurnNow?' id="turn-timer-ring"':'';
  const myTimerClass=isMyTurnNow?' timer-ring':'';

  // Seat references relative to this client's perspective
  const topSeat  = rel(2);   // opposite
  const leftSeat = rel(3);   // to my left
  const rightSeat= rel(1);   // to my right
  const meSeat   = mySeatIndex;

  // Avatar letter: host=H, real players use first letter of name, bots=B+num
  const avatarLabel = i => {
    const n = pname(i);
    if (i === 0 && mySeatIndex === 0) return 'You';
    if (i === mySeatIndex) return 'You';
    return n.startsWith('Bot') ? n.replace('Bot ','B') : n.charAt(0).toUpperCase();
  };

  return `
<button class="back-arrow" onclick="backToMenu()" aria-label="Back to menu">&lsaquo;</button>
<div id="table-wrap">

  <!-- TOP: seat opposite me -->
  <div class="tz-top2">
    <div class="player-zone">
      ${av(topSeat, avatarLabel(topSeat))}
      <span class="pname">${pname(topSeat)}</span>
      <span class="pscore">${G.scores[topSeat]}pts</span>
      <div style="display:flex;margin-top:2px;width:120px;justify-content:center;overflow:hidden">${miniBackCards(G.hands[topSeat].length)}</div>
    </div>
  </div>

  <!-- LEFT: seat to my left -->
  <div class="tz-left">
    <div class="player-zone">
      ${av(leftSeat, avatarLabel(leftSeat))}
      <span class="pname">${pname(leftSeat)}</span>
      <span class="pscore">${G.scores[leftSeat]}pts</span>
      <div style="display:flex;flex-direction:column;align-items:center;gap:1px;margin-top:2px;min-height:80px">
        ${Array(Math.min(G.hands[leftSeat].length,8)).fill(0).map((_,i)=>`<div class="mini-back-v" style="margin-bottom:-8px;z-index:${i}"></div>`).join('')}
      </div>
    </div>
  </div>

  <!-- CENTER: table — diamond layout -->
  <div class="tz-mid">
    ${G.leadColor?`<div class="lead-chip">Lead: ${G.leadColor}</div>`:''}
    ${G.table.length===0
      ?`<div class="table-played-empty">Waiting for first card…</div>`
      :`<div class="table-played">${tableCards}</div>`}
    <div class="status-bar">${G.statusMsg}</div>
    ${G.botThought?`<div class="thought-chip">${G.botThought}</div>`:''}
  </div>

  <!-- RIGHT: seat to my right -->
  <div class="tz-right">
    <div class="player-zone">
      ${av(rightSeat, avatarLabel(rightSeat))}
      <span class="pname">${pname(rightSeat)}</span>
      <span class="pscore">${G.scores[rightSeat]}pts</span>
      <div style="display:flex;flex-direction:column;align-items:center;gap:1px;margin-top:2px;min-height:80px">
        ${Array(Math.min(G.hands[rightSeat].length,8)).fill(0).map((_,i)=>`<div class="mini-back-v" style="margin-bottom:-8px;z-index:${i}"></div>`).join('')}
      </div>
    </div>
  </div>

  <!-- BOTTOM: My area -->
  <div class="tz-btm">
    <div class="my-info">
      ${av(meSeat, 'You')}
      <div class="my-name-ring${myTimerClass}"${myTimerId}>
        <span class="pname">${pname(meSeat)}</span>
        <span class="pscore">${G.scores[meSeat]}pts</span>
      </div>
    </div>
    <div id="my-hand">${handHTML}</div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button class="chip-btn" onclick="showRules()">Rules</button>
      ${!isOnline?`<button class="chip-btn gold" onclick="createOnlineRoom()">Create Room</button>
<button class="chip-btn" onclick="joinOnlineRoom()">Join Room</button>`:''}
    </div>
  </div>

</div>
${modal}`;
}


// ── SHUFFLE PHASE (blank table while overlay runs) ─────────
function buildShufflingHTML(){
  return `
<div id="table-wrap" style="display:flex;align-items:center;justify-content:center;min-height:520px">
  <div style="color:rgba(255,255,255,0.3);font-size:13px;font-weight:600">Shuffling…</div>
</div>`;
}

// ── GIFT PHASE ────────────────────────────────────────────
function buildGiftHTML(){
  // Relative seat helper — same as play phase
  const rel = n => (mySeatIndex + n) % 4;
  const topSeat  = rel(2);
  const leftSeat = rel(3);
  const rightSeat= rel(1);
  const meSeat   = mySeatIndex;

  const avatarLabel = i => {
    if (i === mySeatIndex) return 'You';
    const n = pname(i);
    return n.startsWith('Bot') ? n.replace('Bot ','B') : n.charAt(0).toUpperCase();
  };

  const selSet=new Set(G.selected.map(c=>c.id));
  const hand=G.hands[mySeatIndex];
  const canSelectGift = !G.giftSubmitted;  // lock hand after submitting online
  const violation=G.selected.length>0&&giftViolatesColor(hand,G.selected);
  const handHTML=hand.map((c)=>{
    const sel=selSet.has(c.id);
    const p=pts(c);
    const ptag=p>0?`<span class="ptag">${p}</span>`:'';
    const cc=COLOR_CLASS[c.color];
    return `<div class="card ${cc}${sel?' selected':''}" ${canSelectGift?`data-gift="${c.id}" style="cursor:pointer"`:'style="opacity:0.6"'}>
        ${ptag}
        <span class="corner tl">${lbl(c)}</span>
        <div class="cnum">${lbl(c)}</div>
        <div class="csym">${c.color}</div>
        <span class="corner br">${lbl(c)}</span>
      </div>`;
  }).join('');

  // Gift goes to the player to my right (seat+1)
  const giftTargetName = pname(rightSeat);

  return `
<button class="back-arrow" onclick="backToMenu()" aria-label="Back to menu">&lsaquo;</button>
<div id="table-wrap">

  <!-- TOP: seat opposite me -->
  <div class="tz-top2">
    <div class="player-zone">
      <div class="avatar">${avatarLabel(topSeat)}</div>
      <span class="pname">${pname(topSeat)}</span>
      <span class="pscore">${G.scores[topSeat]}pts</span>
      <div style="display:flex;margin-top:2px;width:120px;justify-content:center;overflow:hidden">${miniBackCards(G.hands[topSeat].length)}</div>
    </div>
  </div>

  <!-- LEFT: seat to my left -->
  <div class="tz-left">
    <div class="player-zone">
      <div class="avatar">${avatarLabel(leftSeat)}</div>
      <span class="pname">${pname(leftSeat)}</span>
      <span class="pscore">${G.scores[leftSeat]}pts</span>
      <div style="display:flex;flex-direction:column;align-items:center;gap:1px;margin-top:2px;min-height:80px">
        ${Array(Math.min(G.hands[leftSeat].length,8)).fill(0).map((_,i)=>`<div class="mini-back-v" style="margin-bottom:-8px;z-index:${i}"></div>`).join('')}
      </div>
    </div>
  </div>

  <!-- CENTER: gift instructions -->
  <div class="tz-mid">
    <div style="background:rgba(0,0,0,0.4);border-radius:14px;padding:10px 20px;text-align:center;border:1px solid rgba(255,255,255,0.1)">
      <div style="color:rgba(255,220,100,0.9);font-size:13px;font-weight:600">Gift 3 cards to ${giftTargetName}</div>
      <div style="color:rgba(255,255,255,0.6);font-size:11px;margin-top:2px">${G.selected.length}/3 selected</div>
      ${violation?`<div class="warn-chip" style="margin-top:6px">Warning: Holding Lee5a - can't empty a color</div>`:''}
    </div>
  </div>

  <!-- RIGHT: seat to my right -->
  <div class="tz-right">
    <div class="player-zone">
      <div class="avatar">${avatarLabel(rightSeat)}</div>
      <span class="pname">${pname(rightSeat)}</span>
      <span class="pscore">${G.scores[rightSeat]}pts</span>
      <div style="display:flex;flex-direction:column;align-items:center;gap:1px;margin-top:2px;min-height:80px">
        ${Array(Math.min(G.hands[rightSeat].length,8)).fill(0).map((_,i)=>`<div class="mini-back-v" style="margin-bottom:-8px;z-index:${i}"></div>`).join('')}
      </div>
    </div>
  </div>

  <!-- BOTTOM: My hand + gift button -->
  <div class="tz-btm">
    <div class="my-info">
      <div class="avatar">You</div>
      <span class="pname">${pname(meSeat)}</span>
      <span class="pscore">${G.scores[meSeat]}pts</span>
    </div>
    <div id="my-hand">${handHTML}</div>
    ${G.giftSubmitted
      ? `<div class="room-msg" style="margin-top:6px">Waiting for other players to gift…</div>`
      : `<button class="chip-btn gold" onclick="confirmGift()" ${G.selected.length!==3||violation?'disabled':''}>
           Gift selected ->
         </button>`
    }
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
      ${isEnd
        ? `<button class="chip-btn gold" onclick="newGame()">New Game</button>`
        : G.roomCode
          ? (G.isHost
              ? `<button class="chip-btn gold" onclick="hostNextRound()">Next Round →</button>`
              : `<div style="font-size:12px;color:rgba(255,255,255,0.5);padding:6px 0">Waiting for host to start next round…</div>`)
          : `<button class="chip-btn gold" onclick="nextRound()">Next Round</button>`
      }
    </div>
  </div></div>`;
}

function attachEvents(){
  document.querySelectorAll('[data-gift]').forEach(el=>{
    el.addEventListener('click',()=>{
      const id=el.dataset.gift;
      const card=G.hands[mySeatIndex].find(c=>c.id===id);
      if(!card)return;
      const idx=G.selected.findIndex(c=>c.id===id);
      if(idx>=0)G.selected.splice(idx,1);else if(G.selected.length<3)G.selected.push(card);
      render();
    });
  });
  document.querySelectorAll('[data-play]').forEach(el=>{
    el.addEventListener('click',()=>{
      if(G.currentPlayer!==mySeatIndex||resolving||G.trickResolving)return;
      const id=el.dataset.play;
      const card=G.hands[mySeatIndex].find(c=>c.id===id);
      if(!card)return;
      if(!getPlayable(mySeatIndex).find(c=>c.id===card.id))return;

      if(G.roomCode){
        // Online: fire sounds immediately for responsiveness,
        // but let the gameState response drive the fly animation
        // (so it lands on the correct slot, not a guessed position).
        SFX.playCardPlay();
        if(isLee(card)) setTimeout(()=>SFX.playLee(), 120);
        socket.emit('playCard',{roomCode:G.roomCode,cardId:id});
      } else {
        // Local Quick Play: run the full local engine
        executePlay(mySeatIndex,card);
      }
    });
  });
}

// ── TIMER ────────────────────────────────────────────────
function startTimer(){
  SFX.playMyTurn();
  stopTimer();
  turnTimeLeft=20;
  updateTimerBar();
  turnTimer=setInterval(()=>{
    turnTimeLeft--;
    updateTimerBar();
    if(turnTimeLeft<=0){
      stopTimer();
      // auto-play: pick first playable card for this client's seat
      const pl=getPlayable(mySeatIndex);
      if(pl.length){
        if(G.roomCode){
          socket.emit('playCard',{roomCode:G.roomCode,cardId:pl[0].id});
        } else {
          executePlay(mySeatIndex,pl[0]);
        }
      }
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
    <button class="menu-btn subtle" onclick="backToGameSelect()">All Games</button>
  </div>
</div>`;
}
function buildGameSelectHTML(){
  return `
<div class="menu-screen game-select-screen">
  <div class="menu-mark">
    <div class="menu-card-stack">
      <div class="menu-card menu-card-red">5</div>
      <div class="menu-card menu-card-blue">4</div>
      <div class="menu-card menu-card-gold">1</div>
    </div>
    <h1>Choose a Game</h1>
    <p>Pick the table you want to play.</p>
  </div>
  <div class="game-choice-grid">
    <button class="game-choice-card" onclick="openLee5aMenu()">
      <span class="game-choice-title">Lee5a</span>
      <span class="game-choice-copy">Fast table play. Avoid the points.</span>
    </button>
    <button class="game-choice-card" onclick="openArba3meye()">
      <span class="game-choice-title">Arba3meye</span>
      <span class="game-choice-copy">Bid, take tricks, and race to the target.</span>
    </button>
      <button class="game-choice-card" onclick="openUno()">
    <span class="game-choice-title">UNO</span>
    <span class="game-choice-copy">Classic color-matching card game.</span>
    </button>
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
    <p>Enter your name and the room code.</p>
    <input class="room-input" id="join-player-name" maxlength="14"
      placeholder="Your name"
      value="${G.joinName||''}"
      oninput="G.joinName=this.value"
      style="text-transform:none;font-size:16px;letter-spacing:0">
    <input class="room-input" id="join-room-code" maxlength="7"
      placeholder="ABC-123"
      value="${G.joinCode||''}"
      oninput="G.joinCode=this.value.toUpperCase();this.value=G.joinCode">
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
  const isOnline=!!G.roomCode&&G.roomCode.length>0;
  const isHost=!isOnline||G.isHost;  // local Quick Room always acts as host; online checks flag
  const filled=players.filter(Boolean).length;
  const canStart=filled===4;
  const seats=players.map((p,i)=>{
    const label=p?p.name:'Empty';
    const kind=p?p.type:'empty';
    const canAddBot=!p&&isHost;
    const canRemoveSeat=p&&p.type!=='host'&&isHost;
    const canMove=isHost;
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
        ${canMove?`<button class="seat-btn" onclick="moveSeat(${i},-1)" ${i===0||kind==='host'?'disabled':''}>Up</button>`:''}
        ${canMove?`<button class="seat-btn" onclick="moveSeat(${i},1)" ${i===3||kind==='host'?'disabled':''}>Down</button>`:''}
        ${canAddBot?`<button class="seat-btn gold" onclick="addBotToSeat(${i})">Bot</button>`:''}
        ${canRemoveSeat?`<button class="seat-btn danger" onclick="removeSeat(${i})">Remove</button>`:''}
      </div>
    </div>
    </div>`;
  }).join('');
  const hostNote=!isHost?'<div class="room-msg">Waiting for host to start the game…</div>':'';
  return `
<button class="back-arrow" onclick="backToMenu()" aria-label="Back to menu">&lsaquo;</button>
<div class="menu-screen lobby-screen">
  <div class="lobby-head">
    <h1>Room ${G.roomCode||'------'}</h1>
    <p>${isHost?'Host: arrange seats and fill missing spots with bots.':'Joined as player. Host controls the lobby.'}</p>
  </div>
  ${isHost?buildDifficultyPicker():''}
  <div class="seat-grid">${seats}</div>
  ${G.roomMsg?`<div class="room-msg">${G.roomMsg}</div>`:''}
  ${hostNote}
  <div class="room-actions">
    ${isHost?`<button class="menu-btn primary" onclick="startCustomRoom()" ${canStart?'':'disabled'}>Start Game</button>`:''}
    ${isHost?`<button class="menu-btn" onclick="addNextBot()" ${filled>=4?'disabled':''}>Add Bot</button>`:''}
    <button class="menu-btn subtle" onclick="openCustomRoom()">Room Code</button>
  </div>
</div>`;
}

window.confirmGift=function(){
  const hand=G.hands[mySeatIndex];
  if(G.selected.length!==3||giftViolatesColor(hand,G.selected))return;
  if(G.roomCode){
    // Online: send to server; server applies all gifts and broadcasts play phase
    socket.emit('submitGift',{roomCode:G.roomCode,cardIds:G.selected.map(c=>c.id)});
    G.giftSubmitted=true;
    G.roomMsg='Waiting for other players to gift…';
    G.selected=[];
    render();
    return;
  }
  // Local Quick Play
  G.gifts[0]=[...G.selected];setTimeout(doGifts,300);
};
window.nextRound=function(){G.modal=null;newRound();};
window.hostNextRound=function(){
  if(!G.roomCode)return;
  socket.emit('startNextRound',{roomCode:G.roomCode});
  G.modal=null;
  render();
};
window.newGame=function(){initGame();};
window.showRules=function(){G.modal={type:'rules'};render();};
window.closeModal=function(){G.modal=null;render();};
window.setBotDifficulty=function(level){botDifficulty=level;render();};
window.openLee5aMenu=function(){stopTimer();G={phase:'menu',modal:null,roomCode:null,roomMsg:''};render();};
window.openArba3meye=function(){stopTimer();window.location.href='arba3meye.html?v=3';};
window.openUno=function(){stopTimer();window.location.href='uno.html';};
window.backToGameSelect=function(){initMenu();};
window.openQuickSetup=function(){stopTimer();G={phase:'quickSetup',modal:null};render();};
window.quickPlay=function(){initGame();};
window.openCustomRoom=function(){stopTimer();G={phase:'customRoom',modal:null,roomMode:'choice',roomCode:null,joinCode:'',joinName:G.joinName||'',roomMsg:''};render();};
window.showCreateRoom=function(){G.roomMode='create';G.roomCode=makeRoomCode();G.roomMsg='';render();};
window.showJoinRoom=function(){G.roomMode='join';G.joinCode='';G.roomMsg='';render();};
window.enterRoomLobby=function(){
  G={phase:'roomLobby',modal:null,roomCode:G.roomCode||makeRoomCode(),roomMsg:'',roomPlayers:defaultRoomPlayers()};
  render();
};
window.joinCustomRoom=function(){
  const nameEl=document.getElementById('join-player-name');
  const codeEl=document.getElementById('join-room-code');
  const name=((nameEl?nameEl.value:G.joinName)||'').trim()||'Player';
  const raw=((codeEl?codeEl.value:G.joinCode)||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(!name||name==='Player'&&!nameEl){G.roomMsg='Enter your name.';render();return;}
  if(raw.length<6){G.roomMsg='Enter a 6-character room code.';render();return;}
  G.joinName=name;
  G.roomMsg='Joining…';render();
  socket.emit('joinRoom',{roomCode:raw,name});
};
window.startCustomRoom=function(){
  if(G.roomCode){
    // Online mode: ask server to validate and broadcast roomStarted to everyone
    socket.emit("startRoom",{roomCode:G.roomCode});
    return;
  }
  // Local mode
  const players=G.roomPlayers||[];
  if(players.filter(Boolean).length<4){G.roomMsg='Fill all 4 seats before starting.';render();return;}
  initGame(players.map(p=>p.name));
};
window.backToMenu=function(){initMenu();};
window.moveSeat=function(i,dir){
  if(G.roomCode){
    socket.emit("moveSeatInRoom",{roomCode:G.roomCode,seatIndex:i,direction:dir});
    return;
  }
  const players=[...(G.roomPlayers||defaultRoomPlayers())];
  const j=i+dir;
  if(j<0||j>=players.length)return;
  if((players[i]&&players[i].type==='host')||(players[j]&&players[j].type==='host'))return;
  [players[i],players[j]]=[players[j],players[i]];
  G.roomPlayers=players;G.roomMsg='Seats updated.';render();
};
window.addBotToSeat=function(i){
  if(G.roomCode){
    // Online mode: tell server to add a bot; server will broadcast roomUpdated
    socket.emit("addBotToRoom",{roomCode:G.roomCode});
    return;
  }
  // Local mode
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
  if(G.roomCode){
    socket.emit("addBotToRoom",{roomCode:G.roomCode});
    return;
  }
  const players=[...(G.roomPlayers||defaultRoomPlayers())];
  const idx=players.findIndex(p=>!p);
  if(idx>=0){G.roomPlayers=players;addBotToSeat(idx);}
};
window.removeSeat=function(i){
  if(G.roomCode){
    socket.emit("removeSeatFromRoom",{roomCode:G.roomCode,seatIndex:i});
    return;
  }
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
  G.hands=hands.map(sortHand);G.phase='shuffling';G.gifts=[null,null,null,null];G.table=[];
  G.leadColor=null;G.selected=[];G.statusMsg=`Choose 3 cards to gift to ${pname(1)}`;G.botThought='';G.playedCards=[];G.knownGiftedLees=[];G.modal=null;G.roundPts=[0,0,0,0];
  resolving=false;giftedIds=new Set();stopTimer();render();
  ANIM.shuffleAndDeal(()=>{ G.phase='gift'; render(); });
}


// ── HAND OVERLAP ─────────────────────────────────────────
// Dynamically computes card margin so the hand always fits the
// available width — matches arba3meye's approach exactly.
function adjustHand(){
  const hand=document.getElementById('my-hand');
  if(!hand)return;
  const cards=[...hand.querySelectorAll('.card')];
  const n=cards.length;
  if(n<2)return;
  // measure actual visible width so the last card never clips off the right edge
  const available=hand.getBoundingClientRect().width-8;
  const cardW=cards[0].getBoundingClientRect().width||54;
  // total = n*cardW + (n-1)*mg → mg = (available - n*cardW)/(n-1)
  let mg=(n>1)?Math.floor((available-cardW*n)/(n-1)):3;
  mg=Math.min(3,mg);
  if(window.matchMedia('(max-width:520px)').matches){
    mg=Math.min(mg,-1);
  } else {
    mg=Math.max(cardW*-0.62,mg);
  }
  hand.style.gap='0';
  cards.forEach((c,i)=>{
    c.style.marginRight=i<n-1?mg+'px':'0';
  });
}
window.addEventListener('resize',()=>requestAnimationFrame(adjustHand));

initMenu();
window.createOnlineRoom = function () {
  socket.emit("createRoom");
};

window.joinOnlineRoom = function () {
  G.roomMode = 'join';
  G.joinCode = '';
  G.joinName = G.joinName || '';
  G.roomMsg = '';
  render();
};