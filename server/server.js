const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

app.use(cors());

app.get("/", (req, res) => {
  res.send("Laye5lo multiplayer server is running.");
});

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = {};

// ── CARD HELPERS (mirrored from script.js) ───────────────
const COLOR_ORDER = ['red', 'blue', 'green', 'yellow'];
const STRENGTH = { '1': 13, 'skip': 12, 'draw2': 11, 'reverse': 10, '0': 9, '9': 8, '8': 7, '7': 6, '6': 5, '5': 4, '4': 3, '3': 2, '2': 1 };

function buildDeck() {
  const d = [];
  COLOR_ORDER.forEach(col =>
    ['0','1','2','3','4','5','6','7','8','9','skip','draw2','reverse'].forEach(t =>
      d.push({ color: col, type: t, id: `${col}-${t}` })
    )
  );
  return d;
}

function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function sortHand(h) {
  return [...h].sort((a, b) => {
    const ci = COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color);
    return ci || (STRENGTH[b.type] || 0) - (STRENGTH[a.type] || 0);
  });
}

function pts(c) {
  if (c.color === 'blue'  && c.type === 'draw2') return 13;
  if (c.color === 'yellow' && c.type === '0')    return 10;
  if (c.color === 'red')                          return 1;
  return 0;
}
function isLee(c) {
  return (c.color === 'blue' && c.type === 'draw2') ||
         (c.color === 'yellow' && c.type === '0');
}
function str(c) { return STRENGTH[c.type] || 0; }

// Mirror of client giftViolatesColor: when holding a Lee, you cannot empty any color
function giftViolatesColor(hand, sel) {
  if (!hand.some(c => isLee(c))) return false;
  const selIds = new Set(sel.map(c => c.id));
  const groups = {};
  hand.forEach(c => { (groups[c.color] = groups[c.color] || []).push(c); });
  return Object.values(groups).some(cards => cards.every(c => selIds.has(c.id)));
}

// Simple bot gift: highest-point cards first, respecting giftViolatesColor
function chooseSimpleGift(hand) {
  const sorted = [...hand].sort((a, b) => pts(b) - pts(a) || str(b) - str(a));
  const chosen = [];
  for (const c of sorted) {
    if (chosen.length === 3) break;
    if (!giftViolatesColor(hand, [...chosen, c])) chosen.push(c);
  }
  // If Lee constraint blocked us, fill remaining slots ignoring it
  for (const c of sorted) {
    if (chosen.length === 3) break;
    if (!chosen.includes(c)) chosen.push(c);
  }
  return chosen;
}

// Apply all 4 gifts simultaneously: each seat's chosen cards go to (seat+1)%4
function applyGifts(game) {
  const nh = game.hands.map(h => [...h]);
  const gs = game.gifts;
  // Remove gifted cards from each sender
  for (let i = 0; i < 4; i++) {
    const giftIds = new Set(gs[i].map(c => c.id));
    nh[i] = nh[i].filter(c => !giftIds.has(c.id));
  }
  // Add gifted cards to each receiver; track which IDs each seat received
  const received = [[], [], [], []];
  for (let i = 0; i < 4; i++) {
    const receiver = (i + 1) % 4;
    gs[i].forEach(c => {
      nh[receiver].push(c);
      received[receiver].push(c.id);
    });
  }
  game.hands = nh.map(sortHand);
  game.receivedGiftCardIdsBySeat = received;
}

function dealGame(playerNames) {
  const deck = shuffle(buildDeck());
  const hands = [[], [], [], []];
  deck.forEach((c, i) => hands[i % 4].push(c));
  return {
    phase: 'gift',
    playerNames,
    hands: hands.map(sortHand),
    gifts: [null, null, null, null],
    table: [],
    currentPlayer: 0,
    leadColor: null,
    scores: [0, 0, 0, 0],
    roundPts: [0, 0, 0, 0],
    selected: [],
    statusMsg: `Choose 3 cards to gift to ${playerNames[1]}`,
    botThought: '',
    playedCards: [],
    knownGiftedLees: [],
    modal: null
  };
}

