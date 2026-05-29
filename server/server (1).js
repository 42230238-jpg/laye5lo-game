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

    io.to(roomCode).emit("gameStarted", { roomCode, gameState });
    console.log("Room", roomCode, "game started — deck dealt server-side. Players:", playerNames);
  });

  // ── DISCONNECT ────────────────────────────────────────────
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
        io.to(roomCode).emit("roomUpdated", roomPayload(roomCode));
      }
    }

    console.log("Player disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
