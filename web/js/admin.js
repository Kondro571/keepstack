// Admin views: dashboard (stats, settings, fixity check) and the audit log. Users live in users.js.
import { $, api, errorMessage, esc, fmtBytes, state, toast } from "./core.js";
import { registerView } from "./router.js";

// ---------- dashboard ----------
async function loadDashboard() {
  const s = await api("/api/stats");
  const cards = [
    ["Total assets", s.total_assets], ["Storage used", fmtBytes(s.total_bytes)],
    ["Saved by dedup", fmtBytes(s.dedup_saved_bytes)], ["Tags", s.tags], ["Collections", s.collections],
    ...Object.entries(s.by_type).map(([k,v]) => [k.charAt(0).toUpperCase()+k.slice(1), v]),
  ];
  $("#stat-cards").innerHTML = cards.map(([l,n]) => `<div class="stat-card"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");
  const settings = await api("/api/settings");
  state.settings = settings;
  $("#set-upload-gb").value = +(settings.max_upload_mb / 1024).toFixed(2);
}

// ---------- settings ----------
// The limit is stored in MB; the form shows GB, which is what people think in.
$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const mb = Math.round(parseFloat($("#set-upload-gb").value) * 1024);
  try {
    state.settings = await api("/api/settings", { method: "PATCH", json: { max_upload_mb: mb } });
    toast(`Upload limit set to ${fmtBytes(state.settings.max_upload_mb * 1024 * 1024)}`);
  } catch (err) { toast(errorMessage(err, "Could not save settings"), "err"); }
});
registerView("dashboard", loadDashboard);
$("#btn-fixity").addEventListener("click", async () => {
  $("#fixity-result").textContent = "Checking...";
  const r = await api("/api/admin/fixity", { method: "POST" });
  $("#fixity-result").textContent = r.ok ? `All ${r.checked} blobs verified. Integrity intact.` : `${r.failures.length} of ${r.checked} failed fixity.`;
});

// ---------- audit ----------
async function loadAudit() {
  const data = await api("/api/audit");
  $("#audit-rows").innerHTML = data.entries.map(e =>
    `<tr><td>${(e.ts||"").slice(0,19).replace("T"," ")}</td><td>${esc(e.username||"-")}</td><td>${esc(e.action)}</td>
     <td>${esc(e.target_type||"")} ${esc((e.target_id||"").slice(0,8))}</td><td>${esc(e.detail||"")}</td><td>${esc(e.ip||"")}</td></tr>`).join("");
}
registerView("audit", loadAudit);
