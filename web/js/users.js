// Users view (admin): list, add, edit, change role, activate/deactivate, delete.
import { $, $$, api, errorMessage, esc, state, toast } from "./core.js";
import { registerView } from "./router.js";
import { roleDesc, roleLabel as roleName, t } from "./i18n.js";

let roles = [];       // [{name, label, description, offered}] from the server
let users = [];
let editing = null;   // user being edited, or null when adding

const roleLabel = (name) => roleName(name, roles.find(r => r.name === name)?.label);
// Offered roles, plus the user's current role if it is a legacy one (e.g. editor).
const rolesFor = (current) => roles.filter(r => r.offered || r.name === current);

async function loadUsers() {
  if (!roles.length) roles = (await api("/api/roles")).roles;
  users = (await api("/api/users")).users;
  renderUsers();
}
registerView("users", loadUsers);

function renderUsers() {
  $("#user-rows").innerHTML = users.map(u => {
    const self = u.id === state.user.id;
    const roleSelect = `<select class="role-select" data-id="${u.id}" ${self ? `disabled title="${esc(t("users.ownRole"))}"` : ""}>
      ${rolesFor(u.role).map(r => `<option value="${r.name}" ${r.name === u.role ? "selected" : ""}>${esc(roleLabel(r.name))}</option>`).join("")}
    </select>`;
    return `<tr>
      <td><strong>${esc(u.username)}</strong>${self ? ` <span class="muted">${esc(t("users.you"))}</span>` : ""}
        ${u.full_name ? `<span class="sub">${esc(u.full_name)}</span>` : ""}</td>
      <td>${esc(u.email || "")}</td>
      <td>${roleSelect}</td>
      <td><span class="status ${u.is_active ? "on" : "off"}">${esc(t(u.is_active ? "users.active" : "users.disabled"))}</span></td>
      <td>${(u.last_login || "").slice(0, 16).replace("T", " ") || `<span class="muted">${esc(t("users.never"))}</span>`}</td>
      <td class="actions">
        <button class="btn btn-ghost" data-edit="${u.id}">${esc(t("users.edit"))}</button>
        ${self ? "" : `<button class="btn btn-ghost" data-toggle="${u.id}">${esc(t(u.is_active ? "users.disable" : "users.enable"))}</button>
        <button class="btn btn-danger" data-delete="${u.id}">${esc(t("common.delete"))}</button>`}
      </td>
    </tr>`;
  }).join("");

  $$("#user-rows .role-select").forEach(sel => sel.addEventListener("change", async () => {
    const u = users.find(x => x.id === Number(sel.dataset.id));
    await saveUser(u, { role: sel.value }, t("users.nowRole", { user: u.username, role: roleLabel(sel.value) }));
  }));
  $$("#user-rows [data-toggle]").forEach(b => b.addEventListener("click", async () => {
    const u = users.find(x => x.id === Number(b.dataset.toggle));
    await saveUser(u, { is_active: !u.is_active }, t(u.is_active ? "users.wasDisabled" : "users.wasEnabled", { user: u.username }));
  }));
  $$("#user-rows [data-edit]").forEach(b => b.addEventListener("click", () =>
    openUserForm(users.find(x => x.id === Number(b.dataset.edit)))));
  $$("#user-rows [data-delete]").forEach(b => b.addEventListener("click", async () => {
    const u = users.find(x => x.id === Number(b.dataset.delete));
    if (!confirm(t("users.confirmDelete", { user: u.username }))) return;
    try {
      await api("/api/users/" + u.id, { method: "DELETE" });
      toast(t("users.deleted", { user: u.username })); loadUsers();
    } catch (err) { toast(errorMessage(err), "err"); }
  }));
}

// Quick inline change; on failure the table re-renders with the stored value.
async function saveUser(u, changes, message) {
  try {
    const updated = await api("/api/users/" + u.id, { method: "PATCH", json: changes });
    users = users.map(x => x.id === u.id ? updated : x);
    toast(message);
  } catch (err) { toast(errorMessage(err), "err"); }
  renderUsers();
}

// ---------- add / edit form ----------
const modal = $("#user-modal");
$("#btn-new-user").addEventListener("click", () => openUserForm(null));
$("#uf-cancel").addEventListener("click", closeUserForm);
$("#user-modal .modal-backdrop").addEventListener("click", closeUserForm);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.classList.contains("hidden")) closeUserForm(); });

function openUserForm(user) {
  editing = user;
  const self = user?.id === state.user.id;
  $("#uf-title").textContent = user ? t("users.editTitle", { user: user.username }) : t("users.add");
  $("#uf-submit").textContent = t(user ? "asset.saveChanges" : "users.create");
  $("#uf-username").value = user?.username || "";
  $("#uf-username").disabled = !!user;  // the username is the sign-in identity
  $("#uf-full_name").value = user?.full_name || "";
  $("#uf-email").value = user?.email || "";
  $("#uf-password").value = "";
  $("#uf-password-label").textContent = t(user ? "users.fNewPassword" : "users.fPassword");
  const current = user?.role || "viewer";
  $("#uf-roles").innerHTML = rolesFor(current).map(r => `
    <label class="role-option">
      <input type="radio" name="uf-role" value="${r.name}" ${r.name === current ? "checked" : ""} ${self ? "disabled" : ""}>
      <span><span class="name">${esc(roleLabel(r.name))}</span><span class="desc"><br>${esc(roleDesc(r.name, r.description))}</span></span>
    </label>`).join("");
  $("#uf-active").checked = user ? !!user.is_active : true;
  $("#uf-active").disabled = self;
  $("#uf-error").classList.add("hidden");
  modal.classList.remove("hidden"); document.body.classList.add("modal-open");
  (user ? $("#uf-full_name") : $("#uf-username")).focus();
}

function closeUserForm() { modal.classList.add("hidden"); document.body.classList.remove("modal-open"); }

$("#user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    full_name: $("#uf-full_name").value.trim(),
    email: $("#uf-email").value.trim(),
    role: $('input[name="uf-role"]:checked')?.value,
    is_active: $("#uf-active").checked,
  };
  const password = $("#uf-password").value;
  if (password) body.password = password;
  if (!editing) body.username = $("#uf-username").value.trim();
  if (editing?.id === state.user.id) { delete body.role; delete body.is_active; }

  const problem = !editing && body.username.length < 3 ? t("users.errUsername")
    : !editing && !password ? t("users.errPassword")
    : password && password.length < 8 ? t("users.errShort")
    : !body.role && !(editing?.id === state.user.id) ? t("users.errRole") : "";
  if (problem) return showFormError(problem);

  $("#uf-submit").disabled = true;
  try {
    if (editing) await api("/api/users/" + editing.id, { method: "PATCH", json: body });
    else await api("/api/users", { json: body });
    toast(editing ? t("users.updated") : t("users.created", { user: body.username }));
    closeUserForm(); loadUsers();
  } catch (err) { showFormError(errorMessage(err)); }
  finally { $("#uf-submit").disabled = false; }
});

function showFormError(msg) { $("#uf-error").textContent = msg; $("#uf-error").classList.remove("hidden"); }