function normalizeRoomCode(roomCode) {
  return String(roomCode || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Returns the seats array (4 slots, null = empty) for broadcast
function roomPayload(roomCode) {
  const room = rooms[roomCode];
  return {
    roomCode,
    hostId: room.hostId,
    seats: room.seats
  };
}

// ── ARBA3MEYE HELPERS ─────────────────────────────────────
const ARBA_COLORS = ['red','blue','yellow','green'];
const ARBA_RANKS = ['1','skip','+2','reverse','0','9','8','7','6','5','4','3','2'];
const ARBA_RV = {'1':13,'skip':12,'+2':11,'reverse':10,'0':9,'9':8,'8':7,'7':6,'6':5,'5':4,'4':3,'3':2,'2':1};
const ARBA_SCORE = {2:2,3:3,4:4,5:10,6:12,7:14,8:16,9:27};
const ARBA_WIN = 41;

function buildArbaDeck() {
  const d = [];
  for (const color of ARBA_COLORS) for (const rank of ARBA_RANKS) d.push({ id: color + rank, color, rank });
  return d;
}
function dealArbaHands() {
  const deck = shuffle(buildArbaDeck());
  const hands = [[],[],[],[]];
  deck.forEach((c,i)=>hands[i%4].push(c));
  return hands.map(sortArbaHand);
}
function sortArbaHand(h) {
  return [...h].sort((a,b)=>ARBA_COLORS.indexOf(a.color)-ARBA_COLORS.indexOf(b.color)||ARBA_RV[b.rank]-ARBA_RV[a.rank]);
}
function cmpArba(a,b,led) {
  const ar=a.color==='red', br=b.color==='red';
  if(ar&&!br)return 1; if(br&&!ar)return -1;
  if(ar&&br)return ARBA_RV[a.rank]-ARBA_RV[b.rank];
  const al=a.color===led, bl=b.color===led;
  if(al&&!bl)return 1; if(bl&&!al)return -1;
  return ARBA_RV[a.rank]-ARBA_RV[b.rank];
}
function legalArba(hand,led,isLead) {
  if(isLead||!led)return hand;
  const suited=hand.filter(c=>c.color===led);
  return suited.length?suited:hand;
}
function trickWinArba(trick,led) {
  let best=0;
  for(let i=1;i<trick.length;i++) if(cmpArba(trick[i].card,trick[best].card,led)>0) best=i;
  return trick[best].pid;
}
function pointsArba(bid,won) {
  return (won>=bid?1:-1)*(ARBA_SCORE[bid]||bid);
}
function botBidArba(hand) {
  let est=0;
  for(const c of hand){
    if(c.color==='red') est += 0.5 + (ARBA_RV[c.rank]/13)*0.5;
    else if(ARBA_RV[c.rank]>=12) est+=0.3;
    else if(ARBA_RV[c.rank]>=10) est+=0.15;
    else if(ARBA_RV[c.rank]>=8) est+=0.05;
  }
  return Math.max(2,Math.min(9,Math.round(est*0.88)));
}
function botCardArba(game,pid) {
  const lg=legalArba(game.hands[pid],game.led,game.trick.length===0);
  if(game.trick.length===0)return [...lg].sort((a,b)=>cmpArba(b,a,null))[0];
  const best=game.trick.reduce((w,t)=>cmpArba(t.card,w.card,game.led)>0?t:w,game.trick[0]);
  const winners=lg.filter(c=>cmpArba(c,best.card,game.led)>0).sort((a,b)=>ARBA_RV[a.rank]-ARBA_RV[b.rank]);
  return winners[0]||[...lg].sort((a,b)=>ARBA_RV[a.rank]-ARBA_RV[b.rank])[0];
}
function newArbaGame(names, scores=[0,0,0,0], round=1) {
  return { names, phase:'bidding', hands:dealArbaHands(), bids:[null,null,null,null], bidIdx:0, trick:[], led:null, wins:[0,0,0,0], scores, cur:0, round, busy:false, winner:null };
}
function broadcastArba(roomCode) {
  const room=rooms[roomCode];
  if(!room)return;
  room.seats.forEach((seat,idx)=>{ if(seat&&seat.id) io.to(seat.id).emit('arbaGameState',{roomCode,gameState:room.arbaGame,mySeatIndex:idx}); });
}
function scheduleArba(roomCode) {
  const room=rooms[roomCode], game=room&&room.arbaGame;
  if(!room||!game)return;
  if(game.phase==='bidding'&&room.seats[game.bidIdx]?.type==='bot') {
    setTimeout(()=>applyArbaBid(roomCode, game.bidIdx, botBidArba(game.hands[game.bidIdx])), 500);
  } else if(game.phase==='playing'&&room.seats[game.cur]?.type==='bot'&&!game.busy) {
    setTimeout(()=>playArbaCard(roomCode, game.cur, botCardArba(game,game.cur)?.id), 650);
  }
}
function applyArbaBid(roomCode,pid,bid) {
  const room=rooms[roomCode], game=room&&room.arbaGame;
  if(!game||game.phase!=='bidding'||game.bidIdx!==pid)return false;
  game.bids[pid]=bid; game.bidIdx++;
  if(game.bidIdx<4){broadcastArba(roomCode); scheduleArba(roomCode); return true;}
  if(game.bids.reduce((s,x)=>s+x,0)<11){ room.arbaGame=newArbaGame(game.names,game.scores,game.round); broadcastArba(roomCode); scheduleArba(roomCode); return true; }
  game.phase='playing'; game.cur=0; broadcastArba(roomCode); scheduleArba(roomCode); return true;
}
function playArbaCard(roomCode,pid,cardId) {
  const room=rooms[roomCode], game=room&&room.arbaGame;
  if(!game||game.phase!=='playing'||game.cur!==pid||game.busy)return false;
  const card=game.hands[pid].find(c=>c.id===cardId);
  if(!card)return false;
  const playable=legalArba(game.hands[pid],game.led,game.trick.length===0);
  if(!playable.find(c=>c.id===cardId))return false;
  game.hands[pid]=sortArbaHand(game.hands[pid].filter(c=>c.id!==cardId));
  if(!game.led)game.led=card.color;
  game.trick.push({pid,card});
  if(game.trick.length<4){game.cur=(pid+1)%4; broadcastArba(roomCode); scheduleArba(roomCode); return true;}
  const wi=trickWinArba(game.trick,game.led);
  game.wins[wi]++; game.cur=wi; game.busy=true; broadcastArba(roomCode);
  setTimeout(()=>{
    const r=rooms[roomCode], g=r&&r.arbaGame; if(!g)return;
    g.trick=[]; g.led=null; g.busy=false;
    if(g.hands.every(h=>h.length===0)){
      for(let i=0;i<4;i++)g.scores[i]+=pointsArba(g.bids[i],g.wins[i]);
      if(g.scores.some(s=>s>=ARBA_WIN)||g.scores.some(s=>s<=-ARBA_WIN)){
        const a=g.scores[0]+g.scores[2], b=g.scores[1]+g.scores[3];
        g.winner=a>b?'Team A':'Team B'; g.phase='gameover';
      } else g.phase='roundover';
    }
    broadcastArba(roomCode); scheduleArba(roomCode);
  },1500);
  return true;
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  // ── CREATE ROOM ──────────────────────────────────────────
  socket.on("createRoom", () => {
    const roomCode = makeRoomCode();

    rooms[roomCode] = {
      hostId: socket.id,
      seats: [
        { id: socket.id, name: "Host", type: "host" },
        null,
        null,
        null
      ]
    };

    socket.join(roomCode);
    socket.emit("roomCreated", roomPayload(roomCode));
    console.log("Room created:", roomCode, "by", socket.id);
  });

  // ── JOIN ROOM ─────────────────────────────────────────────
  socket.on("joinRoom", ({ roomCode, name }) => {
    roomCode = normalizeRoomCode(roomCode);
    console.log("Join attempt:", roomCode, "by", socket.id);
    console.log("Existing rooms:", Object.keys(rooms));

    if (!rooms[roomCode]) {
      socket.emit("joinError", "Room not found.");
      return;
    }

    const room = rooms[roomCode];

    // Find the first empty seat
    const emptyIdx = room.seats.findIndex(s => s === null);
    if (emptyIdx === -1) {
      socket.emit("joinError", "Room is full.");
      return;
    }

    const playerName = name || `Player ${emptyIdx + 1}`;
    room.seats[emptyIdx] = { id: socket.id, name: playerName, type: "player" };

    socket.join(roomCode);
    io.to(roomCode).emit("roomUpdated", roomPayload(roomCode));
    console.log(socket.id, "joined room", roomCode, "as", playerName);
  });

  // ── ADD BOT ───────────────────────────────────────────────
  socket.on("addBotToRoom", ({ roomCode }) => {
    roomCode = normalizeRoomCode(roomCode);
    const room = rooms[roomCode];

    if (!room) { socket.emit("lobbyError", "Room not found."); return; }
    if (room.hostId !== socket.id) { socket.emit("lobbyError", "Only the host can add bots."); return; }

    const emptyIdx = room.seats.findIndex(s => s === null);
    if (emptyIdx === -1) { socket.emit("lobbyError", "Room is full."); return; }

    const botNum = room.seats.filter(s => s && s.type === "bot").length + 1;
    room.seats[emptyIdx] = { id: null, name: `Bot ${botNum}`, type: "bot" };

    io.to(roomCode).emit("roomUpdated", roomPayload(roomCode));
    console.log("Bot added to room", roomCode, "at seat", emptyIdx);
  });

  // ── REMOVE SEAT ───────────────────────────────────────────
  socket.on("removeSeatFromRoom", ({ roomCode, seatIndex }) => {
    roomCode = normalizeRoomCode(roomCode);
    const room = rooms[roomCode];

    if (!room) { socket.emit("lobbyError", "Room not found."); return; }
    if (room.hostId !== socket.id) { socket.emit("lobbyError", "Only the host can remove seats."); return; }

    const seat = room.seats[seatIndex];
    if (!seat || seat.type === "host") { socket.emit("lobbyError", "Cannot remove this seat."); return; }

    room.seats[seatIndex] = null;

    io.to(roomCode).emit("roomUpdated", roomPayload(roomCode));
    console.log("Seat", seatIndex, "removed from room", roomCode);
  });

  // ── MOVE SEAT ─────────────────────────────────────────────
  socket.on("moveSeatInRoom", ({ roomCode, seatIndex, direction }) => {
    roomCode = normalizeRoomCode(roomCode);
    const room = rooms[roomCode];

    if (!room) { socket.emit("lobbyError", "Room not found."); return; }
    if (room.hostId !== socket.id) { socket.emit("lobbyError", "Only the host can move seats."); return; }

    const j = seatIndex + direction;
    if (j < 0 || j >= 4) { socket.emit("lobbyError", "Cannot move seat out of bounds."); return; }

    const a = room.seats[seatIndex];
    const b = room.seats[j];
    if ((a && a.type === "host") || (b && b.type === "host")) {
      socket.emit("lobbyError", "Cannot move the host seat.");
      return;
    }

    room.seats[seatIndex] = b;
    room.seats[j] = a;

    io.to(roomCode).emit("roomUpdated", roomPayload(roomCode));
    console.log("Seats", seatIndex, "and", j, "swapped in room", roomCode);
  });

  // ── START ROOM ────────────────────────────────────────────
  socket.on("startRoom", ({ roomCode }) => {
    roomCode = normalizeRoomCode(roomCode);
    const room = rooms[roomCode];

    if (!room) { socket.emit("lobbyError", "Room not found."); return; }
    if (room.hostId !== socket.id) { socket.emit("lobbyError", "Only the host can start the game."); return; }

    const filled = room.seats.filter(Boolean).length;
    if (filled < 4) { socket.emit("lobbyError", "All 4 seats must be filled before starting."); return; }

    const playerNames = room.seats.map(s => s.name);
    const gameState = dealGame(playerNames);
    room.game = gameState;

    // Send each real player their own seat index; bots have no socket
    room.seats.forEach((seat, seatIndex) => {
      if (seat && seat.id) {
        io.to(seat.id).emit("gameStarted", { roomCode, gameState, mySeatIndex: seatIndex });
      }
    });
    console.log("Room", roomCode, "game started — deck dealt server-side. Players:", playerNames);
  });

  // ── SUBMIT GIFT ───────────────────────────────────────────
  socket.on("submitGift", ({ roomCode, cardIds }) => {
    roomCode = normalizeRoomCode(roomCode);
    const room = rooms[roomCode];
    if (!room || !room.game) { socket.emit("lobbyError", "Game not found."); return; }

    const game = room.game;
    if (game.phase !== 'gift') { socket.emit("lobbyError", "Not in gift phase."); return; }

    const seatIndex = room.seats.findIndex(s => s && s.id === socket.id);
    if (seatIndex === -1) { socket.emit("lobbyError", "You are not in this game."); return; }
    if (game.gifts[seatIndex]) { socket.emit("lobbyError", "You already submitted your gift."); return; }

    if (!Array.isArray(cardIds) || cardIds.length !== 3) {
      socket.emit("lobbyError", "You must select exactly 3 cards."); return;
    }

    const hand = game.hands[seatIndex];
    const chosen = cardIds.map(id => hand.find(c => c.id === id)).filter(Boolean);
    if (chosen.length !== 3) { socket.emit("lobbyError", "One or more cards not found in your hand."); return; }
    if (giftViolatesColor(hand, chosen)) { socket.emit("lobbyError", "Invalid gift: cannot empty a color while holding a Lee5a."); return; }

    game.gifts[seatIndex] = chosen;
    console.log(`Room ${roomCode}: seat ${seatIndex} submitted gift [${cardIds.join(',')}]`);

    // Auto-submit gifts for all bot seats that haven't submitted yet
    room.seats.forEach((seat, idx) => {
      if (seat && seat.type === 'bot' && !game.gifts[idx]) {
        game.gifts[idx] = chooseSimpleGift(game.hands[idx]);
        console.log(`Room ${roomCode}: bot seat ${idx} auto-gifted [${game.gifts[idx].map(c=>c.id).join(',')}]`);
      }
    });

    // Broadcast partial update so the submitting player sees "waiting" state
    // (We only broadcast to real players; their mySeatIndex is preserved)
    const pendingCount = game.gifts.filter(Boolean).length;
    console.log(`Room ${roomCode}: ${pendingCount}/4 gifts submitted`);

    // Check if all 4 gifts are ready
    if (game.gifts.every(Boolean)) {
      applyGifts(game);
      game.phase = 'play';
      game.currentPlayer = 0;
      game.leadColor = null;
      game.table = [];
      game.selected = [];
      game.trickComplete = false;
      game.statusMsg = `${game.playerNames[0]}'s turn`;
      console.log(`Room ${roomCode}: all gifts done — transitioning to play phase`);
    }

    // Broadcast to all real players with personal seat index
    broadcastGameState(roomCode);

    // If game just started play phase and seat 0 is a bot, kick off bot turn
    if (game.phase === 'play' && isBotSeat(room, game.currentPlayer)) {
      setTimeout(() => scheduleBotPlay(roomCode), 750);
    }
  });

// ── BOT / PLAY HELPERS ───────────────────────────────────

function isBotSeat(room, idx) {
  return !!(room.seats[idx] && room.seats[idx].type === 'bot');
}

// Same 3-rule logic as client getPlayable
function getPlayableServer(game, seatIndex) {
  const hand = game.hands[seatIndex];
  if (!game.leadColor) return hand;
  const suited = hand.filter(c => c.color === game.leadColor);
  if (suited.length) return suited;
  const lees = hand.filter(c => isLee(c));
  if (lees.length) return lees;
  return hand;
}

// Simple bot card choice — mirrors the spirit of client pickEasyCard
function chooseBotCard(game, seatIndex) {
  const pl = getPlayableServer(game, seatIndex);
  if (!game.leadColor) {
    // Leading: play lowest-strength non-point card; fallback to lowest-strength
    const safe = pl.filter(c => pts(c) === 0);
    const pool = safe.length ? safe : pl;
    return pool.reduce((best, c) => str(c) < str(best) ? c : best, pool[0]);
  }
  // Following suit
  const suited = pl.filter(c => c.color === game.leadColor);
  if (suited.length) {
    // Try to stay under current winner
    const tableMax = Math.max(...game.table
      .filter(t => t.card.color === game.leadColor)
      .map(t => str(t.card)), 0);
    const under = suited.filter(c => str(c) < tableMax);
    if (under.length) return under.reduce((best, c) => str(c) > str(best) ? c : best, under[0]);
    // Can't go under — play lowest
    return suited.reduce((best, c) => str(c) < str(best) ? c : best, suited[0]);
  }
  // Off-suit: dump highest-point card first, else highest-strength
  const byPts = [...pl].sort((a, b) => pts(b) - pts(a) || str(b) - str(a));
  return byPts[0];
}

// Trick winner: highest-strength card of lead color wins
function trickWinnerServer(table, leadColor) {
  const lead = table.filter(t => t.card.color === leadColor);
  return lead.reduce((best, t) => str(t.card) > str(best.card) ? t : best, lead[0]);
}

// Broadcast current game state to all real players in the room
function broadcastGameState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.seats.forEach((seat, idx) => {
    if (seat && seat.id) {
      io.to(seat.id).emit("gameState", { roomCode, gameState: room.game, mySeatIndex: idx });
    }
  });
}

// Core play logic — used by both the human playCard event and bot auto-play
function playCardForSeat(roomCode, seatIndex, cardId) {
  const room = rooms[roomCode];
  if (!room || !room.game) return false;
  const game = room.game;
  if (game.phase !== 'play') return false;
  if (game.currentPlayer !== seatIndex) return false;

  // Find the card
  const hand = game.hands[seatIndex];
  const card = hand.find(c => c.id === cardId);
  if (!card) return false;

  // Validate playability
  const playable = getPlayableServer(game, seatIndex);
  if (!playable.find(c => c.id === cardId)) return false;

  // Remove from hand, add to table
  game.hands[seatIndex] = sortHand(hand.filter(c => c.id !== cardId));
  if (!game.playedCards) game.playedCards = [];
  game.playedCards.push(card);
  game.table.push({ pi: seatIndex, card });
  if (!game.leadColor) game.leadColor = card.color;

  const leesOnTable = game.table.filter(t => isLee(t.card)).length;
  const trickDone   = game.table.length === 4 || leesOnTable === 2;

  if (trickDone) {
    // ── Score and finish the trick ──────────────────────────
    // Both-lee trick: winner gets 37 flat + any red cards played on that same trick
    const trickPts = leesOnTable === 2
      ? 37 + game.table.reduce((s, t) => s + (t.card.color === 'red' ? pts(t.card) : 0), 0)
      : game.table.reduce((s, t) => s + pts(t.card), 0);

    const winner = trickWinnerServer(game.table, game.leadColor);
    const wi = winner.pi;

    game.roundPts[wi] = (game.roundPts[wi] || 0) + trickPts;

    const msg = leesOnTable === 2
      ? `${game.playerNames[wi]} took both Lee5as! +${trickPts} pts`
      : `${game.playerNames[wi]} wins trick${trickPts > 0 ? ` (+${trickPts}pts)` : ''}`;

    game.statusMsg = msg;
    game.trickResolving = true;  // freeze: table stays visible for 1.5s
    console.log(`Room ${roomCode}: trick won by seat ${wi} — ${msg}`);

    // Broadcast with table still visible + trickResolving=true so clients freeze input
    broadcastGameState(roomCode);

    // After 1.5s: clear table and continue
    setTimeout(() => {
      const room2 = rooms[roomCode];
      if (!room2 || !room2.game) return;
      const g = room2.game;
      g.trickResolving = false;
      g.receivedGiftCardIdsBySeat = null;  // no longer needed after trick

      const tableCards = [...g.table];
      g.table = [];
      g.leadColor = null;

      const roundOver = leesOnTable === 2 || g.hands.every(h => h.length === 0);

      if (roundOver) {
        // Both-lee rule: the trick winner keeps their accumulated roundPts;
        // all other players' round points are wiped to 0.
        if (leesOnTable === 2) {
          g.roundPts = g.roundPts.map((p, i) => i === wi ? p : 0);
        }
        g.scores = g.scores.map((sc, i) => sc + (g.roundPts[i] || 0));
        const maxScore = Math.max(...g.scores);
        const gameOver = maxScore >= 101;
        g.phase = gameOver ? 'gameEnd' : 'roundEnd';
        g.modal = {
          type: gameOver ? 'gameEnd' : 'roundEnd',
          rp: [...g.roundPts],
          sc: [...g.scores]
        };
        g.roundPts = [0, 0, 0, 0];
        console.log(`Room ${roomCode}: round over — scores: ${g.scores}`);
        broadcastGameState(roomCode);
        return;
      }

      g.currentPlayer = wi;
      g.statusMsg = `${g.playerNames[wi]}'s turn`;
      broadcastGameState(roomCode);

      if (isBotSeat(room2, wi)) {
        setTimeout(() => scheduleBotPlay(roomCode), 750);
      }
    }, 1500);

    return true;  // done — delayed continuation handles the rest

  } else {
    // Trick still in progress — advance to next seat
    game.currentPlayer = (seatIndex + 1) % 4;
    game.statusMsg = `${game.playerNames[game.currentPlayer]}'s turn`;
  }

  broadcastGameState(roomCode);

  // Schedule bot play if the next seat is a bot
  const next = game.currentPlayer;
  if (game.phase === 'play' && isBotSeat(room, next)) {
    setTimeout(() => scheduleBotPlay(roomCode), 750);
  }

  return true;
}

// Called by setTimeout — picks and plays a card for the current bot seat
function scheduleBotPlay(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.game) return;
  const game = room.game;
  if (game.phase !== 'play') return;

  const seatIndex = game.currentPlayer;
  if (!isBotSeat(room, seatIndex)) return;  // safety: skip if seat changed

  const card = chooseBotCard(game, seatIndex);
  if (!card) return;

  console.log(`Room ${roomCode}: bot seat ${seatIndex} plays ${card.id}`);
  playCardForSeat(roomCode, seatIndex, card.id);
  // playCardForSeat will schedule the next bot if needed
}

  // ── PLAY CARD ─────────────────────────────────────────────
  socket.on("playCard", ({ roomCode, cardId }) => {
    roomCode = normalizeRoomCode(roomCode);
    const room = rooms[roomCode];
    if (!room || !room.game) { socket.emit("lobbyError", "Game not found."); return; }

    // Identify the sender's seat
    const seatIndex = room.seats.findIndex(s => s && s.id === socket.id);
    if (seatIndex === -1) { socket.emit("lobbyError", "You are not in this game."); return; }

    const game = room.game;
    if (game.phase !== 'play') { socket.emit("lobbyError", "Game is not in play phase."); return; }
    if (game.trickResolving) { socket.emit("lobbyError", "Trick is resolving, please wait."); return; }
    if (game.currentPlayer !== seatIndex) { socket.emit("lobbyError", "It is not your turn."); return; }

    const ok = playCardForSeat(roomCode, seatIndex, cardId);
    if (!ok) socket.emit("lobbyError", "Invalid card or move.");
    // broadcastGameState is called inside playCardForSeat
  });

  // ── START NEXT ROUND ──────────────────────────────────────
  socket.on("startNextRound", ({ roomCode }) => {
    roomCode = normalizeRoomCode(roomCode);
    const room = rooms[roomCode];

    if (!room) { socket.emit("lobbyError", "Room not found."); return; }
    if (room.hostId !== socket.id) { socket.emit("lobbyError", "Only the host can start the next round."); return; }
    if (!room.game) { socket.emit("lobbyError", "No game in progress."); return; }

    const game = room.game;
    if (game.phase !== 'roundEnd' && game.phase !== 'gameEnd') {
      socket.emit("lobbyError", "Round is not over yet."); return;
    }

    // Deal a fresh deck, preserve names + cumulative scores
    const deck = shuffle(buildDeck());
    const hands = [[], [], [], []];
    deck.forEach((c, i) => hands[i % 4].push(c));

    room.game = {
      phase: 'gift',
      playerNames: [...game.playerNames],
      hands: hands.map(sortHand),
      gifts: [null, null, null, null],
      table: [],
      currentPlayer: 0,
      leadColor: null,
      scores: [...game.scores],   // keep cumulative scores
      roundPts: [0, 0, 0, 0],
      selected: [],
      statusMsg: `Choose 3 cards to gift to ${game.playerNames[1]}`,
      botThought: '',
      playedCards: [],
      knownGiftedLees: [],
      modal: null,
      trickResolving: false,
      receivedGiftCardIdsBySeat: null,
    };

    console.log(`Room ${roomCode}: host started next round — fresh deck dealt`);
    broadcastGameState(roomCode);

    // Kick off bot gifts if needed
    room.seats.forEach((seat, idx) => {
      if (seat && seat.type === 'bot') {
        room.game.gifts[idx] = chooseSimpleGift(room.game.hands[idx]);
      }
    });
    // If all gifts are already ready (e.g. all seats are bots), transition to play immediately
    if (room.game.gifts.every(Boolean)) {
      applyGifts(room.game);
      room.game.phase = 'play';
      room.game.currentPlayer = 0;
      room.game.statusMsg = `${room.game.playerNames[0]}'s turn`;
      broadcastGameState(roomCode);
      // Kick off bot play if seat 0 is a bot
      if (isBotSeat(room, 0)) {
        setTimeout(() => scheduleBotPlay(roomCode), 750);
      }
    }
  });

  // ── DISCONNECT ────────────────────────────────────────────
  socket.on("createArbaRoom", () => {
    const roomCode = makeRoomCode();
    rooms[roomCode] = { hostId: socket.id, gameType: "arba3meye", seats: [{ id: socket.id, name: "Host", type: "host" }, null, null, null] };
    socket.join(roomCode);
    socket.emit("arbaRoomCreated", roomPayload(roomCode));
  });

  socket.on("joinArbaRoom", ({ roomCode, name }) => {
    roomCode = normalizeRoomCode(roomCode);
    const room = rooms[roomCode];
    if (!room || room.gameType !== "arba3meye") { socket.emit("arbaJoinError", "Room not found."); return; }
    const emptyIdx = room.seats.findIndex(s => s === null);
    if (emptyIdx === -1) { socket.emit("arbaJoinError", "Room is full."); return; }
    room.seats[emptyIdx] = { id: socket.id, name: name || `Player ${emptyIdx + 1}`, type: "player" };
    socket.join(roomCode);
    io.to(roomCode).emit("arbaRoomUpdated", roomPayload(roomCode));
  });

  socket.on("addArbaBot", ({ roomCode }) => {
    roomCode = normalizeRoomCode(roomCode);
    const room = rooms[roomCode];
    if (!room || room.gameType !== "arba3meye") { socket.emit("arbaLobbyError", "Room not found."); return; }
    if (room.hostId !== socket.id) { socket.emit("arbaLobbyError", "Only the host can add bots."); return; }
    const emptyIdx = room.seats.findIndex(s => s === null);
    if (emptyIdx === -1) { socket.emit("arbaLobbyError", "Room is full."); return; }
    room.seats[emptyIdx] = { id: null, name: `Bot ${emptyIdx + 1}`, type: "bot" };
    io.to(roomCode).emit("arbaRoomUpdated", roomPayload(roomCode));
  });

  socket.on("removeArbaSeat", ({ roomCode, seatIndex }) => {
    roomCode = normalizeRoomCode(roomCode);
    const room = rooms[roomCode];
    if (!room || room.gameType !== "arba3meye") { socket.emit("arbaLobbyError", "Room not found."); return; }
    if (room.hostId !== socket.id) { socket.emit("arbaLobbyError", "Only the host can remove seats."); return; }
    if (!room.seats[seatIndex] || room.seats[seatIndex].type === "host") { socket.emit("arbaLobbyError", "Cannot remove this seat."); return; }
    room.seats[seatIndex] = null;
    io.to(roomCode).emit("arbaRoomUpdated", roomPayload(roomCode));
  });

  socket.on("moveArbaSeat", ({ roomCode, seatIndex, direction }) => {
    roomCode = normalizeRoomCode(roomCode);
    const room = rooms[roomCode];
    if (!room || room.gameType !== "arba3meye") { socket.emit("arbaLobbyError", "Room not found."); return; }
    if (room.hostId !== socket.id) { socket.emit("arbaLobbyError", "Only the host can move seats."); return; }
    const j = seatIndex + direction;
    if (j < 0 || j >= 4 || room.seats[seatIndex]?.type === "host" || room.seats[j]?.type === "host") { socket.emit("arbaLobbyError", "Cannot move this seat."); return; }
    [room.seats[seatIndex], room.seats[j]] = [room.seats[j], room.seats[seatIndex]];
    io.to(roomCode).emit("arbaRoomUpdated", roomPayload(roomCode));
  });

  socket.on("startArbaRoom", ({ roomCode }) => {
    roomCode = normalizeRoomCode(roomCode);
    const room = rooms[roomCode];
    if (!room || room.gameType !== "arba3meye") { socket.emit("arbaLobbyError", "Room not found."); return; }
    if (room.hostId !== socket.id) { socket.emit("arbaLobbyError", "Only the host can start the game."); return; }
    if (room.seats.filter(Boolean).length < 4) { socket.emit("arbaLobbyError", "All 4 seats must be filled before starting."); return; }
    room.arbaGame = newArbaGame(room.seats.map(s => s.name));
    room.seats.forEach((seat, idx) => { if (seat && seat.id) io.to(seat.id).emit("arbaGameStarted", { roomCode, gameState: room.arbaGame, mySeatIndex: idx }); });
    scheduleArba(roomCode);
  });

  socket.on("arbaBid", ({ roomCode, bid }) => {
    roomCode = normalizeRoomCode(roomCode);
    const room = rooms[roomCode];
    const seatIndex = room?.seats.findIndex(s => s && s.id === socket.id);
    if (seatIndex == null || seatIndex < 0 || !applyArbaBid(roomCode, seatIndex, Number(bid))) socket.emit("arbaLobbyError", "Invalid bid.");
  });

  socket.on("arbaPlayCard", ({ roomCode, cardId }) => {
    roomCode = normalizeRoomCode(roomCode);
    const room = rooms[roomCode];
    const seatIndex = room?.seats.findIndex(s => s && s.id === socket.id);
    if (seatIndex == null || seatIndex < 0 || !playArbaCard(roomCode, seatIndex, cardId)) socket.emit("arbaLobbyError", "Invalid card or move.");
  });

  socket.on("startArbaNextRound", ({ roomCode }) => {
    roomCode = normalizeRoomCode(roomCode);
    const room = rooms[roomCode];
    if (!room || room.gameType !== "arba3meye" || !room.arbaGame) { socket.emit("arbaLobbyError", "Room not found."); return; }
    if (room.hostId !== socket.id) { socket.emit("arbaLobbyError", "Only the host can start next round."); return; }
    const g = room.arbaGame;
    room.arbaGame = newArbaGame(g.names, [...g.scores], g.round + 1);
    broadcastArba(roomCode);
    scheduleArba(roomCode);
  });

  socket.on("disconnect", () => {
    for (const roomCode of Object.keys(rooms)) {
      const room = rooms[roomCode];
      let changed = false;

      room.seats = room.seats.map(seat => {
        if (seat && seat.id === socket.id) {
          changed = true;
          return null;
        }
        return seat;
      });

      if (room.seats.every(s => s === null || s.id === null)) {
        // Room is empty of real players (only bots left or all empty)
        const hasRealPlayer = room.seats.some(s => s && s.id !== null);
        if (!hasRealPlayer) {
          delete rooms[roomCode];
          console.log("Room", roomCode, "deleted (no real players left)");
          continue;
        }
      }

      if (changed) {
        io.to(roomCode).emit(room.gameType === "arba3meye" ? "arbaRoomUpdated" : "roomUpdated", roomPayload(roomCode));
      }
    }

    console.log("Player disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
