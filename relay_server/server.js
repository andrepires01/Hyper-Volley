// Hyper Volley relay server: pairs two phones by room code and passes their
// messages back and forth. It knows nothing about the game itself.
//
//   1. The host connects and sends   {"op":"host","code":"1234","v":1}
//      -> {"op":"waiting"}   (or {"op":"error","err":"taken"})
//   2. A friend connects and sends   {"op":"join","code":"1234","v":1}
//      -> both get {"op":"paired"}   (or error "not_found" / "version")
//   3. From then on every binary frame one sends is forwarded to the other.
//   4. When either side disconnects, the other gets {"op":"left"}.
//
// Run:  npm install  then  npm start   (PORT env var, default 8787)

const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 8787;
// Testing only: hold every forwarded message this long (simulates a slow connection).
const LAG_MS = Number(process.env.LAG_MS) || 0;
const MAX_ROOMS = 5000;
// A room nobody joins is closed after this long.
const ROOM_TTL_MS = 30 * 60 * 1000;
// Frames per second one connection may send before it's cut off (the game sends ~20).
const MAX_FRAMES_PER_SEC = 200;

/** code -> { host: WebSocket, v: number, created: number } */
const rooms = new Map();

const server = http.createServer((req, res) => {
  // A plain page, so hosting services' health checks (and you) can see it's up.
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(`Hyper Volley relay OK. Open rooms: ${rooms.size}\n`);
});

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function closeRoomOf(ws) {
  if (ws.code && rooms.get(ws.code)?.host === ws) rooms.delete(ws.code);
  ws.code = null;
}

wss.on("connection", (ws) => {
  ws.alive = true;
  ws.partner = null;
  ws.code = null;
  ws.frames = 0;
  ws.frameWindow = Date.now();
  ws.on("pong", () => (ws.alive = true));

  ws.on("message", (data, isBinary) => {
    // Flood guard.
    const now = Date.now();
    if (now - ws.frameWindow > 1000) {
      ws.frameWindow = now;
      ws.frames = 0;
    }
    if (++ws.frames > MAX_FRAMES_PER_SEC) {
      ws.terminate();
      return;
    }

    if (ws.partner) {
      if (!isBinary) return;
      const partner = ws.partner;
      const forward = () => {
        if (partner.readyState === partner.OPEN) partner.send(data, { binary: true });
      };
      if (LAG_MS > 0) setTimeout(forward, LAG_MS);
      else forward();
      return;
    }
    if (isBinary) return;

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const code = String(msg.code ?? "");
    if (!/^\d{4,8}$/.test(code)) return send(ws, { op: "error", err: "bad_code" });

    if (msg.op === "host") {
      closeRoomOf(ws);
      const existing = rooms.get(code);
      if (existing && existing.host !== ws && existing.host.readyState === ws.OPEN) {
        return send(ws, { op: "error", err: "taken" });
      }
      if (rooms.size >= MAX_ROOMS) return send(ws, { op: "error", err: "full" });
      rooms.set(code, { host: ws, v: msg.v, created: now });
      ws.code = code;
      send(ws, { op: "waiting" });
    } else if (msg.op === "join") {
      const room = rooms.get(code);
      if (!room || room.host.readyState !== ws.OPEN) return send(ws, { op: "error", err: "not_found" });
      if (room.v !== msg.v) return send(ws, { op: "error", err: "version" });
      rooms.delete(code);
      room.host.code = null;
      room.host.partner = ws;
      ws.partner = room.host;
      send(room.host, { op: "paired" });
      send(ws, { op: "paired" });
    }
  });

  ws.on("close", () => {
    closeRoomOf(ws);
    const partner = ws.partner;
    ws.partner = null;
    if (partner) {
      partner.partner = null;
      send(partner, { op: "left" });
      partner.close();
    }
  });
});

// Drop dead connections and stale rooms.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.created > ROOM_TTL_MS || room.host.readyState !== room.host.OPEN) {
      rooms.delete(code);
      room.host.close();
    }
  }
}, 30 * 1000);

server.listen(PORT, () => console.log(`Hyper Volley relay listening on port ${PORT}`));
