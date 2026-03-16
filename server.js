import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { nanoid } from "nanoid";
import { openDb } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PORT            = Number(process.env.PORT            || 5177);
const HOST            = process.env.HOST                   || "0.0.0.0";
const SESSION_SECRET  = process.env.SESSION_SECRET         || "dev-secret-change-me";
const DB_PATH         = process.env.DB_PATH                || path.join(__dirname, "cad-mdt.json");
const ERLC_API_BASE   = (process.env.ERLC_API_BASE         || "https://api.policeroleplay.community").replace(/\/$/, "");
const ERLC_POLL_MS    = Number(process.env.ERLC_POLL_MS    || 15000);
const ERLC_SERVER_KEY = process.env.ERLC_SERVER_KEY        || "vwBEaJVSrTkRkQABLMzb-BEdSITaBkyNFGjVrupFcHVumliIwoUiiZrYBIgYK";

// =============================================================================
//  User accounts
//  - A username may exist as both "dispatch" and "unit" (different roles).
//  - AUTH_USERS.find() matches on (username + password + role) so there is
//    never any ambiguity.
//  - Duplicate identical rows have been removed.
// =============================================================================
const AUTH_USERS = [
  // ── Dispatchers ─────────────────────────────────────────────────────────────
  { username: "boeingliam",      password: "boe",               role: "dispatch" },
  { username: "CSUPT2323",       password: "Thekiller67",       role: "dispatch" },
  { username: "dispatch",        password: "dispatch",          role: "dispatch" },
  { username: "Addiz2",          password: "Lead Dispatcher01", role: "dispatch" },
  { username: "Alwayswishing77", password: "lovesboeingsdad",   role: "dispatch" },
  { username: "teentyson5001",   password: "Teenyissosigma",    role: "dispatch" },

  // ── Pump crews ───────────────────────────────────────────────────────────────
  { username: "pump1a", password: "password", role: "unit", truck: "PUMP1A", perms: "truck" },
  { username: "pump1b", password: "password", role: "unit", truck: "PUMP1B", perms: "truck" },
  { username: "pump2a", password: "password", role: "unit", truck: "PUMP2A", perms: "truck" },
  { username: "pump2b", password: "password", role: "unit", truck: "PUMP2B", perms: "truck" },
  { username: "pump3a", password: "password", role: "unit", truck: "PUMP3A", perms: "truck" },
  { username: "pump3b", password: "password", role: "unit", truck: "PUMP3B", perms: "truck" },

  // ── Rescues ──────────────────────────────────────────────────────────────────
  { username: "rescue1", password: "password", role: "unit", truck: "RESCUE1", perms: "truck" },
  { username: "rescue2", password: "password", role: "unit", truck: "RESCUE2", perms: "truck" },
  { username: "rescue3", password: "password", role: "unit", truck: "RESCUE3", perms: "truck" },

  // ── Aerials ───────────────────────────────────────────────────────────────────
  { username: "aerial1", password: "password", role: "unit", truck: "AERIAL1", perms: "truck" },
  { username: "aerial2", password: "password", role: "unit", truck: "AERIAL2", perms: "truck" },
  { username: "aerial3", password: "password", role: "unit", truck: "AERIAL3", perms: "truck" },

  // ── HazMat ────────────────────────────────────────────────────────────────────
  { username: "hazmat1", password: "password", role: "unit", truck: "HAZMAT1", perms: "truck" },
  { username: "hazmat2", password: "password", role: "unit", truck: "HAZMAT2", perms: "truck" },
  { username: "hazmat3", password: "password", role: "unit", truck: "HAZMAT3", perms: "truck" },

  // ── Command ───────────────────────────────────────────────────────────────────
  { username: "cmd1",             password: "password",         role: "unit", truck: "CMD1",     perms: "command" },
  { username: "cmd2",             password: "password",         role: "unit", truck: "CMD2",     perms: "command" },
  { username: "CSUPT2323",        password: "Thekiller67",      role: "unit", truck: "RNZNECOM", perms: "command" },
  { username: "Addiz-Inspector1", password: "BoeingLiamisDCOM", role: "unit", truck: "DC1",      perms: "command" },

  // ── Senior Officers ───────────────────────────────────────────────────────────
  { username: "vtremam",       password: "password",       role: "unit", truck: "COM1", perms: "senior" },
  { username: "boeingliam",    password: "boe",            role: "unit", truck: "COM2", perms: "senior" },
  { username: "teentyson5001", password: "Teenyissosigma", role: "unit", truck: "COM3", perms: "senior" },
];

