/* =========================
   UnitFlow v2 (Option 2)
   Home → Supply / Crash
   Shared selection + export
========================= */

const LS_KEY = "unitflow_logs_v2";
const LS_AUTHOR_KEY = "unitflow_author_v1";
const LS_LOC_KEY = "unitflow_locations_v1";

const $ = (id) => document.getElementById(id);

const screens = {
  home: $("screen-home"),
  supply: $("screen-supply"),
  crash: $("screen-crash"),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove("active"));
  screens[name].classList.add("active");
  // leaving selection mode on screen switch is a common iOS “dead click” cause
  if (selectMode) setSelecting(false);
}

/* ---------- Defaults / Config ---------- */
const DEFAULT_LOCATIONS = [
  "4th Floor Tower – 4 South",
  "4th Floor Tower – 4 East",
  "3rd Floor Tower – 3 South",
  "3rd Floor Tower – 3 East",
  "ICU Pavilion – Pav A",
  "ICU Pavilion – Pav B",
  "ICU Pavilion – Pav C",
  "ER – Main",
  "X-Ray Dept",
  "Cath Lab",
  "Backup Cart – Central",
];

function loadLocations() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_LOC_KEY) || "null");
    if (Array.isArray(v) && v.length) return v;
  } catch {}
  return DEFAULT_LOCATIONS;
}

/* ---------- Shared Storage ---------- */
function loadLogs() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
  catch { return []; }
}

function saveLogs(logs) {
  localStorage.setItem(LS_KEY, JSON.stringify(logs));
}

function loadAuthor() {
  return (localStorage.getItem(LS_AUTHOR_KEY) || "").trim();
}

function saveAuthor(name) {
  localStorage.setItem(LS_AUTHOR_KEY, (name || "").trim());
}

/* ---------- Date Helpers ---------- */
function startOfToday() {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.getTime();
}

function startOfWeek() {
  const d = new Date();
  const day = d.getDay(); // 0 Sun
  const diff = (day === 0 ? 6 : day - 1); // Monday start
  d.setDate(d.getDate() - diff);
  d.setHours(0,0,0,0);
  return d.getTime();
}

/* ---------- PHI Guard (Supply Notes) ---------- */
function phiLikely(text) {
  if (!text) return false;
  const patterns = [
    /\b(MRN|medical record)\b/i,
    /\bDOB\b/i,
    /\b\d{2}\/\d{2}\/\d{4}\b/,
    /\broom\s?#?\d+\b/i,
    /\bbed\s?#?\d+\b/i
  ];
  return patterns.some(r => r.test(text));
}

/* ---------- Utils ---------- */
function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "_" + Math.random().toString(16).slice(2));
}

/* =========================
   Selection Mode (shared)
========================= */

let selectMode = false;
let selectionScope = "";  // e.g. "supply-today" | "crash-week"
let selectedIds = new Set();

function setSelecting(on, scope) {
  selectMode = on;
  if (scope) selectionScope = scope;

  document.body.classList.toggle("selecting", selectMode);

  selectedIds.clear();
  clearSelectedUI();
  $("actionBar").hidden = true;
  $("selectedCount").textContent = "0 selected";

  renderAll(); // keep UI synced
}

function clearSelectedUI() {
  document.querySelectorAll(".item.selected").forEach(n => n.classList.remove("selected"));
  document.querySelectorAll(".selectBox:checked").forEach(cb => { cb.checked = false; });
}

function updateActionBar() {
  $("selectedCount").textContent = `${selectedIds.size} selected`;
  $("actionBar").hidden = !(selectMode && selectedIds.size > 0);
}

function syncSelectedUI() {
  document.querySelectorAll(".item").forEach(item => {
    const cb = item.querySelector(".selectBox");
    if (!cb) return;

    // enable only in selection mode
    cb.disabled = !selectMode;

    const isSelected = selectedIds.has(item.dataset.id);
    cb.checked = isSelected;
    item.classList.toggle("selected", isSelected);
  });
  updateActionBar();
}

function getSelectedLogs() {
  const logs = loadLogs();
  return logs.filter(l => selectedIds.has(l.id));
}

/* =========================
   Tabs (per screen)
========================= */

function setTabWithin(screenEl, tabName) {
  const tabs = Array.from(screenEl.querySelectorAll(".tab"));
  const panes = Array.from(screenEl.querySelectorAll(".tabpane"));

  tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tabName));
  panes.forEach(p => p.classList.toggle("active", p.id === "tab-" + tabName));
}

