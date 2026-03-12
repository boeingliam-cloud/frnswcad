import fs from "node:fs";
import path from "node:path";

function defaultState() {
  const now = Date.now();
  return {
    users: [
      { id: "seed-dispatch", username: "dispatch", pin: "0000", role: "dispatch", created_at: now },
      { id: "seed-unit", username: "unit1", pin: "0000", role: "unit", created_at: now }
    ],
    units: [],
    incidents: [],
    assignments: [],
    mapPins: [],
    bulletins: [],
    preplans: [],
    incidentCounter: 0
  };
}

function sortBy(a, key) {
  return [...a].sort((x, y) => String(x[key] ?? "").localeCompare(String(y[key] ?? "")));
}

export function openDb(dbPath) {
  const filePath = path.resolve(dbPath);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let state;
  try {
    if (fs.existsSync(filePath)) {
      state = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } else {
      state = defaultState();
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
    }
  } catch {
    state = defaultState();
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
  }

  function save() {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
  }

  const api = {
    // users
    findUser(username, pin, role) {
      return state.users.find(
        (u) => u.username === username && u.pin === pin && u.role === role
      ) || null;
    },

    // units
    upsertUnit({ id, callsign }) {
      const now = Date.now();
      const existing = state.units.find((u) => u.id === id);
      if (!existing) {
        state.units.push({ id, callsign, status: "AVAILABLE", created_at: now, last_update: now });
      } else {
        existing.callsign = callsign;
      }
      save();
    },
    removeUnit(id) {
      state.units = state.units.filter(u => u.id !== id);
      state.assignments = state.assignments.filter(a => a.unit_id !== id);
      save();
    },
    setUnitErlcPlayer(id, erlc_player_name) {
      const u = state.units.find((x) => x.id === id);
      if (!u) return;
      u.erlc_player_name = erlc_player_name != null ? String(erlc_player_name).trim() || null : null;
      save();
    },
    setUnitStatus(id, status) {
      const u = state.units.find((x) => x.id === id);
      if (!u) return;
      u.status = status;
      u.last_update = Date.now();
      save();
    },
    setUnitLocation(id, loc) {
      const u = state.units.find((x) => x.id === id);
      if (!u) return;
      u.location_x = loc.location_x;
      u.location_z = loc.location_z;
      u.postal_code = loc.postal_code ?? null;
      u.street_name = loc.street_name ?? null;
      u.building_number = loc.building_number ?? null;
      u.last_update = Date.now();
      save();
    },

    // incidents
    nextIncidentId(priority) {
      if (!state.incidentCounter) state.incidentCounter = 0;
      state.incidentCounter += 1;
      const num = String(state.incidentCounter).padStart(3, '0');
      const pri = String(priority || 'P2').replace(/[^123]/g, '2');
      save();
      return `P${pri.replace('P','')}-${num}`;
    },
    insertIncident(inc) {
      state.incidents.push(inc);
      save();
    },

    // assignments
    assignUnit(incident_id, unit_id) {
      const existing = state.assignments.find((a) => a.incident_id === incident_id && a.unit_id === unit_id);
      if (!existing) state.assignments.push({ incident_id, unit_id, assigned_at: Date.now() });
      save();
    },
    unassignUnit(incident_id, unit_id) {
      state.assignments = state.assignments.filter((a) => !(a.incident_id === incident_id && a.unit_id === unit_id));
      save();
    },
    closeIncident(incident_id, closed_by) {
      const inc = state.incidents.find((i) => i.id === incident_id);
      if (!inc) return;
      inc.status = "CLOSED";
      inc.closed_at = Date.now();
      if (closed_by) inc.closed_by = closed_by;
      save();
    },
    updateIncident(incident_id, fields) {
      const inc = state.incidents.find((i) => i.id === incident_id);
      if (!inc) return false;
      const allowed = ["nature","priority","notes","location_label","postal_code","street_name","updated_by"];
      for (const k of allowed) {
        if (fields[k] !== undefined) inc[k] = fields[k];
      }
      inc.updated_at = Date.now();
      save();
      return true;
    },
    addSitrep(incident_id, sitrep) {
      const inc = state.incidents.find((i) => i.id === incident_id);
      if (!inc) return false;
      if (!Array.isArray(inc.sitreps)) inc.sitreps = [];
      inc.sitreps.push({ author: sitrep.author, text: sitrep.text, at: Date.now() });
      save();
      return true;
    },


    // map pins
    addMapPin(pin) {
      if (!Array.isArray(state.mapPins)) state.mapPins = [];
      state.mapPins.push(pin);
      save();
    },
    removeMapPin(pin_id) {
      if (!Array.isArray(state.mapPins)) state.mapPins = [];
      state.mapPins = state.mapPins.filter(p => p.id !== pin_id);
      save();
    },
    clearIncidentPins(incident_id) {
      if (!Array.isArray(state.mapPins)) state.mapPins = [];
      state.mapPins = state.mapPins.filter(p => p.incident_id !== incident_id);
      save();
    },

    // bulletins
    addBulletin(b) {
      if (!Array.isArray(state.bulletins)) state.bulletins = [];
      state.bulletins.unshift(b);
      save();
    },
    deleteBulletin(id) {
      state.bulletins = (state.bulletins || []).filter(b => b.id !== id);
      save();
    },

    // preplans
    upsertPreplan(p) {
      if (!Array.isArray(state.preplans)) state.preplans = [];
      const idx = state.preplans.findIndex(x => x.id === p.id);
      if (idx >= 0) state.preplans[idx] = p;
      else state.preplans.push(p);
      save();
    },
    deletePreplan(id) {
      state.preplans = (state.preplans || []).filter(p => p.id !== id);
      save();
    },

    // state
    getState() {
      const units = sortBy(state.units, "callsign");
      const incidents = [...state.incidents].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)).slice(0, 50);
      const assignments = [...state.assignments];
      const mapPins = Array.isArray(state.mapPins) ? [...state.mapPins] : [];
      const bulletins = Array.isArray(state.bulletins) ? [...state.bulletins] : [];
      const preplans  = Array.isArray(state.preplans)  ? [...state.preplans]  : [];
      return { units, incidents, assignments, mapPins, bulletins, preplans };
    }
  };

  return api;
}

