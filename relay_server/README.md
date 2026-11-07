# Hyper Volley relay server

Lets two players on different networks play a Private Room. Each phone
connects here, the server pairs them by room code, and from then on it just
passes their messages back and forth. (Players on the same Wi-Fi don't need it:
the game finds rooms on the local network by itself.)

## Put it online (free, about 5 minutes) — Render

1. Put this `relay_server` folder in a GitHub repository (it can be a repo of its own).
2. On https://render.com create a **New → Web Service** from that repository.
   - Root directory: the folder with `server.js` (if it isn't the repo root)
   - Runtime: Node · Build command: `npm install` · Start command: `npm start`
   - Instance type: Free
3. Once it's live, Render shows an address like `https://hyper-volley-relay.onrender.com`.
   Opening it in a browser should say `Hyper Volley relay OK`.
4. In Godot: **Project → Project Settings → Network → Relay Url**, enter the
   same address with `wss://` instead of `https://`:

       wss://hyper-volley-relay.onrender.com

   (or edit `project.godot`: `[network]` → `relay_url="wss://…"`), then export the game again.

Free Render services go to sleep after ~15 minutes without players; the first
room after that takes up to a minute to open while it wakes up. Any host that
runs Node and allows WebSockets works the same way (Fly.io, Railway, a VPS…).

## Run it on your PC

    npm install
    npm start          # listens on port 8787 (set PORT to change)

To point a game you run from the editor at it without changing the project,
set the environment variable `HV_RELAY=ws://127.0.0.1:8787` before starting Godot.

## Testing knobs

- `LAG_MS=80 npm start` holds every message 80 ms (feels like a slow connection).
- `HV_NO_LAN=1` (for the game) skips the same-Wi-Fi search, so two copies of the
  game on one PC go through the relay.

## Protocol

Text frames (JSON) until paired, then binary frames are forwarded untouched:

| Client sends                          | Server answers                              |
|---------------------------------------|---------------------------------------------|
| `{"op":"host","code":"1234","v":1}`   | `{"op":"waiting"}` or `{"op":"error","err":"taken"}` |
| `{"op":"join","code":"1234","v":1}`   | both get `{"op":"paired"}`, or error `not_found` / `version` |
| (partner disconnects)                 | `{"op":"left"}`                             |
