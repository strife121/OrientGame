const crypto = require("crypto");
const http = require("http");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "";
const ACCESS_COOKIE = "orient_access";
const DISCONNECT_GRACE_MS = Number(process.env.DISCONNECT_GRACE_MS || 180000);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();
const disconnectTimers = new Map();

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
      let val = part.slice(idx + 1);
      try {
        val = decodeURIComponent(val);
      } catch {
        // Keep raw value when URI decoding fails.
      }
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

function normalizePlayerKey(playerKey) {
  return (playerKey || "")
    .toString()
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
}

function normalizeHexColor(color) {
  const raw = (color || "").toString().trim();
  const match = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) {
    return "";
  }
  return `#${match[1].toUpperCase()}`;
}

function generateRandomColor() {
  // Keep colors readable on white and blue backgrounds.
  const r = crypto.randomInt(40, 216);
  const g = crypto.randomInt(40, 216);
  const b = crypto.randomInt(40, 216);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function generateRoomId() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function generatePlayerKey() {
  return crypto.randomBytes(16).toString("hex");
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

function clearProgress(room) {
  for (const player of room.players.values()) {
    player.progress = null;
  }
}

function allFinished(room) {
  let activePlayers = 0;
  for (const player of room.players.values()) {
    const inRace = player.connected || player.finishedMs !== null;
    if (!inRace) {
      continue;
    }
    activePlayers += 1;
    if (player.finishedMs === null) {
      return false;
    }
  }
  return activePlayers > 0;
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
      color: player.color,
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
      connected: player.connected,
      color: player.color,
    })),
    results,
  };
}

function broadcastRoom(room) {
  io.to(room.id).emit("room_state", serializeRoom(room));
}

function timerKey(roomId, playerId) {
  return `${roomId}:${playerId}`;
}

function clearDisconnectTimer(roomId, playerId) {
  const key = timerKey(roomId, playerId);
  const timer = disconnectTimers.get(key);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  disconnectTimers.delete(key);
}

function clearRoomTimers(roomId) {
  const prefix = `${roomId}:`;
  for (const [key, timer] of disconnectTimers.entries()) {
    if (key.startsWith(prefix)) {
      clearTimeout(timer);
      disconnectTimers.delete(key);
    }
  }
}

function deleteRoomIfEmpty(room) {
  if (room.players.size === 0) {
    clearRoomTimers(room.id);
    rooms.delete(room.id);
    return true;
  }
  return false;
}

function updateLeader(room) {
  if (room.leaderId) {
    const current = room.players.get(room.leaderId);
    if (current && current.connected) {
      return;
    }
  }

  const connected = [...room.players.values()]
    .filter((player) => player.connected)
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const ordered = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);

  const nextLeader = connected[0] || ordered[0];
  room.leaderId = nextLeader ? nextLeader.id : null;
}

