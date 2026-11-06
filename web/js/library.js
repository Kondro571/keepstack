// Library view: search, sort, paging, the asset grid and the sidebar facets.
import { $, $$, api, esc, fmtBytes, isPlainClick, state } from "./core.js";
import { currentView, registerView, route } from "./router.js";
import { openAsset } from "./asset.js";

let searchTimer;
// typing replaces the history entry instead of adding one per keystroke
$("#search").addEventListener("input", (e) => { state.q = e.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(() => loadLibrary({ push: false }), 250); });
$("#search-mode").addEventListener("change", (e) => { state.mode = e.target.value; loadLibrary(); });
$("#sort").addEventListener("change", (e) => { state.sort = e.target.value; loadLibrary(); });
$("#active-filter").addEventListener("click", () => { state.media = null; state.tag = null; state.collection = null; loadLibrary(); });

const PAGE_SIZES = [10, 50, 100, 500];
let prefPageSize = 50, pageSize = 50, page = 1, lastFilterKey = "", librarySeq = 0;
const filterKey = () => JSON.stringify([state.q, state.mode, state.sort, state.media, state.tag, state.collection]);
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
  if (state.tag) p.set("tag", state.tag);
  if (state.collection) p.set("collection", state.collection);
  if (state.sort !== "newest") p.set("sort", state.sort);
  if (page > 1) p.set("page", page);
  if (pageSize !== prefPageSize) p.set("size", pageSize);
  const qs = p.toString();
  return "/library" + (qs ? "?" + qs : "");
}
function readLibraryUrl() {
  const p = new URLSearchParams(location.search);
  state.q = p.get("q") || "";
  state.mode = p.get("mode") === "semantic" ? "semantic" : "keyword";
  state.media = p.get("media"); state.tag = p.get("tag"); state.collection = p.get("collection");
  state.sort = ["newest", "oldest", "name", "largest"].includes(p.get("sort")) ? p.get("sort") : "newest";
  page = Math.max(1, parseInt(p.get("page"), 10) || 1);
  const size = parseInt(p.get("size"), 10);
  pageSize = PAGE_SIZES.includes(size) ? size : prefPageSize;
  lastFilterKey = filterKey();  // the page in the URL must not be reset as a "new search"
  $("#search").value = state.q; $("#search-mode").value = state.mode;
  $("#sort").value = state.sort; $("#page-size").value = String(pageSize);
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
  const url = libraryUrl();
  if (url !== location.pathname + location.search) history[push || fromOtherView ? "pushState" : "replaceState"](null, "", url);
  if (fromOtherView) return route();
  const p = new URLSearchParams({ q: state.q, sort: state.sort, mode: state.mode,
    limit: String(pageSize), offset: String((page - 1) * pageSize) });
  if (state.media) p.set("media_type", state.media);
  if (state.tag) p.set("tag", state.tag);
  if (state.collection) p.set("collection_id", state.collection);
  const seq = ++librarySeq;
  const data = await api("/api/assets?" + p.toString());
  if (seq !== librarySeq) return;  // a newer request (e.g. further typing) superseded this one
  if (!data.items.length && page > 1 && data.total) {  // e.g. last item on the last page deleted
    page = Math.ceil(data.total / pageSize); return loadLibrary({ push: false });
  }
  renderFacets(data.facets);
  renderGrid(data.items, data.total);
  renderPager(data.total);
  const filt = state.media || (state.tag ? "#" + state.tag : null) || (state.collection ? "collection" : null);
  $("#active-filter").classList.toggle("hidden", !filt);
  if (filt) $("#active-filter").textContent = filt;
}

function renderGrid(items, total) {
  $("#result-title").textContent = state.q ? `Results (${total})` : `Library (${total})`;
  $("#empty").classList.toggle("hidden", items.length > 0);
  $("#grid").innerHTML = items.map(a => `
    <div class="card" data-uuid="${a.uuid}">
      <img class="thumb" loading="lazy" src="/api/assets/${a.uuid}/thumb" alt="${esc(a.alt_text || a.title)}">
      <div class="meta">
        <span class="title" title="${esc(a.title)}">${esc(a.title)}</span>
        <span class="sub"><span class="badge">${a.media_type}</span><span>${fmtBytes(a.size)}</span></span>
      </div>
    </div>`).join("");
  $$("#grid .card").forEach(c => c.addEventListener("click", () => openAsset(c.dataset.uuid)));
}

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
    `<li class="${state.tag===t.value?'active':''}" data-tag="${esc(t.value)}"><span>${esc(t.value)}</span><span class="count">${t.count}</span></li>`).join("");
  $$("#facet-media li").forEach(li => li.addEventListener("click", () => { state.media = state.media===li.dataset.media?null:li.dataset.media; loadLibrary(); }));
  $$("#facet-tags li").forEach(li => li.addEventListener("click", () => { state.tag = state.tag===li.dataset.tag?null:li.dataset.tag; loadLibrary(); }));
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