function wireTabs(screenEl) {
  const tabs = Array.from(screenEl.querySelectorAll(".tab"));
  tabs.forEach(t => t.addEventListener("click", (e) => {
    e.preventDefault();
    // KEY FIX: tabs always exit select mode (prevents "dead" UI on iOS)
    if (selectMode) setSelecting(false);
    setTabWithin(screenEl, t.dataset.tab);
  }));
}

/* =========================
   Render Items
========================= */

function badgeForSupply(severity) {
  if (severity === "High") return "high";
  if (severity === "Medium") return "med";
  return "low";
}

// Crash cart status (v2.1-lite): derived from latest known expirations for a cart
function computeCartStatus(latestCentralDateISO, latestMedDateISO) {
  const now = new Date();
  const msDay = 86400000;

  const toDays = (iso) => {
    if (!iso) return null;
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    return Math.floor((d.getTime() - now.getTime()) / msDay);
  };

  const dc = toDays(latestCentralDateISO);
  const dm = toDays(latestMedDateISO);

  // no data
  if (dc === null && dm === null) return { cls:"unv", label:"UNVERIFIED" };

  const worst = Math.min(
    dc === null ? 99999 : dc,
    dm === null ? 99999 : dm
  );

  if (worst < 0) return { cls:"crit", label:"EXPIRED" };
  if (worst <= 7) return { cls:"crit", label:"ACTION" };
  if (worst <= 30) return { cls:"attn", label:"ATTN" };
  return { cls:"ready", label:"READY" };
}

function entryNodeSupply(l, scope) {
  const el = document.createElement("div");
  el.className = "item";
  el.dataset.id = l.id;
  el.dataset.scope = scope;

  const sevClass = badgeForSupply(l.severity);
  const when = new Date(l.ts).toLocaleString();
  const who = l.author ? ` • ${escapeHtml(l.author)}` : "";
  const qty = (l.qty !== "" && l.qty != null) ? ` • Qty: ${escapeHtml(l.qty)}` : "";
  const unit = l.unit ? ` • ${escapeHtml(l.unit)}` : "";
  const shift = l.shift ? ` • ${escapeHtml(l.shift)}` : "";

  el.innerHTML = `
    <div class="item-top">
      <input type="checkbox" class="selectBox" data-id="${escapeHtml(l.id)}" aria-label="Select entry" />
      <div class="left">
        <div><strong>${escapeHtml(l.type || "Entry")}</strong></div>
        <div class="meta">${escapeHtml(when)}${who}${shift}${unit}${qty}</div>
        ${l.notes ? `<div class="meta">${escapeHtml(l.notes)}</div>` : ""}
      </div>
    </div>
    <div class="badge ${sevClass}">${escapeHtml(l.severity || "Low")}</div>
  `;
  return el;
}

function entryNodeCrash(l, scope, statusMeta) {
  const el = document.createElement("div");
  el.className = "item";
  el.dataset.id = l.id;
  el.dataset.scope = scope;

  const when = new Date(l.ts).toLocaleString();
  const line1 = `${escapeHtml(l.cartType)} • Cart ${escapeHtml(l.cartNumber)} • ${escapeHtml(l.location)}`;
  const line2 = `${escapeHtml(l.reason)}${l.checkedBy ? ` • ${escapeHtml(l.checkedBy)}` : ""}${l.seal ? ` • Seal: ${escapeHtml(l.seal)}` : ""}`;

  const expParts = [];
  if (l.centralNew) expParts.push(`Central: ${escapeHtml(l.centralNew)}`);
  if (l.medNew) expParts.push(`Med: ${escapeHtml(l.medNew)}`);
  const line3 = expParts.length ? expParts.join(" • ") : (l.notes ? escapeHtml(l.notes) : "");

  el.innerHTML = `
    <div class="item-top">
      <input type="checkbox" class="selectBox" data-id="${escapeHtml(l.id)}" aria-label="Select entry" />
      <div class="left">
        <div><strong>${line1}</strong></div>
        <div class="meta">${escapeHtml(when)} • ${line2}</div>
        ${line3 ? `<div class="meta">${line3}</div>` : ""}
      </div>
    </div>
    <div class="badge ${statusMeta.cls}">${statusMeta.label}</div>
  `;
  return el;
}

