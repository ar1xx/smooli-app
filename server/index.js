import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import http from "http";
import { Server } from "socket.io";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, "db.json");
const TRUSTED_ORIGIN = process.env.TRUSTED_ORIGIN || "http://localhost:5173";
const SALT_ROUNDS = 12;

function loadDb() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    return {
      personal: data.personal || {},
      shared: data.shared || {},
      users: data.users || {},
      sessions: data.sessions || {},
    };
  } catch {
    return { personal: {}, shared: {}, users: {}, sessions: {} };
  }
}

let db = loadDb();
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }, 150);
}

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "http://localhost:4000", "http://localhost:5173"],
      imgSrc: ["'self'", "data:", "https:"],
      mediaSrc: ["'self'", "data:"],
    },
  },
  xFrameOptions: { action: "deny" },
  xContentTypeOptions: "nosniff",
  referrerPolicy: { policy: "no-referrer" },
}));

app.use(cors({ origin: TRUSTED_ORIGIN, credentials: true }));
app.use(express.json({ limit: "15mb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "too_many_attempts" },
  standardHeaders: true,
  legacyHeaders: false,
});

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "unauthorized" });
  const session = db.sessions[token];
  if (!session || session.expiresAt < Date.now()) {
    return res.status(401).json({ error: "invalid_session" });
  }
  req.user = { nickname: session.nickname };
  next();
}

function roomAccess(req, res, next) {
  const roomId = req.params.roomId || req.body.roomId;
  if (!roomId) return res.status(400).json({ error: "room_id_required" });
  const room = db.shared[`room:${roomId}`];
  if (!room) return res.status(404).json({ error: "room_not_found" });
  if (!room.members.includes(req.user.nickname)) {
    return res.status(403).json({ error: "forbidden" });
  }
  req.room = room;
  next();
}

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const { nickname, password } = req.body;
  if (!nickname || !password) return res.status(400).json({ error: "missing_fields" });
  if (!/^[A-Za-z0-9_]{4,16}$/.test(nickname)) return res.status(400).json({ error: "invalid_nickname" });
  const key = `user:${nickname.toLowerCase()}`;
  if (db.users[key]) return res.status(409).json({ error: "nickname_taken" });
  const hashed = await bcrypt.hash(password, SALT_ROUNDS);
  db.users[key] = { nickname, password: hashed, friends: [], createdAt: Date.now() };
  persist();
  res.status(201).json({ ok: true });
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { nickname, password } = req.body;
  if (!nickname || !password) return res.status(400).json({ error: "missing_fields" });
  const key = `user:${nickname.toLowerCase()}`;
  const user = db.users[key];
  if (!user) return res.status(401).json({ error: "invalid_credentials" });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "invalid_credentials" });
  const token = uuidv4();
  db.sessions[token] = { nickname, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 };
  persist();
  res.json({ token, nickname });
});

app.post("/api/auth/logout", authMiddleware, (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  delete db.sessions[token];
  persist();
  res.json({ ok: true });
});

app.get("/api/users/:nickname", authMiddleware, (req, res) => {
  const key = `user:${req.params.nickname.toLowerCase()}`;
  const user = db.users[key];
  if (!user) return res.status(404).json({ error: "not_found" });
  res.json({ nickname: user.nickname, friends: user.friends || [], createdAt: user.createdAt });
});

app.post("/api/invites/send", authMiddleware, (req, res) => {
  const { toNickname, roomId } = req.body;
  if (!toNickname || !roomId) return res.status(400).json({ error: "missing_fields" });
  const from = req.user.nickname;
  const targetKey = `invites:${toNickname.toLowerCase()}`;
  const existing = db.personal[targetKey] || [];
  if (existing.some((inv) => inv.from === from && inv.roomId === roomId)) {
    return res.status(409).json({ error: "already_sent" });
  }
  const invite = { id: uuidv4(), roomId, from, at: Date.now() };
  db.personal[targetKey] = [invite, ...existing];
  persist();
  io.to(toNickname.toLowerCase()).emit(`invite:${toNickname}`, invite);
  res.json({ ok: true });
});

