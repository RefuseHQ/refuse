// Tiny SPA — vanilla JS, hash routing, fetch() against /api/*.
//
// Admin token is stored in sessionStorage. The UI prompts on first use of an
// admin endpoint; routes that don't need it (dashboard, playground, config)
// degrade gracefully when the token is absent.

const ADMIN_KEY_STORAGE = "refuse_admin_token";
const APP_KEY_STORAGE = "refuse_app_token";

const $ = (sel) => document.querySelector(sel);

const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));

function adminToken() { return sessionStorage.getItem(ADMIN_KEY_STORAGE); }
function setAdminToken(v) {
  if (v) sessionStorage.setItem(ADMIN_KEY_STORAGE, v);
  else sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  renderAuthState();
}
function appToken() { return sessionStorage.getItem(APP_KEY_STORAGE); }
function setAppToken(v) {
  if (v) sessionStorage.setItem(APP_KEY_STORAGE, v);
  else sessionStorage.removeItem(APP_KEY_STORAGE);
  renderAuthState();
}

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  // Admin endpoints need the admin token; check routes can use the app key.
  if (path.startsWith("/api/admin/") || path.startsWith("/api/keys")) {
    const t = adminToken();
    if (t) headers["Authorization"] = "Bearer " + t;
  } else if (path.startsWith("/api/v1/")) {
    const t = appToken();
    if (t) headers["Authorization"] = "Bearer " + t;
  }
  const res = await fetch(path, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
  return body;
}

async function promptAdminToken() {
  const v = window.prompt("Admin token (REFUSE_ADMIN_TOKEN):");
  if (v) setAdminToken(v.trim());
  return adminToken();
}

function renderAuthState() {
  const a = adminToken();
  const k = appToken();
  $("#auth-state").innerHTML = `
    <span class="dim">admin: ${a ? "set" : "<button id='set-admin'>set</button>"} </span>
    <span class="dim">| key: ${k ? "set" : "<button id='set-app'>set</button>"} </span>
    ${a || k ? `<button id='clear-tokens'>clear</button>` : ""}
  `;
  $("#auth-state").querySelector("#set-admin")?.addEventListener("click", () => promptAdminToken().then(render));
  $("#auth-state").querySelector("#set-app")?.addEventListener("click", () => {
    const v = window.prompt("API key (rfs_…):");
    if (v) setAppToken(v.trim());
    render();
  });
  $("#auth-state").querySelector("#clear-tokens")?.addEventListener("click", () => {
    setAdminToken(null); setAppToken(null); render();
  });
}

/* ── pages ─────────────────────────────────────────────────────────── */

