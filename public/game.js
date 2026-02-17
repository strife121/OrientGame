/* eslint-disable no-use-before-define */
"use strict";

(() => {
  const queryParams = new URLSearchParams(window.location.search);

  const ui = {
    status: document.getElementById("status"),
    joinPanel: document.getElementById("joinPanel"),
    roomPanel: document.getElementById("roomPanel"),
    nameInput: document.getElementById("nameInput"),
    roomInput: document.getElementById("roomInput"),
    createRoomBtn: document.getElementById("createRoomBtn"),
    joinRoomBtn: document.getElementById("joinRoomBtn"),
    joinRandomColorBtn: document.getElementById("joinRandomColorBtn"),
    joinColorPreview: document.getElementById("joinColorPreview"),
    joinColorHex: document.getElementById("joinColorHex"),
    roomCode: document.getElementById("roomCode"),
    copyLinkBtn: document.getElementById("copyLinkBtn"),
    roomNameInput: document.getElementById("roomNameInput"),
    saveNameBtn: document.getElementById("saveNameBtn"),
    roomRandomColorBtn: document.getElementById("roomRandomColorBtn"),
    roomColorPreview: document.getElementById("roomColorPreview"),
    roomColorHex: document.getElementById("roomColorHex"),
    roomProfileBox: document.getElementById("roomProfileBox"),
    raceButtonsRow: document.getElementById("raceButtonsRow"),
    courseConfigRow: document.getElementById("courseConfigRow"),
    checkpointCountInput: document.getElementById("checkpointCountInput"),
    saveCheckpointBtn: document.getElementById("saveCheckpointBtn"),
    showPositionOnMapInput: document.getElementById("showPositionOnMapInput"),
    observerModeInput: document.getElementById("observerModeInput"),
    btnNewMap: document.getElementById("btnNewMap"),
    btnNewLeg: document.getElementById("btnNewLeg"),
    btnStart: document.getElementById("btnStart"),
    btnMap: document.getElementById("btnMap"),
    btnWithdraw: document.getElementById("btnWithdraw"),
    playersSection: document.getElementById("playersSection"),
    resultsSection: document.getElementById("resultsSection"),
    playersList: document.getElementById("playersList"),
    resultsBody: document.getElementById("resultsBody"),
    resultsCol1: document.getElementById("resultsCol1"),
    resultsCol2: document.getElementById("resultsCol2"),
    resultsCol3: document.getElementById("resultsCol3"),
    showSplitsToggle: document.getElementById("showSplitsToggle"),
    timerBadge: document.getElementById("timerBadge"),
    canvasWrap: document.getElementById("canvasWrap"),
    canvas: document.getElementById("canvas"),
    countdownOverlay: document.getElementById("countdownOverlay"),
    countdownValue: document.getElementById("countdownValue"),
  };

  const state = {
    socket: null,
    connected: false,
    joined: false,
    pendingRoomId: "",
    roomId: "",
    playerId: "",
    playerName: "",
    playerColor: "#8F1F1F",
    leaderId: "",
    players: [],
    results: [],
    phase: "lobby",
    startedAt: null,
    countdownEndsAt: null,
    mapSeed: null,
    legSeed: null,
    checkpointCount: 3,
    showPositionOnMap: true,
    showSplits: false,
    isObserver: false,
    serverOffsetMs: 0,
    lastPhaseSyncAt: 0,
    startFlashUntil: 0,
    localFinished: false,
    localWithdrawn: false,
    withdrawRequestPending: false,
    mapViewOpen: false,
    resumeProgress: null,
    mapViewSnapshot: null,
  };
  state.showSplits = localStorage.getItem("orient_show_splits") === "1";
  ui.showPositionOnMapInput.checked = state.showPositionOnMap;
  ui.showSplitsToggle.checked = state.showSplits;

  const savedPlayerKey = normalizePlayerKey(localStorage.getItem("orient_player_key") || "");
  state.playerId = savedPlayerKey || generatePlayerKey();
  localStorage.setItem("orient_player_key", state.playerId);

  const savedName = localStorage.getItem("orient_player_name");
  ui.nameInput.value = sanitizeName(savedName || "") || `Runner ${Math.floor(Math.random() * 900 + 100)}`;
  state.playerName = ui.nameInput.value;
  ui.roomNameInput.value = ui.nameInput.value;

  const savedColor = normalizeHexColor(localStorage.getItem("orient_player_color") || "");
  state.playerColor = savedColor || generateRandomColor();
  localStorage.setItem("orient_player_color", state.playerColor);
  updateColorPreview();

  const urlRoom = normalizeRoomId(queryParams.get("room") || "");
  if (urlRoom) {
    ui.roomInput.value = urlRoom;
  }

  ui.createRoomBtn.addEventListener("click", () => {
    const roomId = generateRoomCode();
    joinRoom(roomId);
  });

  ui.joinRoomBtn.addEventListener("click", () => {
    const roomId = normalizeRoomId(ui.roomInput.value) || generateRoomCode();
    joinRoom(roomId);
  });

  ui.copyLinkBtn.addEventListener("click", async () => {
    if (!state.roomId) {
      return;
    }
    const link = buildInviteLink(state.roomId);
    try {
      await navigator.clipboard.writeText(link);
      setStatus("Ссылка скопирована");
    } catch (_err) {
      setStatus("Не удалось скопировать ссылку");
    }
  });

  ui.btnNewMap.addEventListener("click", () => {
    if (!canSendRoomEvent()) {
      return;
    }
    if (!isLocalLeader()) {
      setStatus("Только лидер комнаты управляет картой и дистанцией.");
      return;
    }
    clearLocalProgress(state.roomId);
    state.socket.emit("new_map");
  });

  ui.btnNewLeg.addEventListener("click", () => {
    if (!canSendRoomEvent()) {
      return;
    }
    if (!isLocalLeader()) {
      setStatus("Только лидер комнаты управляет картой и дистанцией.");
      return;
    }
    clearLocalProgress(state.roomId);
    state.socket.emit("new_leg");
  });

  ui.btnStart.addEventListener("click", () => {
    if (!canSendRoomEvent()) {
      return;
    }
    if (!isLocalLeader()) {
      setStatus("Только лидер комнаты может запускать старт.");
      return;
    }
    clearLocalProgress(state.roomId);
    state.socket.emit("start_race");
  });

  ui.saveCheckpointBtn.addEventListener("click", () => {
    applyCheckpointCount(true);
  });

  ui.checkpointCountInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    applyCheckpointCount(true);
  });

  ui.showPositionOnMapInput.addEventListener("change", () => {
    applyShowPositionOnMap(true);
  });

  ui.observerModeInput.addEventListener("change", () => {
    applyObserverMode(true);
  });

  ui.showSplitsToggle.addEventListener("change", () => {
    state.showSplits = Boolean(ui.showSplitsToggle.checked);
    localStorage.setItem("orient_show_splits", state.showSplits ? "1" : "0");
    renderResults();
  });

  ui.btnMap.addEventListener("click", () => {
    if (state.phase !== "running") {
      return;
    }
    setMapViewOpen(!state.mapViewOpen);
  });

  ui.btnWithdraw.addEventListener("click", () => {
    if (state.withdrawRequestPending) {
      return;
    }
    if (!canSendRoomEvent()) {
      setStatus("Нет соединения с сервером.");
      return;
    }
    if (state.phase !== "running" || state.localFinished) {
      setStatus("Сойти можно только во время активной гонки.");
      return;
    }
    state.withdrawRequestPending = true;
    renderUi();
    setStatus("Фиксируем сход...");

    let requestSettled = false;
    const timeoutId = window.setTimeout(() => {
      if (requestSettled) {
        return;
      }
      requestSettled = true;
      state.withdrawRequestPending = false;
      renderUi();
      setStatus("Сервер не ответил. Попробуйте снова.");
    }, 3500);

    state.socket.emit(
      "player_withdrawn",
      {
        roomId: state.roomId,
        playerId: state.playerId,
      },
      (ack) => {
      if (requestSettled) {
        return;
      }
      requestSettled = true;
      window.clearTimeout(timeoutId);
      state.withdrawRequestPending = false;

      if (ack && ack.ok) {
        state.localWithdrawn = true;
        state.localFinished = true;
        mMoving = false;
        clearLocalProgress(state.roomId);
        renderUi();
        if (ack.phase === "lobby") {
          setStatus("Все участники сошли. Возврат в лобби.");
        } else {
          setStatus("Вы сошли с дистанции.");
        }
        return;
      }
      renderUi();
      setStatus((ack && ack.message) || "Не удалось сойти с дистанции.");
      }
    );
  });

  ui.nameInput.addEventListener("change", () => {
    applyPlayerName(ui.nameInput.value, true);
  });

  ui.roomNameInput.addEventListener("change", () => {
    applyPlayerName(ui.roomNameInput.value, true);
  });

  ui.roomNameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    applyPlayerName(ui.roomNameInput.value, true);
  });

  ui.saveNameBtn.addEventListener("click", () => {
    applyPlayerName(ui.roomNameInput.value, true);
  });

  ui.joinRandomColorBtn.addEventListener("click", () => {
    applyPlayerColor(generateRandomColor(), true);
  });

  ui.roomRandomColorBtn.addEventListener("click", () => {
    applyPlayerColor(generateRandomColor(), true);
  });

  let canvas = ui.canvas;
  let ctx = canvas.getContext("2d");
  let ctxWidth = 1;
  let ctxHeight = 1;
  let gSystemTime = 0;
  let mViewPos = new vec2(0, 0);
  let mViewR = 0;
  let mViewS = 1;
  let mMapNodes = [];
  let mRouteNodes = [];
  let mSrcNode;
  let mDstNode;
  let mCheckpointNodes = [];
  let mNextCheckpointIdx = 0;
  let mDotNode;
  let mDotFrom;
  let mDotTo;
  let mDotI;
  let mDotPos = new vec2(0, 0);
  let mDotAng = 0;
  let mDotAngPID = new PID(0.16, 0.1, 0);
  let mDotPosxPID = new PID(0.16, 0.1, 0);
  let mDotPosyPID = new PID(0.16, 0.1, 0);
  let mMoving = false;
  let mRoadChoiceMode = false;
  let mMenu = true;
  let mAtStart = true;
  let mCenterView = true;
  let mShowCompass = true;
  let mLastFrameTime = performance.now();
  let mNodeIndexMap = new Map();
  let mLastProgressPushAt = 0;

  let randomSource = Math.random;

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function rand() {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), t | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function withSeed(seed, fn) {
    const previousRandom = randomSource;
    randomSource = mulberry32(seed || 1);
    try {
      return fn();
    } finally {
      randomSource = previousRandom;
    }
  }

  function FRAND() {
    return randomSource();
  }

  function RandRange(a, b) {
    return FRAND() * (b - a) + a;
  }

  function RandRangeI(a, b) {
    return Math.floor(FRAND() * (b - a + 1)) + a;
  }

  function Interpolate(a, b, i) {
    return a + (b - a) * i;
  }

  function Clamp(x, a, b) {
    return x < a ? a : x > b ? b : x;
  }

  function Create2DArray(size) {
    let ret = [];
    for (let a = 0; a < size; a += 1) {
      ret[a] = [];
    }
    return ret;
  }

  function Set2DArray(array, val) {
    for (let x = 0; x < array.length; x += 1) {
      for (let y = 0; y < array.length; y += 1) {
        array[x][y] = val;
      }
    }
  }

  function vec2(aX, aY) {
    this.x = aX;
    this.y = aY;
  }

  vec2.prototype.copy = function copy() {
    return new vec2(this.x, this.y);
  };
  vec2.prototype.plusEquals = function plusEquals(v) {
    this.x += v.x;
    this.y += v.y;
    return this;
  };
  vec2.prototype.multiplyEquals = function multiplyEquals(f) {
    this.x *= f;
    this.y *= f;
    return this;
  };
  vec2.prototype.divideEquals = function divideEquals(f) {
    this.x /= f;
    this.y /= f;
    return this;
  };
  vec2.prototype.length = function length() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  };
  vec2.prototype.lengthSquared = function lengthSquared() {
    return this.x * this.x + this.y * this.y;
  };
  vec2.divide = function divide(a, f) {
    return new vec2(a.x / f, a.y / f);
  };
  vec2.add = function add(a, b) {
    return new vec2(a.x + b.x, a.y + b.y);
  };
  vec2.sub = function sub(a, b) {
    return new vec2(a.x - b.x, a.y - b.y);
  };
  vec2.interpolate = function interpolate(a, b, i) {
    return new vec2(Interpolate(a.x, b.x, i), Interpolate(a.y, b.y, i));
  };
  vec2.bezier = function bezier(p1, p2, p3, p4, i) {
    let a = (1 - i) * (1 - i) * (1 - i);
    let b = 3 * (1 - i) * (1 - i) * i;
    let c = 3 * (1 - i) * i * i;
    let d = i * i * i;
    return new vec2(a * p1.x + b * p2.x + c * p3.x + d * p4.x, a * p1.y + b * p2.y + c * p3.y + d * p4.y);
  };

  function PID(aKp, aKi, aKd) {
    this.Kp = aKp;
    this.Ki = aKi;
    this.Kd = aKd;
    this.CV = 0;
    this.I = 0;
    this.e1 = 0;
    this.Reset = function Reset() {
      this.CV = 0;
      this.I = 0;
      this.e1 = 0;
    };
    this.GetValue = function GetValue() {
      return this.CV;
    };
    this.Step = function Step(aDt, aError) {
      let e0 = aError;
      let P = this.Kp * e0;
      this.I = this.I + this.Ki * e0 * aDt;
      let D = this.Kd * (e0 - this.e1) / aDt;
      this.CV = P + this.I + D;
      this.e1 = e0;
    };
  }

  function DrawArrow(drawCtx, x, y, ang) {
    drawCtx.save();
    drawCtx.translate(x, y);
    drawCtx.rotate(ang);
    let s = 3;
    let ci = Math.sin(gSystemTime * 5) * 0.1 + 0.9;
    drawCtx.fillStyle = `rgb(${Math.floor(255 * ci)},${Math.floor(128 * ci)},0)`;
    drawCtx.beginPath();
    drawCtx.moveTo(0, -s);
    drawCtx.lineTo(-s * 0.3, -s);
    drawCtx.lineTo(-s * 0.2, 0);
    drawCtx.lineTo(-s * 0.7, 0);
    drawCtx.lineTo(0, s);
    drawCtx.lineTo(s * 0.7, 0);
    drawCtx.lineTo(s * 0.2, 0);
    drawCtx.lineTo(s * 0.3, -s);
    drawCtx.lineTo(0, -s);
    drawCtx.fill();
    drawCtx.strokeStyle = "rgb(0,0,0)";
    drawCtx.lineWidth = 0.25;
    drawCtx.beginPath();
    drawCtx.moveTo(0, -s);
    drawCtx.lineTo(-s * 0.3, -s);
    drawCtx.lineTo(-s * 0.2, 0);
    drawCtx.lineTo(-s * 0.7, 0);
    drawCtx.lineTo(0, s);
    drawCtx.lineTo(s * 0.7, 0);
    drawCtx.lineTo(s * 0.2, 0);
    drawCtx.lineTo(s * 0.3, -s);
    drawCtx.lineTo(0, -s);
    drawCtx.stroke();
    drawCtx.restore();
  }

  const COURSE_COLOR = "#DD1F26";
  const COURSE_VISITED_COLOR = "rgba(221,31,38,0.65)";
  const COURSE_HALO_COLOR = "rgba(221,31,38,0.28)";

  function DrawLegacySquareControl(drawCtx, x, y, ang, size = 2, lineWidth = 0.25) {
    drawCtx.save();
    drawCtx.translate(x, y);
    drawCtx.rotate(ang);

    drawCtx.fillStyle = "white";
    drawCtx.fillRect(-size, -size, size * 2, size * 2);

    drawCtx.fillStyle = "rgb(255,128,0)";
    drawCtx.beginPath();
    drawCtx.moveTo(size, size);
    drawCtx.lineTo(-size, size);
    drawCtx.lineTo(size, -size);
    drawCtx.closePath();
    drawCtx.fill();

    drawCtx.strokeStyle = "black";
    drawCtx.lineWidth = lineWidth;
    drawCtx.strokeRect(-size, -size, size * 2, size * 2);
    drawCtx.restore();
  }

  function DrawStartControl(drawCtx, node, nextNode) {
    if (!node) {
      return;
    }
    const x = node.center.x;
    const y = node.center.y;

    if (!mMenu) {
      DrawLegacySquareControl(drawCtx, x, y, -mViewR, 2, 0.25);
      return;
    }

    const size = mMenu ? 5.4 : 3.2;
    const lineWidth = mMenu ? 1.3 : 0.5;
    const angle = nextNode ? Math.atan2(nextNode.center.y - y, nextNode.center.x - x) : 0;

    drawCtx.save();
    drawCtx.translate(x, y);
    drawCtx.rotate(angle);
    drawCtx.beginPath();
    drawCtx.moveTo(size, 0);
    drawCtx.lineTo(-size * 0.72, size * 0.66);
    drawCtx.lineTo(-size * 0.72, -size * 0.66);
    drawCtx.closePath();
    drawCtx.fillStyle = "rgba(221,31,38,0.08)";
    drawCtx.fill();
    drawCtx.strokeStyle = COURSE_COLOR;
    drawCtx.lineWidth = lineWidth;
    drawCtx.stroke();
    drawCtx.restore();
  }

  function checkpointLabel(index) {
    const n = index + 1;
    return n === 10 ? "0" : String(n);
  }

  function DrawCheckpointControl(drawCtx, node, index, visited, current) {
    if (!node) {
      return;
    }

    const x = node.center.x;
    const y = node.center.y;

    if (!mMenu) {
      if (current) {
        drawCtx.save();
        drawCtx.strokeStyle = COURSE_HALO_COLOR;
        drawCtx.lineWidth = 0.7;
        drawCtx.beginPath();
        drawCtx.arc(x, y, 3.6, 0, Math.PI * 2, false);
        drawCtx.stroke();
        drawCtx.restore();
      }

      DrawLegacySquareControl(drawCtx, x, y, -mViewR, 2, 0.25);

      drawCtx.save();
      drawCtx.translate(x, y);
      drawCtx.rotate(-mViewR);
      drawCtx.fillStyle = visited ? "#0D8A3B" : "#112D67";
      drawCtx.font = "3.1px Trebuchet MS, sans-serif";
      drawCtx.textAlign = "left";
      drawCtx.textBaseline = "middle";
      drawCtx.fillText(checkpointLabel(index), 2.8, -2.4);
      drawCtx.restore();
      return;
    }

    if (current) {
      drawCtx.save();
      drawCtx.strokeStyle = COURSE_HALO_COLOR;
      drawCtx.lineWidth = 1.6;
      drawCtx.beginPath();
      drawCtx.arc(x, y, 6.2, 0, Math.PI * 2, false);
      drawCtx.stroke();
      drawCtx.restore();
    }

    drawCtx.save();
    drawCtx.beginPath();
    drawCtx.arc(x, y, 4.6, 0, Math.PI * 2, false);
    drawCtx.strokeStyle = visited ? COURSE_VISITED_COLOR : COURSE_COLOR;
    drawCtx.lineWidth = 1.35;
    drawCtx.stroke();
    drawCtx.restore();

    drawCtx.save();
    drawCtx.fillStyle = visited ? COURSE_VISITED_COLOR : COURSE_COLOR;
    drawCtx.strokeStyle = "rgba(255,255,255,0.92)";
    drawCtx.lineWidth = 2.8;
    drawCtx.font = "20px Trebuchet MS, sans-serif";
    drawCtx.textAlign = "left";
    drawCtx.textBaseline = "middle";
    const label = checkpointLabel(index);
    const tx = x + 9.5;
    const ty = y - 8.2;
    drawCtx.strokeText(label, tx, ty);
    drawCtx.fillText(label, tx, ty);
    drawCtx.restore();
  }

  function shouldDrawPlayerTrace() {
    return state.isObserver || state.localFinished || state.phase === "finished";
  }

  function pickCheckpointNode(prevNode, usedNodes, minDistance) {
    const candidates = [];
    for (let i = 0; i < mMapNodes.length; i += 1) {
      const node = mMapNodes[i];
      if (!node || usedNodes.has(node)) {
        continue;
      }
      if (vec2.sub(node.center, prevNode.center).length() < minDistance) {
        continue;
      }
      candidates.push(node);
    }

    if (!candidates.length) {
      return null;
    }
    return candidates[RandRangeI(0, candidates.length - 1)];
  }

  function MapNode(aPos) {
    this.pos = aPos.copy();
    this.neighbors = [];
    this.neighborCnt = 0;
    this.center = null;
    this.startNeighbor = RandRangeI(-5, 5);

    this.GetValidNeighborIdx = function GetValidNeighborIdx(neighborNum) {
      let can = neighborNum;
      let ca = -1;
      while (can > 0) {
        if (++ca >= 4) {
          ca = 0;
        }
        if (this.neighbors[ca]) {
          can -= 1;
        }
      }
      return ca;
    };

    this.GetNeighborPos = function GetNeighborPos(neighborIdx, i) {
      return vec2.interpolate(this.center, this.neighbors[neighborIdx].center, i);
    };

    this.UpdateDotPos = function UpdateDotPos() {
      let p1 = this.GetNeighborPos(mDotFrom, 0.5);
      let p2 = this.GetNeighborPos(mDotTo, 0.5);
      let c1 = vec2.interpolate(p1, this.center, 0.7);
      let c2 = vec2.interpolate(p2, this.center, 0.7);
      mDotPos = vec2.bezier(p1, c1, c2, p2, mDotI);
      let dir = vec2.sub(vec2.bezier(p1, c1, c2, p2, mDotI + 0.001), mDotPos);
      mDotAng = Math.atan2(dir.x, dir.y) + Math.PI;
    };

    this.Draw = function Draw(drawCtx) {
      let minD = (Math.max(ctxWidth, ctxHeight) * 1.2) / mViewS;
      let dist =
        (this.center.x - mViewPos.x) * (this.center.x - mViewPos.x) +
        (this.center.y - mViewPos.y) * (this.center.y - mViewPos.y);
      if (dist > minD * minD) {
        return;
      }

      if (this.startNeighbor <= 0) {
        for (let a = 0; a < 4; a += 1) {
          if (this.neighbors[a]) {
            let cent = this.GetNeighborPos(a, -0.02);
            drawCtx.moveTo(cent.x, cent.y);
            let half = this.GetNeighborPos(a, mMenu ? 0.43 : 0.5);
            drawCtx.lineTo(half.x, half.y);
          }
        }
      } else {
        let ca = this.GetValidNeighborIdx(this.startNeighbor);
        let centerHalf = this.GetNeighborPos(ca, mMenu ? 0.43 : 0.5);
        for (let a = 0; a < 4; a += 1) {
          if (a !== ca && this.neighbors[a]) {
            drawCtx.moveTo(centerHalf.x, centerHalf.y);
            let half = this.GetNeighborPos(a, mMenu ? 0.43 : 0.5);
            let c1 = vec2.interpolate(centerHalf, this.center, 0.7);
            let c2 = vec2.interpolate(half, this.center, 0.7);
            drawCtx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, half.x, half.y);
          }
        }
      }
    };

    this.DrawArrows = function DrawArrows(drawCtx) {
      for (let a = 0; a < 4; a += 1) {
        if (this.neighbors[a]) {
          let half = this.GetNeighborPos(a, 0.4);
          let dir = vec2.sub(this.center, half);
          let ang = Math.atan2(dir.x, -dir.y);
          DrawArrow(drawCtx, half.x, half.y, ang);
        }
      }
    };

    this.ClickArrows = function ClickArrows(aPos) {
      if (mMoving || state.phase !== "running" || state.localFinished || state.isObserver) {
        return;
      }
      for (let a = 0; a < 4; a += 1) {
        if (this.neighbors[a]) {
          let half = this.GetNeighborPos(a, 0.4);
          if (vec2.sub(half, aPos).length() < 3) {
            mDotTo = a;
            mMoving = true;
            mAtStart = false;
            mCenterView = false;
            if (a === mDotFrom && mDotI < 0.1) {
              mDotI = 0.999;
            }
            mRoadChoiceMode = false;
            return;
          }
        }
      }
    };
  }

  function RouteNode(aNode, aFrom, aTo) {
    this.mNode = aNode;
    this.mFrom = aFrom;
    this.mTo = aTo;
    this.Draw = function Draw(drawCtx) {
      let minD = (Math.max(ctxWidth, ctxHeight) * 1.2) / mViewS;
      if (vec2.sub(this.mNode.center, mViewPos).lengthSquared() > minD * minD) {
        return;
      }
      let srcHalf = this.mNode.GetNeighborPos(this.mFrom, 0.5);
      let dstHalf = this.mNode.GetNeighborPos(this.mTo, 0.5);
      drawCtx.moveTo(srcHalf.x, srcHalf.y);
      let c1 = vec2.interpolate(srcHalf, this.mNode.center, 0.7);
      let c2 = vec2.interpolate(dstHalf, this.mNode.center, 0.7);
      drawCtx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, dstHalf.x, dstHalf.y);
    };
  }

  function BuildMap(seed) {
    withSeed(seed, () => {
      mMapNodes.length = 0;

      let GRID = 20;
      let SCALE = 20;
      let dx = [0, 0, -1, 1];
      let dy = [-1, 1, 0, 0];
      let nodes = Create2DArray(GRID);
      Set2DArray(nodes, 15);

      for (let a = 0; a < GRID; a += 1) {
        nodes[a][0] &= ~1;
        nodes[a][GRID - 1] &= ~2;
        nodes[0][a] &= ~4;
        nodes[GRID - 1][a] &= ~8;
      }

      for (let s = 2; s < 6; s += 1) {
        for (let x = 0; x < GRID; x += s) {
          for (let y = 0; y < GRID; y += s) {
            if (FRAND() < 0.6) {
              for (let a = 0; a < 4; a += 1) {
                if (nodes[x][y] & (1 << a)) {
                  nodes[x][y] &= ~(1 << a);
                  nodes[x + dx[a]][y + dy[a]] &= ~(1 << (a ^ 1));
                }
              }
            }
          }
        }
      }

      let THRESH = 0.1;
      for (let x = 0; x < GRID; x += 1) {
        for (let y = 0; y < GRID; y += 1) {
          for (let a = 0; a < 4; a += 1) {
            if (nodes[x][y] & (1 << a)) {
              if (FRAND() < THRESH) {
                nodes[x][y] &= ~(1 << a);
                nodes[x + dx[a]][y + dy[a]] &= ~(1 << (a ^ 1));
              }
            }
          }
        }
      }

      let busy = true;
      while (busy) {
        busy = false;
        for (let x = 0; x < GRID; x += 1) {
          for (let y = 0; y < GRID; y += 1) {
            let cnt = 0;
            for (let a = 0; a < 4; a += 1) {
              if (nodes[x][y] & (1 << a)) {
                cnt += 1;
              }
            }
            if (cnt === 1) {
              for (let a = 0; a < 4; a += 1) {
                if (nodes[x][y] & (1 << a)) {
                  nodes[x][y] &= ~(1 << a);
                  nodes[x + dx[a]][y + dy[a]] &= ~(1 << (a ^ 1));
                }
              }
              busy = true;
            }
          }
        }
      }

      let mark = Create2DArray(GRID);
      let startNode = 1;
      while (startNode) {
        Set2DArray(mark, false);

        let sn = startNode;
        for (let x = 0; x < GRID; x += 1) {
          for (let y = 0; y < GRID; y += 1) {
            if (nodes[x][y]) {
              sn -= 1;
              if (sn === 0) {
                mark[x][y] = true;
                x = GRID;
                y = GRID;
              }
            }
          }
        }

        busy = true;
        while (busy) {
          busy = false;
          for (let x = 0; x < GRID; x += 1) {
            for (let y = 0; y < GRID; y += 1) {
              if (mark[x][y]) {
                for (let a = 0; a < 4; a += 1) {
                  if (nodes[x][y] & (1 << a)) {
                    if (!mark[x + dx[a]][y + dy[a]]) {
                      mark[x + dx[a]][y + dy[a]] = true;
                      busy = true;
                    }
                  }
                }
              }
            }
          }
        }

        let cnt = 0;
        for (let x = 0; x < GRID; x += 1) {
          for (let y = 0; y < GRID; y += 1) {
            if (mark[x][y]) {
              cnt += 1;
            }
          }
        }

        if (cnt > (GRID * GRID) / 16) {
          break;
        }
        startNode += 1;
      }

      for (let x = 0; x < GRID; x += 1) {
        for (let y = 0; y < GRID; y += 1) {
          if (!mark[x][y]) {
            for (let a = 0; a < 4; a += 1) {
              if (nodes[x][y] & (1 << a)) {
                nodes[x][y] &= ~(1 << a);
                nodes[x + dx[a]][y + dy[a]] &= ~(1 << (a ^ 1));
              }
            }
          }
        }
      }

      let RND = 0.4;
      let xy = Create2DArray(GRID);
      for (let x = 0; x < GRID; x += 1) {
        for (let y = 0; y < GRID; y += 1) {
          xy[x][y] = new vec2(x + RandRange(-RND, RND), y + RandRange(-RND, RND));
        }
      }

      for (let xx = 0; xx <= GRID; xx += 15) {
        for (let yy = 0; yy <= GRID; yy += 15) {
          let center = new vec2(xx, yy);
          let RAD = RandRange(6, 8);
          let ang = RandRange(0.7, 1.2) * (FRAND() > 0.5 ? 1 : -1);
          for (let x = 0; x < GRID; x += 1) {
            for (let y = 0; y < GRID; y += 1) {
              let p = vec2.sub(xy[x][y], center);
              let d = p.length() / RAD;
              let a = Interpolate(ang, 0, Clamp(d, 0.5, 1));
              let o = new vec2(
                Math.cos(a) * p.x - Math.sin(a) * p.y,
                Math.sin(a) * p.x + Math.cos(a) * p.y
              );
              xy[x][y] = vec2.add(o, center);
            }
          }
        }
      }

      let mapNodes = Create2DArray(GRID);
      for (let x = 0; x < GRID; x += 1) {
        for (let y = 0; y < GRID; y += 1) {
          if (nodes[x][y]) {
            mapNodes[x][y] = new MapNode(xy[x][y].copy().multiplyEquals(SCALE));
          }
        }
      }

      for (let x = 0; x < GRID; x += 1) {
        for (let y = 0; y < GRID; y += 1) {
          for (let a = 0; a < 4; a += 1) {
            if (nodes[x][y] & (1 << a)) {
              mapNodes[x][y].neighbors[a] = mapNodes[x + dx[a]][y + dy[a]];
            }
          }
        }
      }

      for (let x = 0; x < GRID; x += 1) {
        for (let y = 0; y < GRID; y += 1) {
          if (mapNodes[x][y]) {
            mapNodes[x][y].center = mapNodes[x][y].pos.copy();
            let cnt = 1;
            for (let a = 0; a < 4; a += 1) {
              if (mapNodes[x][y].neighbors[a]) {
                let half = vec2.interpolate(mapNodes[x][y].pos, mapNodes[x][y].neighbors[a].pos, 0.5);
                mapNodes[x][y].center.plusEquals(half);
                cnt += 1;
              }
            }
            mapNodes[x][y].center.divideEquals(cnt);
            mapNodes[x][y].neighborCnt = cnt - 1;

            if (mapNodes[x][y].neighborCnt === 2 && mapNodes[x][y].startNeighbor <= 0) {
              mapNodes[x][y].startNeighbor = 1;
            }

            mMapNodes.push(mapNodes[x][y]);
          }
        }
      }

      mNodeIndexMap = new Map();
      for (let idx = 0; idx < mMapNodes.length; idx += 1) {
        mNodeIndexMap.set(mMapNodes[idx], idx);
      }
    });
  }

  function InitCourse(seed, checkpointCount) {
    if (!mMapNodes.length) {
      return;
    }

    const targetCount = clampInt(checkpointCount, 1, 10, 3);

    withSeed(seed, () => {
      mSrcNode = mMapNodes[RandRangeI(0, mMapNodes.length - 1)];
      mCheckpointNodes = [];

      const used = new Set();
      used.add(mSrcNode);
      let previous = mSrcNode;
      for (let cp = 0; cp < targetCount; cp += 1) {
        let node = pickCheckpointNode(previous, used, 55);
        if (!node) {
          node = pickCheckpointNode(previous, used, 44);
        }
        if (!node) {
          node = pickCheckpointNode(previous, used, 30);
        }
        if (!node) {
          node = pickCheckpointNode(previous, used, 0);
        }
        if (!node) {
          break;
        }

        mCheckpointNodes.push(node);
        used.add(node);
        previous = node;
      }

      if (!mCheckpointNodes.length) {
        mCheckpointNodes.push(mSrcNode);
      }

      mDstNode = mCheckpointNodes[mCheckpointNodes.length - 1];
    });

    InitDot((seed || 1) + 1);
  }

  function InitDot(seed) {
    if (typeof seed === "number") {
      withSeed(seed, () => {
        InitDot();
      });
      return;
    }

    if (!mSrcNode) {
      return;
    }
    mRouteNodes.length = 0;
    mNextCheckpointIdx = 0;

    mDotNode = mSrcNode;
    mDotFrom = mDotNode.GetValidNeighborIdx(RandRangeI(1, 4));
    mDotTo = mDotFrom;
    while (mDotTo === mDotFrom) {
      mDotTo = mDotNode.GetValidNeighborIdx(RandRangeI(1, 4));
    }
    mDotI = 0.5;
    mDotNode.UpdateDotPos();
    mAtStart = true;
    mCenterView = true;
    mMoving = false;
    mRoadChoiceMode = false;
  }

  function MoveViewToDot() {
    if (!mDotNode) {
      return;
    }
    mDotNode.UpdateDotPos();
    mViewPos = mDotPos.copy();
    mDotPosxPID.Reset();
    mDotPosyPID.Reset();
    mDotAngPID.Reset();
  }

  function tryHandleCheckpointReached() {
    if (state.phase !== "running" || state.localFinished || mCheckpointNodes.length <= 0 || !mDotNode) {
      return false;
    }
    const targetNode = mCheckpointNodes[Math.min(mNextCheckpointIdx, mCheckpointNodes.length - 1)];
    if (!targetNode || mDotNode !== targetNode) {
      return false;
    }

    mNextCheckpointIdx += 1;
    if (state.socket && state.connected) {
      state.socket.emit("player_split", { splitIndex: mNextCheckpointIdx });
    }

    if (mNextCheckpointIdx >= mCheckpointNodes.length) {
      state.localFinished = true;
      mMoving = false;
      mRoadChoiceMode = false;
      if (state.socket && state.connected) {
        state.socket.emit("player_finished");
      }
      return true;
    }

    mMoving = false;
    mRoadChoiceMode = mDotNode.neighborCnt <= 2;
    return true;
  }

  function Update(aDt) {
    gSystemTime += aDt;

    if (!mDotNode) {
      return;
    }

    if (mMenu) {
      mViewPos.x = 200;
      mViewPos.y = 350;
      mViewS = Math.min(ctxWidth, ctxHeight) / 600;
      mViewR = 0;
    } else {
      let dist = 0;
      let allowMove = state.phase === "running" && !state.localFinished && !state.isObserver;
      while (allowMove && mMoving && dist < aDt * 35) {
        let lastDP = mDotPos.copy();
        mDotI += 0.05;
        while (mDotI > 1) {
          mRouteNodes.push(new RouteNode(mDotNode, mDotFrom, mDotTo));

          mDotNode = mDotNode.neighbors[mDotTo];
          mDotFrom = mDotTo ^ 1;
          mDotTo = mDotFrom;
          while (mDotTo === mDotFrom) {
            mDotTo = mDotNode.GetValidNeighborIdx(RandRangeI(1, 4));
          }
          mDotI -= 1;
          mDotNode.UpdateDotPos();

          if (tryHandleCheckpointReached()) {
            break;
          }

          if (mDotNode.neighborCnt > 2 && mDotNode !== mDstNode) {
            mMoving = false;
            mRoadChoiceMode = false;
            break;
          }
        }
        mDotNode.UpdateDotPos();
        dist += vec2.sub(mDotPos, lastDP).length();

        if (tryHandleCheckpointReached()) {
          break;
        }
      }

      mViewS = (17 * Math.min(ctxWidth, ctxHeight)) / 600;
      if (mDotAng - mViewR > Math.PI) {
        mViewR += Math.PI * 2;
      }
      if (mViewR - mDotAng > Math.PI) {
        mViewR -= Math.PI * 2;
      }
      mDotAngPID.Step(aDt, mDotAng - mViewR);
      mViewR += mDotAngPID.GetValue();
      mDotPosxPID.Step(aDt, mDotPos.x - mViewPos.x);
      mViewPos.x += mDotPosxPID.GetValue();
      mDotPosyPID.Step(aDt, mDotPos.y - mViewPos.y);
      mViewPos.y += mDotPosyPID.GetValue();

      tryHandleCheckpointReached();
    }
  }

  function MouseDown(aX, aY) {
    if (state.phase !== "running" || state.localFinished || state.isObserver || !mDotNode) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const safeWidth = rect.width || 1;
    const safeHeight = rect.height || 1;
    const canvasX = (aX - rect.left) * (ctxWidth / safeWidth);
    const canvasY = (aY - rect.top) * (ctxHeight / safeHeight);

    let x = (canvasX - ctxWidth * 0.5) / mViewS;
    let y = (canvasY - ctxHeight * (mCenterView ? 0.5 : 0.8)) / mViewS;
    let _x = Math.cos(-mViewR) * x - Math.sin(-mViewR) * y;
    let _y = Math.sin(-mViewR) * x + Math.cos(-mViewR) * y;
    const worldPos = new vec2(_x + mViewPos.x, _y + mViewPos.y);
    if (!mMoving && !mMenu && mRoadChoiceMode && clickRoadChoiceArrows(worldPos)) {
      return;
    }
    mDotNode.ClickArrows(worldPos);
  }

  function CanvasMouseDown(e) {
    MouseDown(e.clientX, e.clientY);
  }

  function CanvasTouchDown(e) {
    e.preventDefault();
    const touch = e.targetTouches[0] || e.changedTouches[0] || e.touches[0];
    if (!touch) {
      return;
    }
    MouseDown(touch.clientX, touch.clientY);
  }

  function getNodeByIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= mMapNodes.length) {
      return null;
    }
    return mMapNodes[index] || null;
  }

  function drawProgressTrace(drawCtx, progress, color) {
    if (!progress || !Array.isArray(progress.route) || progress.route.length === 0) {
      return;
    }
    drawCtx.strokeStyle = hexToRgba(color, 0.5);
    drawCtx.lineWidth = 5;
    drawCtx.beginPath();

    for (let i = 0; i < progress.route.length; i += 1) {
      const segment = progress.route[i];
      const node = getNodeByIndex(segment && segment.nodeIdx);
      if (!node) {
        continue;
      }
      if (!Number.isInteger(segment.from) || !Number.isInteger(segment.to)) {
        continue;
      }
      const src = node.GetNeighborPos(segment.from, 0.5);
      const dst = node.GetNeighborPos(segment.to, 0.5);
      const c1 = vec2.interpolate(src, node.center, 0.7);
      const c2 = vec2.interpolate(dst, node.center, 0.7);
      drawCtx.moveTo(src.x, src.y);
      drawCtx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, dst.x, dst.y);
    }

    drawCtx.stroke();
  }

  function getProgressDotPosition(progress) {
    if (!progress || typeof progress !== "object") {
      return null;
    }
    const node = getNodeByIndex(progress.dotNodeIdx);
    if (!node) {
      return null;
    }
    if (progress.atStart) {
      return node.center.copy();
    }
    if (!Number.isInteger(progress.dotFrom) || !Number.isInteger(progress.dotTo)) {
      return node.center.copy();
    }

    const dotI = Clamp(Number(progress.dotI), 0, 1);
    const p1 = node.GetNeighborPos(progress.dotFrom, 0.5);
    const p2 = node.GetNeighborPos(progress.dotTo, 0.5);
    const c1 = vec2.interpolate(p1, node.center, 0.7);
    const c2 = vec2.interpolate(p2, node.center, 0.7);
    return vec2.bezier(p1, c1, c2, p2, dotI);
  }

  function getDotCurvePoint(node, fromIdx, toIdx, t) {
    if (!node) {
      return null;
    }
    const from = Math.min(3, Math.max(0, Math.floor(Number(fromIdx))));
    const to = Math.min(3, Math.max(0, Math.floor(Number(toIdx))));
    const i = Clamp(Number(t), 0, 1);
    const p1 = node.GetNeighborPos(from, 0.5);
    const p2 = node.GetNeighborPos(to, 0.5);
    const c1 = vec2.interpolate(p1, node.center, 0.7);
    const c2 = vec2.interpolate(p2, node.center, 0.7);
    return vec2.bezier(p1, c1, c2, p2, i);
  }

  function normalizeDirOrFallback(v, fallbackX, fallbackY) {
    const len = v.length();
    if (len < 0.0001) {
      return new vec2(fallbackX, fallbackY);
    }
    return vec2.divide(v, len);
  }

  function getRoadChoiceGeometry() {
    if (!mRoadChoiceMode || !mDotNode) {
      return null;
    }
    const base = getDotCurvePoint(mDotNode, mDotFrom, mDotTo, mDotI);
    if (!base) {
      return null;
    }
    const next = getDotCurvePoint(mDotNode, mDotFrom, mDotTo, Clamp(mDotI + 0.08, 0, 1));
    const prev = getDotCurvePoint(mDotNode, mDotFrom, mDotTo, Clamp(mDotI - 0.08, 0, 1));
    if (!next || !prev) {
      return null;
    }

    const fallbackForward = vec2.sub(next, prev);
    const forwardDir = normalizeDirOrFallback(vec2.sub(next, base), fallbackForward.x || 0, fallbackForward.y || -1);
    const backDir = normalizeDirOrFallback(vec2.sub(prev, base), -forwardDir.x || 0, -forwardDir.y || 1);

    const dist = 4.4;
    const forwardPos = new vec2(base.x + forwardDir.x * dist, base.y + forwardDir.y * dist);
    const backPos = new vec2(base.x + backDir.x * dist, base.y + backDir.y * dist);

    return {
      forwardPos,
      backPos,
      forwardAngle: Math.atan2(forwardDir.x, -forwardDir.y),
      backAngle: Math.atan2(backDir.x, -backDir.y),
    };
  }

  function drawRoadChoiceArrows(drawCtx) {
    const geometry = getRoadChoiceGeometry();
    if (!geometry) {
      return;
    }
    DrawArrow(drawCtx, geometry.forwardPos.x, geometry.forwardPos.y, geometry.forwardAngle);
    DrawArrow(drawCtx, geometry.backPos.x, geometry.backPos.y, geometry.backAngle);
  }

  function clickRoadChoiceArrows(worldPos) {
    const geometry = getRoadChoiceGeometry();
    if (!geometry) {
      return false;
    }
    if (vec2.sub(geometry.forwardPos, worldPos).length() < 3.3) {
      mRoadChoiceMode = false;
      mMoving = true;
      mAtStart = false;
      mCenterView = false;
      return true;
    }
    if (vec2.sub(geometry.backPos, worldPos).length() < 3.3) {
      const oldFrom = mDotFrom;
      mDotFrom = mDotTo;
      mDotTo = oldFrom;
      mDotI = Clamp(1 - mDotI, 0, 1);
      mDotNode.UpdateDotPos();
      mRoadChoiceMode = false;
      mMoving = true;
      mAtStart = false;
      mCenterView = false;
      return true;
    }
    return false;
  }

  function drawObserverPlayers(drawCtx) {
    if (!state.isObserver || !mMenu || !state.players.length) {
      return;
    }

    for (const player of state.players) {
      if (!player || player.observer) {
        continue;
      }
      const color = normalizeHexColor(player.color) || "#8F1F1F";
      const progress = player.progress;
      let pos = null;
      if (progress && progress.mapSeed === state.mapSeed && progress.legSeed === state.legSeed) {
        drawProgressTrace(drawCtx, progress, color);
        pos = getProgressDotPosition(progress);
      } else if ((state.phase === "countdown" || state.phase === "running") && mSrcNode) {
        pos = mSrcNode.center.copy();
      }
      if (!pos) {
        continue;
      }

      drawCtx.fillStyle = color;
      drawCtx.beginPath();
      drawCtx.arc(pos.x, pos.y, 4.2, 0, Math.PI * 2, false);
      drawCtx.fill();
      drawCtx.strokeStyle = "rgba(0,0,0,0.85)";
      drawCtx.lineWidth = 0.9;
      drawCtx.beginPath();
      drawCtx.arc(pos.x, pos.y, 4.2, 0, Math.PI * 2, false);
      drawCtx.stroke();
    }
  }

  function DrawMap() {
    if (!mDotNode || !mSrcNode || !mDstNode) {
      return;
    }

    ctx.save();
    ctx.translate(ctxWidth * 0.5, ctxHeight * (mCenterView && !mMenu ? 0.5 : 0.8));
    ctx.scale(mViewS, mViewS);
    ctx.rotate(mViewR);
    ctx.translate(-mViewPos.x, -mViewPos.y);

    if (mMenu && shouldDrawPlayerTrace()) {
      ctx.strokeStyle = hexToRgba(state.playerColor, 0.5);
      ctx.lineWidth = 8;
      ctx.beginPath();
      for (let a = 0; a < mRouteNodes.length; a += 1) {
        mRouteNodes[a].Draw(ctx);
      }
      ctx.stroke();
    }
    drawObserverPlayers(ctx);

    ctx.strokeStyle = mMenu ? "rgb(0,150,0)" : "rgb(255,255,255)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let a = 0; a < mMapNodes.length; a += 1) {
      mMapNodes[a].Draw(ctx);
    }
    ctx.stroke();

    if (mMenu && mCheckpointNodes.length > 0) {
      ctx.strokeStyle = "rgba(221,31,38,0.9)";
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(mSrcNode.center.x, mSrcNode.center.y);
      for (let i = 0; i < mCheckpointNodes.length; i += 1) {
        ctx.lineTo(mCheckpointNodes[i].center.x, mCheckpointNodes[i].center.y);
      }
      ctx.stroke();
      ctx.lineJoin = "miter";
    }

    DrawStartControl(ctx, mSrcNode, mCheckpointNodes[0] || null);
    for (let i = 0; i < mCheckpointNodes.length; i += 1) {
      DrawCheckpointControl(
        ctx,
        mCheckpointNodes[i],
        i,
        i < mNextCheckpointIdx,
        !state.localFinished && i === mNextCheckpointIdx
      );
    }

    const showPlayerInRaceView = !mMenu && !mAtStart;
    const showPlayerOnBigMap = mMenu && state.phase === "running" && !state.isObserver && state.showPositionOnMap;
    if (showPlayerInRaceView || showPlayerOnBigMap) {
      let rad = mMenu ? 5 : 2;
      let dotX = mAtStart ? mDotNode.center.x : mDotPos.x;
      let dotY = mAtStart ? mDotNode.center.y : mDotPos.y;
      ctx.fillStyle = state.playerColor;
      ctx.beginPath();
      ctx.arc(dotX, dotY, rad, 0, Math.PI * 2, false);
      ctx.fill();
      ctx.strokeStyle = "rgb(0,0,0)";
      ctx.lineWidth = mMenu ? 1 : 0.25;
      ctx.beginPath();
      ctx.arc(dotX, dotY, rad, 0, Math.PI * 2, false);
      ctx.stroke();
    }

    if (!mMoving && !mMenu) {
      if (mRoadChoiceMode) {
        drawRoadChoiceArrows(ctx);
      } else {
        mDotNode.DrawArrows(ctx);
      }
    }

    ctx.restore();

    if (mShowCompass) {
      let s = Math.min(40, Math.min(ctxWidth, ctxHeight) / 15);

      ctx.save();
      ctx.translate(s * 1.2, ctxHeight - s * 1.2);
      ctx.rotate(mViewR);

      ctx.fillStyle = "rgba(0,0,0,0.1)";
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, Math.PI * 2, false);
      ctx.fill();
      ctx.strokeStyle = "black";
      ctx.lineWidth = s < 30 ? 1 : 2;
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, Math.PI * 2, false);
      ctx.stroke();

      ctx.fillStyle = "red";
      ctx.beginPath();
      ctx.moveTo(-s * 0.15, 0);
      ctx.lineTo(-s * 0.15, -s * 0.8);
      ctx.lineTo(0, -s);
      ctx.lineTo(s * 0.15, -s * 0.8);
      ctx.lineTo(s * 0.15, 0);
      ctx.fill();

      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.moveTo(-s * 0.15, 0);
      ctx.lineTo(-s * 0.15, s * 0.8);
      ctx.lineTo(0, s);
      ctx.lineTo(s * 0.15, s * 0.8);
      ctx.lineTo(s * 0.15, 0);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(-s * 0.15, 0);
      ctx.lineTo(-s * 0.15, -s * 0.8);
      ctx.lineTo(0, -s);
      ctx.lineTo(s * 0.15, -s * 0.8);
      ctx.lineTo(s * 0.15, s * 0.8);
      ctx.lineTo(0, s);
      ctx.lineTo(-s * 0.15, s * 0.8);
      ctx.lineTo(-s * 0.15, 0);
      ctx.stroke();

      ctx.restore();
    }
  }

  function SetMenuVis(menu) {
    mMenu = menu;
    canvas.style.background = mMenu ? "white" : "rgb(200,200,255)";
  }

  function setMapViewOpen(shouldOpen) {
    if (state.phase !== "running") {
      state.mapViewOpen = false;
      state.mapViewSnapshot = null;
      mRoadChoiceMode = false;
      SetMenuVis(true);
      renderUi();
      return;
    }

    state.mapViewOpen = Boolean(shouldOpen);
    if (state.mapViewOpen) {
      const wasMoving = mMoving;
      state.mapViewSnapshot = {
        viewPos: mViewPos.copy(),
        viewR: mViewR,
        viewS: mViewS,
        centerView: mCenterView,
        dotAng: mDotAng,
      };
      // Match original stop/menu behavior: open overview map and pause automatic movement.
      mMoving = false;
      if (wasMoving && !state.localFinished && !state.isObserver) {
        mRoadChoiceMode = true;
      }
      mCenterView = true;
      SetMenuVis(true);
    } else {
      if (state.mapViewSnapshot) {
        mViewPos = state.mapViewSnapshot.viewPos.copy();
        mViewR = state.mapViewSnapshot.viewR;
        mViewS = state.mapViewSnapshot.viewS;
        mCenterView = state.mapViewSnapshot.centerView;
        mDotAng = state.mapViewSnapshot.dotAng;
      } else {
        MoveViewToDot();
      }
      state.mapViewSnapshot = null;
      SetMenuVis(false);
    }

    renderUi();
  }

  function WindowResize() {
    const rect = ui.canvasWrap.getBoundingClientRect();
    const maxW = Math.max(240, Math.floor(rect.width));
    const maxH = Math.max(240, Math.floor(rect.height));

    canvas.width = ctxWidth = maxW;
    canvas.height = ctxHeight = maxH;
  }

  function HandleResize() {
    WindowResize();
    renderUi();
  }

  function gameLoop(now) {
    const dt = Math.min(0.05, (now - mLastFrameTime) / 1000);
    mLastFrameTime = now;

    ctx.clearRect(0, 0, ctxWidth, ctxHeight);
    Update(Number.isFinite(dt) ? dt : 0.016);
    DrawMap();
    refreshTimer();
    maybePushProgress(false);

    requestAnimationFrame(gameLoop);
  }

  canvas.addEventListener("mousedown", CanvasMouseDown, false);
  canvas.addEventListener("touchstart", CanvasTouchDown, { passive: false });
  window.addEventListener("beforeunload", () => {
    maybePushProgress(true);
  });
  window.addEventListener("resize", HandleResize);
  window.addEventListener("orientationchange", HandleResize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", HandleResize);
  }
  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(() => {
      HandleResize();
    });
    resizeObserver.observe(ui.canvasWrap);
  }
  HandleResize();
  requestAnimationFrame(gameLoop);

  if (urlRoom) {
    joinRoom(urlRoom);
  } else {
    BuildMap(150000001);
    InitCourse(900000001, state.checkpointCount);
    SetMenuVis(true);
    renderUi();
    setStatus("Создайте комнату или войдите в существующую");
  }

  function canSendRoomEvent() {
    return Boolean(state.socket && state.connected && state.joined && state.roomId);
  }

  function isLocalLeader() {
    return Boolean(state.playerId && state.leaderId && state.playerId === state.leaderId);
  }

  function normalizeRoomId(roomId) {
    return (roomId || "")
      .toString()
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "")
      .slice(0, 24);
  }

  function sanitizeName(name) {
    return (name || "")
      .toString()
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 24);
  }

  function normalizeCheckpointCount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return state.checkpointCount || 3;
    }
    return Math.min(10, Math.max(1, Math.floor(n)));
  }

  function normalizeShowPositionOnMap(value) {
    return value !== false;
  }

  function normalizeSplits(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((ms) => (Number.isFinite(ms) ? ms : null));
  }

  function normalizeHexColor(color) {
    const raw = (color || "").toString().trim();
    const match = raw.match(/^#?([0-9a-fA-F]{6})$/);
    if (!match) {
      return "";
    }
    return `#${match[1].toUpperCase()}`;
  }

  function hexToRgba(hex, alpha) {
    const normalized = normalizeHexColor(hex);
    const clampedAlpha = Math.min(1, Math.max(0, Number(alpha)));
    if (!normalized) {
      return `rgba(143,31,31,${clampedAlpha})`;
    }
    const r = Number.parseInt(normalized.slice(1, 3), 16);
    const g = Number.parseInt(normalized.slice(3, 5), 16);
    const b = Number.parseInt(normalized.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${clampedAlpha})`;
  }

  function generateRandomColor() {
    const bytes = new Uint8Array(3);
    window.crypto.getRandomValues(bytes);
    const channels = [...bytes].map((value) => 40 + (value % 176));
    return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }

  function applyPlayerName(nextName, emitToServer) {
    const name = sanitizeName(nextName) || state.playerName || `Runner ${Math.floor(Math.random() * 900 + 100)}`;
    const changed = name !== state.playerName;
    state.playerName = name;
    ui.nameInput.value = name;
    ui.roomNameInput.value = name;
    if (changed) {
      localStorage.setItem("orient_player_name", name);
    }
    if (state.roomId) {
      for (const player of state.players) {
        if (player.id === state.playerId) {
          player.name = name;
        }
      }
      for (const result of state.results) {
        if (result.id === state.playerId) {
          result.name = name;
        }
      }
      renderPlayers();
      renderResults();
    }
    if (emitToServer && state.socket && state.connected && state.roomId) {
      state.socket.emit("update_name", { name });
    }
  }

  function updateColorPreview() {
    ui.joinColorPreview.style.backgroundColor = state.playerColor;
    ui.roomColorPreview.style.backgroundColor = state.playerColor;
    ui.joinColorHex.textContent = state.playerColor;
    ui.roomColorHex.textContent = state.playerColor;
  }

  function applyPlayerColor(nextColor, emitToServer) {
    const color = normalizeHexColor(nextColor) || generateRandomColor();
    const changed = color !== state.playerColor;
    state.playerColor = color;
    if (changed) {
      localStorage.setItem("orient_player_color", color);
    }
    updateColorPreview();
    if (state.roomId) {
      for (const player of state.players) {
        if (player.id === state.playerId) {
          player.color = color;
        }
      }
      for (const result of state.results) {
        if (result.id === state.playerId) {
          result.color = color;
        }
      }
      renderPlayers();
      renderResults();
    }
    if (emitToServer && state.socket && state.connected && state.roomId) {
      state.socket.emit("update_color", { color });
    }
  }

  function applyCheckpointCount(emitToServer) {
    const count = normalizeCheckpointCount(ui.checkpointCountInput.value);
    ui.checkpointCountInput.value = String(count);
    const previousCount = state.checkpointCount;

    const canPreview = state.phase === "lobby" && mMapNodes.length > 0;
    if (canPreview && count !== previousCount) {
      state.checkpointCount = count;
      InitCourse(state.legSeed || 1, state.checkpointCount);
      SetMenuVis(true);
      renderUi();
    }

    if (!emitToServer) {
      state.checkpointCount = count;
      return;
    }

    if (!canSendRoomEvent()) {
      return;
    }
    if (!isLocalLeader()) {
      setStatus("Только лидер комнаты может менять количество КП.");
      return;
    }
    if (state.phase !== "lobby") {
      setStatus("Количество КП можно менять только в лобби.");
      return;
    }
    state.socket.emit("set_checkpoint_count", { count });
  }

  function applyShowPositionOnMap(emitToServer) {
    const enabled = Boolean(ui.showPositionOnMapInput.checked);

    if (!emitToServer) {
      state.showPositionOnMap = enabled;
      return;
    }

    if (!canSendRoomEvent()) {
      ui.showPositionOnMapInput.checked = state.showPositionOnMap;
      return;
    }
    if (!isLocalLeader()) {
      ui.showPositionOnMapInput.checked = state.showPositionOnMap;
      setStatus("Только лидер комнаты может управлять показом позиции.");
      return;
    }
    if (state.phase !== "lobby") {
      ui.showPositionOnMapInput.checked = state.showPositionOnMap;
      setStatus("Показ позиции можно менять только в лобби.");
      return;
    }

    state.showPositionOnMap = enabled;
    renderUi();
    state.socket.emit("set_show_position_on_map", { enabled });
  }

  function applyObserverMode(emitToServer) {
    const enabled = Boolean(ui.observerModeInput.checked);

    if (!emitToServer) {
      state.isObserver = enabled;
      return;
    }

    if (!canSendRoomEvent()) {
      ui.observerModeInput.checked = state.isObserver;
      return;
    }

    const raceActive = state.phase === "countdown" || state.phase === "running";
    if (!enabled && raceActive) {
      ui.observerModeInput.checked = true;
      setStatus("Отключить режим наблюдателя можно после завершения гонки.");
      return;
    }

    state.isObserver = enabled;
    if (enabled) {
      state.mapViewOpen = true;
      state.mapViewSnapshot = null;
      mMoving = false;
      mRoadChoiceMode = false;
      mCenterView = true;
      SetMenuVis(true);
    }
    renderUi();
    state.socket.emit("set_observer_mode", { enabled });
  }

  function generateRoomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(6);
    window.crypto.getRandomValues(bytes);
    let code = "";
    for (let i = 0; i < bytes.length; i += 1) {
      code += alphabet[bytes[i] % alphabet.length];
    }
    return code;
  }

  function normalizePlayerKey(playerKey) {
    return (playerKey || "")
      .toString()
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 64);
  }

  function generatePlayerKey() {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function progressStorageKey(roomId) {
    return `orient_progress_${roomId}`;
  }

  function saveLocalProgress(snapshot) {
    if (!state.roomId || !snapshot) {
      return;
    }
    try {
      localStorage.setItem(progressStorageKey(state.roomId), JSON.stringify(snapshot));
    } catch (_err) {
      // Ignore storage quota errors.
    }
  }

  function loadLocalProgress(roomId) {
    if (!roomId) {
      return null;
    }
    try {
      const raw = localStorage.getItem(progressStorageKey(roomId));
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_err) {
      return null;
    }
  }

  function clearLocalProgress(roomId) {
    if (!roomId) {
      return;
    }
    try {
      localStorage.removeItem(progressStorageKey(roomId));
    } catch (_err) {
      // Ignore storage errors.
    }
  }

  function clampNumber(n, min, max, fallback) {
    const value = Number(n);
    if (!Number.isFinite(value)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, value));
  }

  function clampInt(n, min, max, fallback) {
    return Math.floor(clampNumber(n, min, max, fallback));
  }

  function buildProgressSnapshot() {
    if (!mDotNode || !state.roomId || state.phase !== "running") {
      return null;
    }

    const dotNodeIdx = mNodeIndexMap.get(mDotNode);
    if (!Number.isInteger(dotNodeIdx)) {
      return null;
    }

    const route = mRouteNodes
      .slice(-1200)
      .map((node) => {
        const nodeIdx = mNodeIndexMap.get(node.mNode);
        if (!Number.isInteger(nodeIdx)) {
          return null;
        }
        return {
          nodeIdx,
          from: node.mFrom,
          to: node.mTo,
        };
      })
      .filter(Boolean);

    return {
      mapSeed: state.mapSeed,
      legSeed: state.legSeed,
      startedAt: state.startedAt,
      checkpointIndex: mNextCheckpointIdx,
      dotNodeIdx,
      dotFrom: mDotFrom,
      dotTo: mDotTo,
      dotI: mDotI,
      atStart: mAtStart,
      moving: mMoving,
      route,
      savedAt: Date.now(),
    };
  }

  function applyProgressSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return false;
    }

    if (snapshot.mapSeed !== state.mapSeed || snapshot.legSeed !== state.legSeed) {
      return false;
    }

    if (!state.startedAt || snapshot.startedAt !== state.startedAt) {
      return false;
    }

    const nodeIdx = clampInt(snapshot.dotNodeIdx, 0, mMapNodes.length - 1, -1);
    if (nodeIdx < 0 || !mMapNodes[nodeIdx]) {
      return false;
    }

    mDotNode = mMapNodes[nodeIdx];
    mDotFrom = clampInt(snapshot.dotFrom, 0, 3, 0);
    mDotTo = clampInt(snapshot.dotTo, 0, 3, 0);
    mDotI = clampNumber(snapshot.dotI, 0, 1, 0.5);
    mNextCheckpointIdx = clampInt(snapshot.checkpointIndex, 0, mCheckpointNodes.length, 0);
    mAtStart = Boolean(snapshot.atStart);
    mMoving = false;
    mCenterView = true;

    if (!mDotNode.neighbors[mDotFrom]) {
      mDotFrom = mDotNode.GetValidNeighborIdx(1);
    }
    if (!mDotNode.neighbors[mDotTo] || mDotTo === mDotFrom) {
      mDotTo = mDotNode.GetValidNeighborIdx(1);
      if (mDotTo === mDotFrom) {
        mDotTo = mDotNode.GetValidNeighborIdx(2);
      }
    }

    mRouteNodes.length = 0;
    if (Array.isArray(snapshot.route)) {
      for (const segment of snapshot.route.slice(-1200)) {
        const routeNodeIdx = clampInt(segment?.nodeIdx, 0, mMapNodes.length - 1, -1);
        if (routeNodeIdx < 0 || !mMapNodes[routeNodeIdx]) {
          continue;
        }
        const from = clampInt(segment.from, 0, 3, 0);
        const to = clampInt(segment.to, 0, 3, 0);
        mRouteNodes.push(new RouteNode(mMapNodes[routeNodeIdx], from, to));
      }
    }

    mDotNode.UpdateDotPos();
    return true;
  }

  function maybePushProgress(force) {
    if (state.phase !== "running" || !state.roomId || !state.startedAt || !mDotNode || state.localFinished || state.isObserver) {
      return;
    }

    const now = performance.now();
    if (!force && now - mLastProgressPushAt < 500) {
      return;
    }

    const snapshot = buildProgressSnapshot();
    if (!snapshot) {
      return;
    }

    saveLocalProgress(snapshot);

    if (state.socket && state.connected) {
      state.socket.emit("progress_update", snapshot);
    }

    mLastProgressPushAt = now;
  }

  function buildInviteLink(roomId) {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    return url.toString();
  }

  function updateUrl(roomId) {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    window.history.replaceState({}, "", url.toString());
  }

  function ensureSocket() {
    if (state.socket) {
      return;
    }

    state.socket = io();

    state.socket.on("connect", () => {
      state.connected = true;
      state.joined = false;
      setStatus("Подключено к серверу");
      if (state.pendingRoomId) {
        emitJoin();
      }
      renderUi();
    });

    state.socket.on("disconnect", () => {
      state.connected = false;
      state.joined = false;
      setStatus("Соединение потеряно, пробуем восстановить...");
      renderUi();
    });

    state.socket.on("connect_error", (err) => {
      setStatus(`Ошибка соединения: ${err.message}`);
    });

    state.socket.on("room_action_denied", (message) => {
      if (typeof message === "string" && message.trim()) {
        setStatus(message);
      }
    });

    state.socket.on("room_state", (payload) => {
      applyRoomState(payload);
    });
  }

  function emitJoin() {
    if (!state.socket || !state.connected || !state.pendingRoomId) {
      return;
    }

    state.socket.emit(
      "join_room",
      {
        roomId: state.pendingRoomId,
        name: state.playerName,
        playerKey: state.playerId,
        color: state.playerColor,
      },
      (ack) => {
        if (!ack || !ack.ok) {
          state.joined = false;
          setStatus("Не удалось войти в комнату");
          return;
        }
        state.joined = true;
        state.playerId = normalizePlayerKey(ack.playerId || state.playerId);
        localStorage.setItem("orient_player_key", state.playerId);
        if (ack.color) {
          applyPlayerColor(ack.color, false);
        }
        state.roomId = ack.roomId;
        state.resumeProgress = ack.progress || loadLocalProgress(state.roomId);
        updateUrl(state.roomId);
        setStatus(`Комната ${state.roomId}`);
        renderUi();
      }
    );
  }

  function joinRoom(roomId) {
    const normalizedRoom = normalizeRoomId(roomId);
    const name = sanitizeName(ui.nameInput.value);

    state.pendingRoomId = normalizedRoom || generateRoomCode();
    state.resumeProgress = null;
    applyPlayerName(name || `Runner ${Math.floor(Math.random() * 900 + 100)}`, false);

    ui.roomInput.value = state.pendingRoomId;

    updateUrl(state.pendingRoomId);
    ensureSocket();
    setStatus("Подключение к комнате...");

    if (state.connected) {
      emitJoin();
    }
  }

  function applyRoomState(payload) {
    if (!payload || !payload.roomId) {
      return;
    }

    const previousPhase = state.phase;
    const previousMapSeed = state.mapSeed;
    const previousLegSeed = state.legSeed;
    const previousCheckpointCount = state.checkpointCount;

    state.roomId = payload.roomId;
    state.pendingRoomId = payload.roomId;
    state.joined = true;
    state.leaderId = payload.leaderId || "";
    state.players = Array.isArray(payload.players)
      ? payload.players.map((player) => ({
          ...player,
          observer: Boolean(player && player.observer),
          splits: normalizeSplits(player && player.splits),
          progress: player && player.progress && typeof player.progress === "object" ? player.progress : null,
        }))
      : [];
    state.results = Array.isArray(payload.results) ? payload.results : [];
    state.phase = payload.phase || "lobby";
    state.startedAt = typeof payload.startedAt === "number" ? payload.startedAt : null;
    state.countdownEndsAt = typeof payload.countdownEndsAt === "number" ? payload.countdownEndsAt : null;
    state.mapSeed = typeof payload.mapSeed === "number" ? payload.mapSeed : null;
    state.legSeed = typeof payload.legSeed === "number" ? payload.legSeed : null;
    state.checkpointCount = normalizeCheckpointCount(payload.checkpointCount);
    state.showPositionOnMap = normalizeShowPositionOnMap(payload.showPositionOnMap);
    ui.checkpointCountInput.value = String(state.checkpointCount);
    ui.showPositionOnMapInput.checked = state.showPositionOnMap;

    if (typeof payload.serverNow === "number") {
      state.serverOffsetMs = payload.serverNow - Date.now();
    }

    const localPlayer = state.players.find((player) => player.id === state.playerId);
    state.isObserver = Boolean(localPlayer && localPlayer.observer);
    state.localWithdrawn = Boolean(localPlayer && localPlayer.withdrawn);
    state.localFinished = Boolean(localPlayer && (localPlayer.finishedMs !== null || localPlayer.withdrawn));
    state.withdrawRequestPending = false;
    ui.observerModeInput.checked = state.isObserver;
    if (localPlayer) {
      if (localPlayer.name) {
        applyPlayerName(localPlayer.name, false);
      }
      if (localPlayer.color) {
        applyPlayerColor(localPlayer.color, false);
      }
    }

    const mapChanged =
      state.mapSeed !== previousMapSeed ||
      state.legSeed !== previousLegSeed ||
      state.checkpointCount !== previousCheckpointCount;
    if (mapChanged || mMapNodes.length === 0) {
      BuildMap(state.mapSeed || 1);
      InitCourse(state.legSeed || 1, state.checkpointCount);
      const hadPreviousSeeds = previousMapSeed !== null && previousLegSeed !== null;
      if (hadPreviousSeeds) {
        clearLocalProgress(state.roomId);
      }
    }

    const currentRaceActive = state.phase === "countdown" || state.phase === "running";
    const previousRaceActive = previousPhase === "countdown" || previousPhase === "running";

    if (currentRaceActive && !previousRaceActive) {
      mRoadChoiceMode = false;
      state.mapViewSnapshot = null;
      let restored = false;
      if (!state.isObserver && state.phase === "running") {
        if (state.resumeProgress) {
          restored = applyProgressSnapshot(state.resumeProgress);
        }
        if (!restored) {
          restored = applyProgressSnapshot(loadLocalProgress(state.roomId));
        }
      }
      if (!restored) {
        InitDot((state.legSeed || 1) + 1);
      }
      if (state.isObserver) {
        state.mapViewOpen = true;
        mMoving = false;
        mCenterView = true;
        SetMenuVis(true);
      } else {
        state.mapViewOpen = false;
        MoveViewToDot();
        mViewR = 0;
        mDotAng = 0;
        SetMenuVis(false);
      }
      mLastProgressPushAt = 0;
      state.resumeProgress = null;
    }

    if (previousPhase === "countdown" && state.phase === "running") {
      state.startFlashUntil = getSyncedNow() + 900;
    }

    if (!currentRaceActive && previousRaceActive) {
      state.mapViewOpen = false;
      state.mapViewSnapshot = null;
      mMoving = false;
      mRoadChoiceMode = false;
      mCenterView = true;
      SetMenuVis(true);
      clearLocalProgress(state.roomId);
      state.resumeProgress = null;
      state.startFlashUntil = 0;
    }

    if (!currentRaceActive && !previousRaceActive) {
      state.mapViewOpen = false;
      state.mapViewSnapshot = null;
      mRoadChoiceMode = false;
      SetMenuVis(true);
    }

    if (currentRaceActive && state.isObserver) {
      state.mapViewOpen = true;
      state.mapViewSnapshot = null;
      mMoving = false;
      mRoadChoiceMode = false;
      mCenterView = true;
      SetMenuVis(true);
    }

    renderUi();
  }

  function setStatus(text) {
    ui.status.textContent = text;
  }

  function renderUi() {
    const inRoom = Boolean(state.roomId);
    const countdown = state.phase === "countdown";
    const running = state.phase === "running";
    const finished = state.phase === "finished";
    const raceActive = countdown || running;
    const leader = isLocalLeader();
    const mobile = window.matchMedia("(max-width: 940px)").matches;
    const mobileRunning = mobile && raceActive && !state.isObserver;
    const mobileLobby = mobile && inRoom && state.phase === "lobby";

    ui.joinPanel.classList.toggle("hidden", inRoom);
    ui.roomPanel.classList.toggle("hidden", !inRoom);
    ui.roomCode.textContent = state.roomId || "-";
    document.body.classList.toggle("mobile-running", mobileRunning);
    document.body.classList.toggle("mobile-lobby", mobileLobby);
    document.body.classList.toggle("mobile-countdown", mobile && countdown);
    ui.roomProfileBox.classList.toggle("hidden", !inRoom || state.phase !== "lobby");
    ui.playersSection.classList.toggle("hidden", mobileRunning);
    ui.resultsSection.classList.toggle("hidden", mobileRunning);
    if (mobile && finished) {
      ui.resultsSection.classList.remove("hidden");
    }
    ui.countdownOverlay.classList.toggle("hidden", !countdown);

    let phaseText = "Лобби";
    if (countdown) {
      phaseText = "Подготовка к старту";
    } else if (running) {
      phaseText = "Гонка идет";
    } else if (finished) {
      phaseText = "Гонка завершена";
    }
    const playerCount = state.players.length;
    ui.status.textContent = inRoom ? `${phaseText}. Игроков: ${playerCount}` : ui.status.textContent;

    const disabled = !state.connected || !inRoom;
    const canWithdraw = running && !state.localFinished && !state.isObserver;
    ui.btnStart.disabled = disabled || !leader || raceActive;
    ui.btnNewMap.disabled = disabled || !leader || raceActive;
    ui.btnNewLeg.disabled = disabled || !leader || raceActive;
    ui.btnMap.disabled = disabled || state.phase !== "running" || state.isObserver;
    ui.btnWithdraw.disabled = disabled || !canWithdraw || state.withdrawRequestPending;
    ui.checkpointCountInput.disabled = disabled || !leader || state.phase !== "lobby";
    ui.saveCheckpointBtn.disabled = disabled || !leader || state.phase !== "lobby";
    ui.showPositionOnMapInput.disabled = disabled || !leader || state.phase !== "lobby";
    ui.observerModeInput.disabled = disabled;

    ui.btnNewMap.classList.toggle("hidden", !leader || raceActive);
    ui.btnNewLeg.classList.toggle("hidden", !leader || raceActive);
    ui.btnStart.classList.toggle("hidden", !leader || raceActive);
    ui.btnMap.classList.toggle("hidden", !running || state.isObserver);
    ui.btnWithdraw.classList.toggle("hidden", !running || state.localFinished || state.isObserver);
    ui.btnWithdraw.textContent = state.withdrawRequestPending ? "Сходим..." : "Сойти";
    ui.btnMap.textContent = state.mapViewOpen ? "BACK" : "MAP";
    ui.raceButtonsRow.classList.toggle("hidden", countdown || (!leader && !running) || (state.isObserver && running));
    ui.courseConfigRow.classList.toggle("hidden", !leader || state.phase !== "lobby");
    ui.checkpointCountInput.value = String(state.checkpointCount);
    ui.showPositionOnMapInput.checked = state.showPositionOnMap;
    ui.observerModeInput.checked = state.isObserver;
    ui.showSplitsToggle.checked = state.showSplits;

    renderPlayers();
    renderResults();
  }

  function renderPlayers() {
    ui.playersList.innerHTML = "";
    for (const player of state.players) {
      const li = document.createElement("li");
      const parts = [];
      parts.push(player.name);
      if (player.id === state.leaderId) {
        parts.push("(leader)");
      }
      if (player.observer) {
        parts.push("- наблюдатель");
      } else if (player.withdrawn) {
        parts.push("- сошел");
      } else if (player.finishedMs !== null) {
        parts.push(`- финиш ${formatMs(player.finishedMs)}`);
      } else if (player.connected === false) {
        parts.push("- переподключение...");
      } else if (state.phase === "running" || state.phase === "countdown") {
        parts.push("- на дистанции");
      } else {
        parts.push("- ожидание");
      }
      const row = document.createElement("span");
      row.className = "player-row";

      const swatch = document.createElement("span");
      swatch.className = "player-color";
      swatch.style.backgroundColor = normalizeHexColor(player.color) || "#8F1F1F";

      const text = document.createElement("span");
      text.textContent = parts.join(" ");

      row.appendChild(swatch);
      row.appendChild(text);
      li.appendChild(row);
      ui.playersList.appendChild(li);
    }
  }

  function renderResults() {
    ui.resultsBody.innerHTML = "";

    if (state.showSplits) {
      renderSplitResults();
      return;
    }

    ui.resultsCol1.textContent = "#";
    ui.resultsCol2.textContent = "Игрок";
    ui.resultsCol3.textContent = "Время";

    if (!state.results.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.textContent = "Пока нет результатов";
      tr.appendChild(td);
      ui.resultsBody.appendChild(tr);
      return;
    }

    for (const result of state.results) {
      const tr = document.createElement("tr");

      const rank = document.createElement("td");
      rank.textContent = String(result.finishRank);

      const name = document.createElement("td");
      const nameWrap = document.createElement("span");
      nameWrap.className = "result-name";

      const swatch = document.createElement("span");
      swatch.className = "player-color";
      swatch.style.backgroundColor = normalizeHexColor(result.color) || "#8F1F1F";

      const label = document.createElement("span");
      label.textContent = result.name;

      nameWrap.appendChild(swatch);
      nameWrap.appendChild(label);
      name.appendChild(nameWrap);

      const time = document.createElement("td");
      time.textContent = result.status === "withdrawn" || result.finishedMs === null ? "сошел" : formatMs(result.finishedMs);

      tr.appendChild(rank);
      tr.appendChild(name);
      tr.appendChild(time);
      ui.resultsBody.appendChild(tr);
    }
  }

  function splitStanding(cpIndex, localTime) {
    const times = [];
    for (const player of state.players) {
      if (!player || player.observer) {
        continue;
      }
      const splits = normalizeSplits(player.splits);
      const value = splits[cpIndex];
      if (Number.isFinite(value)) {
        times.push(value);
      }
    }
    if (!Number.isFinite(localTime) || !times.length) {
      return null;
    }
    times.sort((a, b) => a - b);
    const place = times.findIndex((value) => value >= localTime) + 1;
    return {
      place: place > 0 ? place : times.length,
      total: times.length,
    };
  }

  function renderSplitResults() {
    const localPlayer = state.players.find((player) => player.id === state.playerId);
    if (!localPlayer) {
      ui.resultsCol1.textContent = "КП";
      ui.resultsCol2.textContent = "Место";
      ui.resultsCol3.textContent = "Время";
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.textContent = "Нет данных игрока в комнате";
      tr.appendChild(td);
      ui.resultsBody.appendChild(tr);
      return;
    }

    if (localPlayer.observer) {
      renderObserverSplitResults();
      return;
    }

    ui.resultsCol1.textContent = "КП";
    ui.resultsCol2.textContent = "Место";
    ui.resultsCol3.textContent = "Время";

    const localSplits = normalizeSplits(localPlayer.splits);
    const checkpointTotal = Math.max(1, state.checkpointCount);
    let hasValues = false;

    for (let cp = 1; cp <= checkpointTotal; cp += 1) {
      const cpIndex = cp - 1;
      const splitTime = localSplits[cpIndex];
      if (Number.isFinite(splitTime)) {
        hasValues = true;
      }
      const standing = splitStanding(cpIndex, splitTime);

      const tr = document.createElement("tr");
      const cpCell = document.createElement("td");
      cpCell.textContent = String(cp);

      const placeCell = document.createElement("td");
      placeCell.textContent = standing ? `${standing.place}/${standing.total}` : "-";

      const timeCell = document.createElement("td");
      timeCell.textContent = Number.isFinite(splitTime) ? formatMs(splitTime) : "-";

      tr.appendChild(cpCell);
      tr.appendChild(placeCell);
      tr.appendChild(timeCell);
      ui.resultsBody.appendChild(tr);
    }

    if (!hasValues) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.textContent = state.phase === "lobby" ? "Стартуйте гонку, чтобы увидеть сплиты" : "Пока нет взятых КП";
      tr.appendChild(td);
      ui.resultsBody.appendChild(tr);
    }
  }

  function renderObserverSplitResults() {
    ui.resultsCol1.textContent = "КП";
    ui.resultsCol2.textContent = "Игрок";
    ui.resultsCol3.textContent = "Время";

    const splitRows = [];
    for (const player of state.players) {
      if (!player || player.observer) {
        continue;
      }
      const splits = normalizeSplits(player.splits);
      for (let cpIndex = 0; cpIndex < splits.length; cpIndex += 1) {
        const splitTime = splits[cpIndex];
        if (!Number.isFinite(splitTime)) {
          continue;
        }
        splitRows.push({
          cp: cpIndex + 1,
          time: splitTime,
          playerName: player.name,
          playerColor: normalizeHexColor(player.color) || "#8F1F1F",
        });
      }
    }

    if (!splitRows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.textContent = state.phase === "lobby" ? "Стартуйте гонку, чтобы увидеть сплиты" : "Пока нет взятых КП";
      tr.appendChild(td);
      ui.resultsBody.appendChild(tr);
      return;
    }

    splitRows.sort((a, b) => (a.cp !== b.cp ? a.cp - b.cp : a.time - b.time));
    const splitCounts = new Map();
    for (const row of splitRows) {
      splitCounts.set(row.cp, (splitCounts.get(row.cp) || 0) + 1);
    }

    let prevCp = -1;
    let place = 0;
    for (const row of splitRows) {
      if (row.cp !== prevCp) {
        prevCp = row.cp;
        place = 1;
      } else {
        place += 1;
      }

      const tr = document.createElement("tr");
      const cpCell = document.createElement("td");
      cpCell.textContent = String(row.cp);

      const nameCell = document.createElement("td");
      const nameWrap = document.createElement("span");
      nameWrap.className = "result-name";

      const swatch = document.createElement("span");
      swatch.className = "player-color";
      swatch.style.backgroundColor = row.playerColor;

      const label = document.createElement("span");
      label.textContent = `${row.playerName} (${place}/${splitCounts.get(row.cp) || 1})`;

      nameWrap.appendChild(swatch);
      nameWrap.appendChild(label);
      nameCell.appendChild(nameWrap);

      const timeCell = document.createElement("td");
      timeCell.textContent = formatMs(row.time);

      tr.appendChild(cpCell);
      tr.appendChild(nameCell);
      tr.appendChild(timeCell);
      ui.resultsBody.appendChild(tr);
    }
  }

  function getSyncedNow() {
    return Date.now() + state.serverOffsetMs;
  }

  function refreshCountdownOverlay() {
    if (state.phase !== "countdown" || !state.startedAt) {
      if (state.phase === "running" && state.startFlashUntil > getSyncedNow()) {
        ui.countdownValue.textContent = "СТАРТ";
        ui.countdownOverlay.classList.remove("hidden");
      } else {
        ui.countdownOverlay.classList.add("hidden");
      }
      return;
    }

    const msLeft = Math.max(0, state.startedAt - getSyncedNow());
    if (msLeft <= 0) {
      ui.countdownValue.textContent = "СТАРТ";
      ui.countdownOverlay.classList.remove("hidden");
      const now = performance.now();
      if (canSendRoomEvent() && now - state.lastPhaseSyncAt > 500) {
        state.lastPhaseSyncAt = now;
        state.socket.emit("sync_phase");
      }
      return;
    }

    const secondsLeft = Math.min(5, Math.max(1, Math.ceil(msLeft / 1000)));
    ui.countdownValue.textContent = String(secondsLeft);
    ui.countdownOverlay.classList.remove("hidden");
  }

  function refreshTimer() {
    refreshCountdownOverlay();

    if (state.phase === "running" && state.startedAt) {
      ui.timerBadge.textContent = formatMs(Math.max(0, getSyncedNow() - state.startedAt));
      return;
    }

    if (state.phase === "finished" && state.results.length > 0) {
      const finishTimes = state.results.map((entry) => entry.finishedMs).filter((value) => Number.isFinite(value));
      if (finishTimes.length > 0) {
        ui.timerBadge.textContent = formatMs(Math.max(...finishTimes));
      } else {
        ui.timerBadge.textContent = "00:00.0";
      }
      return;
    }

    ui.timerBadge.textContent = "00:00.0";
  }

  function formatMs(ms) {
    const total = Math.max(0, Math.floor(ms));
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const tenths = Math.floor((total % 1000) / 100);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }
})();