app.post("/api/invites/respond", authMiddleware, (req, res) => {
  const { inviteId, accept } = req.body;
  const nick = req.user.nickname.toLowerCase();
  const key = `invites:${nick}`;
  const invites = db.personal[key] || [];
  const invite = invites.find((i) => i.id === inviteId);
  if (!invite) return res.status(404).json({ error: "not_found" });
  const remaining = invites.filter((i) => i.id !== inviteId);
  db.personal[key] = remaining;
  if (accept) {
    const roomKey = `room:${invite.roomId}`;
    const room = db.shared[roomKey];
    if (room && !room.members.includes(req.user.nickname)) {
      room.members.push(req.user.nickname);
      persist();
    }
    res.json({ ok: true, roomId: invite.roomId });
  } else {
    persist();
    res.json({ ok: true });
  }
});

app.post("/api/friend-requests/send", authMiddleware, (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: "missing_fields" });
  const from = req.user.nickname;
  if (from.toLowerCase() === to.toLowerCase()) return res.status(400).json({ error: "cannot_request_self" });
  const fromKey = `friend_requests:sent:${from.toLowerCase()}`;
  const toKey = `friend_requests:pending:${to.toLowerCase()}`;
  const sent = db.shared[fromKey] || [];
  const pending = db.shared[toKey] || [];
  if (sent.some((r) => r.to.toLowerCase() === to.toLowerCase() && r.status === "pending")) {
    return res.status(409).json({ error: "already_sent" });
  }
  if (pending.some((r) => r.from.toLowerCase() === from.toLowerCase() && r.status === "pending")) {
    return res.status(409).json({ error: "already_pending" });
  }
  const req_obj = { id: uuidv4(), from, to, status: "pending", at: Date.now() };
  db.shared[fromKey] = [...sent, req_obj];
  db.shared[toKey] = [...pending, req_obj];
  persist();
  res.json({ ok: true });
});

app.post("/api/friend-requests/respond", authMiddleware, (req, res) => {
  const { requestId, accept } = req.body;
  const nick = req.user.nickname.toLowerCase();
  const pendingKey = `friend_requests:pending:${nick}`;
  const pending = db.shared[pendingKey] || [];
  const request = pending.find((r) => r.id === requestId);
  if (!request) return res.status(404).json({ error: "not_found" });
  const newPending = pending.filter((r) => r.id !== requestId);
  db.shared[pendingKey] = newPending;
  const fromKey = `friend_requests:sent:${request.from.toLowerCase()}`;
  const sent = db.shared[fromKey] || [];
  const newSent = sent.filter((r) => r.id !== requestId);
  db.shared[fromKey] = newSent;
  if (accept) {
    const myKey = `user:${nick}`;
    const theirKey = `user:${request.from.toLowerCase()}`;
    const me = db.users[myKey] || { nickname: req.user.nickname, friends: [] };
    const them = db.users[theirKey] || { nickname: request.from, friends: [] };
    const myFriends = Array.isArray(me.friends) ? me.friends : [];
    const theirFriends = Array.isArray(them.friends) ? them.friends : [];
    if (!myFriends.includes(request.from)) me.friends = [...myFriends, request.from];
    if (!theirFriends.includes(req.user.nickname)) them.friends = [...theirFriends, req.user.nickname];
    db.users[myKey] = me;
    db.users[theirKey] = them;
  }
  persist();
  res.json({ ok: true });
});

