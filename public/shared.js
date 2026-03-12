function qs(sel) { return document.querySelector(sel); }

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c);
  return n;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function toast(title, body) {
  let wrap = document.getElementById("toast-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "toast-wrap";
    wrap.style.cssText = "position:fixed;top:14px;right:14px;z-index:9999;display:grid;gap:8px;max-width:340px;";
    document.body.appendChild(wrap);
  }
  const item = document.createElement("div");
  item.style.cssText = "background:rgba(15,24,44,.96);border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:10px 14px;box-shadow:0 8px 24px rgba(0,0,0,.5);";
  item.innerHTML = `<p style="margin:0 0 3px;font-weight:800;font-size:13px;">${title}</p><p style="margin:0;color:#9bb0d1;font-size:12px;">${body}</p>`;
  wrap.appendChild(item);
  setTimeout(() => item.remove(), 6000);
}

function statusPill(status) {
  const s = String(status || "UNKNOWN").toUpperCase();
  const cls = s === "AVAILABLE" || s === "CLEAR" ? "ok"
    : s === "ENROUTE" || s === "ONSCENE" ? "warn"
    : s === "EMR" ? "danger"
    : s === "CLOSED" ? "muted" : "muted";
  return el("span", { class: `pill ${cls}`, text: s });
}

async function logout() {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/index.html";
}

async function whoami() {
  try {
    const res = await fetch("/whoami");
    if (!res.ok) return null;
    const data = await res.json();
    return data.user;
  } catch { return null; }
}

function buildTone() {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return ctx;
  }

  function beep(ac, freq, startTime, duration, volume = 0.4) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.01);
    gain.gain.setValueAtTime(volume, startTime + duration - 0.01);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  async function play(tone) {
    const ac = getCtx();
    if (ac.state === "suspended") await ac.resume();
    const now = ac.currentTime;

    if (tone === "hiLo") {
      // Hi-lo fire tone: two alternating pitches, 3 cycles
      const pairs = [
        [1200, 0.22], [800, 0.22],
        [1200, 0.22], [800, 0.22],
        [1200, 0.22], [800, 0.22],
      ];
      let t = now;
      for (const [freq, dur] of pairs) {
        beep(ac, freq, t, dur, 0.5);
        t += dur + 0.03;
      }
    } else {
      // Default: 3 short beeps
      beep(ac, 960, now,        0.18, 0.45);
      beep(ac, 960, now + 0.24, 0.18, 0.45);
      beep(ac, 960, now + 0.48, 0.18, 0.45);
    }
  }

  return { play };
}

window.CAD_SHARED = { qs, el, fmtTime, toast, statusPill, logout, whoami, buildTone };