/* =========================
   Render Supply + Crash
========================= */

function renderSupply() {
  const logs = loadLogs().filter(l => l.mode === "supply").sort((a,b)=>(b.ts||0)-(a.ts||0));
  const todayStart = startOfToday();
  const weekStart = startOfWeek();

  const todayLogs = logs.filter(l => (l.ts||0) >= todayStart);
  const weekLogs  = logs.filter(l => (l.ts||0) >= weekStart);

  $("supplyTodayCount").textContent = `${todayLogs.length} entr${todayLogs.length===1?"y":"ies"}`;
  $("supplyWeekCount").textContent  = `${weekLogs.length} entr${weekLogs.length===1?"y":"ies"}`;

  $("supplyTodayList").innerHTML = todayLogs.length ? "" : `<p class="sub">No entries yet today.</p>`;
  $("supplyWeekList").innerHTML  = weekLogs.length ? ""  : `<p class="sub">No entries yet this week.</p>`;

  todayLogs.forEach(l => $("supplyTodayList").appendChild(entryNodeSupply(l, "supply-today")));
  weekLogs.forEach(l => $("supplyWeekList").appendChild(entryNodeSupply(l, "supply-week")));
}

function latestExpByCart(crashLogs) {
  // key: `${cartType}|${location}|${cartNumber}`
  const map = new Map();
  for (const l of crashLogs) {
    const key = `${l.cartType}|${l.location}|${l.cartNumber}`;
    const prev = map.get(key) || { centralNew:null, medNew:null, ts:0 };
    const ts = l.ts || 0;
    // only consider newest log to update expirations (we still want latest known exps)
    const next = { ...prev };
    if (ts >= prev.ts) next.ts = ts;
    if (l.centralNew) next.centralNew = l.centralNew;
    if (l.medNew) next.medNew = l.medNew;
    map.set(key, next);
  }
  return map;
}

function renderCrash() {
  const crashLogsAll = loadLogs().filter(l => l.mode === "crash").sort((a,b)=>(b.ts||0)-(a.ts||0));
  const todayStart = startOfToday();
  const weekStart = startOfWeek();

  const todayLogs = crashLogsAll.filter(l => (l.ts||0) >= todayStart);
  const weekLogs  = crashLogsAll.filter(l => (l.ts||0) >= weekStart);

  $("crashTodayCount").textContent = `${todayLogs.length} entr${todayLogs.length===1?"y":"ies"}`;
  $("crashWeekCount").textContent  = `${weekLogs.length} entr${weekLogs.length===1?"y":"ies"}`;

  $("crashTodayList").innerHTML = todayLogs.length ? "" : `<p class="sub">No crash cart logs yet today.</p>`;
  $("crashWeekList").innerHTML  = weekLogs.length ? ""  : `<p class="sub">No crash cart logs yet this week.</p>`;

  const expMap = latestExpByCart(crashLogsAll);

  const statusFor = (l) => {
    const key = `${l.cartType}|${l.location}|${l.cartNumber}`;
    const latest = expMap.get(key) || {};
    return computeCartStatus(latest.centralNew, latest.medNew);
  };

  todayLogs.forEach(l => $("crashTodayList").appendChild(entryNodeCrash(l, "crash-today", statusFor(l))));
  weekLogs.forEach(l => $("crashWeekList").appendChild(entryNodeCrash(l, "crash-week", statusFor(l))));

  // v2.1-lite Alerts panel (only in Today view)
  const alerts = buildCrashAlerts(expMap);
  if (alerts.length) {
    $("crashAlerts").hidden = false;
    $("crashAlerts").innerHTML = `
      <div><strong>Crash Cart Alerts</strong> (next 30 days)</div>
      <div style="margin-top:6px;">${alerts.map(a => `• ${a}`).join("<br>")}</div>
    `;
  } else {
    $("crashAlerts").hidden = true;
    $("crashAlerts").innerHTML = "";
  }
}