// =============================================================================
//  Server setup
// =============================================================================
const app        = express();
const httpServer = createServer(app);
const io         = new SocketIOServer(httpServer);
const db         = openDb(DB_PATH);

const sessionMiddleware = session({
  secret:            SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie:            { sameSite: "lax" },
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
    if (!req.session?.user)             return res.redirect("/index.html");
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
    return res.status(400).json({ ok: false, error: "Invalid role" });

  const user = AUTH_USERS.find(
    u => u.username === username && u.password === password && u.role === asRole
  );
  if (!user) return res.status(401).json({ ok: false, error: "Invalid username or password" });

  const displayCallsign = asRole === "unit"
    ? (user.truck || callsign || username.toUpperCase())
    : undefined;

  req.session.user = {
    id:       `user-${username}`,
    username,
    role:     asRole,
    truck:    user.truck || null,
    perms:    asRole === "unit" ? (user.perms || "truck") : "dispatch",
    callsign: displayCallsign,
  };

  if (asRole === "unit") {
    const unitId = `unit-${username}`;
    db.upsertUnit({ id: unitId, callsign: displayCallsign });
    // Auto-bind ER:LC name and pull location immediately on login
    if (ERLC_SERVER_KEY) {
      db.setUnitErlcPlayer(unitId, username);
      fetchErlcPlayers()
        .then(players => { if (players?.length) applyErlcLocationsToUnits(players); })
        .catch(() => {});
    }
  }

  res.json({ ok: true, role: asRole });
});

app.post("/api/logout", (req, res) => {
  req.session?.destroy(() => res.json({ ok: true }));
});

// ── Page routes ───────────────────────────────────────────────────────────────
app.get("/dispatch", requireRole("dispatch"), (_req, res) => res.redirect("/dispatch.html"));
app.get("/mdt",      requireRole("unit"),     (_req, res) => res.redirect("/mdt.html"));
app.get("/whoami",   requireAuth,             (req,  res) => res.json({ ok: true, user: req.session.user }));

app.get("/api/state", requireAuth, (_req, res) => {
  res.json({ ok: true, ...db.getState() });
});

// ── Socket.IO auth ────────────────────────────────────────────────────────────
io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

function socketUser(socket) {
  return socket.request?.session?.user ?? null;
}

function broadcastState() {
  io.emit("state", db.getState());
}

