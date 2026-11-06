/* Keepstack single-page client entry point. Vanilla JS ES modules, no build step.
 *
 *   core.js         shared helpers ($, api, toast, esc) and state
 *   i18n.js         interface language (English, Polish): t(), data-i18n markup
 *   router.js       per-view URLs and navigation
 *   library.js      search, grid/list layout, paging, sidebar facets, user preferences
 *   bulk.js         multi-select and bulk actions (tag, collection, delete)
 *   asset.js        asset detail drawer
 *   upload.js       upload dialog and tag import
 *   collections.js  collections view
 *   admin.js        dashboard, audit log
 *   users.js        user management (add, edit, roles, delete)
 *   tags.js         tag labels in the interface language ("dog" shown as "pies")
 *   tagvocab.js     tags view: translate tags into each language
 *
 * Feature modules register their view with the router when imported; this
 * file handles sign-in, the language switch and boot.
 */
import { $, $$, api, roleAtLeast, setUnauthorizedHandler, state } from "./core.js";
import { applyI18n, roleLabel, setLang, t } from "./i18n.js";
import { route } from "./router.js";
import { loadTagLabels } from "./tags.js";
import { loadPrefs } from "./library.js";
import { clearSelection } from "./bulk.js";
import "./asset.js";
import "./upload.js";
import "./collections.js";
import "./admin.js";
import "./users.js";
import "./tagvocab.js";

applyI18n();

// ---------- auth ----------
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const r = await api("/api/auth/login", { json: { username: $("#login-user").value, password: $("#login-pass").value } });
    state.user = r.user; enterApp();
  } catch (err) {
    console.error("Login failed:", err);
    $("#login-error").textContent = err.message.includes("Too many") ? t("login.locked") : t("login.invalid");
    $("#login-error").classList.remove("hidden");
  }
});
$("#btn-logout").addEventListener("click", logout);
setUnauthorizedHandler(logout);
function logout() {
  // Only the server can clear the HttpOnly session cookie.
  if (state.user) fetch("/api/auth/logout", { method: "POST", headers: { "X-Requested-With": "keepstack" } });
  state.user = null; clearSelection();
  $("#app").classList.add("hidden"); $("#login").classList.remove("hidden");
}

function renderUserLabel() {
  if (state.user) $("#user-label").textContent = `${state.user.username} (${roleLabel(state.user.role)})`;
}

async function enterApp() {
  $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
  renderUserLabel();
  const isAdmin = state.user.role === "admin";
  $$(".admin-only").forEach(el => el.classList.toggle("hidden", !isAdmin));
  $$(".contrib-only").forEach(el => el.classList.toggle("hidden", !roleAtLeast("contributor")));
  // Hide what the role cannot do; the server enforces the same rules.
  $("#btn-upload").classList.toggle("hidden", !roleAtLeast("uploader"));
  $(".tag-import").classList.toggle("hidden", !roleAtLeast("contributor"));
  api("/api/settings").then(s => { state.settings = s; }).catch(() => {});
  const prefs = await loadPrefs();
  // The account's language wins over this browser's; a first choice made on
  // the sign-in screen is saved to the account.
  if (prefs.language) setLang(prefs.language);
  else saveLanguage();
  await loadTagLabels();
  route();
}

// ---------- language ----------
function saveLanguage() {
  if (state.user) api("/api/auth/me/preferences", { method: "PATCH", json: { language: document.documentElement.lang } }).catch(() => {});
}
$$("select.lang-select").forEach(sel => sel.addEventListener("change", () => {
  if (setLang(sel.value)) saveLanguage();
}));
// Re-render what scripts drew (static markup is handled by applyI18n).
document.addEventListener("keepstack:lang-changed", async () => {
  renderUserLabel();
  if (!state.user) return;
  await loadTagLabels();
  route();
});

// ---------- boot ----------
(async function boot() {
  localStorage.removeItem("keepstack_token");  // tokens used to live here; now an HttpOnly cookie
  try { state.user = await api("/api/auth/me"); enterApp(); return; } catch {}
  $("#login").classList.remove("hidden");
})();