function buildCrashAlerts(expMap) {
  const now = new Date();
  const msDay = 86400000;

  const lines = [];
  for (const [key, v] of expMap.entries()) {
    const [cartType, location, cartNumber] = key.split("|");

    const check = (label, iso) => {
      if (!iso) return;
      const d = new Date(iso + "T00:00:00");
      if (isNaN(d.getTime())) return;
      const days = Math.floor((d.getTime() - now.getTime()) / msDay);
      if (days < 0) lines.push(`${cartType} Cart ${cartNumber} (${location}) — ${label} EXPIRED (${iso})`);
      else if (days <= 7) lines.push(`${cartType} Cart ${cartNumber} (${location}) — ${label} expires in ${days} day${days===1?"":"s"} (${iso})`);
      else if (days <= 30) lines.push(`${cartType} Cart ${cartNumber} (${location}) — ${label} expires in ${days} days (${iso})`);
    };

    check("Central", v.centralNew);
    check("Med Box", v.medNew);
  }

  // keep top 6 alerts to avoid clutter
  return lines.slice(0, 6);
}

function renderAll() {
  renderSupply();
  renderCrash();
  syncSelectedUI();
}

/* =========================
   Export / Print / Table
========================= */

function exportCsvFromLogs(logs, filenamePrefix) {
  if (!logs.length) return;

  // union headers for both modes
  const header = [
    "mode","timestamp","author","shift","unit","type","severity","qty","notes",
    "cartType","location","cartNumber","reason","centralOld","centralNew","medOld","medNew","checkedBy","seal"
  ];

  const rows = logs.map(l => ([
    l.mode || "",
    new Date(l.ts).toISOString(),
    l.author || "",
    l.shift || "",
    l.unit || "",
    l.type || "",
    l.severity || "",
    (l.qty ?? ""),
    (l.notes || "").replaceAll("\n"," ").trim(),
    l.cartType || "",
    l.location || "",
    l.cartNumber || "",
    l.reason || "",
    l.centralOld || "",
    l.centralNew || "",
    l.medOld || "",
    l.medNew || "",
    l.checkedBy || "",
    l.seal || "",
  ]));

  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v).replaceAll('"','""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenamePrefix}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function exportSelectedCsv() {
  const selected = getSelectedLogs().sort((a,b)=>(a.ts||0)-(b.ts||0));
  exportCsvFromLogs(selected, "unitflow_selected");
}

function exportAllCsvForMode(mode) {
  const logs = loadLogs().filter(l => l.mode === mode).sort((a,b)=>(a.ts||0)-(b.ts||0));
  exportCsvFromLogs(logs, `unitflow_${mode}_all`);
}

function printSelected() {
  if (selectedIds.size === 0) return;
  document.body.classList.add("printing-selected");
  setTimeout(() => {
    window.print();
    setTimeout(() => document.body.classList.remove("printing-selected"), 400);
  }, 50);
}

function printAll() {
  document.body.classList.remove("printing-selected");
  window.print();
}