app.delete("/api/friend-requests/:id", authMiddleware, (req, res) => {
  const nick = req.user.nickname.toLowerCase();
  const pendingKey = `friend_requests:pending:${nick}`;
  const pending = db.shared[pendingKey] || [];
  const request = pending.find((r) => r.id === req.params.id);
  if (!request) return res.status(404).json({ error: "not_found" });
  db.shared[pendingKey] = pending.filter((r) => r.id !== req.params.id);
  const fromKey = `friend_requests:sent:${request.from.toLowerCase()}`;
  const sent = db.shared[fromKey] || [];
  db.shared[fromKey] = sent.filter((r) => r.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

app.delete("/api/friends/:nickname", authMiddleware, (req, res) => {
  const me = req.user.nickname;
  const them = req.params.nickname;
  const myKey = `user:${me.toLowerCase()}`;
  const theirKey = `user:${them.toLowerCase()}`;
  const myUser = db.users[myKey];
  const theirUser = db.users[theirKey];
  if (!myUser || !theirUser) return res.status(404).json({ error: "not_found" });
  myUser.friends = (myUser.friends || []).filter((f) => f.toLowerCase() !== them.toLowerCase());
  theirUser.friends = (theirUser.friends || []).filter((f) => f.toLowerCase() !== me.toLowerCase());
  persist();
  res.json({ ok: true });
});

app.get("/api/kv/:key", authMiddleware, (req, res) => {
  const shared = req.query.shared === "true";
  const store = shared ? db.shared : db.personal;
  const key = shared ? req.params.key : `${req.user.nickname}:${req.params.key}`;
  if (shared && req.params.key.startsWith("user:")) {
    return res.status(403).json({ error: "forbidden" });
  }
  const value = store[key];
  if (value === undefined) return res.status(404).json({ error: "not_found" });
  res.json({ key: req.params.key, value, shared });
});

app.post("/api/kv/:key", authMiddleware, (req, res) => {
  const { value, shared } = req.body;
  const store = shared ? db.shared : db.personal;
  const key = shared ? req.params.key : `${req.user.nickname}:${req.params.key}`;
  if (shared && req.params.key.startsWith("user:")) {
    return res.status(403).json({ error: "forbidden" });
  }
  store[key] = value;
  persist();
  res.json({ key: req.params.key, value, shared: !!shared });
});

app.delete("/api/kv/:key", authMiddleware, (req, res) => {
  const shared = req.query.shared === "true";
  const store = shared ? db.shared : db.personal;
  const key = shared ? req.params.key : `${req.user.nickname}:${req.params.key}`;
  if (shared && req.params.key.startsWith("user:")) {
    return res.status(403).json({ error: "forbidden" });
  }
  delete store[key];
  persist();
  res.json({ key: req.params.key, deleted: true, shared });
});

app.get("/api/kv", authMiddleware, (req, res) => {
  const shared = req.query.shared === "true";
  const prefix = req.query.prefix || "";
  const store = shared ? db.shared : db.personal;
  const userPrefix = shared ? prefix : `${req.user.nickname}:${prefix}`;
  const keys = Object.keys(store).filter((k) => k.startsWith(userPrefix)).map((k) => shared ? k : k.slice(req.user.nickname.length + 1));
  res.json({ keys, prefix, shared });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: TRUSTED_ORIGIN, credentials: true } });

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("unauthorized"));
  const session = db.sessions[token];
  if (!session || session.expiresAt < Date.now()) return next(new Error("invalid_session"));
  socket.data.nickname = session.nickname;
  next();
});

io.on("connection", (socket) => {
  socket.on("room:join", ({ roomId, nickname }) => {
    socket.join(roomId);
    socket.data.nickname = nickname;
    socket.data.roomId = roomId;
  });

  socket.on("room:leave", ({ roomId }) => {
    socket.leave(roomId);
  });

  socket.on("room:playback", (payload) => {
    const patch = { ...payload, updatedAt: Date.now() };
    const key = `room:${payload.roomId}`;
    const room = db.shared[key];
    if (room && room.members.includes(socket.data.nickname)) {
      room.playback = patch;
      persist();
    }
    socket.to(payload.roomId).emit("room:playback", patch);
  });

  socket.on("room:mix", (payload) => {
    const key = `room:${payload.roomId}`;
    const room = db.shared[key];
    if (room && room.members.includes(socket.data.nickname)) {
      room.mix = payload.mix;
      if (payload.sharedTracks) room.sharedTracks = payload.sharedTracks;
      persist();
    }
    socket.to(payload.roomId).emit("room:mix", payload);
  });

  socket.on("room:invite", ({ toNickname, invite }) => {
    io.emit(`invite:${toNickname}`, invite);
  });
});

const PORT = 4000;
server.listen(PORT, () => console.log(`Smooli server running on http://localhost:${PORT}`));
