const crypto = require("crypto");
const http = require("http");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const DISCONNECT_GRACE_MS = Number(process.env.DISCONNECT_GRACE_MS || 180000);
const COUNTDOWN_SECONDS = 5;
const COUNTDOWN_MS = COUNTDOWN_SECONDS * 1000;
const MIN_CHECKPOINTS = 1;
const MAX_CHECKPOINTS = 10;
const DEFAULT_CHECKPOINTS = 3;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();
const disconnectTimers = new Map();

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

function nextSeedDifferent(prevSeed) {
  const prev = Number(prevSeed);
  let next = randomSeed();
  for (let attempt = 0; attempt < 6 && Number.isFinite(prev) && next === prev; attempt += 1) {
    next = randomSeed();
  }
  if (Number.isFinite(prev) && next === prev) {
    return ((prev + 1) % 0x7fffffff) || 1;
  }
  return next;
}

function createRoom(roomId) {
  return {
    id: roomId,
    phase: "lobby",
    startedAt: null,
    countdownEndsAt: null,
    mapSeed: randomSeed(),
    legSeed: randomSeed(),
    checkpointCount: DEFAULT_CHECKPOINTS,
    showPositionOnMap: true,
    leaderId: null,
    players: new Map(),
    createdAt: Date.now(),
    lastProgressBroadcastAt: 0,
    countdownTimer: null,
  };
}

function clearCountdownTimer(room) {
  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
  }
  room.countdownEndsAt = null;
}

function resetRoomToLobby(room, options = {}) {
  const resetMap = Boolean(options.resetMap);
  const resetLeg = Boolean(options.resetLeg);

  clearCountdownTimer(room);
  if (resetMap) {
    room.mapSeed = nextSeedDifferent(room.mapSeed);
  }
  if (resetLeg) {
    room.legSeed = nextSeedDifferent(room.legSeed);
  }
  room.phase = "lobby";
  room.startedAt = null;
  clearFinishes(room);
  clearProgress(room);
}

function promoteCountdownIfDue(room) {
  if (room.phase !== "countdown" || !room.startedAt) {
    return false;
  }
  if (Date.now() < room.startedAt) {
    return false;
  }
  clearCountdownTimer(room);
  room.phase = "running";
  return true;
}

function startRaceCountdown(room) {
  clearCountdownTimer(room);
  room.lastProgressBroadcastAt = 0;
  room.phase = "countdown";
  room.startedAt = Date.now() + COUNTDOWN_MS;
  room.countdownEndsAt = room.startedAt;
  clearFinishes(room);
  clearProgress(room);

  const delay = Math.max(0, room.countdownEndsAt - Date.now());
  room.countdownTimer = setTimeout(() => {
    const liveRoom = rooms.get(room.id);
    if (!liveRoom) {
      return;
    }
    if (promoteCountdownIfDue(liveRoom)) {
      broadcastRoom(liveRoom);
    }
  }, delay);
}

function clearFinishes(room) {
  for (const player of room.players.values()) {
    player.finishedMs = null;
    player.withdrawn = false;
    player.withdrawnAt = null;
    player.finishRank = null;
    player.splits = [];
  }
}

function clearProgress(room) {
  for (const player of room.players.values()) {
    player.progress = null;
  }
}

function isRaceParticipant(player) {
  return !player.observer;
}

function isPlayerInRace(player) {
  return player.connected || player.finishedMs !== null || player.withdrawn;
}

function allFinished(room) {
  let activePlayers = 0;
  for (const player of room.players.values()) {
    if (!isRaceParticipant(player)) {
      continue;
    }
    const inRace = isPlayerInRace(player);
    if (!inRace) {
      continue;
    }
    activePlayers += 1;
    if (player.finishedMs === null && !player.withdrawn) {
      return false;
    }
  }
  return activePlayers > 0;
}

function allActiveWithdrawn(room) {
  let activePlayers = 0;
  let withdrawnPlayers = 0;
  for (const player of room.players.values()) {
    if (!isRaceParticipant(player)) {
      continue;
    }
    const inRace = isPlayerInRace(player);
    if (!inRace) {
      continue;
    }
    activePlayers += 1;
    if (player.withdrawn) {
      withdrawnPlayers += 1;
    }
  }
  return activePlayers > 0 && activePlayers === withdrawnPlayers;
}

