// Admin views: dashboard (stats, fixity check), users, and the audit log.
import { $, api, esc, fmtBytes } from "./core.js";
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
}
registerView("dashboard", loadDashboard);
$("#btn-fixity").addEventListener("click", async () => {
  $("#fixity-result").textContent = "Checking...";
  const r = await api("/api/admin/fixity", { method: "POST" });
  $("#fixity-result").textContent = r.ok ? `All ${r.checked} blobs verified. Integrity intact.` : `${r.failures.length} of ${r.checked} failed fixity.`;
});

// ---------- users ----------
async function loadUsers() {
  const data = await api("/api/users");
  $("#user-rows").innerHTML = data.users.map(u =>
    `<tr><td>${esc(u.username)}</td><td>${esc(u.email||"")}</td><td>${u.role}</td><td>${u.is_active?"Yes":"No"}</td><td>${(u.last_login||"").slice(0,16).replace("T"," ")}</td></tr>`).join("");
}
registerView("users", loadUsers);
$("#btn-new-user").addEventListener("click", async () => {
  const username = prompt("Username"); if (!username) return;
  const password = prompt("Temporary password"); if (!password) return;
  const role = prompt("Role (admin/editor/contributor/viewer)", "contributor") || "viewer";
  await api("/api/users", { json: { username, password, role } }); loadUsers();
});

// ---------- audit ----------
async function loadAudit() {
  const data = await api("/api/audit");
  $("#audit-rows").innerHTML = data.entries.map(e =>
    `<tr><td>${(e.ts||"").slice(0,19).replace("T"," ")}</td><td>${esc(e.username||"-")}</td><td>${esc(e.action)}</td>
     <td>${esc(e.target_type||"")} ${esc((e.target_id||"").slice(0,8))}</td><td>${esc(e.detail||"")}</td><td>${esc(e.ip||"")}</td></tr>`).join("");
}
registerView("audit", loadAudit);