function removePlayerImmediately(room, playerId, shouldBroadcast = true) {
  clearDisconnectTimer(room.id, playerId);
  const removed = room.players.delete(playerId);
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

function scheduleDisconnectCleanup(room, playerId) {
  clearDisconnectTimer(room.id, playerId);
  const key = timerKey(room.id, playerId);

  const timer = setTimeout(() => {
    disconnectTimers.delete(key);

    const liveRoom = rooms.get(room.id);
    if (!liveRoom) {
      return;
    }

    const player = liveRoom.players.get(playerId);
    if (!player || player.connected) {
      return;
    }

    liveRoom.players.delete(playerId);
    updateLeader(liveRoom);

    if (liveRoom.phase === "running" && allFinished(liveRoom)) {
      liveRoom.phase = "finished";
    }

    if (deleteRoomIfEmpty(liveRoom)) {
      return;
    }

    broadcastRoom(liveRoom);
  }, DISCONNECT_GRACE_MS);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  disconnectTimers.set(key, timer);
}

function clampNumber(input, min, max, fallback) {
  const n = Number(input);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

function clampInt(input, min, max, fallback) {
  return Math.floor(clampNumber(input, min, max, fallback));
}

function sanitizeProgress(progress) {
  if (!progress || typeof progress !== "object") {
    return null;
  }

  const mapSeed = Number(progress.mapSeed);
  const legSeed = Number(progress.legSeed);
  if (!Number.isFinite(mapSeed) || !Number.isFinite(legSeed)) {
    return null;
  }

  const route = Array.isArray(progress.route)
    ? progress.route
        .slice(-1200)
        .map((segment) => {
          if (!segment || typeof segment !== "object") {
            return null;
          }
          return {
            nodeIdx: clampInt(segment.nodeIdx, 0, 10000, 0),
            from: clampInt(segment.from, 0, 3, 0),
            to: clampInt(segment.to, 0, 3, 0),
          };
        })
        .filter(Boolean)
    : [];

  return {
    mapSeed: Math.floor(mapSeed),
    legSeed: Math.floor(legSeed),
    startedAt: Number.isFinite(Number(progress.startedAt)) ? Math.floor(Number(progress.startedAt)) : null,
    dotNodeIdx: clampInt(progress.dotNodeIdx, 0, 10000, 0),
    dotFrom: clampInt(progress.dotFrom, 0, 3, 0),
    dotTo: clampInt(progress.dotTo, 0, 3, 0),
    dotI: clampNumber(progress.dotI, 0, 1, 0.5),
    atStart: Boolean(progress.atStart),
    moving: Boolean(progress.moving),
    route,
    updatedAt: Date.now(),
  };
}

function getRoomForSocket(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) {
    return null;
  }
  return rooms.get(roomId) || null;
}

function getPlayerForSocket(socket, room) {
  const playerId = socket.data.playerId;
  if (!playerId) {
    return null;
  }

  const player = room.players.get(playerId);
  if (!player) {
    return null;
  }

  if (player.socketId !== socket.id) {
    return null;
  }

  return player;
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
    const playerId = normalizePlayerKey(payload?.playerKey) || generatePlayerKey();
    const color = normalizeHexColor(payload?.color);

    const previousRoomId = socket.data.roomId;
    const previousPlayerId = socket.data.playerId;

    if (previousRoomId && (previousRoomId !== roomId || previousPlayerId !== playerId)) {
      const previousRoom = rooms.get(previousRoomId);
      socket.leave(previousRoomId);
      if (previousRoom && previousPlayerId) {
        removePlayerImmediately(previousRoom, previousPlayerId, true);
      }
    }

    let room = rooms.get(roomId);
    if (!room) {
      room = createRoom(roomId);
      rooms.set(roomId, room);
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerId = playerId;

    let player = room.players.get(playerId);
    if (player) {
      player.name = name;
      if (color) {
        player.color = color;
      } else if (!player.color) {
        player.color = generateRandomColor();
      }
      player.socketId = socket.id;
      player.connected = true;
      player.disconnectedAt = null;
    } else {
      player = {
        id: playerId,
        name,
        color: color || generateRandomColor(),
        joinedAt: Date.now(),
        finishedMs: null,
        finishRank: null,
        progress: null,
        socketId: socket.id,
        connected: true,
        disconnectedAt: null,
      };
      room.players.set(playerId, player);
    }

    clearDisconnectTimer(roomId, playerId);
    updateLeader(room);
    broadcastRoom(room);

    if (typeof ack === "function") {
      ack({ ok: true, roomId, playerId, progress: player.progress, color: player.color });
    }
  });

  socket.on("update_name", (payload) => {
    const name = sanitizeName(payload?.name);
    withJoinedRoom(socket, (room) => {
      const player = getPlayerForSocket(socket, room);
      if (!player) {
        return;
      }
      player.name = name;
      broadcastRoom(room);
    });
  });

  socket.on("update_color", (payload) => {
    const color = normalizeHexColor(payload?.color);
    if (!color) {
      return;
    }

    withJoinedRoom(socket, (room) => {
      const player = getPlayerForSocket(socket, room);
      if (!player) {
        return;
      }
      player.color = color;
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
      clearProgress(room);
      broadcastRoom(room);
    });
  });

  socket.on("new_leg", () => {
    withJoinedRoom(socket, (room) => {
      room.legSeed = randomSeed();
      room.phase = "lobby";
      room.startedAt = null;
      clearFinishes(room);
      clearProgress(room);
      broadcastRoom(room);
    });
  });

  socket.on("start_race", () => {
    withJoinedRoom(socket, (room) => {
      room.phase = "running";
      room.startedAt = Date.now();
      clearFinishes(room);
      clearProgress(room);
      broadcastRoom(room);
    });
  });

  socket.on("progress_update", (payload) => {
    withJoinedRoom(socket, (room) => {
      if (room.phase !== "running") {
        return;
      }

      const player = getPlayerForSocket(socket, room);
      if (!player || player.finishedMs !== null) {
        return;
      }

      const progress = sanitizeProgress(payload);
      if (!progress) {
        return;
      }

      if (progress.mapSeed !== room.mapSeed || progress.legSeed !== room.legSeed) {
        return;
      }

      if (!room.startedAt || progress.startedAt !== room.startedAt) {
        return;
      }

      player.progress = progress;
    });
  });

  socket.on("player_finished", () => {
    withJoinedRoom(socket, (room) => {
      if (room.phase !== "running" || !room.startedAt) {
        return;
      }

      const player = getPlayerForSocket(socket, room);
      if (!player || player.finishedMs !== null) {
        return;
      }

      player.finishedMs = Math.max(0, Date.now() - room.startedAt);
      player.finishRank = 1 + [...room.players.values()].filter((entry) => entry.finishRank !== null).length;
      player.progress = null;

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

    const player = getPlayerForSocket(socket, room);
    if (!player) {
      return;
    }

    player.connected = false;
    player.socketId = null;
    player.disconnectedAt = Date.now();

    if (room.phase === "running" && allFinished(room)) {
      room.phase = "finished";
    }

    scheduleDisconnectCleanup(room, player.id);
    updateLeader(room);
    broadcastRoom(room);
  });
});

server.listen(PORT, () => {
  const accessMsg = ACCESS_TOKEN ? "access token enabled" : "public mode";
  console.log(`Ski-O multiplayer listening on http://localhost:${PORT} (${accessMsg})`);
});
