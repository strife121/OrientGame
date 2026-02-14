const crypto = require("crypto");
const http = require("http");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "";
const ACCESS_COOKIE = "orient_access";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();

function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf("=");
      if (idx <= 0) {
        return acc;
      }
      const key = part.slice(0, idx);
      const val = decodeURIComponent(part.slice(idx + 1));
      acc[key] = val;
      return acc;
    }, {});
}

function sanitizeName(name) {
  const raw = (name || "").toString().trim().replace(/\s+/g, " ");
  if (!raw) {
    return `Runner ${crypto.randomInt(100, 1000)}`;
  }
  return raw.slice(0, 24);
}

function normalizeRoomId(roomId) {
  return (roomId || "")
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 24);
}

function generateRoomId() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function randomSeed() {
  return crypto.randomInt(1, 0x7fffffff);
}

function createRoom(roomId) {
  return {
    id: roomId,
    phase: "lobby",
    startedAt: null,
    mapSeed: randomSeed(),
    legSeed: randomSeed(),
    leaderId: null,
    players: new Map(),
    createdAt: Date.now(),
  };
}

function clearFinishes(room) {
  for (const player of room.players.values()) {
    player.finishedMs = null;
    player.finishRank = null;
  }
}

function allFinished(room) {
  if (room.players.size === 0) {
    return false;
  }
  for (const player of room.players.values()) {
    if (player.finishedMs === null) {
      return false;
    }
  }
  return true;
}

function serializeRoom(room) {
  const players = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  const results = players
    .filter((player) => player.finishedMs !== null)
    .sort((a, b) => {
      if (a.finishRank !== b.finishRank) {
        return a.finishRank - b.finishRank;
      }
      return a.finishedMs - b.finishedMs;
    })
    .map((player) => ({
      id: player.id,
      name: player.name,
      finishRank: player.finishRank,
      finishedMs: player.finishedMs,
    }));

  return {
    roomId: room.id,
    phase: room.phase,
    startedAt: room.startedAt,
    mapSeed: room.mapSeed,
    legSeed: room.legSeed,
    leaderId: room.leaderId,
    serverNow: Date.now(),
    players: players.map((player) => ({
      id: player.id,
      name: player.name,
      joinedAt: player.joinedAt,
      finishRank: player.finishRank,
      finishedMs: player.finishedMs,
    })),
    results,
  };
}

function broadcastRoom(room) {
  io.to(room.id).emit("room_state", serializeRoom(room));
}

function deleteRoomIfEmpty(room) {
  if (room.players.size === 0) {
    rooms.delete(room.id);
    return true;
  }
  return false;
}

function updateLeader(room) {
  if (room.leaderId && room.players.has(room.leaderId)) {
    return;
  }
  const nextLeader = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
  room.leaderId = nextLeader ? nextLeader.id : null;
}

function removePlayerFromRoom(room, socketId, shouldBroadcast = true) {
  const removed = room.players.delete(socketId);
  if (!removed) {
    return;
  }

  updateLeader(room);

  if (room.phase === "running" && allFinished(room)) {
    room.phase = "finished";
  }

  if (deleteRoomIfEmpty(room)) {
    return;
  }

  if (shouldBroadcast) {
    broadcastRoom(room);
  }
}

function getRoomForSocket(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) {
    return null;
  }
  return rooms.get(roomId) || null;
}

function withJoinedRoom(socket, callback) {
  const room = getRoomForSocket(socket);
  if (!room) {
    return;
  }
  callback(room);
}

app.use((req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /\n");
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

if (ACCESS_TOKEN) {
  app.use((req, res, next) => {
    const queryToken = typeof req.query.access === "string" ? req.query.access : "";
    const cookieToken = parseCookies(req.headers.cookie)[ACCESS_COOKIE] || "";

    if (queryToken && queryToken === ACCESS_TOKEN) {
      res.setHeader(
        "Set-Cookie",
        `${ACCESS_COOKIE}=${encodeURIComponent(ACCESS_TOKEN)}; Path=/; HttpOnly; SameSite=Lax`
      );
      return next();
    }

    if (cookieToken === ACCESS_TOKEN) {
      return next();
    }

    res.status(401).send("Unauthorized. Use invite link with ?access=TOKEN.");
  });
}

app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));

