// Every view has its own URL (/library, /collections, ...) and the library's
// search, filters and page live in the query string, so back/forward,
// refresh and shared links all land on the same screen. Views register a
// loader here; the router never imports them, which keeps imports one-way.
import { $$, isPlainClick, roleAtLeast, state } from "./core.js";

const VIEWS = ["library", "collections", "tags", "dashboard", "users", "audit"];
// Views a role below this cannot open (the server checks the same).
const MIN_ROLE = { tags: "contributor", dashboard: "admin", users: "admin", audit: "admin" };
const loaders = {};

export const currentView = () => location.pathname.replace(/^\/+|\/+$/g, "") || "library";

export function registerView(name, loader) { loaders[name] = loader; }

export function navigate(url) {
  if (url !== location.pathname + location.search) history.pushState(null, "", url);
  route();
}

export function route() {
  let view = currentView();
  if (!VIEWS.includes(view) || (MIN_ROLE[view] && !roleAtLeast(MIN_ROLE[view]))) {
    view = "library"; history.replaceState(null, "", "/library");
  }
  $$(".nav-item").forEach(a => a.classList.toggle("active", a.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("hidden", v.id !== "view-" + view));
  loaders[view]?.();
}

window.addEventListener("popstate", () => { if (state.user) route(); });
$$(".nav-item").forEach(a => a.addEventListener("click", (e) => {
  if (!isPlainClick(e)) return;
  e.preventDefault();
  navigate(a.getAttribute("href"));
}));
