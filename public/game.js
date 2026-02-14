/* eslint-disable no-use-before-define */
"use strict";

(() => {
  const queryParams = new URLSearchParams(window.location.search);
  const accessToken = queryParams.get("access") || "";

  const ui = {
    status: document.getElementById("status"),
    joinPanel: document.getElementById("joinPanel"),
    roomPanel: document.getElementById("roomPanel"),
    nameInput: document.getElementById("nameInput"),
    roomInput: document.getElementById("roomInput"),
    createRoomBtn: document.getElementById("createRoomBtn"),
    joinRoomBtn: document.getElementById("joinRoomBtn"),
    roomCode: document.getElementById("roomCode"),
    copyLinkBtn: document.getElementById("copyLinkBtn"),
    btnNewMap: document.getElementById("btnNewMap"),
    btnNewLeg: document.getElementById("btnNewLeg"),
    btnStart: document.getElementById("btnStart"),
    btnMap: document.getElementById("btnMap"),
    compassCheck: document.getElementById("compassCheck"),
    fullscreenCheck: document.getElementById("fullscreenCheck"),
    playersList: document.getElementById("playersList"),
    resultsBody: document.getElementById("resultsBody"),
    timerBadge: document.getElementById("timerBadge"),
    canvasWrap: document.getElementById("canvasWrap"),
    canvas: document.getElementById("canvas"),
  };

  const state = {
    socket: null,
    connected: false,
    pendingRoomId: "",
    roomId: "",
    playerId: "",
    playerName: "",
    leaderId: "",
    players: [],
    results: [],
    phase: "lobby",
    startedAt: null,
    mapSeed: null,
    legSeed: null,
    serverOffsetMs: 0,
    localFinished: false,
    mapViewOpen: false,
  };

  const savedName = localStorage.getItem("orient_player_name");
  ui.nameInput.value = sanitizeName(savedName || "") || `Runner ${Math.floor(Math.random() * 900 + 100)}`;

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
    state.socket.emit("new_map");
  });

  ui.btnNewLeg.addEventListener("click", () => {
    if (!canSendRoomEvent()) {
      return;
    }
    state.socket.emit("new_leg");
  });

  ui.btnStart.addEventListener("click", () => {
    if (!canSendRoomEvent()) {
      return;
    }
    state.socket.emit("start_race");
  });

  ui.btnMap.addEventListener("click", () => {
    if (state.phase !== "running") {
      return;
    }
    setMapViewOpen(!state.mapViewOpen);
  });

  ui.nameInput.addEventListener("change", () => {
    const name = sanitizeName(ui.nameInput.value);
    ui.nameInput.value = name;
    state.playerName = name;
    localStorage.setItem("orient_player_name", name);
    if (state.socket && state.connected && state.roomId) {
      state.socket.emit("update_name", { name });
    }
  });

  ui.compassCheck.addEventListener("change", () => {
    mShowCompass = Boolean(ui.compassCheck.checked);
  });

  ui.fullscreenCheck.addEventListener("change", () => {
    mFullscreen = Boolean(ui.fullscreenCheck.checked);
    WindowResize();
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
  let mMenu = true;
  let mAtStart = true;
  let mCenterView = true;
  let mShowCompass = false;
  let mLastFrameTime = performance.now();
  let mFullscreen = true;

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

  function DrawControl(drawCtx, x, y, ang) {
    drawCtx.save();
    drawCtx.translate(x, y);
    drawCtx.rotate(ang);
    let s = 2;

    drawCtx.fillStyle = "white";
    drawCtx.fillRect(-s, -s, s * 2, s * 2);

    drawCtx.fillStyle = "rgb(255,128,0)";
    drawCtx.beginPath();
    drawCtx.moveTo(s, s);
    drawCtx.lineTo(-s, s);
    drawCtx.lineTo(s, -s);
    drawCtx.lineTo(s, s);
    drawCtx.fill();

    drawCtx.strokeStyle = "black";
    drawCtx.lineWidth = 0.25;
    drawCtx.strokeRect(-s, -s, s * 2, s * 2);

    drawCtx.restore();
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
      if (mMoving || state.phase !== "running" || state.localFinished) {
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
    });
  }

  function InitCourse(seed) {
    if (!mMapNodes.length) {
      return;
    }

    withSeed(seed, () => {
      mSrcNode = mMapNodes[RandRangeI(0, mMapNodes.length - 1)];

      let dist = 0;
      let guard = 1000;
      while (dist < 50 && guard > 0) {
        mDstNode = mMapNodes[RandRangeI(0, mMapNodes.length - 1)];
        dist = vec2.sub(mSrcNode.center, mDstNode.center).length();
        guard -= 1;
      }
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
      let allowMove = state.phase === "running" && !state.localFinished;
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

          if (mDotNode.neighborCnt > 2 && mDotNode !== mDstNode) {
            mMoving = false;
          }
        }
        mDotNode.UpdateDotPos();
        dist += vec2.sub(mDotPos, lastDP).length();
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

      if (state.phase === "running" && !state.localFinished && mDotNode === mDstNode && mDotI > 0.5) {
        state.localFinished = true;
        mMoving = false;
        if (state.socket && state.connected) {
          state.socket.emit("player_finished");
        }
      }
    }
  }

  function MouseDown(aX, aY) {
    if (state.phase !== "running" || state.localFinished || !mDotNode) {
      return;
    }

    let x = (aX - canvas.getBoundingClientRect().left - ctxWidth * 0.5) / mViewS;
    let y = (aY - canvas.getBoundingClientRect().top - ctxHeight * (mCenterView ? 0.5 : 0.8)) / mViewS;
    let _x = Math.cos(-mViewR) * x - Math.sin(-mViewR) * y;
    let _y = Math.sin(-mViewR) * x + Math.cos(-mViewR) * y;
    mDotNode.ClickArrows(new vec2(_x + mViewPos.x, _y + mViewPos.y));
  }

  function CanvasMouseDown(e) {
    MouseDown(e.clientX, e.clientY);
  }

  function CanvasTouchDown(e) {
    e.preventDefault();
    MouseDown(e.targetTouches[0].pageX, e.targetTouches[0].pageY);
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

    if (mMenu) {
      ctx.strokeStyle = "rgb(255,100,100)";
      ctx.lineWidth = 8;
      ctx.beginPath();
      for (let a = 0; a < mRouteNodes.length; a += 1) {
        mRouteNodes[a].Draw(ctx);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = mMenu ? "rgb(0,150,0)" : "rgb(255,255,255)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let a = 0; a < mMapNodes.length; a += 1) {
      mMapNodes[a].Draw(ctx);
    }
    ctx.stroke();

    if (mMenu) {
      ctx.strokeStyle = "rgba(255,0,255,0.5)";
      ctx.lineWidth = 5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      let rad = 15;
      ctx.arc(mDstNode.center.x, mDstNode.center.y, rad, 0, Math.PI * 2, false);
      let dir = vec2.sub(mDstNode.center, mSrcNode.center);
      dir.divideEquals(dir.length());
      ctx.moveTo(mSrcNode.center.x + dir.x * rad, mSrcNode.center.y + dir.y * rad);
      ctx.lineTo(
        mSrcNode.center.x - dir.x * rad * 0.6 + dir.y * rad * 0.9,
        mSrcNode.center.y - dir.y * rad * 0.6 - dir.x * rad * 0.9
      );
      ctx.lineTo(
        mSrcNode.center.x - dir.x * rad * 0.6 - dir.y * rad * 0.9,
        mSrcNode.center.y - dir.y * rad * 0.6 + dir.x * rad * 0.9
      );
      ctx.lineTo(mSrcNode.center.x + dir.x * rad, mSrcNode.center.y + dir.y * rad);
      ctx.lineTo(mDstNode.center.x - dir.x * rad, mDstNode.center.y - dir.y * rad);
      ctx.stroke();
      ctx.lineJoin = "miter";
    }

    if (!mMenu) {
      DrawControl(ctx, mSrcNode.center.x, mSrcNode.center.y, -mViewR);
      DrawControl(ctx, mDstNode.center.x, mDstNode.center.y, -mViewR);
    }

    if (!mAtStart || (state.phase === "running" && mMenu)) {
      let rad = mMenu ? 5 : 2;
      let dotX = mAtStart ? mDotNode.center.x : mDotPos.x;
      let dotY = mAtStart ? mDotNode.center.y : mDotPos.y;
      ctx.fillStyle = "rgb(128,0,0)";
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
      mDotNode.DrawArrows(ctx);
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
      SetMenuVis(true);
      renderUi();
      return;
    }

    state.mapViewOpen = Boolean(shouldOpen);
    if (state.mapViewOpen) {
      // Match original stop/menu behavior: open overview map and pause automatic movement.
      mMoving = false;
      mCenterView = true;
      SetMenuVis(true);
    } else {
      MoveViewToDot();
      mViewR = 0;
      mDotAng = 0;
      // After closing overview map, re-center player in viewport.
      mCenterView = true;
      SetMenuVis(false);
    }

    renderUi();
  }

  function WindowResize() {
    const rect = ui.canvasWrap.getBoundingClientRect();
    const maxW = Math.max(240, Math.floor(rect.width));
    const maxH = Math.max(240, Math.floor(rect.height));

    canvas.width = ctxWidth = mFullscreen ? maxW : Math.min(600, maxW);
    canvas.height = ctxHeight = mFullscreen ? maxH : Math.min(600, maxH);
  }

  function gameLoop(now) {
    const dt = Math.min(0.05, (now - mLastFrameTime) / 1000);
    mLastFrameTime = now;

    ctx.clearRect(0, 0, ctxWidth, ctxHeight);
    Update(Number.isFinite(dt) ? dt : 0.016);
    DrawMap();
    refreshTimer();

    requestAnimationFrame(gameLoop);
  }

  canvas.addEventListener("mousedown", CanvasMouseDown, false);
  canvas.addEventListener("touchstart", CanvasTouchDown, { passive: false });
  window.addEventListener("resize", WindowResize);
  WindowResize();
  requestAnimationFrame(gameLoop);

  if (urlRoom) {
    joinRoom(urlRoom);
  } else {
    BuildMap(150000001);
    InitCourse(900000001);
    SetMenuVis(true);
    renderUi();
    setStatus("Создайте комнату или войдите в существующую");
  }

  function canSendRoomEvent() {
    return Boolean(state.socket && state.connected && state.roomId);
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

  function buildInviteLink(roomId) {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    if (accessToken) {
      url.searchParams.set("access", accessToken);
    }
    return url.toString();
  }

  function updateUrl(roomId) {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    if (accessToken) {
      url.searchParams.set("access", accessToken);
    }
    window.history.replaceState({}, "", url.toString());
  }

  function ensureSocket() {
    if (state.socket) {
      return;
    }

    const auth = accessToken ? { access: accessToken } : {};
    state.socket = io({ auth });

    state.socket.on("connect", () => {
      state.connected = true;
      state.playerId = state.socket.id;
      setStatus("Подключено к серверу");
      if (state.pendingRoomId) {
        emitJoin();
      }
      renderUi();
    });

    state.socket.on("disconnect", () => {
      state.connected = false;
      setStatus("Соединение потеряно, пробуем восстановить...");
      renderUi();
    });

    state.socket.on("connect_error", (err) => {
      setStatus(`Ошибка соединения: ${err.message}`);
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
      },
      (ack) => {
        if (!ack || !ack.ok) {
          setStatus("Не удалось войти в комнату");
          return;
        }
        state.playerId = ack.playerId;
        state.roomId = ack.roomId;
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
    state.playerName = name || `Runner ${Math.floor(Math.random() * 900 + 100)}`;

    ui.roomInput.value = state.pendingRoomId;
    ui.nameInput.value = state.playerName;

    localStorage.setItem("orient_player_name", state.playerName);

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

    state.roomId = payload.roomId;
    state.leaderId = payload.leaderId || "";
    state.players = Array.isArray(payload.players) ? payload.players : [];
    state.results = Array.isArray(payload.results) ? payload.results : [];
    state.phase = payload.phase || "lobby";
    state.startedAt = typeof payload.startedAt === "number" ? payload.startedAt : null;
    state.mapSeed = typeof payload.mapSeed === "number" ? payload.mapSeed : null;
    state.legSeed = typeof payload.legSeed === "number" ? payload.legSeed : null;

    if (typeof payload.serverNow === "number") {
      state.serverOffsetMs = payload.serverNow - Date.now();
    }

    const localPlayer = state.players.find((player) => player.id === state.playerId);
    state.localFinished = Boolean(localPlayer && localPlayer.finishedMs !== null);

    if (state.mapSeed !== previousMapSeed || state.legSeed !== previousLegSeed || mMapNodes.length === 0) {
      BuildMap(state.mapSeed || 1);
      InitCourse(state.legSeed || 1);
    }

    if (state.phase === "running" && previousPhase !== "running") {
      state.mapViewOpen = false;
      InitDot((state.legSeed || 1) + 1);
      MoveViewToDot();
      mViewR = 0;
      mDotAng = 0;
      SetMenuVis(false);
    }

    if (state.phase !== "running" && previousPhase === "running") {
      state.mapViewOpen = false;
      mMoving = false;
      mCenterView = true;
      SetMenuVis(true);
    }

    if (state.phase !== "running" && previousPhase !== "running") {
      state.mapViewOpen = false;
      SetMenuVis(true);
    }

    renderUi();
  }

  function setStatus(text) {
    ui.status.textContent = text;
  }

  function renderUi() {
    const inRoom = Boolean(state.roomId);
    ui.joinPanel.classList.toggle("hidden", inRoom);
    ui.roomPanel.classList.toggle("hidden", !inRoom);
    ui.roomCode.textContent = state.roomId || "-";

    let phaseText = "Лобби";
    if (state.phase === "running") {
      phaseText = "Гонка идет";
    } else if (state.phase === "finished") {
      phaseText = "Гонка завершена";
    }
    const playerCount = state.players.length;
    ui.status.textContent = inRoom ? `${phaseText}. Игроков: ${playerCount}` : ui.status.textContent;

    const disabled = !state.connected || !inRoom;
    ui.btnStart.disabled = disabled || state.phase === "running";
    ui.btnNewMap.disabled = disabled || state.phase === "running";
    ui.btnNewLeg.disabled = disabled || state.phase === "running";
    ui.btnMap.disabled = disabled || state.phase !== "running";

    const running = state.phase === "running";
    ui.btnNewMap.classList.toggle("hidden", running);
    ui.btnNewLeg.classList.toggle("hidden", running);
    ui.btnStart.classList.toggle("hidden", running);
    ui.btnMap.classList.toggle("hidden", !running);
    ui.btnMap.textContent = state.mapViewOpen ? "BACK" : "MAP";

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
      if (player.finishedMs !== null) {
        parts.push(`- финиш ${formatMs(player.finishedMs)}`);
      } else if (state.phase === "running") {
        parts.push("- на дистанции");
      } else {
        parts.push("- ожидание");
      }
      li.textContent = parts.join(" ");
      ui.playersList.appendChild(li);
    }
  }

  function renderResults() {
    ui.resultsBody.innerHTML = "";

    if (!state.results.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.textContent = "Пока нет финишировавших";
      tr.appendChild(td);
      ui.resultsBody.appendChild(tr);
      return;
    }

    for (const result of state.results) {
      const tr = document.createElement("tr");

      const rank = document.createElement("td");
      rank.textContent = String(result.finishRank);

      const name = document.createElement("td");
      name.textContent = result.name;

      const time = document.createElement("td");
      time.textContent = formatMs(result.finishedMs);

      tr.appendChild(rank);
      tr.appendChild(name);
      tr.appendChild(time);
      ui.resultsBody.appendChild(tr);
    }
  }

  function getSyncedNow() {
    return Date.now() + state.serverOffsetMs;
  }

  function refreshTimer() {
    if (state.phase === "running" && state.startedAt) {
      ui.timerBadge.textContent = formatMs(Math.max(0, getSyncedNow() - state.startedAt));
      return;
    }

    if (state.phase === "finished" && state.results.length > 0) {
      const maxTime = Math.max(...state.results.map((entry) => entry.finishedMs));
      ui.timerBadge.textContent = formatMs(maxTime);
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