io.use((socket, next) => {
  if (!ACCESS_TOKEN) {
    return next();
  }

  const authToken = typeof socket.handshake.auth?.access === "string" ? socket.handshake.auth.access : "";
  const queryToken = typeof socket.handshake.query?.access === "string" ? socket.handshake.query.access : "";
  const cookieToken = parseCookies(socket.handshake.headers.cookie)[ACCESS_COOKIE] || "";

  if (authToken === ACCESS_TOKEN || queryToken === ACCESS_TOKEN || cookieToken === ACCESS_TOKEN) {
    return next();
  }

  return next(new Error("unauthorized"));
});

io.on("connection", (socket) => {
  socket.on("join_room", (payload, ack) => {
    const roomId = normalizeRoomId(payload?.roomId) || generateRoomId();
    const name = sanitizeName(payload?.name);
    const previousRoomId = socket.data.roomId;

    if (previousRoomId && previousRoomId !== roomId) {
      const previousRoom = rooms.get(previousRoomId);
      socket.leave(previousRoomId);
      if (previousRoom) {
        removePlayerFromRoom(previousRoom, socket.id, true);
      }
    }

    let room = rooms.get(roomId);
    if (!room) {
      room = createRoom(roomId);
      rooms.set(roomId, room);
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    const existing = room.players.get(socket.id);
    if (existing) {
      existing.name = name;
    } else {
      room.players.set(socket.id, {
        id: socket.id,
        name,
        joinedAt: Date.now(),
        finishedMs: null,
        finishRank: null,
      });
    }

    updateLeader(room);
    broadcastRoom(room);

    if (typeof ack === "function") {
      ack({ ok: true, roomId, playerId: socket.id });
    }
  });

  socket.on("update_name", (payload) => {
    const name = sanitizeName(payload?.name);
    withJoinedRoom(socket, (room) => {
      const player = room.players.get(socket.id);
      if (!player) {
        return;
      }
      player.name = name;
      broadcastRoom(room);
    });
  });

  socket.on("new_map", () => {
    withJoinedRoom(socket, (room) => {
      room.mapSeed = randomSeed();
      room.legSeed = randomSeed();
      room.phase = "lobby";
      room.startedAt = null;
      clearFinishes(room);
      broadcastRoom(room);
    });
  });

  socket.on("new_leg", () => {
    withJoinedRoom(socket, (room) => {
      room.legSeed = randomSeed();
      room.phase = "lobby";
      room.startedAt = null;
      clearFinishes(room);
      broadcastRoom(room);
    });
  });

  socket.on("start_race", () => {
    withJoinedRoom(socket, (room) => {
      room.phase = "running";
      room.startedAt = Date.now();
      clearFinishes(room);
      broadcastRoom(room);
    });
  });

  socket.on("player_finished", () => {
    withJoinedRoom(socket, (room) => {
      if (room.phase !== "running" || !room.startedAt) {
        return;
      }

      const player = room.players.get(socket.id);
      if (!player || player.finishedMs !== null) {
        return;
      }

      player.finishedMs = Math.max(0, Date.now() - room.startedAt);
      player.finishRank = 1 + [...room.players.values()].filter((entry) => entry.finishRank !== null).length;

      if (allFinished(room)) {
        room.phase = "finished";
      }

      broadcastRoom(room);
    });
  });

  socket.on("disconnect", () => {
    const room = getRoomForSocket(socket);
    if (!room) {
      return;
    }
    removePlayerFromRoom(room, socket.id, true);
  });
});

server.listen(PORT, () => {
  const accessMsg = ACCESS_TOKEN ? "access token enabled" : "public mode";
  console.log(`Ski-O multiplayer listening on http://localhost:${PORT} (${accessMsg})`);
});
