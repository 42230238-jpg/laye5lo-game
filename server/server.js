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

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("createRoom", () => {
    const roomCode = makeRoomCode();

    rooms[roomCode] = {
      players: [{ id: socket.id, name: "Host" }]
    };

    socket.join(roomCode);

    socket.emit("roomCreated", {
      roomCode,
      players: rooms[roomCode].players
    });

    console.log("Room created:", roomCode);
  });

  socket.on("joinRoom", ({ roomCode, name }) => {
    roomCode = normalizeRoomCode(roomCode);
console.log("Join attempt:", roomCode);
console.log("Existing rooms:", Object.keys(rooms));

    if (!rooms[roomCode]) {
      socket.emit("joinError", "Room not found.");
      return;
    }

    if (rooms[roomCode].players.length >= 4) {
      socket.emit("joinError", "Room is full.");
      return;
    }

    rooms[roomCode].players.push({
      id: socket.id,
      name: name || `Player ${rooms[roomCode].players.length + 1}`
    });

    socket.join(roomCode);

    io.to(roomCode).emit("roomUpdated", {
      roomCode,
      players: rooms[roomCode].players
    });

    console.log(socket.id, "joined room", roomCode);
  });

  socket.on("disconnect", () => {
    for (const roomCode of Object.keys(rooms)) {
      const room = rooms[roomCode];
      room.players = room.players.filter((p) => p.id !== socket.id);

      if (room.players.length === 0) {
        delete rooms[roomCode];
      } else {
        io.to(roomCode).emit("roomUpdated", {
          roomCode,
          players: room.players
        });
      }
    }

    console.log("Player disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});