function hasActiveRaceParticipants(room) {
  for (const player of room.players.values()) {
    if (!isRaceParticipant(player)) {
      continue;
    }
    if (isPlayerInRace(player)) {
      return true;
    }
  }
  return false;
}

function serializeProgressForClient(progress) {
  if (!progress || typeof progress !== "object") {
    return null;
  }
  return {
    mapSeed: progress.mapSeed,
    legSeed: progress.legSeed,
    startedAt: progress.startedAt,
    checkpointIndex: progress.checkpointIndex,
    dotNodeIdx: progress.dotNodeIdx,
    dotFrom: progress.dotFrom,
    dotTo: progress.dotTo,
    dotI: progress.dotI,
    atStart: Boolean(progress.atStart),
    moving: Boolean(progress.moving),
    route: Array.isArray(progress.route) ? progress.route : [],
    updatedAt: progress.updatedAt,
  };
}

function serializeRoom(room) {
  promoteCountdownIfDue(room);

  const players = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  const results = players
    .filter((player) => !player.observer && (player.finishedMs !== null || player.withdrawn))
    .sort((a, b) => {
      if (a.finishRank !== b.finishRank) {
        return a.finishRank - b.finishRank;
      }
      const aTime = Number.isFinite(a.finishedMs) ? a.finishedMs : Number.MAX_SAFE_INTEGER;
      const bTime = Number.isFinite(b.finishedMs) ? b.finishedMs : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    })
    .map((player) => ({
      id: player.id,
      name: player.name,
      finishRank: player.finishRank,
      finishedMs: player.finishedMs,
      status: player.withdrawn ? "withdrawn" : "finished",
      color: player.color,
    }));

  return {
    roomId: room.id,
    phase: room.phase,
    startedAt: room.startedAt,
    countdownEndsAt: room.countdownEndsAt,
    mapSeed: room.mapSeed,
    legSeed: room.legSeed,
    checkpointCount: room.checkpointCount,
    showPositionOnMap: room.showPositionOnMap !== false,
    isObserver: false,
    leaderId: room.leaderId,
    serverNow: Date.now(),
    players: players.map((player) => ({
      id: player.id,
      name: player.name,
      joinedAt: player.joinedAt,
      finishRank: player.finishRank,
      finishedMs: player.finishedMs,
      withdrawn: Boolean(player.withdrawn),
      connected: player.connected,
      color: player.color,
      observer: Boolean(player.observer),
      splits: Array.isArray(player.splits) ? player.splits : [],
      progress: serializeProgressForClient(player.progress),
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
    clearCountdownTimer(room);
    clearRoomTimers(room.id);
    rooms.delete(room.id);
    return true;
  }
  return false;
}

function requireLeader(socket, room, actionLabel) {
  if (!room.leaderId || socket.data.playerId !== room.leaderId) {
    socket.emit("room_action_denied", `Только лидер может ${actionLabel}.`);
    return false;
  }
  return true;
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

  if (room.phase === "running") {
    if (!hasActiveRaceParticipants(room)) {
      resetRoomToLobby(room);
    } else if (allFinished(room)) {
      room.phase = "finished";
    }
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

    if (liveRoom.phase === "running") {
      if (!hasActiveRaceParticipants(liveRoom)) {
        resetRoomToLobby(liveRoom);
      } else if (allFinished(liveRoom)) {
        liveRoom.phase = "finished";
      }
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
    checkpointIndex: clampInt(progress.checkpointIndex, 0, MAX_CHECKPOINTS, 0),
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

app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));

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
      if (!Array.isArray(player.splits)) {
        player.splits = [];
      }
      if (typeof player.observer !== "boolean") {
        player.observer = false;
      }
    } else {
      player = {
        id: playerId,
        name,
        color: color || generateRandomColor(),
        joinedAt: Date.now(),
        finishedMs: null,
        withdrawn: false,
        withdrawnAt: null,
        finishRank: null,
        progress: null,
        splits: [],
        observer: false,
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
      if (!requireLeader(socket, room, "менять карту")) {
        return;
      }
      resetRoomToLobby(room, { resetMap: true, resetLeg: true });
      broadcastRoom(room);
    });
  });

  socket.on("new_leg", () => {
    withJoinedRoom(socket, (room) => {
      if (!requireLeader(socket, room, "менять дистанцию")) {
        return;
      }
      resetRoomToLobby(room, { resetLeg: true });
      broadcastRoom(room);
    });
  });

  socket.on("set_checkpoint_count", (payload) => {
    withJoinedRoom(socket, (room) => {
      if (!requireLeader(socket, room, "задавать количество КП")) {
        return;
      }
      if (room.phase !== "lobby") {
        socket.emit("room_action_denied", "Количество КП можно менять только в лобби.");
        return;
      }

      const nextCount = clampInt(payload?.count, MIN_CHECKPOINTS, MAX_CHECKPOINTS, room.checkpointCount);
      if (nextCount === room.checkpointCount) {
        return;
      }

      room.checkpointCount = nextCount;
      resetRoomToLobby(room, { resetLeg: true });
      broadcastRoom(room);
    });
  });

  socket.on("set_show_position_on_map", (payload) => {
    withJoinedRoom(socket, (room) => {
      if (!requireLeader(socket, room, "управлять показом позиции")) {
        return;
      }
      if (room.phase !== "lobby") {
        socket.emit("room_action_denied", "Показ позиции можно менять только в лобби.");
        return;
      }

      const enabled = payload?.enabled !== false;
      if (room.showPositionOnMap === enabled) {
        return;
      }

      room.showPositionOnMap = enabled;
      broadcastRoom(room);
    });
  });

  socket.on("set_observer_mode", (payload) => {
    withJoinedRoom(socket, (room) => {
      const player = getPlayerForSocket(socket, room);
      if (!player) {
        return;
      }

      const enabled = payload?.enabled === true;
      if (player.observer === enabled) {
        return;
      }

      const raceActive = room.phase === "running" || room.phase === "countdown";
      if (!enabled && raceActive) {
        socket.emit("room_action_denied", "Отключить режим наблюдателя можно после завершения гонки.");
        return;
      }

      player.observer = enabled;
      if (enabled) {
        player.finishedMs = null;
        player.withdrawn = false;
        player.withdrawnAt = null;
        player.finishRank = null;
        player.progress = null;
        player.splits = [];
      }

      if ((room.phase === "running" || room.phase === "countdown") && !hasActiveRaceParticipants(room)) {
        resetRoomToLobby(room);
      } else if (room.phase === "running" && allFinished(room)) {
        room.phase = "finished";
      }

      broadcastRoom(room);
    });
  });

  socket.on("sync_phase", () => {
    withJoinedRoom(socket, (room) => {
      if (promoteCountdownIfDue(room)) {
        broadcastRoom(room);
      }
    });
  });

  socket.on("start_race", () => {
    withJoinedRoom(socket, (room) => {
      if (!requireLeader(socket, room, "запускать старт")) {
        return;
      }
      if (room.phase !== "lobby") {
        return;
      }
      const starters = [...room.players.values()].filter((entry) => entry.connected && !entry.observer);
      if (!starters.length) {
        socket.emit("room_action_denied", "Нет участников дистанции. Отключите режим наблюдателя хотя бы у одного игрока.");
        return;
      }
      startRaceCountdown(room);
      broadcastRoom(room);
    });
  });

  socket.on("progress_update", (payload) => {
    withJoinedRoom(socket, (room) => {
      if (room.phase !== "running") {
        return;
      }

      const player = getPlayerForSocket(socket, room);
      if (!player || player.observer || player.finishedMs !== null || player.withdrawn) {
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
      const now = Date.now();
      if (!room.lastProgressBroadcastAt || now - room.lastProgressBroadcastAt >= 160) {
        room.lastProgressBroadcastAt = now;
        broadcastRoom(room);
      }
    });
  });

  socket.on("player_split", (payload) => {
    withJoinedRoom(socket, (room) => {
      if (room.phase !== "running" || !room.startedAt) {
        return;
      }

      const player = getPlayerForSocket(socket, room);
      if (!player || player.observer || player.finishedMs !== null || player.withdrawn) {
        return;
      }

      const splitIndex = clampInt(payload?.splitIndex, 1, room.checkpointCount, 0);
      const expectedIndex = (Array.isArray(player.splits) ? player.splits.length : 0) + 1;
      if (splitIndex !== expectedIndex) {
        return;
      }

      const splitMs = Math.max(0, Date.now() - room.startedAt);
      const previousSplit = Array.isArray(player.splits) && player.splits.length ? player.splits[player.splits.length - 1] : 0;
      const safeSplit = Math.max(previousSplit, splitMs);
      player.splits.push(safeSplit);
      broadcastRoom(room);
    });
  });

  socket.on("player_finished", () => {
    withJoinedRoom(socket, (room) => {
      if (room.phase !== "running" || !room.startedAt) {
        return;
      }

      const player = getPlayerForSocket(socket, room);
      if (!player || player.observer || player.finishedMs !== null || player.withdrawn) {
        return;
      }

      player.finishedMs = Math.max(0, Date.now() - room.startedAt);
      if (player.splits.length === room.checkpointCount - 1) {
        player.splits.push(player.finishedMs);
      }
      player.finishRank = 1 + [...room.players.values()].filter((entry) => entry.finishRank !== null).length;

      if (allFinished(room)) {
        room.phase = "finished";
      }

      broadcastRoom(room);
    });
  });

  socket.on("player_withdrawn", (payloadOrAck, maybeAck) => {
    const payload =
      payloadOrAck && typeof payloadOrAck === "object" && typeof payloadOrAck !== "function" ? payloadOrAck : {};
    const ack = typeof payloadOrAck === "function" ? payloadOrAck : maybeAck;
    const respond = (payload) => {
      if (typeof ack === "function") {
        ack(payload);
      }
    };

    const fallbackRoomId = normalizeRoomId(payload.roomId);
    const room = getRoomForSocket(socket) || (fallbackRoomId ? rooms.get(fallbackRoomId) || null : null);
    if (!room) {
      respond({ ok: false, message: "Комната не найдена. Обновите страницу." });
      return;
    }

    if (room.phase !== "running" || !room.startedAt) {
      respond({ ok: false, message: "Сойти можно только во время гонки." });
      return;
    }

    let player = getPlayerForSocket(socket, room);
    if (!player) {
      const fallbackPlayerId = normalizePlayerKey(payload.playerId);
      if (fallbackPlayerId) {
        player = room.players.get(fallbackPlayerId) || null;
      }
    }
    if (!player) {
      respond({ ok: false, message: "Игрок не найден в комнате. Обновите страницу." });
      return;
    }
    if (socket.data.playerId && player.id !== socket.data.playerId) {
      respond({ ok: false, message: "Игрок не совпадает с текущей сессией." });
      return;
    }
    if (player.observer) {
      respond({ ok: false, message: "Наблюдатель не участвует в дистанции." });
      return;
    }
    if (player.finishedMs !== null || player.withdrawn) {
      respond({ ok: true, phase: room.phase });
      return;
    }

    player.withdrawn = true;
    player.withdrawnAt = Math.max(0, Date.now() - room.startedAt);
    player.finishRank = 1 + [...room.players.values()].filter((entry) => entry.finishRank !== null).length;

    const connectedPlayers = [...room.players.values()].filter((entry) => entry.connected && !entry.observer);
    if (connectedPlayers.length <= 1) {
      resetRoomToLobby(room);
      broadcastRoom(room);
      respond({ ok: true, phase: room.phase });
      return;
    }

    if (allFinished(room)) {
      if (allActiveWithdrawn(room)) {
        resetRoomToLobby(room);
      } else {
        room.phase = "finished";
      }
    }

    broadcastRoom(room);
    respond({ ok: true, phase: room.phase });
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

    if (room.phase === "running") {
      if (!hasActiveRaceParticipants(room)) {
        resetRoomToLobby(room);
      } else if (allFinished(room)) {
        room.phase = "finished";
      }
    }

    scheduleDisconnectCleanup(room, player.id);
    updateLeader(room);
    broadcastRoom(room);
  });
});

const countdownWatcher = setInterval(() => {
  for (const room of rooms.values()) {
    if (promoteCountdownIfDue(room)) {
      broadcastRoom(room);
    }
  }
}, 250);

if (typeof countdownWatcher.unref === "function") {
  countdownWatcher.unref();
}

server.listen(PORT, () => {
  console.log(`Ski-O multiplayer listening on http://localhost:${PORT}`);
});
