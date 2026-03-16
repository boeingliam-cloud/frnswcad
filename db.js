import fs from "node:fs";
import path from "node:path";

function defaultState() {
  const now = Date.now();
  return {
    users: [
      { id: "seed-dispatch", username: "dispatch", pin: "0000", role: "dispatch", created_at: now },
      { id: "seed-unit",     username: "unit1",    pin: "0000", role: "unit",     created_at: now },
    ],
    units:           [],
    incidents:       [],
    assignments:     [],
    mapPins:         [],
    bulletins:       [],
    preplans:        [],
    incidentCounter: 0,
  };
}

function sortBy(arr, key) {
  return [...arr].sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")));
}

export function openDb(dbPath) {
  const filePath = path.resolve(dbPath);
  const dir      = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let state;
  try {
    state = fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath, "utf8"))
      : defaultState();
  } catch {
    state = defaultState();
  }
  // Ensure all top-level arrays exist (safe migration for older JSON files)
  state.mapPins         ??= [];
  state.bulletins       ??= [];
  state.preplans        ??= [];
  state.incidentCounter ??= 0;

  function save() {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
  }

  // Write initial file if it didn't exist
  if (!fs.existsSync(filePath)) save();

  return {
    // ── Users ──────────────────────────────────────────────────────────────────
    findUser(username, pin, role) {
      return state.users.find(u => u.username === username && u.pin === pin && u.role === role) ?? null;
    },

    // ── Units ──────────────────────────────────────────────────────────────────
    upsertUnit({ id, callsign }) {
      const now      = Date.now();
      const existing = state.units.find(u => u.id === id);
      if (!existing) {
        state.units.push({ id, callsign, status: "AVAIL", created_at: now, last_update: now });
      } else {
        existing.callsign = callsign;
      }
      save();
    },

    removeUnit(id) {
      state.units       = state.units.filter(u => u.id !== id);
      state.assignments = state.assignments.filter(a => a.unit_id !== id);
      save();
    },

    setUnitErlcPlayer(id, erlc_player_name) {
      const u = state.units.find(x => x.id === id);
      if (!u) return;
      u.erlc_player_name = erlc_player_name != null ? String(erlc_player_name).trim() || null : null;
      save();
    },

    setUnitStatus(id, status) {
      const u = state.units.find(x => x.id === id);
      if (!u) return;
      u.status      = status;
      u.last_update = Date.now();
      save();
    },

    setUnitLocation(id, loc) {
      const u = state.units.find(x => x.id === id);
      if (!u) return;
      u.location_x      = loc.location_x;
      u.location_z      = loc.location_z;
      u.postal_code     = loc.postal_code     ?? null;
      u.street_name     = loc.street_name     ?? null;
      u.building_number = loc.building_number ?? null;
      u.last_update     = Date.now();
      save();
    },

    // ── Incidents ──────────────────────────────────────────────────────────────
    nextIncidentId(priority) {
      state.incidentCounter = (state.incidentCounter || 0) + 1;
      const num = String(state.incidentCounter).padStart(3, "0");
      const pri = String(priority || "P2").replace(/[^123]/g, "2").replace("P", "");
      save();
      return `P${pri}-${num}`;
    },

    insertIncident(inc) {
      state.incidents.push(inc);
      save();
    },

    updateIncident(incident_id, fields) {
      const inc = state.incidents.find(i => i.id === incident_id);
      if (!inc) return false;
      // location_x and location_z are intentionally included so dispatch can
      // pin an incident on the map, which the MDT uses for the route panel.
      const ALLOWED = [
        "nature", "priority", "notes",
        "location_label", "postal_code", "street_name",
        "location_x", "location_z",
        "updated_by",
      ];
      for (const k of ALLOWED) {
        if (fields[k] !== undefined) inc[k] = fields[k];
      }
      inc.updated_at = Date.now();
      save();
      return true;
    },

    closeIncident(incident_id, closed_by) {
      const inc = state.incidents.find(i => i.id === incident_id);
      if (!inc) return;
      inc.status    = "CLOSED";
      inc.closed_at = Date.now();
      if (closed_by) inc.closed_by = closed_by;
      save();
    },

    addSitrep(incident_id, sitrep) {
      const inc = state.incidents.find(i => i.id === incident_id);
      if (!inc) return false;
      if (!Array.isArray(inc.sitreps)) inc.sitreps = [];
      inc.sitreps.push({ author: sitrep.author, text: sitrep.text, at: Date.now() });
      save();
      return true;
    },

    // ── Assignments ────────────────────────────────────────────────────────────
    assignUnit(incident_id, unit_id) {
      const exists = state.assignments.find(a => a.incident_id === incident_id && a.unit_id === unit_id);
      if (!exists) state.assignments.push({ incident_id, unit_id, assigned_at: Date.now() });
      save();
    },

    unassignUnit(incident_id, unit_id) {
      state.assignments = state.assignments.filter(
        a => !(a.incident_id === incident_id && a.unit_id === unit_id)
      );
      save();
    },

    // ── Map pins ───────────────────────────────────────────────────────────────
    addMapPin(pin) {
      state.mapPins.push(pin);
      save();
    },

    removeMapPin(pin_id) {
      state.mapPins = state.mapPins.filter(p => p.id !== pin_id);
      save();
    },

    clearIncidentPins(incident_id) {
      state.mapPins = state.mapPins.filter(p => p.incident_id !== incident_id);
      save();
    },

    // ── Bulletins ──────────────────────────────────────────────────────────────
    addBulletin(b) {
      state.bulletins.unshift(b);
      save();
    },

    deleteBulletin(id) {
      state.bulletins = state.bulletins.filter(b => b.id !== id);
      save();
    },

    // ── Pre-plans ──────────────────────────────────────────────────────────────
    upsertPreplan(p) {
      const idx = state.preplans.findIndex(x => x.id === p.id);
      if (idx >= 0) state.preplans[idx] = p;
      else state.preplans.push(p);
      save();
    },

    deletePreplan(id) {
      state.preplans = state.preplans.filter(p => p.id !== id);
      save();
    },

    // ── Full state snapshot ────────────────────────────────────────────────────
    getState() {
      return {
        units:       sortBy(state.units, "callsign"),
        incidents:   [...state.incidents]
          .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
          .slice(0, 50),
        assignments: [...state.assignments],
        mapPins:     [...state.mapPins],
        bulletins:   [...state.bulletins],
        preplans:    [...state.preplans],
      };
    },
  };
}