async function pageDashboard() {
  const main = $("#main");
  main.innerHTML = `<h2>Dashboard</h2><div id="dash-body">Loading…</div>`;
  if (!adminToken()) {
    $("#dash-body").innerHTML = `<div class="banner-warn">Admin token not set. Set it in the top-right to see DB stats + source health.</div>`;
    return;
  }
  try {
    const [stats, sources] = await Promise.all([api("/api/admin/stats"), api("/api/admin/sources")]);
    const tiles = Object.entries(stats.rows).map(([t, n]) =>
      `<div class="stat"><div class="stat-label">${escape(t)}</div><div class="stat-value">${n >= 0 ? n.toLocaleString() : "—"}</div></div>`
    ).join("");
    const lastOk = (sources.sources || []).map(s => ({ ...s, ago: s.last_ok_at ? timeAgo(s.last_ok_at) : "never" }));
    const rows = lastOk.map(s => `
      <tr>
        <td>${escape(s.source)}</td>
        <td><span class="status-${s.last_status === 'ok' ? 'ok' : 'err'}">${escape(s.last_status || '—')}</span></td>
        <td>${escape(s.ago)}</td>
        <td>${(s.records_processed ?? 0).toLocaleString()}</td>
        <td class="dim">${escape(s.last_error || "")}</td>
      </tr>
    `).join("");
    $("#dash-body").innerHTML = `
      <h3>Database</h3>
      <div class="grid">${tiles}</div>
      <h3>Sources</h3>
      <div class="card" style="padding:0">
        <table>
          <thead><tr><th>source</th><th>status</th><th>last ok</th><th>records</th><th>error</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="dim">No ingestion runs yet.</td></tr>`}</tbody>
        </table>
      </div>
    `;
  } catch (e) {
    $("#dash-body").innerHTML = `<div class="banner-warn">${escape(e.message)}</div>`;
  }
}

async function pagePlayground() {
  const main = $("#main");
  main.innerHTML = `
    <h2>Playground</h2>
    <div class="card">
      <form id="check-form">
        <div class="row"><label>Ecosystem</label><input type="text" name="ecosystem" value="npm" required /></div>
        <div class="row"><label>Name</label><input type="text" name="name" value="lodash" required /></div>
        <div class="row"><label>Version</label><input type="text" name="version" value="4.17.10" required /></div>
        <button class="btn" type="submit">Check</button>
      </form>
    </div>
    <pre class="output" id="check-output">Result will appear here.</pre>
  `;
  $("#check-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const body = Object.fromEntries(form);
    $("#check-output").textContent = "Querying…";
    try {
      const r = await api("/api/v1/check/package", { method: "POST", body: JSON.stringify(body) });
      $("#check-output").textContent = JSON.stringify(r, null, 2);
    } catch (e) {
      $("#check-output").textContent = "Error: " + e.message;
    }
  });
}

async function pageSources() {
  const main = $("#main");
  main.innerHTML = `<h2>Sources</h2><div id="src-body">Loading…</div>`;
  if (!adminToken()) {
    $("#src-body").innerHTML = `<div class="banner-warn">Set admin token to view + trigger sources.</div>`;
    return;
  }
  try {
    const { sources } = await api("/api/admin/sources");
    const rows = (sources || []).map(s => `
      <tr>
        <td>${escape(s.source)}</td>
        <td><span class="status-${s.last_status === 'ok' ? 'ok' : 'err'}">${escape(s.last_status || '—')}</span></td>
        <td>${escape(s.last_run_at || '')}</td>
        <td>${escape(s.last_ok_at || '')}</td>
        <td>${(s.records_processed ?? 0).toLocaleString()}</td>
        <td class="dim">${escape(s.last_error || '')}</td>
      </tr>
    `).join("");
    $("#src-body").innerHTML = `
      <div class="card" style="padding:0">
        <table>
          <thead><tr><th>source</th><th>status</th><th>last run</th><th>last ok</th><th>records</th><th>error</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6" class="dim">No ingestion runs yet.</td></tr>`}</tbody>
        </table>
      </div>
      <h3>Manually trigger</h3>
      <div>
        <button class="btn" data-trigger="osv">Run OSV delta</button>
        <button class="btn" data-trigger="deps-dev">Run deps.dev refresh</button>
        <button class="btn" data-trigger="enrichment">Run daily enrichment</button>
      </div>
      <pre class="output" id="trig-out" style="margin-top: 12px;">No triggers yet.</pre>
    `;
    main.querySelectorAll("[data-trigger]").forEach(b => b.addEventListener("click", async (e) => {
      const job = e.target.getAttribute("data-trigger");
      $("#trig-out").textContent = `Triggering ${job}…`;
      try {
        const r = await api(`/api/admin/ingest/${job}`, { method: "POST" });
        $("#trig-out").textContent = JSON.stringify(r, null, 2);
      } catch (err) { $("#trig-out").textContent = "Error: " + err.message; }
    }));
  } catch (e) {
    $("#src-body").innerHTML = `<div class="banner-warn">${escape(e.message)}</div>`;
  }
}

async function pageKeys() {
  const main = $("#main");
  main.innerHTML = `<h2>API keys</h2><div id="keys-body">Loading…</div>`;
  if (!adminToken()) {
    $("#keys-body").innerHTML = `<div class="banner-warn">Set admin token to manage keys.</div>`;
    return;
  }
  try {
    const { keys } = await api("/api/keys/");
    const rows = (keys || []).map(k => `
      <tr>
        <td>${escape(k.prefix)}…</td>
        <td>${escape(k.name || "")}</td>
        <td class="dim">${escape(k.created_at || "")}</td>
        <td class="dim">${escape(k.last_used_at || "")}</td>
        <td>${k.revoked_at ? `<span class="status-err">revoked ${escape(k.revoked_at)}</span>` : `<button class="danger" data-revoke="${escape(k.id)}">Revoke</button>`}</td>
      </tr>
    `).join("");
    $("#keys-body").innerHTML = `
      <div class="card" style="padding:0">
        <table>
          <thead><tr><th>prefix</th><th>name</th><th>created</th><th>last used</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="dim">No keys yet.</td></tr>`}</tbody>
        </table>
      </div>
      <h3>Create new key</h3>
      <form id="new-key">
        <div class="row"><label>Name (optional)</label><input type="text" name="name" placeholder="e.g. laptop" /></div>
        <button class="btn" type="submit">Create</button>
      </form>
      <pre class="output" id="new-key-out" style="display:none"></pre>
    `;
    $("#new-key").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      try {
        const r = await api("/api/keys/", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
        const out = $("#new-key-out");
        out.style.display = "block";
        out.textContent = `Created. Copy this NOW — it will not be shown again:\n\n${r.key}\n\n(prefix: ${r.prefix})`;
        setTimeout(pageKeys, 500);
      } catch (err) { window.alert("Error: " + err.message); }
    });
    main.querySelectorAll("[data-revoke]").forEach(b => b.addEventListener("click", async (e) => {
      const id = e.target.getAttribute("data-revoke");
      if (!confirm("Revoke this key?")) return;
      await api(`/api/keys/${id}`, { method: "DELETE" });
      pageKeys();
    }));
  } catch (e) {
    $("#keys-body").innerHTML = `<div class="banner-warn">${escape(e.message)}</div>`;
  }
}

