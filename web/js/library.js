// Library view: search, sort, tag filter, paging, grid/list layout, and the sidebar facets.
import { $, $$, api, esc, fmtBytes, isPlainClick, state } from "./core.js";
import { currentView, registerView, route } from "./router.js";
import { openAsset } from "./asset.js";
import { canSelect, clearSelection, selected, selectPage, setPage, toggle } from "./bulk.js";

let searchTimer;
// typing replaces the history entry instead of adding one per keystroke
$("#search").addEventListener("input", (e) => {
  // a search ranks by best match unless another order was picked
  const defaultOrder = state.sort === defaultSort();
  state.q = e.target.value;
  if (defaultOrder) state.sort = defaultSort();
  syncSortSelect();
  clearTimeout(searchTimer); searchTimer = setTimeout(() => loadLibrary({ push: false }), 250);
});
$("#search-mode").addEventListener("change", (e) => { state.mode = e.target.value; loadLibrary(); });
$("#sort").addEventListener("change", (e) => { state.sort = e.target.value; loadLibrary(); });

// ---------- sorting ----------
const SORTS = ["relevance", "newest", "oldest", "name", "name_desc", "largest", "smallest",
  "type", "type_desc", "dims_desc", "dims"];
const defaultSort = () => state.q ? "relevance" : "newest";
function syncSortSelect() {
  $("#sort option[value=relevance]").disabled = !state.q;
  $("#sort").value = state.sort;
}
// Sortable list columns: [ascending, descending] sort, first click uses `first`.
const SORT_COLUMNS = {
  name: { asc: "name", desc: "name_desc", first: "asc" },
  type: { asc: "type", desc: "type_desc", first: "asc" },
  size: { asc: "smallest", desc: "largest", first: "desc" },
  dims: { asc: "dims", desc: "dims_desc", first: "desc" },
  date: { asc: "oldest", desc: "newest", first: "desc" },
};
function sortHeader(col, label, cls = "") {
  const c = SORT_COLUMNS[col];
  const dir = state.sort === c.asc ? "asc" : state.sort === c.desc ? "desc" : null;
  const aria = dir ? ` aria-sort="${dir === "asc" ? "ascending" : "descending"}"` : "";
  return `<th class="${cls}"${aria}><button type="button" class="th-sort${dir ? " active" : ""}" data-sort-col="${col}"
    title="Sort by ${label.toLowerCase()}">${label}<span class="arrow">${dir === "asc" ? "&#9650;" : dir === "desc" ? "&#9660;" : "&#8693;"}</span></button></th>`;
}
function sortByColumn(col) {
  const c = SORT_COLUMNS[col];
  state.sort = state.sort === c[c.first] ? c[c.first === "asc" ? "desc" : "asc"] : c[c.first];
  syncSortSelect();
  loadLibrary();
}

// ---------- active filters ----------
// One removable chip per filter; clicking a chip drops just that filter.
function renderActiveFilters() {
  const chips = [];
  if (state.media) chips.push(["media", "", state.media, "Media type"]);
  if (state.collection) chips.push(["collection", "", "collection", "Collection"]);
  state.tagsIn.forEach(t => chips.push(["in", t, "#" + t, "Must have tag"]));
  state.tagsOut.forEach(t => chips.push(["out", t, "#" + t, "Must not have tag"]));
  $("#active-filters").innerHTML = chips.map(([kind, val, label, title]) =>
    `<button type="button" class="chip chip-${kind}" data-kind="${kind}" data-value="${esc(val)}" title="${title} (click to remove)">${kind === "out" ? "not " : ""}${esc(label)}</button>`).join("")
    + (chips.length > 1 ? '<button type="button" class="chip-clear btn btn-ghost" data-kind="all">Clear all</button>' : "");
  const n = state.tagsIn.length + state.tagsOut.length;
  $("#tag-filter-count").textContent = n;
  $("#tag-filter-count").classList.toggle("hidden", !n);
}
$("#active-filters").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-kind]");
  if (!chip) return;
  const { kind, value } = chip.dataset;
  if (kind === "media" || kind === "all") state.media = null;
  if (kind === "collection" || kind === "all") state.collection = null;
  if (kind === "in") state.tagsIn = state.tagsIn.filter(t => t !== value);
  if (kind === "out") state.tagsOut = state.tagsOut.filter(t => t !== value);
  if (kind === "all") { state.tagsIn = []; state.tagsOut = []; }
  loadLibrary();
});