// =============================================================================
//  ER:LC / PRC API  (v2/server — no query params needed)
// =============================================================================
async function fetchErlcPlayers() {
  if (!ERLC_SERVER_KEY) return null;
  try {
    const res = await fetch(`${ERLC_API_BASE}/v2/server`, {
      headers: { "server-key": ERLC_SERVER_KEY, Accept: "application/json" },
    });

    if (res.status === 429) {
      const wait = Number(res.headers.get("Retry-After") || 30);
      console.warn(`[ER:LC] Rate limited — retry in ${wait}s`);
      return null;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[ER:LC] HTTP ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const data    = await res.json();
    // v2 may use Players, players, Members, or members
    const players = data?.Players ?? data?.players ?? data?.Members ?? data?.members;

    if (!Array.isArray(players)) {
      console.warn("[ER:LC] Unexpected response. Keys:", Object.keys(data).join(", "));
      return null;
    }
    if (players.length > 0) {
      console.log(`[ER:LC] ${players.length} player(s). Keys: ${Object.keys(players[0]).join(", ")}`);
    }
    return players;
  } catch (err) {
    console.warn("[ER:LC] fetch error:", err.message);
    return null;
  }
}

function norm(s) { return String(s ?? "").trim().toLowerCase(); }

function applyErlcLocationsToUnits(players) {
  const { units } = db.getState();
  let changed = false;

  for (const unit of units) {
    if (!unit.erlc_player_name) continue;
    const target = norm(unit.erlc_player_name);

    const player = players.find(p => {
      // v2 Player field: "RobloxUsername:RobloxUserId"
      const raw      = String(p.Player ?? p.Username ?? p.Name ?? "");
      const username = raw.includes(":") ? raw.split(":")[0] : raw;
      return norm(username) === target || norm(p.Callsign ?? "") === target;
    });

    if (!player) {
      console.log(`[ER:LC] No match for ${unit.callsign} (looking for: "${target}")`);
      continue;
    }

    // Location may be nested under player.Location or flat on the player object
    const loc = player.Location ?? player.location ?? {};
    const x   = Number(loc.LocationX ?? loc.locationX ?? loc.X ?? player.X);
    const z   = Number(loc.LocationZ ?? loc.locationZ ?? loc.Z ?? player.Z);

    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      console.warn(`[ER:LC] ${unit.callsign} matched but coords invalid:`, JSON.stringify(loc).slice(0, 120));
      continue;
    }

    db.setUnitLocation(unit.id, {
      location_x:      x,
      location_z:      z,
      postal_code:     loc.PostalCode     ?? loc.postalCode     ?? null,
      street_name:     loc.StreetName     ?? loc.streetName     ?? null,
      building_number: loc.BuildingNumber ?? loc.buildingNumber ?? null,
    });
    changed = true;
    console.log(`[ER:LC] ✓ ${unit.callsign} → X:${x.toFixed(1)} Z:${z.toFixed(1)} (${loc.StreetName ?? "?"})`);
  }

  if (changed) broadcastState();
}

function startErlcPoller() {
  if (!ERLC_SERVER_KEY) {
    console.log("  ER:LC poller disabled — set ERLC_SERVER_KEY");
    return;
  }
  const poll = async () => {
    const players = await fetchErlcPlayers();
    if (!players) return;
    if (players.length === 0) { console.log("[ER:LC] Server is empty"); return; }
    applyErlcLocationsToUnits(players);
  };
  poll();
  setInterval(poll, ERLC_POLL_MS);
  console.log(`  ER:LC poller active — every ${ERLC_POLL_MS / 1000}s`);
}

// =============================================================================
//  Socket events
// =============================================================================
const connectedSockets = new Map(); // unitId → socket