async function pageConfig() {
  const main = $("#main");
  main.innerHTML = `<h2>Config</h2><div id="cfg-body">Loading…</div>`;
  if (!adminToken()) {
    $("#cfg-body").innerHTML = `<div class="banner-warn">Set admin token to view config.</div>`;
    return;
  }
  try {
    const { config } = await api("/api/admin/config");
    const items = (config || []).map(e => `
      <div class="k">${escape(e.name)}</div>
      <div class="v ${e.sensitive ? "sensitive" : ""}">${escape(e.value)}</div>
    `).join("");
    $("#cfg-body").innerHTML = `<div class="card"><div class="kv">${items}</div></div>`;
  } catch (e) {
    $("#cfg-body").innerHTML = `<div class="banner-warn">${escape(e.message)}</div>`;
  }
}

/* ── helpers ───────────────────────────────────────────────────────── */

function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return sec + "s ago";
  const m = Math.round(sec / 60); if (m < 60) return m + "m ago";
  const h = Math.round(m / 60); if (h < 48) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}

/* ── router ────────────────────────────────────────────────────────── */

const ROUTES = {
  "": pageDashboard,
  "playground": pagePlayground,
  "sources": pageSources,
  "keys": pageKeys,
  "config": pageConfig,
};

function currentRoute() {
  const h = location.hash.replace(/^#\/?/, "").replace(/^\//, "");
  return h.split("?")[0];
}

function render() {
  const r = currentRoute();
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("active", a.getAttribute("data-route") === r));
  (ROUTES[r] ?? pageDashboard)();
}

window.addEventListener("hashchange", render);
renderAuthState();
render();
