// Multi-select in the library and the bulk action bar (tag, collection, delete).
// The selection is a set of asset uuids that survives paging; library.js clears
// it when the search or filters change, so actions never hit files the user
// can no longer see in the result set.
import { $, $$, api, errorMessage, esc, notifyCatalogChanged, roleAtLeast, toast } from "./core.js";

export const selected = new Set();
let pageUuids = [];      // uuids on the current page, in display order
let anchor = null;       // last toggled uuid, for shift-click ranges
let collections = [];

export const canSelect = () => roleAtLeast("contributor");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function setPage(uuids) { pageUuids = uuids; syncSelectionUi(); }

export function clearSelection() { selected.clear(); anchor = null; syncSelectionUi(); }

export function toggle(uuid, on, { range = false } = {}) {
  if (range && anchor && pageUuids.includes(anchor)) {
    const [from, to] = [pageUuids.indexOf(anchor), pageUuids.indexOf(uuid)].sort((x, y) => x - y);
    pageUuids.slice(from, to + 1).forEach(u => on ? selected.add(u) : selected.delete(u));
  } else {
    on ? selected.add(uuid) : selected.delete(uuid);
  }
  anchor = uuid;
  syncSelectionUi();
}

export function selectPage(on) {
  pageUuids.forEach(u => on ? selected.add(u) : selected.delete(u));
  syncSelectionUi();
}

export function syncSelectionUi() {
  $$("#grid [data-select]").forEach(cb => {
    const on = selected.has(cb.dataset.select);
    cb.checked = on;
    cb.closest(".card, tr")?.classList.toggle("selected", on);
  });
  const onPage = pageUuids.filter(u => selected.has(u)).length;
  const all = pageUuids.length > 0 && onPage === pageUuids.length, some = onPage > 0 && !all;
  [$("#select-page"), $("#grid .select-all")].forEach(cb => { if (cb) { cb.checked = all; cb.indeterminate = some; } });
  $("#grid").classList.toggle("selecting", selected.size > 0);
  renderBar(onPage);
}

function renderBar(onPage) {
  const bar = $("#bulk-bar"), n = selected.size;
  const wasHidden = bar.classList.contains("hidden");
  bar.classList.toggle("hidden", !n);
  if (!n) return;
  const elsewhere = n - onPage;
  $("#bulk-count").textContent = plural(n, "file") + " selected" + (elsewhere ? ` (${elsewhere} on other pages)` : "");
  $("#bulk-delete").classList.toggle("hidden", !roleAtLeast("editor"));
  if (wasHidden) loadCollectionOptions();  // pick up collections created meanwhile
}

async function loadCollectionOptions() {
  try { collections = (await api("/api/collections")).collections; } catch { collections = []; }
  $("#bulk-collection").innerHTML = `<option value="">Add to collection...</option>` +
    collections.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("") +
    `<option value="__new">+ New collection...</option>`;
}

async function run(action, extra, describe) {
  try {
    const r = await api("/api/assets/bulk", { json: { action, uuids: [...selected], ...extra } });
    toast(describe(r));
    if (action === "delete") clearSelection();
    notifyCatalogChanged();
  } catch (err) { toast(errorMessage(err), "err"); }
}

const skipped = (r, why) => r.matched > r.changed ? ` (${r.matched - r.changed} ${why})` : "";

$("#bulk-clear").addEventListener("click", clearSelection);
$("#select-page").addEventListener("change", (e) => selectPage(e.target.checked));

$("#bulk-tag-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const tag = $("#bulk-tag").value.trim();
  if (!tag) return $("#bulk-tag").focus();
  run("tag", { tag }, r => `Tag "${tag.toLowerCase()}" added to ${plural(r.changed, "file")}${skipped(r, "already had it")}`);
});
$("#bulk-untag").addEventListener("click", () => {
  const tag = $("#bulk-tag").value.trim();
  if (!tag) { toast("Type the tag to remove first", "err"); return $("#bulk-tag").focus(); }
  run("untag", { tag }, r => `Tag "${tag.toLowerCase()}" removed from ${plural(r.changed, "file")}${skipped(r, "did not have it")}`);
});

$("#bulk-collection").addEventListener("change", async (e) => {
  let id = e.target.value;
  e.target.value = "";
  if (!id) return;
  let name = collections.find(c => String(c.id) === id)?.name;
  if (id === "__new") {
    name = prompt("New collection name")?.trim();
    if (!name) return;
    try { id = (await api("/api/collections", { json: { name } })).id; }
    catch (err) { return toast(errorMessage(err), "err"); }
    loadCollectionOptions();
  }
  run("collection", { collection_id: Number(id) },
    r => `${plural(r.changed, "file")} added to "${name}"${skipped(r, "already there")}`);
});

$("#bulk-delete").addEventListener("click", () => {
  const n = selected.size;
  if (!confirm(`Delete ${plural(n, "file")}? They disappear from the library for everyone.`)) return;
  run("delete", {}, r => `${plural(r.changed, "file")} deleted`);
});

// Esc clears the selection when no dialog or drawer is open. Capture phase, so
// this sees the state before the drawer's own Esc handler closes it.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && selected.size && !document.body.classList.contains("modal-open")) clearSelection();
}, { capture: true });
