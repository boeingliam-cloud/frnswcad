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

const AUTH_USERS = [

  // Dispatchers
  { username: "boeingliam",  password: "boe", role: "dispatch" },
  { username: "CSUPT2323",  password: "Thekiller67", role: "dispatch" },
  { username: "dispatch",  password: "dispatch", role: "dispatch" },
  { username: "Addiz",  password: "Lead Dispatcher01", role: "dispatch" },
  

  // Pump crews
  { username: "pump1a",     password: "password",     role: "unit", truck: "PUMP1A",  perms: "truck"   },
  { username: "pump1b",     password: "password",     role: "unit", truck: "PUMP1B",  perms: "truck"   },
  { username: "pump2a",     password: "password",     role: "unit", truck: "PUMP2A",  perms: "truck"   },
  { username: "pump2b",     password: "password",     role: "unit", truck: "PUMP2B",  perms: "truck"   },

  // Recues
  { username: "rescue1",    password: "password",     role: "unit", truck: "RESCUE1", perms: "truck"   },
  { username: "rescue2",    password: "password",     role: "unit", truck: "RESCUE2", perms: "truck"   },

  // Aerials
  { username: "aerial1",    password: "password",     role: "unit", truck: "AERIAL1", perms: "truck"   },
  { username: "aerial2",    password: "password",     role: "unit", truck: "AERIAL2", perms: "truck"   },

  // Special units
  { username: "hazmat1",    password: "password",     role: "unit", truck: "HAZMAT1", perms: "truck"   },
  { username: "hazmat2",    password: "password",     role: "unit", truck: "HAZMAT2", perms: "truck"   },

   // extra units
  { username: "pump3a",     password: "password",     role: "unit", truck: "PUMP3A",  perms: "truck"   },
  { username: "pump3b",     password: "password",     role: "unit", truck: "PUMP3B",  perms: "truck"   },
  { username: "rescue3",    password: "password",     role: "unit", truck: "RESCUE3", perms: "truck"   },
  { username: "aerial3",    password: "password",     role: "unit", truck: "AERIAL3", perms: "truck"   },
  { username: "hazmat3",    password: "password",     role: "unit", truck: "HAZMAT3", perms: "truck"   },


  // Command vehicles
  { username: "cmd1",       password: "password",     role: "unit", truck: "CMD1",    perms: "command" },
  { username: "cmd2",       password: "password",     role: "unit", truck: "CMD2",    perms: "command" },
  { username: "CSUPT2323",       password: "Thekiller67",     role: "unit", truck: "RNZNECOM",    perms: "command" },
  { username: "Addiz-Inspector1",       password: "BoeingLiamisDCOM",     role: "unit", truck: "DC1",    perms: "command" },

  // Senior officers
  { username: "com1",        password: "password",     role: "unit", truck: "COM1",     perms: "senior"  },
  { username: "com2",        password: "password",     role: "unit", truck: "COM2",     perms: "senior"  },
  { username: "teentyson5001",         password: "Teenyissosigma",     role: "unit", truck: "COM3",    perms: "senior"  },
];

// =============================================================================
//  ER:LC / PRC PRIVATE SERVER API KEY
//  Paste your server key from in-game settings below, or set the environment
//  variable ERLC_SERVER_KEY before running.
// =============================================================================
const ERLC_SERVER_KEY = process.env.ERLC_SERVER_KEY || "vwBEaJVSrTkRkQABLMzb-BEdSITaBkyNFGjVrupFcHVumliIwoUiiZrYBIgYK";

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
  const { units, incidents, assignments, mapPins, bulletins, preplans } = db.getState();
  res.json({ ok: true, units, incidents, assignments, mapPins, bulletins, preplans });
});

// ── Socket.IO auth ────────────────────────────────────────────────────────────
io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

function requireSocketAuth(socket) {
  return socket.request?.session?.user || null;
}

function broadcastState() {
  const { units, incidents, assignments, mapPins, bulletins, preplans } = db.getState();
  io.emit("state", { units, incidents, assignments, mapPins, bulletins, preplans });
}

