/* Keepstack single-page client entry point. Vanilla JS ES modules, no build step.
 *
 *   core.js         shared helpers ($, api, toast, esc) and state
 *   router.js       per-view URLs and navigation
 *   library.js      search, grid/list layout, paging, sidebar facets, user preferences
 *   bulk.js         multi-select and bulk actions (tag, collection, delete)
 *   asset.js        asset detail drawer
 *   upload.js       upload dialog and tag import
 *   collections.js  collections view
 *   admin.js        dashboard, audit log
 *   users.js        user management (add, edit, roles, delete)
 *
 * Feature modules register their view with the router when imported; this
 * file handles sign-in and boot.
 */
import { $, $$, api, roleAtLeast, setUnauthorizedHandler, state } from "./core.js";
import { route } from "./router.js";
import { loadPrefs } from "./library.js";
import { clearSelection } from "./bulk.js";
import "./asset.js";
import "./upload.js";
import "./collections.js";
import "./admin.js";
import "./users.js";

// ---------- auth ----------
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const r = await api("/api/auth/login", { json: { username: $("#login-user").value, password: $("#login-pass").value } });
    state.token = r.token; localStorage.setItem("keepstack_token", r.token);
    state.user = r.user; enterApp();
  } catch (err) { console.error("Login failed:", err); $("#login-error").textContent = "Invalid credentials"; $("#login-error").classList.remove("hidden"); }
});
$("#btn-logout").addEventListener("click", logout);
setUnauthorizedHandler(logout);
function logout() { localStorage.removeItem("keepstack_token"); state.token = null; state.user = null; clearSelection();
  $("#app").classList.add("hidden"); $("#login").classList.remove("hidden"); }

function enterApp() {
  $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
  $("#user-label").textContent = `${state.user.username} (${state.user.role})`;
  const isAdmin = state.user.role === "admin";
  $$(".admin-only").forEach(el => el.classList.toggle("hidden", !isAdmin));
  // Hide what the role cannot do; the server enforces the same rules.
  $("#btn-upload").classList.toggle("hidden", !roleAtLeast("uploader"));
  $(".tag-import").classList.toggle("hidden", !roleAtLeast("contributor"));
  loadPrefs().then(route);
}

// ---------- boot ----------
(async function boot() {
  if (state.token) {
    try { state.user = await api("/api/auth/me"); enterApp(); return; } catch {}
  }
  $("#login").classList.remove("hidden");
})();