io.on("connection", socket => {
  const user = socketUser(socket);
  if (!user) { socket.disconnect(true); return; }

  if (user.role === "unit") {
    const uid = `unit-${user.username}`;
    connectedSockets.set(uid, socket);
    socket.on("disconnect", () => {
      connectedSockets.delete(uid);
      db.removeUnit(uid);
      broadcastState();
    });
  }

  socket.emit("hello", { user });

  // ── Unit: change own status ───────────────────────────────────────────────────
  socket.on("unit:setStatus", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "unit") return;
    const VALID = ["AVAIL","UNAVAIL","RESPOND","ONSCENE","MOBILE","EMR"];
    const status = String(payload?.status || "").toUpperCase();
    if (!VALID.includes(status)) return;
    db.setUnitStatus(`unit-${u.username}`, status);
    broadcastState();
    // ── Duress alert ─────────────────────────────────────────────────────────
    // When a unit activates EMR, send a dedicated event so dispatch can play
    // a distinct alarm tone and show a persistent alert — separate from the
    // normal state broadcast so it fires exactly once on the transition.
    if (status === "EMR") {
      const unitId   = `unit-${u.username}`;
      const { units } = db.getState();
      const unit     = units.find(x => x.id === unitId);
      io.emit("unit:duress", {
        unit_id:  unitId,
        callsign: unit?.callsign || u.username.toUpperCase(),
        at:       Date.now(),
      });
      console.log(`[DURESS] ⚠ ${unit?.callsign || u.username} activated EMR`);
    }
  });

  // ── Unit: manual location push ────────────────────────────────────────────────
  socket.on("unit:updateLocation", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "unit") return;
    const x = Number(payload?.location_x);
    const z = Number(payload?.location_z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    db.setUnitLocation(`unit-${u.username}`, {
      location_x:      x,
      location_z:      z,
      postal_code:     payload?.postal_code     != null ? String(payload.postal_code)     : null,
      street_name:     payload?.street_name     != null ? String(payload.street_name)     : null,
      building_number: payload?.building_number != null ? String(payload.building_number) : null,
    });
    broadcastState();
  });

  // ── Unit: set ER:LC player name (pulls location immediately) ──────────────────
  socket.on("unit:setErlcPlayer", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "unit") return;
    const name = payload?.erlc_player_name != null ? String(payload.erlc_player_name).trim() || null : null;
    db.setUnitErlcPlayer(`unit-${u.username}`, name);
    if (name) {
      fetchErlcPlayers()
        .then(p => { if (p?.length) applyErlcLocationsToUnits(p); })
        .catch(() => {});
    }
    broadcastState();
  });

  // ── Unit (command+): edit incident ────────────────────────────────────────────
  socket.on("unit:updateIncident", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "unit" || !["command","senior"].includes(u.perms)) return;
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

  // ── Unit (senior only): close incident ────────────────────────────────────────
  socket.on("unit:closeIncident", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "unit" || u.perms !== "senior") return;
    const incidentId = String(payload?.incident_id || "");
    if (!incidentId) return;
    db.getState().assignments
      .filter(a => a.incident_id === incidentId)
      .forEach(a => db.setUnitStatus(a.unit_id, "AVAIL"));
    db.closeIncident(incidentId, u.callsign || u.username);
    broadcastState();
  });

  // ── Any authenticated user: add sitrep ────────────────────────────────────────
  socket.on("incident:addSitrep", payload => {
    const u = socketUser(socket);
    if (!u) return;
    const incidentId = String(payload?.incident_id || "");
    const text       = String(payload?.text        || "").trim();
    if (!incidentId || !text) return;
    db.addSitrep(incidentId, { author: u.callsign || u.username, text });
    broadcastState();
  });

  // ── Dispatch: override unit status ────────────────────────────────────────────
  socket.on("dispatch:setUnitStatus", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "dispatch") return;
    const VALID = ["AVAIL","UNAVAIL","RESPOND","ONSCENE","MOBILE","EMR"];
    const unitId = String(payload?.unit_id || "");
    const status = String(payload?.status  || "").toUpperCase();
    if (!unitId || !VALID.includes(status)) return;
    db.setUnitStatus(unitId, status);
    broadcastState();
  });

  // ── Dispatch: set ER:LC name for a unit ───────────────────────────────────────
  socket.on("dispatch:setUnitErlcPlayer", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "dispatch") return;
    const unitId = String(payload?.unit_id || "");
    const name   = payload?.erlc_player_name != null ? String(payload.erlc_player_name).trim() || null : null;
    if (!unitId) return;
    db.setUnitErlcPlayer(unitId, name);
    broadcastState();
  });

  // ── Dispatch: create incident ─────────────────────────────────────────────────
  socket.on("dispatch:createIncident", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "dispatch") return;
    const nature = String(payload?.nature || "").trim();
    if (!nature) return;
    const priority = String(payload?.priority || "P2").trim();
    const lx = payload?.location_x != null ? Number(payload.location_x) : null;
    const lz = payload?.location_z != null ? Number(payload.location_z) : null;
    db.insertIncident({
      id:              db.nextIncidentId(priority),
      created_by:      u.username,
      created_at:      Date.now(),
      status:          "OPEN",
      nature,
      priority,
      notes:           payload?.notes           != null ? String(payload.notes)           : null,
      location_label:  payload?.location_label  != null ? String(payload.location_label)  : null,
      location_x:      Number.isFinite(lx) ? lx : null,
      location_z:      Number.isFinite(lz) ? lz : null,
      postal_code:     payload?.postal_code     != null ? String(payload.postal_code)     : null,
      street_name:     payload?.street_name     != null ? String(payload.street_name)     : null,
      building_number: payload?.building_number != null ? String(payload.building_number) : null,
    });
    broadcastState();
  });

  // ── Dispatch: assign / unassign unit ──────────────────────────────────────────
  socket.on("dispatch:assignUnit", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "dispatch") return;
    const incidentId = String(payload?.incident_id || "");
    const unitId     = String(payload?.unit_id     || "");
    if (!incidentId || !unitId) return;
    db.assignUnit(incidentId, unitId);
    broadcastState();
  });

  socket.on("dispatch:unassignUnit", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "dispatch") return;
    const incidentId = String(payload?.incident_id || "");
    const unitId     = String(payload?.unit_id     || "");
    if (!incidentId || !unitId) return;
    db.unassignUnit(incidentId, unitId);
    broadcastState();
  });

  // ── Dispatch: close incident ───────────────────────────────────────────────────
  socket.on("dispatch:closeIncident", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "dispatch") return;
    const incidentId = String(payload?.incident_id || "");
    if (!incidentId) return;
    db.getState().assignments
      .filter(a => a.incident_id === incidentId)
      .forEach(a => db.setUnitStatus(a.unit_id, "AVAIL"));
    db.closeIncident(incidentId, u.username);
    broadcastState();
  });

  // ── Dispatch: edit incident ────────────────────────────────────────────────────
  socket.on("dispatch:updateIncident", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "dispatch") return;
    const incidentId = String(payload?.incident_id || "");
    if (!incidentId) return;
    const fields = {};
    if (payload.nature         != null) fields.nature         = String(payload.nature).trim();
    if (payload.priority       != null) fields.priority       = String(payload.priority).trim();
    if (payload.notes          != null) fields.notes          = String(payload.notes);
    if (payload.location_label != null) fields.location_label = String(payload.location_label);
    if (payload.postal_code    != null) fields.postal_code    = String(payload.postal_code);
    if (payload.street_name    != null) fields.street_name    = String(payload.street_name);
    if (payload.location_x     != null) { const v = Number(payload.location_x); if (Number.isFinite(v)) fields.location_x = v; }
    if (payload.location_z     != null) { const v = Number(payload.location_z); if (Number.isFinite(v)) fields.location_z = v; }
    if (!fields.nature) return;
    fields.updated_by = u.username;
    db.updateIncident(incidentId, fields);
    broadcastState();
  });

  // ── Dispatch: set incident map location by clicking the map ───────────────────
  socket.on("dispatch:setIncidentLocation", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "dispatch") return;
    const incidentId = String(payload?.incident_id || "");
    if (!incidentId) return;
    const x = Number(payload?.location_x);
    const z = Number(payload?.location_z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    db.updateIncident(incidentId, { location_x: x, location_z: z, updated_by: u.username });
    broadcastState();
  });

  // ── Dispatch: kick unit ────────────────────────────────────────────────────────
  socket.on("dispatch:kickUnit", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "dispatch") return;
    const unitId = String(payload?.unit_id || "");
    if (!unitId) return;
    db.removeUnit(unitId);
    broadcastState();
    const target = connectedSockets.get(unitId);
    if (target) {
      target.emit("kicked", { reason: "Disconnected by dispatch" });
      target.request?.session?.destroy?.(() => {});
      setTimeout(() => target.disconnect(true), 300);
    }
  });

  // ── Dispatch: bulletins ────────────────────────────────────────────────────────
  socket.on("dispatch:addBulletin", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "dispatch") return;
    const text  = String(payload?.text  || "").trim();
    const title = String(payload?.title || "").trim();
    if (!text) return;
    db.addBulletin({ id: nanoid(8), title: title || null, text, author: u.username, at: Date.now() });
    broadcastState();
  });

  socket.on("dispatch:deleteBulletin", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "dispatch") return;
    db.deleteBulletin(String(payload?.id || ""));
    broadcastState();
  });

  // ── Dispatch: pre-plans ────────────────────────────────────────────────────────
  socket.on("dispatch:upsertPreplan", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "dispatch") return;
    const address = String(payload?.address || "").trim();
    if (!address) return;
    db.upsertPreplan({
      id:         payload?.id || nanoid(8),
      address,
      hazards:    String(payload?.hazards || ""),
      access:     String(payload?.access  || ""),
      water:      String(payload?.water   || ""),
      notes:      String(payload?.notes   || ""),
      author:     u.username,
      updated_at: Date.now(),
    });
    broadcastState();
  });

  socket.on("dispatch:deletePreplan", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "dispatch") return;
    db.deletePreplan(String(payload?.id || ""));
    broadcastState();
  });

  // ── Dispatch: add map pin ──────────────────────────────────────────────────────
  socket.on("dispatch:addMapPin", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "dispatch") return;
    const x = Number(payload?.location_x);
    const z = Number(payload?.location_z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    db.addMapPin({
      id:          nanoid(8),
      incident_id: payload?.incident_id ? String(payload.incident_id) : null,
      location_x:  x,
      location_z:  z,
      label:       payload?.label != null ? String(payload.label).trim() || null : null,
      icon:        payload?.icon  != null ? String(payload.icon).trim()  || "📍" : "📍",
      added_by:    u.username,
      added_at:    Date.now(),
    });
    broadcastState();
  });

  // ── Dispatch: remove map pin ───────────────────────────────────────────────────
  socket.on("dispatch:removeMapPin", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "dispatch") return;
    const pin_id = String(payload?.pin_id || "");
    if (!pin_id) return;
    db.removeMapPin(pin_id);
    broadcastState();
  });

  // ── Dispatch: page / tone ──────────────────────────────────────────────────────
  socket.on("dispatch:page", payload => {
    const u = socketUser(socket);
    if (!u || u.role !== "dispatch") return;
    io.emit("page", {
      from:        u.username,
      incident_id: payload?.incident_id != null ? String(payload.incident_id) : null,
      message:     String(payload?.message || "Station call"),
      tone:        String(payload?.tone    || "default"),
      at:          Date.now(),
    });
  });
});