// ---------- tag filter panel ----------
// Choices are a draft until Filter is clicked; the list is fetched on open.
const TF_SHOW = 300;  // rows rendered at once; the search box narrows the rest
const draft = { in: new Set(), out: new Set() };
let allTags = [];
const tagPanel = $("#tag-filter");
$("#btn-tag-filter").addEventListener("click", () => tagPanel.classList.contains("hidden") ? openTagFilter() : closeTagFilter());
async function openTagFilter() {
  draft.in = new Set(state.tagsIn); draft.out = new Set(state.tagsOut);
  $("#tf-match").value = state.tagMatch; $("#tf-search").value = "";
  tagPanel.classList.remove("hidden"); $("#btn-tag-filter").setAttribute("aria-expanded", "true");
  $("#tf-list").innerHTML = '<li class="muted">Loading tags...</li>';
  allTags = (await api("/api/tags")).tags.filter(t => t.c > 0 || draft.in.has(t.name) || draft.out.has(t.name));
  renderTagList();
  $("#tf-search").focus();
}
function closeTagFilter() {
  tagPanel.classList.add("hidden"); $("#btn-tag-filter").setAttribute("aria-expanded", "false");
}
function renderTagList() {
  const needle = $("#tf-search").value.trim().toLowerCase();
  // most used first; picking a tag never moves it, so the list stays put while clicking
  const rows = allTags.filter(t => !needle || t.name.includes(needle))
    .sort((a, b) => b.c - a.c || a.name.localeCompare(b.name));
  const shown = rows.slice(0, TF_SHOW);
  $("#tf-list").innerHTML = shown.map(t => {
    const st = draft.in.has(t.name) ? "in" : draft.out.has(t.name) ? "out" : "";
    return `<li class="${st}" data-tag="${esc(t.name)}">
      <span class="tf-name">${esc(t.name)}</span><span class="count">${t.c}</span>
      <button type="button" class="tf-btn in" data-set="in" aria-pressed="${st === "in"}" title="Must have">&#10003;</button>
      <button type="button" class="tf-btn out" data-set="out" aria-pressed="${st === "out"}" title="Must not have">&#10005;</button>
    </li>`;
  }).join("") + (rows.length > TF_SHOW ? `<li class="muted">${rows.length - TF_SHOW} more tags; type to narrow the list</li>`
    : !rows.length ? '<li class="muted">No tags match</li>' : "");
  const parts = [];
  if (draft.in.size) parts.push(`${draft.in.size} must have`);
  if (draft.out.size) parts.push(`${draft.out.size} must not have`);
  $("#tf-summary").textContent = parts.join(", ") || "No tags chosen";
}
$("#tf-search").addEventListener("input", renderTagList);
$("#tf-search").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyTagFilter(); } });
$("#tf-list").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-tag]");
  if (!li) return;
  const name = li.dataset.tag;
  // the buttons set a state (clicking the active one clears it); the row cycles none -> in -> out
  const set = e.target.closest("[data-set]")?.dataset.set
    ?? (draft.in.has(name) ? "out" : draft.out.has(name) ? null : "in");
  const was = draft.in.has(name) ? "in" : draft.out.has(name) ? "out" : null;
  draft.in.delete(name); draft.out.delete(name);
  if (set && !(e.target.closest("[data-set]") && was === set)) draft[set].add(name);
  renderTagList();
});
$("#tf-reset").addEventListener("click", () => { draft.in.clear(); draft.out.clear(); renderTagList(); });
$("#tf-apply").addEventListener("click", applyTagFilter);
function applyTagFilter() {
  state.tagsIn = [...draft.in]; state.tagsOut = [...draft.out]; state.tagMatch = $("#tf-match").value;
  closeTagFilter();
  loadLibrary();
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !tagPanel.classList.contains("hidden")) closeTagFilter();
});

const PAGE_SIZES = [10, 50, 100, 500];
let prefPageSize = 50, pageSize = 50, page = 1, lastFilterKey = "", librarySeq = 0;
const tagKey = () => [state.tagsIn, state.tagsOut, state.tagsIn.length > 1 ? state.tagMatch : ""];
const filterKey = () => JSON.stringify([state.q, state.mode, state.sort, state.media, ...tagKey(), state.collection]);
// Same files regardless of order; a different result set drops the selection.
const resultSetKey = () => JSON.stringify([state.q, state.mode, state.media, ...tagKey(), state.collection]);
let lastResultSetKey = null;

