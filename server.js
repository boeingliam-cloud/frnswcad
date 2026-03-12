import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { nanoid } from "nanoid";
import { openDb } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 5177);
const HOST = process.env.HOST || "0.0.0.0";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "cad-mdt.json");
const ERLC_API_BASE = (process.env.ERLC_API_BASE || "https://api.policeroleplay.community").replace(/\/$/, "");
const ERLC_POLL_MS = Number(process.env.ERLC_POLL_MS || 15000);

// =============================================================================
//  USER ACCOUNTS
//  username  = login username (tracked internally + matched to ER:LC)
//  password  = login password
//  role      = "dispatch" or "unit"
//  truck     = (unit only) display callsign shown on MDT, map, dispatch table
//  perms     = (unit only) permission level:
//                "truck"   — standard crew, read-only MDT (default)
//                "command" — crew commander, can edit/update incident details
//                            from their MDT and submit sitreps
//                "senior"  — senior officer, same as command + can close calls
// =============================================================================
const AUTH_USERS = [

  // Dispatchers
  { username: "dispatch",  password: "dispatch", role: "dispatch" },
  { username: "GovGenGGAussie", password: "Officalggtothecommenwealthofaustraila", role: "dispatch" }

  // Pump crews
  { username: "pump1a",     password: "password",     role: "unit", truck: "PUMP1A",  perms: "command"   },
  { username: "pump1b",     password: "password",     role: "unit", truck: "PUMP1B",  perms: "command"   },
  { username: "pump2a",     password: "password",     role: "unit", truck: "PUMP2A",  perms: "command"   },
  { username: "pump2b",     password: "password",     role: "unit", truck: "PUMP2B",  perms: "command"   },

  // Recues
  { username: "rescue1",    password: "password",     role: "unit", truck: "RESCUE1", perms: "command"   },
  { username: "rescue2",    password: "password",     role: "unit", truck: "RESCUE2", perms: "command"   },

  // Aerials
  { username: "aerial1",    password: "password",     role: "unit", truck: "AERIAL1", perms: "command"   },
  { username: "aerial2",    password: "password",     role: "unit", truck: "AERIAL2", perms: "command"   },

  // Special units
  { username: "hazmat1",    password: "password",     role: "unit", truck: "HAZMAT1", perms: "command"   },
  { username: "hazmat2",    password: "password",     role: "unit", truck: "HAZMAT2", perms: "command"   },

   // extra units
  { username: "pump3a",     password: "password",     role: "unit", truck: "PUMP3A",  perms: "command"   },
  { username: "pump3b",     password: "password",     role: "unit", truck: "PUMP3B",  perms: "command"   },
  { username: "rescue3",    password: "password",     role: "unit", truck: "RESCUE3", perms: "command"   },
  { username: "aerial3",    password: "password",     role: "unit", truck: "AERIAL3", perms: "command"   },
  { username: "hazmat3",    password: "password",     role: "unit", truck: "HAZMAT3", perms: "command"   },
{ username: "GovGenGGAussie" password: "Officalggtothecommenwealthofaustraila" role: "unit", truck: "GovGen", perms: "senior" }


  // Command vehicles
  { username: "cmd1",       password: "password",     role: "unit", truck: "CMD1",    perms: "command" },
  { username: "cmd2",       password: "password",     role: "unit", truck: "CMD2",    perms: "command" },

  // Senior officers
  { username: "CMD1",        password: "password",     role: "unit", truck: "CMD1",     perms: "senior"  },
  { username: "CMD2",        password: "password",     role: "unit", truck: "CMD2",     perms: "senior"  },
  { username: "CMD3",         password: "password",     role: "unit", truck: "CMD3",    perms: "senior"  },
  

// =============================================================================
//  ER:LC / PRC PRIVATE SERVER API KEY
//  Paste your server key from in-game settings below, or set the environment
//  variable ERLC_SERVER_KEY before running.
// =============================================================================
const ERLC_SERVER_KEY = process.env.ERLC_SERVER_KEY || "YOUR_SERVER_KEY_HERE";

// =============================================================================
//  Server setup
// =============================================================================
const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer);
const db = openDb(DB_PATH);

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: "lax" }
});

app.use(express.json());
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, "public")));