function openSelectedTable() {
  const selected = getSelectedLogs().sort((a,b)=>(a.ts||0)-(b.ts||0));
  if (!selected.length) return;

  const title = `UnitFlow — Selected`;
  const generated = new Date().toLocaleString();

  const rowsHtml = selected.map(l => {
    const when = new Date(l.ts).toLocaleString();

    if (l.mode === "crash") {
      return `
        <tr>
          <td>${escapeHtml(when)}</td>
          <td>Crash</td>
          <td>${escapeHtml(l.cartType || "")}</td>
          <td>${escapeHtml(l.location || "")}</td>
          <td>${escapeHtml(l.cartNumber || "")}</td>
          <td>${escapeHtml(l.reason || "")}</td>
          <td>${escapeHtml(l.centralNew || "")}</td>
          <td>${escapeHtml(l.medNew || "")}</td>
          <td>${escapeHtml(l.checkedBy || "")}</td>
          <td>${escapeHtml(l.seal || "")}</td>
          <td>${escapeHtml(l.notes || "")}</td>
        </tr>
      `;
    }

    // supply
    return `
      <tr>
        <td>${escapeHtml(when)}</td>
        <td>Supply</td>
        <td>${escapeHtml(l.author || "")}</td>
        <td>${escapeHtml(l.shift || "")}</td>
        <td>${escapeHtml(l.unit || "")}</td>
        <td>${escapeHtml(l.type || "")}</td>
        <td>${escapeHtml(l.severity || "")}</td>
        <td>${escapeHtml(l.qty ?? "")}</td>
        <td colspan="3">${escapeHtml(l.notes || "")}</td>
      </tr>
    `;
  }).join("");

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 16px; }
    h1 { margin: 0 0 6px 0; font-size: 18px; }
    .meta { margin: 0 0 14px 0; color: #555; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #ddd; padding: 8px; vertical-align: top; }
    th { background: #f5f5f5; text-align: left; }
    .tip { margin-top: 12px; font-size: 12px; color: #555; }
    @media print { .tip { display: none; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Generated: ${escapeHtml(generated)} • Items: ${selected.length}</p>

  <table>
    <thead>
      <tr>
        <th>Time</th>
        <th>Mode</th>
        <th colspan="9">Details</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <p class="tip">Tip: iPhone → Share → Print → pinch/zoom preview → Share → Save to Files (PDF).</p>
</body>
</html>`;

  const w = window.open("", "_blank");
  if (!w) {
    alert("Pop-up blocked. Please allow pop-ups for this site, then try again.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
}

/* =========================
   Supply Form
========================= */

function clearSupplyForm(hideWarn=true) {
  $("s_shift").value = "";
  $("s_unit").value = "";
  $("s_type").value = "Replenishment";
  $("s_severity").value = "Low";
  $("s_qty").value = "";
  $("s_notes").value = "";
  if (hideWarn) $("s_phiWarn").hidden = true;
}

/* =========================
   Crash Form
========================= */

function fillLocationsDropdown() {
  const locs = loadLocations();
  const sel = $("c_location");
  sel.innerHTML = locs.map(l => `<option>${escapeHtml(l)}</option>`).join("");
}

function crashReasonIsExpiration(reason) {
  return reason === "Expiration swap" || reason === "Routine reseal (seal broken)";
}

function updateCrashFormHint() {
  const reason = $("c_reason").value;
  const isExp = crashReasonIsExpiration(reason);

  // Only require New exp dates for expiration reasons.
  $("c_centralNew").required = isExp;
  $("c_medNew").required = isExp;

  // Visual hint
  $("c_hint").hidden = isExp ? true : false;

  // If not expiration reason, don’t nag with empty required fields
  if (!isExp) {
    $("c_centralNew").value = "";
    $("c_medNew").value = "";
    $("c_centralOld").value = "";
    $("c_medOld").value = "";
  }
}

function clearCrashForm() {
  $("c_cartType").value = "Adult";
  fillLocationsDropdown();
  $("c_cartNumber").value = "";
  $("c_reason").value = "After use (code event)";
  $("c_checkedBy").value = loadAuthor() || "";
  $("c_seal").value = "";
  $("c_centralOld").value = "";
  $("c_centralNew").value = "";
  $("c_medOld").value = "";
  $("c_medNew").value = "";
  $("c_notes").value = "";
  updateCrashFormHint();
}

/* =========================
   Wire UI
========================= */

function wireNav() {
  $("goSupply").addEventListener("click", () => showScreen("supply"));
  $("goCrash").addEventListener("click", () => showScreen("crash"));
  $("backFromSupply").addEventListener("click", () => showScreen("home"));
  $("backFromCrash").addEventListener("click", () => showScreen("home"));

  $("purgeBtn").addEventListener("click", () => {
    if (!confirm("Clear ALL logs from this device?")) return;
    localStorage.removeItem(LS_KEY);
    selectedIds.clear();
    setSelecting(false);
    renderAll();
    showScreen("home");
  });
}

function wireSupply() {
  // Prefill author
  $("s_author").value = loadAuthor();

  $("s_saveBtn").addEventListener("click", () => {
    const authorInput = $("s_author").value.trim();
    if (authorInput) saveAuthor(authorInput);

    const entry = {
      id: uid(),
      mode: "supply",
      ts: Date.now(),
      author: authorInput || loadAuthor(),
      shift: $("s_shift").value.trim(),
      unit: $("s_unit").value.trim(),
      type: $("s_type").value,
      severity: $("s_severity").value,
      qty: $("s_qty").value,
      notes: $("s_notes").value.trim()
    };

    const warn = phiLikely(entry.notes) || phiLikely(entry.unit);
    $("s_phiWarn").hidden = !warn;

    const logs = loadLogs();
    logs.push(entry);
    saveLogs(logs);

    clearSupplyForm(false);
    renderAll();
    // jump to Today tab
    setTabWithin(screens.supply, "supply-today");
  });

  $("s_clearBtn").addEventListener("click", () => clearSupplyForm(true));

  // selection buttons
  $("selectSupplyTodayBtn").addEventListener("click", () => setSelecting(true, "supply-today"));
  $("selectSupplyWeekBtn").addEventListener("click", () => setSelecting(true, "supply-week"));

  // export/print all
  $("exportSupplyCsvAll").addEventListener("click", () => exportAllCsvForMode("supply"));
  $("exportSupplyCsvAll2").addEventListener("click", () => exportAllCsvForMode("supply"));
  $("printSupplyAll").addEventListener("click", printAll);
  $("printSupplyAll2").addEventListener("click", printAll);
}

function wireCrash() {
  fillLocationsDropdown();
  $("c_checkedBy").value = loadAuthor() || "";

  $("c_reason").addEventListener("change", updateCrashFormHint);
  updateCrashFormHint();

  $("c_saveBtn").addEventListener("click", () => {
    const checkedBy = $("c_checkedBy").value.trim();
    if (checkedBy) saveAuthor(checkedBy);

    const entry = {
      id: uid(),
      mode: "crash",
      ts: Date.now(),
      cartType: $("c_cartType").value,
      location: $("c_location").value,
      cartNumber: $("c_cartNumber").value.trim(),
      reason: $("c_reason").value,
      centralOld: $("c_centralOld").value || "",
      centralNew: $("c_centralNew").value || "",
      medOld: $("c_medOld").value || "",
      medNew: $("c_medNew").value || "",
      checkedBy: checkedBy || loadAuthor(),
      seal: $("c_seal").value.trim(),
      notes: $("c_notes").value.trim(),
    };

    if (!entry.location || !entry.cartNumber || !entry.reason || !entry.checkedBy) {
      alert("Please fill: Location, Cart #, Reason, Checked By.");
      return;
    }

    const logs = loadLogs();
    logs.push(entry);
    saveLogs(logs);

    clearCrashForm();
    renderAll();
    setTabWithin(screens.crash, "crash-today");
  });

  $("c_clearBtn").addEventListener("click", clearCrashForm);

  // selection buttons
  $("selectCrashTodayBtn").addEventListener("click", () => setSelecting(true, "crash-today"));
  $("selectCrashWeekBtn").addEventListener("click", () => setSelecting(true, "crash-week"));

  // export/print all
  $("exportCrashCsvAll").addEventListener("click", () => exportAllCsvForMode("crash"));
  $("exportCrashCsvAll2").addEventListener("click", () => exportAllCsvForMode("crash"));
  $("printCrashAll").addEventListener("click", printAll);
  $("printCrashAll2").addEventListener("click", printAll);
}

function wireSelectionBar() {
  $("cancelSelectBtn").addEventListener("click", () => setSelecting(false));
  $("viewSelectedBtn").addEventListener("click", openSelectedTable);
  $("exportSelectedBtn").addEventListener("click", exportSelectedCsv);
  $("printSelectedBtn").addEventListener("click", printSelected);

  // checkbox selection (delegated)
  document.addEventListener("change", (e) => {
    const cb = e.target;
    if (!cb.classList || !cb.classList.contains("selectBox")) return;

    if (!selectMode) {
      cb.checked = false;
      return;
    }

    const item = cb.closest(".item");
    if (!item) return;

    // enforce scope (only allow selection from the active list scope)
    if (item.dataset.scope !== selectionScope) {
      cb.checked = false;
      return;
    }

    const id = item.dataset.id;
    if (cb.checked) selectedIds.add(id);
    else selectedIds.delete(id);

    item.classList.toggle("selected", cb.checked);
    updateActionBar();
  });
}

/* =========================
   Init
========================= */

(function init() {
  wireNav();
  wireTabs(screens.supply);
  wireTabs(screens.crash);
  wireSupply();
  wireCrash();
  wireSelectionBar();

  // service worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // default start
  showScreen("home");
  renderAll();

  // set default tabs
  setTabWithin(screens.supply, "supply-today");
  setTabWithin(screens.crash, "crash-today");
})();

// Absolute safety: never show selection bar on Home
const homeObserver = new MutationObserver(() => {
  const homeVisible = screens.home.classList.contains("active");
  if (homeVisible) {
    $("actionBar").hidden = true;
    document.body.classList.remove("selecting");
    selectMode = false;
    selectedIds.clear();
  }
});

homeObserver.observe(document.body, { attributes: true, subtree: true });