// Grid (cards) or list (rows with tags and details); a per-user preference.
const LAYOUTS = ["grid", "list"];
let layout = "grid", lastPage = null;
$$(".view-toggle [data-layout]").forEach(b => b.addEventListener("click", () => {
  if (layout === b.dataset.layout) return;
  layout = b.dataset.layout;
  api("/api/auth/me/preferences", { method: "PATCH", json: { library_layout: layout } }).catch(() => {});
  if (lastPage) renderResults(lastPage.items, lastPage.total);
}));
$("#page-size").addEventListener("change", (e) => {
  // keep roughly the same place in the list: the first item stays on screen
  const first = (page - 1) * pageSize;
  pageSize = prefPageSize = Number(e.target.value);
  page = Math.floor(first / pageSize) + 1;
  api("/api/auth/me/preferences", { method: "PATCH", json: { page_size: pageSize } }).catch(() => {});
  loadLibrary();
});

// URL <-> library state. Defaults are left out to keep links short.
function libraryUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.mode !== "keyword") p.set("mode", state.mode);
  if (state.media) p.set("media", state.media);
  state.tagsIn.forEach(t => p.append("tag", t));
  state.tagsOut.forEach(t => p.append("not", t));
  if (state.tagsIn.length > 1 && state.tagMatch === "any") p.set("match", "any");
  if (state.collection) p.set("collection", state.collection);
  if (state.sort !== defaultSort()) p.set("sort", state.sort);
  if (page > 1) p.set("page", page);
  if (pageSize !== prefPageSize) p.set("size", pageSize);
  const qs = p.toString();
  return "/library" + (qs ? "?" + qs : "");
}
function readLibraryUrl() {
  const p = new URLSearchParams(location.search);
  state.q = p.get("q") || "";
  state.mode = p.get("mode") === "semantic" ? "semantic" : "keyword";
  state.media = p.get("media"); state.collection = p.get("collection");
  const tags = (key) => [...new Set(p.getAll(key).map(t => t.trim().toLowerCase()).filter(Boolean))];
  state.tagsIn = tags("tag"); state.tagsOut = tags("not").filter(t => !state.tagsIn.includes(t));
  state.tagMatch = p.get("match") === "any" ? "any" : "all";
  state.sort = SORTS.includes(p.get("sort")) && (p.get("sort") !== "relevance" || state.q) ? p.get("sort") : defaultSort();
  page = Math.max(1, parseInt(p.get("page"), 10) || 1);
  const size = parseInt(p.get("size"), 10);
  pageSize = PAGE_SIZES.includes(size) ? size : prefPageSize;
  lastFilterKey = filterKey();  // the page in the URL must not be reset as a "new search"
  $("#search").value = state.q; $("#search-mode").value = state.mode;
  syncSortSelect(); $("#page-size").value = String(pageSize);
}

registerView("library", () => { readLibraryUrl(); loadLibrary({ push: false }); });
document.addEventListener("keepstack:catalog-changed", () => {
  if (currentView() === "library") loadLibrary({ push: false });
});

export async function loadLibrary({ push = true } = {}) {
  // Search box and sidebar filters are on every view; using them elsewhere
  // opens the library.
  const fromOtherView = currentView() !== "library";
  // Any change of search, filter or sort starts again from page 1.
  if (filterKey() !== lastFilterKey) { page = 1; lastFilterKey = filterKey(); }
  if (resultSetKey() !== lastResultSetKey) {
    if (lastResultSetKey !== null && selected.size) clearSelection();
    lastResultSetKey = resultSetKey();
  }
  const url = libraryUrl();
  if (url !== location.pathname + location.search) history[push || fromOtherView ? "pushState" : "replaceState"](null, "", url);
  if (fromOtherView) return route();
  const p = new URLSearchParams({ q: state.q, sort: state.sort, mode: state.mode,
    limit: String(pageSize), offset: String((page - 1) * pageSize) });
  if (state.media) p.set("media_type", state.media);
  state.tagsIn.forEach(t => p.append("tag", t));
  state.tagsOut.forEach(t => p.append("not_tag", t));
  p.set("tag_match", state.tagMatch);
  if (state.collection) p.set("collection_id", state.collection);
  const seq = ++librarySeq;
  const data = await api("/api/assets?" + p.toString());
  if (seq !== librarySeq) return;  // a newer request (e.g. further typing) superseded this one
  if (!data.items.length && page > 1 && data.total) {  // e.g. last item on the last page deleted
    page = Math.ceil(data.total / pageSize); return loadLibrary({ push: false });
  }
  renderFacets(data.facets);
  renderResults(data.items, data.total);
  renderPager(data.total);
  renderActiveFilters();
}