// ── Auth helpers ──────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.user) return res.redirect("/index.html");
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session?.user) return res.redirect("/index.html");
    if (req.session.user.role !== role) return res.status(403).send("Forbidden");
    next();
  };
}

// ── Login ─────────────────────────────────────────────────────────────────────
app.post("/api/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();
  const asRole   = String(req.body?.role     || "").trim();
  const callsign = String(req.body?.callsign || "").trim();

  if (!username || !password || !asRole)
    return res.status(400).json({ ok: false, error: "Missing username, password or role" });
  if (asRole !== "dispatch" && asRole !== "unit")
    return res.status(400).json({ ok: false, error: "Bad role" });

  const user = AUTH_USERS.find(
    u => u.username === username && u.password === password && u.role === asRole
  );

  if (!user) return res.status(401).json({ ok: false, error: "Invalid username or password" });

  // truck = display name on MDT/map. truck field takes priority over typed callsign.
  const displayCallsign = asRole === "unit"
    ? (user.truck || callsign || user.username.toUpperCase())
    : undefined;

  req.session.user = {
    id:       `user-${user.username}`,
    username: user.username,
    role:     user.role,
    truck:    user.truck || null,
    perms:    user.role === "unit" ? (user.perms || "truck") : "dispatch",
    callsign: displayCallsign
  };

  if (asRole === "unit") {
    const unitId = `unit-${user.username}`;
    // Register/update the unit in the database with the truck display name
    db.upsertUnit({ id: unitId, callsign: displayCallsign });
    // Auto-bind ER:LC player name to their login username
    if (ERLC_SERVER_KEY && ERLC_SERVER_KEY !== "YOUR_SERVER_KEY_HERE") {
      db.setUnitErlcPlayer(unitId, username);
      (async () => {
        const players = await fetchErlcPlayers();
        if (players && players.length > 0) applyErlcLocationsToUnits(players);
      })();
    }
  }

  res.json({ ok: true, role: asRole });
});

app.post("/api/logout", (req, res) => {
  req.session?.destroy(() => res.json({ ok: true }));
});

// ── Page routes ───────────────────────────────────────────────────────────────
app.get("/dispatch", requireRole("dispatch"), (req, res) => res.redirect("/dispatch.html"));
app.get("/mdt",      requireRole("unit"),     (req, res) => res.redirect("/mdt.html"));
app.get("/whoami",   requireAuth,             (req, res) => res.json({ ok: true, user: req.session.user }));

app.get("/api/state", requireAuth, (req, res) => {
  const { units, incidents, assignments } = db.getState();
  res.json({ ok: true, units, incidents, assignments });
});

// ── Socket.IO auth ────────────────────────────────────────────────────────────
io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

function requireSocketAuth(socket) {
  return socket.request?.session?.user || null;
}

function broadcastState() {
  const { units, incidents, assignments } = db.getState();
  io.emit("state", { units, incidents, assignments });
}

// ── ER:LC API ─────────────────────────────────────────────────────────────────
async function fetchErlcPlayers() {
  if (!ERLC_SERVER_KEY || ERLC_SERVER_KEY === "YOUR_SERVER_KEY_HERE") return null;
  try {
    const res = await fetch(`${ERLC_API_BASE}/v2/server/players`, {
      headers: { "server-key": ERLC_SERVER_KEY }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data)) return data;
    return data?.Players ?? data?.players ?? null;
  } catch {
    return null;
  }
}

function normalise(name) {
  return String(name ?? "").trim().toLowerCase();
}

