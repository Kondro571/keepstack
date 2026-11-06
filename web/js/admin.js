// Admin views: dashboard (stats, settings, fixity check) and the audit log. Users live in users.js.
import { $, api, errorMessage, esc, fmtBytes, state, toast } from "./core.js";
import { registerView } from "./router.js";
import { fmtNum, mediaLabel, t } from "./i18n.js";

// ---------- dashboard ----------
async function loadDashboard() {
  const s = await api("/api/stats");
  const cards = [
    [t("dash.totalAssets"), fmtNum(s.total_assets)], [t("dash.storage"), fmtBytes(s.total_bytes)],
    [t("dash.dedup"), fmtBytes(s.dedup_saved_bytes)], [t("dash.tags"), fmtNum(s.tags)], [t("dash.collections"), fmtNum(s.collections)],
    ...Object.entries(s.by_type).map(([k,v]) => { const l = mediaLabel(k); return [l.charAt(0).toUpperCase()+l.slice(1), fmtNum(v)]; }),
  ];
  $("#stat-cards").innerHTML = cards.map(([l,n]) => `<div class="stat-card"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`).join("");
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
    toast(t("dash.limitSaved", { size: fmtBytes(state.settings.max_upload_mb * 1024 * 1024) }));
  } catch (err) { toast(errorMessage(err, t("dash.limitFailed")), "err"); }
});
registerView("dashboard", loadDashboard);
$("#btn-fixity").addEventListener("click", async () => {
  $("#fixity-result").textContent = t("dash.checking");
  const r = await api("/api/admin/fixity", { method: "POST" });
  $("#fixity-result").textContent = r.ok ? t("dash.fixityOk", { n: fmtNum(r.checked) })
    : t("dash.fixityFailed", { failed: fmtNum(r.failures.length), n: fmtNum(r.checked) });
});

// ---------- audit ----------
async function loadAudit() {
  const data = await api("/api/audit");
  $("#audit-rows").innerHTML = data.entries.map(e =>
    `<tr><td>${(e.ts||"").slice(0,19).replace("T"," ")}</td><td>${esc(e.username||"-")}</td><td>${esc(e.action)}</td>
     <td>${esc(e.target_type||"")} ${esc((e.target_id||"").slice(0,8))}</td><td>${esc(e.detail||"")}</td><td>${esc(e.ip||"")}</td></tr>`).join("");
}
registerView("audit", loadAudit);