// =============================================================================
//  REST utility endpoints
// =============================================================================

// Raw player list — useful for checking what the API returns
app.get("/api/erlc/players", requireRole("dispatch"), async (_req, res) => {
  const players = await fetchErlcPlayers();
  if (!players) return res.json({ ok: false, players: [], error: "ER:LC API unavailable or key invalid" });
  res.json({ ok: true, count: players.length, players });
});

// Match report — shows which units matched which ER:LC players
app.get("/api/erlc/debug", requireRole("dispatch"), async (_req, res) => {
  const players = await fetchErlcPlayers();
  if (!players) return res.json({ ok: false, error: "ER:LC API unavailable" });
  const { units } = db.getState();
  const report = units.map(u => {
    const target  = u.erlc_player_name ? norm(u.erlc_player_name) : null;
    const matched = target ? players.find(p => {
      const raw      = String(p.Player ?? p.Username ?? "");
      const username = raw.includes(":") ? raw.split(":")[0] : raw;
      return norm(username) === target || norm(p.Callsign ?? "") === target;
    }) : null;
    return { unit: u.callsign, erlc_player_name: u.erlc_player_name, matched: !!matched, location: matched?.Location ?? null };
  });
  res.json({ ok: true, player_count: players.length, units: report, raw_sample: players.slice(0, 5) });
});

// ── Map image proxy (avoids CORS on PRC map CDN) ──────────────────────────────
const MAP_FILES = {
  fall_postals: "fall_postals.png",
  fall_blank:   "fall_blank.png",
  snow_postals: "snow_postals.png",
  snow_blank:   "snow_blank.png",
};

app.get("/api/map-proxy", async (req, res) => {
  const variant  = String(req.query.variant || "fall_postals");
  const filename = MAP_FILES[variant] || "fall_postals.png";
  try {
    const upstream = await fetch(`https://api.policeroleplay.community/maps/${filename}`);
    if (!upstream.ok) return res.status(502).send("Map fetch failed");
    const buf = await upstream.arrayBuffer();
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(502).send("Map proxy error: " + err.message);
  }
});

// =============================================================================
//  Start
// =============================================================================
startErlcPoller();

httpServer.listen(PORT, HOST, () => {
  console.log(`\n🔥 FRNSW CAD/MDT  →  http://localhost:${PORT}`);
  console.log(`   Dispatch        →  http://localhost:${PORT}/dispatch`);
  console.log(`   Unit MDT        →  http://localhost:${PORT}/mdt\n`);
});