function applyErlcLocationsToUnits(players) {
  if (!Array.isArray(players)) return;
  const { units } = db.getState();
  for (const unit of units) {
    const matchName = unit.erlc_player_name ? normalise(unit.erlc_player_name) : null;
    if (!matchName) continue;
    const player = players.find(p => {
      const fromPlayer = (p.Player && String(p.Player).includes(":"))
        ? normalise(String(p.Player).split(":")[0]) : "";
      const u = normalise(p.Username ?? p.PlayerName ?? p.Name ?? fromPlayer);
      const c = normalise(p.Callsign);
      return u === matchName || c === matchName || fromPlayer === matchName;
    });
    if (!player) continue;
    const loc = player.Location ?? player;
    const x = Number(loc.LocationX ?? loc.location_x);
    const z = Number(loc.LocationZ ?? loc.location_z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    db.setUnitLocation(unit.id, {
      location_x:      x,
      location_z:      z,
      postal_code:     loc.PostalCode     ?? loc.Postal       ?? loc.postal_code     ?? null,
      street_name:     loc.StreetName     ?? loc.Street       ?? loc.street_name     ?? null,
      building_number: loc.BuildingNumber ?? loc.Building     ?? loc.building_number ?? null
    });
  }
  broadcastState();
}

function startErlcPoller() {
  if (!ERLC_SERVER_KEY || ERLC_SERVER_KEY === "YOUR_SERVER_KEY_HERE") {
    console.log("  ER:LC poller disabled — paste your server key into ERLC_SERVER_KEY in server.js");
    return;
  }
  const poll = async () => {
    const players = await fetchErlcPlayers();
    if (players && players.length > 0) applyErlcLocationsToUnits(players);
  };
  poll();
  setInterval(poll, ERLC_POLL_MS);
  console.log(`  ER:LC location poller active (every ${ERLC_POLL_MS / 1000}s)`);
}

// ── Socket events ─────────────────────────────────────────────────────────────
// Track connected sockets by unit id so dispatch can kick them
const connectedSockets = new Map(); // unitId → socket

io.on("connection", socket => {
  const user = requireSocketAuth(socket);
  if (!user) { socket.disconnect(true); return; }

  // Track unit sockets so dispatch can kick them
  if (user.role === "unit") {
    const unitId = `unit-${user.username}`;
    connectedSockets.set(unitId, socket);
    socket.on("disconnect", () => {
      connectedSockets.delete(unitId);
      db.removeUnit(unitId);
      broadcastState();
    });
  }

  socket.emit("hello", { user });

  // Unit: change status
  socket.on("unit:setStatus", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "unit") return;
    const status = String(payload?.status || "").toUpperCase();
    const VALID_STATUSES = ["AVAILABLE","ENROUTE","ONSCENE","CLEAR","OFFLINE","EMR","ALT","MOB","PRO","INS","NAV","STN","AVL"];
    if (!VALID_STATUSES.includes(status)) return;
    db.setUnitStatus(`unit-${u.username}`, status);
    broadcastState();
  });

  // Unit: manual location update
  socket.on("unit:updateLocation", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "unit") return;
    const x = Number(payload?.location_x);
    const z = Number(payload?.location_z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    db.setUnitLocation(`unit-${u.username}`, {
      location_x:      x,
      location_z:      z,
      postal_code:     payload?.postal_code     != null ? String(payload.postal_code)     : null,
      street_name:     payload?.street_name     != null ? String(payload.street_name)     : null,
      building_number: payload?.building_number != null ? String(payload.building_number) : null
    });
    broadcastState();
  });

  // Unit: set ER:LC player name for auto-location
  socket.on("unit:setErlcPlayer", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "unit") return;
    const name = payload?.erlc_player_name != null ? String(payload.erlc_player_name).trim() : null;
    db.setUnitErlcPlayer(`unit-${u.username}`, name || null);
    broadcastState();
  });

  // Dispatch: create incident
  socket.on("dispatch:createIncident", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "dispatch") return;
    const nature = String(payload?.nature || "").trim();
    if (!nature) return;
    const x = payload?.location_x != null ? Number(payload.location_x) : null;
    const z = payload?.location_z != null ? Number(payload.location_z) : null;
    const priority = String(payload?.priority || "P2").trim();
    db.insertIncident({
      id:              db.nextIncidentId(priority),
      created_by:      u.username,
      created_at:      Date.now(),
      nature,
      priority:        String(payload?.priority        || "P2").trim(),
      notes:           payload?.notes           != null ? String(payload.notes)           : null,
      location_label:  payload?.location_label  != null ? String(payload.location_label)  : null,
      location_x:      Number.isFinite(x) ? x : null,
      location_z:      Number.isFinite(z) ? z : null,
      postal_code:     payload?.postal_code     != null ? String(payload.postal_code)     : null,
      street_name:     payload?.street_name     != null ? String(payload.street_name)     : null,
      building_number: payload?.building_number != null ? String(payload.building_number) : null,
      status:          "OPEN"
    });
    broadcastState();
  });

  // Dispatch: assign unit to incident
  socket.on("dispatch:assignUnit", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "dispatch") return;
    const incidentId = String(payload?.incident_id || "");
    const unitId     = String(payload?.unit_id     || "");
    if (!incidentId || !unitId) return;
    db.assignUnit(incidentId, unitId);
    broadcastState();
  });

  // Dispatch: remove unit from incident
  socket.on("dispatch:unassignUnit", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "dispatch") return;
    const incidentId = String(payload?.incident_id || "");
    const unitId     = String(payload?.unit_id     || "");
    if (!incidentId || !unitId) return;
    db.unassignUnit(incidentId, unitId);
    broadcastState();
  });

  // Dispatch: update ER:LC name for a unit (from dispatch table)
  socket.on("dispatch:setUnitErlcPlayer", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "dispatch") return;
    const unitId = String(payload?.unit_id || "");
    const name   = payload?.erlc_player_name != null ? String(payload.erlc_player_name).trim() : null;
    if (!unitId) return;
    db.setUnitErlcPlayer(unitId, name || null);
    broadcastState();
  });

  // Dispatch: close incident
  // Unit (command+): edit incident details from MDT
  socket.on("unit:updateIncident", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "unit") return;
    if (!["command", "senior"].includes(u.perms)) return;
    const incidentId = String(payload?.incident_id || "");
    if (!incidentId) return;
    const fields = {};
    if (payload.nature         != null) fields.nature         = String(payload.nature).trim();
    if (payload.priority       != null) fields.priority       = String(payload.priority).trim();
    if (payload.notes          != null) fields.notes          = String(payload.notes);
    if (payload.location_label != null) fields.location_label = String(payload.location_label);
    if (!fields.nature) return;
    fields.updated_by = u.callsign || u.username;
    db.updateIncident(incidentId, fields);
    broadcastState();
  });

  // Unit (senior only): close incident from MDT
  socket.on("unit:closeIncident", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "unit") return;
    if (u.perms !== "senior") return;
    const incidentId = String(payload?.incident_id || "");
    if (!incidentId) return;
    // Auto-AVL all units assigned to this incident
    const assignments = db.getState().assignments.filter(a => a.incident_id === incidentId);
    for (const a of assignments) {
      db.setUnitStatus(a.unit_id, "AVL");
    }
    db.closeIncident(incidentId, u.callsign || u.username);
    broadcastState();
  });

  // Dispatch: close incident + auto-AVL assigned units
  socket.on("dispatch:closeIncident", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "dispatch") return;
    const incidentId = String(payload?.incident_id || "");
    if (!incidentId) return;
    const st = db.getState();
    for (const a of st.assignments.filter(a => a.incident_id === incidentId)) {
      db.setUnitStatus(a.unit_id, "AVL");
    }
    db.closeIncident(incidentId, u.username);
    broadcastState();
  });

  // Dispatch: edit/update an incident
  socket.on("dispatch:updateIncident", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "dispatch") return;
    const incidentId = String(payload?.incident_id || "");
    if (!incidentId) return;
    const fields = {};
    if (payload.nature          != null) fields.nature          = String(payload.nature).trim();
    if (payload.priority        != null) fields.priority        = String(payload.priority).trim();
    if (payload.notes           != null) fields.notes           = String(payload.notes);
    if (payload.location_label  != null) fields.location_label  = String(payload.location_label);
    if (payload.postal_code     != null) fields.postal_code     = String(payload.postal_code);
    if (payload.street_name     != null) fields.street_name     = String(payload.street_name);
    if (!fields.nature) return;
    fields.updated_by = u.username;
    db.updateIncident(incidentId, fields);
    broadcastState();
  });

  // Any user: add a sitrep to an incident
  socket.on("incident:addSitrep", payload => {
    const u = requireSocketAuth(socket);
    if (!u) return;
    const incidentId = String(payload?.incident_id || "");
    const text       = String(payload?.text        || "").trim();
    if (!incidentId || !text) return;
    db.addSitrep(incidentId, { author: u.callsign || u.username, text });
    broadcastState();
  });

  // Dispatch: kick a unit off the MDT
  socket.on("dispatch:kickUnit", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "dispatch") return;
    const unitId = String(payload?.unit_id || "");
    if (!unitId) return;
    // Remove from db immediately so dispatch sees them gone right away
    db.removeUnit(unitId);
    broadcastState();
    // Then boot their socket
    const target = connectedSockets.get(unitId);
    if (target) {
      target.emit("kicked", { reason: "Disconnected by dispatch" });
      const req = target.request;
      if (req?.session) req.session.destroy(() => {});
      setTimeout(() => target.disconnect(true), 300);
    }
  });

  // Dispatch: bulletins
  socket.on("dispatch:addBulletin", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "dispatch") return;
    const text = String(payload?.text || "").trim();
    const title = String(payload?.title || "").trim();
    if (!text) return;
    db.addBulletin({ id: nanoid(8), title: title || null, text, author: u.username, at: Date.now() });
    broadcastState();
  });
  socket.on("dispatch:deleteBulletin", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "dispatch") return;
    db.deleteBulletin(String(payload?.id || ""));
    broadcastState();
  });

  // Dispatch: preplans
  socket.on("dispatch:upsertPreplan", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "dispatch") return;
    const address = String(payload?.address || "").trim();
    if (!address) return;
    db.upsertPreplan({
      id:       payload?.id || nanoid(8),
      address,
      hazards:  String(payload?.hazards  || ""),
      access:   String(payload?.access   || ""),
      water:    String(payload?.water    || ""),
      notes:    String(payload?.notes    || ""),
      author:   u.username,
      updated_at: Date.now()
    });
    broadcastState();
  });
  socket.on("dispatch:deletePreplan", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "dispatch") return;
    db.deletePreplan(String(payload?.id || ""));
    broadcastState();
  });

  // Dispatch: add a custom map pin linked to an incident
  socket.on("dispatch:addMapPin", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "dispatch") return;
    const incident_id = payload?.incident_id ? String(payload.incident_id) : null;
    const x = Number(payload?.location_x);
    const z = Number(payload?.location_z);
    const label = payload?.label != null ? String(payload.label).trim() : "";
    const icon  = payload?.icon  != null ? String(payload.icon).trim()  : "📍";
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    db.addMapPin({
      id: nanoid(8),
      incident_id: incident_id || null,
      location_x: x,
      location_z: z,
      label: label || null,
      icon,
      added_by: u.username,
      added_at: Date.now()
    });
    broadcastState();
  });

  // Dispatch: remove a map pin
  socket.on("dispatch:removeMapPin", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "dispatch") return;
    const pin_id = String(payload?.pin_id || "");
    if (!pin_id) return;
    db.removeMapPin(pin_id);
    broadcastState();
  });

  // Dispatch: send page/tone to all connected clients
  socket.on("dispatch:page", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "dispatch") return;
    io.emit("page", {
      from:        u.username,
      incident_id: payload?.incident_id != null ? String(payload.incident_id) : null,
      message:     String(payload?.message || "Station call"),
      tone:        String(payload?.tone    || "default"),
      at:          Date.now()
    });
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
startErlcPoller();