// ── ER:LC API ─────────────────────────────────────────────────────────────────
// Location data is ONLY available via v2/server — v1/players has no coords.
async function fetchErlcPlayers() {
  if (!ERLC_SERVER_KEY || ERLC_SERVER_KEY === "YOUR_SERVER_KEY_HERE") return null;
  try {
    // v2/server with players=true returns Players[].Location with LocationX/Z
    const res = await fetch(`${ERLC_API_BASE}/v2/server?players=true`, {
      headers: {
        "server-key": ERLC_SERVER_KEY,
        "Accept": "application/json"
      }
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After") || 30);
      console.warn(`[ER:LC] Rate limited — waiting ${retryAfter}s`);
      return null;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[ER:LC] API returned ${res.status}: ${body}`);
      return null;
    }

    const data = await res.json();

    // v2/server response: { Players: [ { Player, Callsign, Team, Permission, WantedStars, Location: { LocationX, LocationZ, PostalCode, StreetName, BuildingNumber } } ] }
    const players = data?.Players ?? data?.players;
    if (Array.isArray(players)) return players;

    console.warn("[ER:LC] Unexpected v2 response shape:", JSON.stringify(data).slice(0, 200));
    return null;
  } catch (err) {
    console.warn("[ER:LC] fetch error:", err.message);
    return null;
  }
}

function normalise(name) {
  return String(name ?? "").trim().toLowerCase();
}

function applyErlcLocationsToUnits(players) {
  if (!Array.isArray(players)) return;
  const { units } = db.getState();
  let changed = false;

  for (const unit of units) {
    const matchName = unit.erlc_player_name ? normalise(unit.erlc_player_name) : null;
    if (!matchName) continue;

    const player = players.find(p => {
      // v2 format: "Player": "Username:UserId"
      const playerStr = String(p.Player ?? p.Username ?? p.Name ?? "");
      const username = playerStr.includes(":") ? playerStr.split(":")[0] : playerStr;
      const u = normalise(username);
      const c = normalise(p.Callsign ?? "");
      return u === matchName || c === matchName;
    });

    if (!player) continue;

    // v2 Location object: { LocationX, LocationZ, PostalCode, StreetName, BuildingNumber }
    const loc = player.Location;
    if (!loc) {
      console.warn(`[ER:LC] Player matched but has no Location data — server may not support v2 locations`);
      continue;
    }

    const x = Number(loc.LocationX);
    const z = Number(loc.LocationZ);

    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;

    db.setUnitLocation(unit.id, {
      location_x:      x,
      location_z:      z,
      postal_code:     loc.PostalCode     ?? null,
      street_name:     loc.StreetName     ?? null,
      building_number: loc.BuildingNumber ?? null,
    });
    changed = true;
    console.log(`[ER:LC] ${unit.callsign} → X:${x.toFixed(1)} Z:${z.toFixed(1)} (${loc.StreetName ?? "?"})`);
  }

  if (changed) broadcastState();
}

function startErlcPoller() {
  if (!ERLC_SERVER_KEY || ERLC_SERVER_KEY === "YOUR_SERVER_KEY_HERE") {
    console.log("  ER:LC poller disabled — set ERLC_SERVER_KEY env var or hardcode key in server.js");
    return;
  }
  console.log("  ER:LC poller starting...");
  const poll = async () => {
    const players = await fetchErlcPlayers();
    if (players === null) return; // error already logged in fetchErlcPlayers
    if (players.length === 0) {
      console.log("[ER:LC] No players in server");
      return;
    }
    console.log(`[ER:LC] ${players.length} player(s) online — updating locations`);
    applyErlcLocationsToUnits(players);
  };
  poll();
  setInterval(poll, ERLC_POLL_MS);
  console.log(`  ER:LC location poller active — polling every ${ERLC_POLL_MS / 1000}s`);
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
    const VALID_STATUSES = ["AVAIL","UNAVAIL","RESPOND","ONSCENE","MOBILE","EMR"];
    if (!VALID_STATUSES.includes(status)) return;
    db.setUnitStatus(`unit-${u.username}`, status);
    broadcastState();
  });

  // Dispatch: override a unit's status
  socket.on("dispatch:setUnitStatus", payload => {
    const u = requireSocketAuth(socket);
    if (!u || u.role !== "dispatch") return;
    const unitId = String(payload?.unit_id || "");
    const status = String(payload?.status || "").toUpperCase();
    const VALID_STATUSES = ["AVAIL","UNAVAIL","RESPOND","ONSCENE","MOBILE","EMR"];
    if (!unitId || !VALID_STATUSES.includes(status)) return;
    db.setUnitStatus(unitId, status);
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
      db.setUnitStatus(a.unit_id, "AVAIL");
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
      db.setUnitStatus(a.unit_id, "AVAIL");
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
  if (!players) return res.json({ ok: false, players: [], error: "ER:LC API unavailable or key invalid" });
  res.json({ ok: true, count: players.length, players });
});

// Debug: see raw ER:LC response + which units matched
app.get("/api/erlc/debug", requireRole("dispatch"), async (req, res) => {
  const players = await fetchErlcPlayers();
  if (!players) return res.json({ ok: false, error: "ER:LC API unavailable — check key and server status" });
  const { units } = db.getState();
  const matches = units.map(u => {
    const matchName = u.erlc_player_name ? String(u.erlc_player_name).trim().toLowerCase() : null;
    const matched = matchName ? players.find(p => {
      const playerStr = String(p.Player ?? p.Username ?? "");
      const username = playerStr.includes(":") ? playerStr.split(":")[0] : playerStr;
      return username.toLowerCase() === matchName;
    }) : null;
    return { unit: u.callsign, erlc_player_name: u.erlc_player_name, matched: !!matched, position: matched?.Position ?? null };
  });
  res.json({ ok: true, player_count: players.length, units_checked: matches, raw_sample: players.slice(0, 3) });
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