function renderResults(items, total) {
  lastPage = { items, total };
  $("#result-title").textContent = state.q ? `Results (${total})` : `Library (${total})`;
  $("#empty").classList.toggle("hidden", items.length > 0);
  $$(".view-toggle [data-layout]").forEach(b => b.classList.toggle("active", b.dataset.layout === layout));
  const sel = canSelect();
  $(".select-page").classList.toggle("hidden", !sel || !items.length);
  const grid = $("#grid");
  grid.className = layout === "list" ? "results-list" : "grid";
  grid.classList.toggle("can-select", sel);
  const check = (a) => sel ? `<input type="checkbox" data-select="${a.uuid}" aria-label="Select ${esc(a.title)}">` : "";

  if (layout === "list") {
    const tags = (a) => a.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")
      + (a.tag_count > a.tags.length ? `<span class="more">+${a.tag_count - a.tags.length}</span>` : "");
    grid.innerHTML = items.length ? `<table class="asset-list">
      <thead><tr>
        ${sel ? '<th class="col-check"><input type="checkbox" class="select-all" aria-label="Select page"></th>' : ""}
        <th></th>${sortHeader("name", "Name")}${sortHeader("type", "Type", "col-type")}<th class="col-tags">Tags</th>
        ${sortHeader("size", "Size")}${sortHeader("dims", "Dimensions", "col-dims")}${sortHeader("date", "Added", "col-date")}
      </tr></thead>
      <tbody>${items.map(a => `<tr data-uuid="${a.uuid}">
        ${sel ? `<td class="col-check">${check(a)}</td>` : ""}
        <td><img class="mini" loading="lazy" src="/api/assets/${a.uuid}/thumb" alt=""></td>
        <td><div class="name" title="${esc(a.title)}">${esc(a.title)}</div><div class="file" title="${esc(a.filename)}">${esc(a.filename)}</div></td>
        <td class="col-type"><span class="badge">${a.media_type}</span> <span class="num">${esc((a.ext || "").toUpperCase())}</span></td>
        <td class="col-tags"><div class="tags">${tags(a)}</div></td>
        <td class="num">${fmtBytes(a.size)}</td>
        <td class="num col-dims">${a.width ? `${a.width}&times;${a.height}` : "&mdash;"}</td>
        <td class="num col-date">${(a.created_at || "").slice(0, 10)}</td>
      </tr>`).join("")}</tbody></table>` : "";
  } else {
    grid.innerHTML = items.map(a => `
      <div class="card" data-uuid="${a.uuid}">
        ${sel ? `<label class="select-box">${check(a)}</label>` : ""}
        <img class="thumb" loading="lazy" src="/api/assets/${a.uuid}/thumb" alt="${esc(a.alt_text || a.title)}">
        <div class="meta">
          <span class="title" title="${esc(a.title)}">${esc(a.title)}</span>
          <span class="sub"><span class="badge">${a.media_type}</span><span>${fmtBytes(a.size)}</span></span>
        </div>
      </div>`).join("");
  }
  setPage(items.map(a => a.uuid));
}

// One listener for both layouts: checkboxes select, anything else opens the asset.
// Ctrl/Cmd-click selects too, Shift selects a range on the page.
$("#grid").addEventListener("click", (e) => {
  const th = e.target.closest("[data-sort-col]");
  if (th) { sortByColumn(th.dataset.sortCol); return; }
  const cb = e.target.closest("[data-select]");
  if (cb) { toggle(cb.dataset.select, cb.checked, { range: e.shiftKey }); return; }
  if (e.target.closest(".select-box, .col-check")) return;  // padding around a checkbox
  const item = e.target.closest("[data-uuid]");
  if (!item) return;
  if (canSelect() && (e.ctrlKey || e.metaKey || e.shiftKey)) {
    toggle(item.dataset.uuid, !selected.has(item.dataset.uuid), { range: e.shiftKey });
    return;
  }
  openAsset(item.dataset.uuid);
});
$("#grid").addEventListener("change", (e) => { if (e.target.matches(".select-all")) selectPage(e.target.checked); });