app.get("/api/erlc/players", requireRole("dispatch"), async (req, res) => {
  const players = await fetchErlcPlayers();
  if (!players) return res.json({ ok: true, players: [], error: "ER:LC API not configured or unavailable" });
  res.json({ ok: true, players });
});

// ── Map image proxy (avoids browser CORS block on PRC map images) ─────────────
const MAP_FILES = {
  fall_postals: "fall_postals.png",
  fall_blank:   "fall_blank.png",
  snow_postals: "snow_postals.png",
  snow_blank:   "snow_blank.png"
};

app.get("/api/map-proxy", async (req, res) => {
  const variant  = String(req.query.variant || "fall_postals");
  const filename = MAP_FILES[variant] || "fall_postals.png";
  const url      = `https://api.policeroleplay.community/maps/${filename}`;
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) return res.status(502).send("Map fetch failed");
    const buf = await upstream.arrayBuffer();
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(502).send("Map proxy error: " + err.message);
  }
});

httpServer.listen(PORT, HOST, () => {
  console.log(`\n🔥 FRNSW CAD/MDT running at http://localhost:${PORT}`);
  console.log(`   Dispatch → http://localhost:${PORT}/dispatch`);
  console.log(`   Unit MDT → http://localhost:${PORT}/mdt\n`);
});
