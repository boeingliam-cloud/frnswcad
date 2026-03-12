# FRNSW Fire CAD/MDT
### ER:LC Liberty County — Local Web CAD

A lightweight web-based CAD (Computer-Aided Dispatch) + MDT (Mobile Data Terminal) for a small FRNSW fire department running in ER:LC.

---

## Quick Start

### Requirements
- [Node.js LTS](https://nodejs.org/) (v18 or newer)

### Setup

```bash
# 1. Extract this zip, open a terminal in the folder
cd cad-mdt

# 2. Install dependencies (only needed once)
npm install

# 3. Start the server
node server.js
```

Then open:
- **Dispatch console:** `http://localhost:5177/dispatch`
- **Unit MDT:** `http://localhost:5177/mdt`
- **Other devices on same network:** replace `localhost` with your PC's IP address

---

## Default Logins

Edit `AUTH_USERS` in `server.js` to add/change accounts.

| Role | Username | Password |
|---|---|---|
| Dispatcher | `dispatch` | `dispatch123` |
| Unit | `unit1` | `unit123` |

When logging in as a **Unit**, enter a callsign (e.g. `PUMPA1`).

---

## ER:LC API Integration (Auto Location)

To pull live unit locations from your ER:LC private server:

1. Get your **Server Key** from ER:LC in-game settings → Private Server → API
2. Open `server.js` and find this line near the top:
   ```js
   const ERLC_SERVER_KEY = process.env.ERLC_SERVER_KEY || "YOUR_KEY_HERE";
   ```
3. Replace `YOUR_KEY_HERE` with your actual server key, **or** set the environment variable:
   ```bash
   ERLC_SERVER_KEY=your_key node server.js
   ```
4. Once running, in the **Dispatch console → Units table**, set the **ER:LC name** for each unit (their in-game Roblox username or callsign)
5. Locations will update automatically every 15 seconds

### API Endpoints Used
| Endpoint | Purpose |
|---|---|
| `GET /v2/server/players` | Live player locations, teams, callsigns |

---

## Features

### Dispatch Console (`/dispatch`)
- Create incidents with nature, priority, location, notes
- Assign/unassign units to incidents
- Close incidents
- Live map with ER:LC official map images (Fall/Winter, with/without postals)
- Unit location markers on map
- Page tone to all connected units
- Units table with ER:LC name binding

### Unit MDT (`/mdt`)
- FRNSW-style status panel: ALT / MOB / PRO / INS / EMR / NAV / STN / AVL
- Incident details screen (auto-shows assigned incident)
- Live map with your position marker
- Resources screen (all units on your incident)
- Messages screen (pages from dispatch)
- Manual location entry or paste ER:LC JSON
- Duress mode (EMR) — red border on MDT

---

## Map

Uses official ER:LC map images from `https://api.policeroleplay.community/maps/`
- `fall_postals.png` — Fall map with postal codes + street names
- `fall_blank.png` — Fall map, blank
- `snow_postals.png` — Winter map with postals
- `snow_blank.png` — Winter map, blank

If unit markers appear mirrored vertically, toggle **Flip Z** in the unit MDT settings overlay.

---

## File Structure

```
cad-mdt/
├── server.js          ← Express + Socket.IO backend
├── db.js              ← JSON flat-file database
├── cad-mdt.json       ← Data file (auto-created if missing)
├── package.json
└── public/
    ├── index.html     ← Login page
    ├── dispatch.html  ← Dispatch console
    ├── mdt.html       ← Unit MDT
    ├── app.css        ← Shared styles
    ├── mdt.css        ← MDT-specific styles
    └── shared.js      ← Shared JS utilities
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5177` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `ERLC_SERVER_KEY` | *(in server.js)* | PRC private server API key |
| `ERLC_API_BASE` | `https://api.policeroleplay.community` | PRC API base URL |
| `ERLC_POLL_MS` | `15000` | Location poll interval (ms) |
| `SESSION_SECRET` | `dev-secret-change-me` | Session secret — change for production |
| `DB_PATH` | `./cad-mdt.json` | Path to JSON database file |