function renderPager(total) {
  const pages = Math.ceil(total / pageSize);
  const pager = $("#pager");
  pager.classList.toggle("hidden", pages <= 1);
  if (pages <= 1) { pager.innerHTML = ""; return; }
  // first, last, and two either side of the current page; gaps become "..."
  const nums = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])]
    .filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  const current = page;
  const hrefFor = (n) => { page = n; const u = libraryUrl(); page = current; return u; };
  // real links, so a page can be opened in a new tab or copied
  const btn = (n, label, extra = "") =>
    `<a class="btn btn-ghost ${extra}" href="${esc(hrefFor(n))}" data-page="${n}" ${n === page && !label ? 'aria-current="page"' : ""}>${label || n}</a>`;
  let html = page > 1 ? btn(page - 1, "&lsaquo; Prev") : "";
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) html += '<span class="gap">...</span>';
    html += btn(n, "", n === page ? "current" : "");
  });
  if (page < pages) html += btn(page + 1, "Next &rsaquo;");
  const from = (page - 1) * pageSize + 1, to = Math.min(page * pageSize, total);
  html += `<span class="range muted">${from.toLocaleString()}-${to.toLocaleString()} of ${total.toLocaleString()}</span>`;
  pager.innerHTML = html;
  $$("#pager a").forEach(b => b.addEventListener("click", (e) => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    page = Number(b.dataset.page);
    $(".content").scrollTo?.({ top: 0 }); window.scrollTo({ top: 0 });
    loadLibrary();
  }));
}

function renderFacets(facets) {
  $("#facet-media").innerHTML = (facets.media_types || []).map(m =>
    `<li class="${state.media===m.value?'active':''}" data-media="${m.value}"><span>${m.value}</span><span class="count">${m.count}</span></li>`).join("");
  $("#facet-tags").innerHTML = (facets.tags || []).slice(0, 18).map(t =>
    `<li class="${state.tagsIn.includes(t.value)?'active':state.tagsOut.includes(t.value)?'excluded':''}" data-tag="${esc(t.value)}"><span>${esc(t.value)}</span><span class="count">${t.count}</span></li>`).join("");
  $$("#facet-media li").forEach(li => li.addEventListener("click", () => { state.media = state.media===li.dataset.media?null:li.dataset.media; loadLibrary(); }));
  // a sidebar tag adds to (or drops from) the "must have" tags
  $$("#facet-tags li").forEach(li => li.addEventListener("click", () => {
    const t = li.dataset.tag;
    const had = state.tagsIn.includes(t) || state.tagsOut.includes(t);
    state.tagsIn = state.tagsIn.filter(x => x !== t); state.tagsOut = state.tagsOut.filter(x => x !== t);
    if (!had) state.tagsIn.push(t);
    loadLibrary();
  }));
}

// Collapsed facet groups and page size are stored per user on the server, so
// they follow the account across refreshes and browsers.
let closedFacets = [];
const currentClosedFacets = () => $$(".facet-group[data-group]").filter(x => !x.open).map(x => x.dataset.group);
export async function loadPrefs() {
  let prefs = {};
  try { prefs = await api("/api/auth/me/preferences"); } catch {}
  closedFacets = prefs.facets_closed || [];
  $$(".facet-group[data-group]").forEach(g => { g.open = !closedFacets.includes(g.dataset.group); });
  prefPageSize = PAGE_SIZES.includes(prefs.page_size) ? prefs.page_size : 50;
  layout = LAYOUTS.includes(prefs.library_layout) ? prefs.library_layout : "grid";
}
$$(".facet-group[data-group]").forEach(g => {
  // toggle also fires (async) for programmatic changes; only save real differences
  g.addEventListener("toggle", () => {
    const now = currentClosedFacets();
    if (!state.user || now.join() === closedFacets.join()) return;
    closedFacets = now;
    api("/api/auth/me/preferences", { method: "PATCH", json: { facets_closed: now } }).catch(() => {});
  });
});
