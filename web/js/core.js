/* Shared helpers and state for the Keepstack client. Vanilla JS, no build step. */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const state = { user: null, settings: { max_upload_mb: null },
  q: "", mode: "keyword", media: null, sort: "newest", collection: null,
  tagsIn: [], tagsOut: [], tagMatch: "all" };  // tag filter: must have / must not have

// ---------- API helper ----------
let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

// The session lives in an HttpOnly cookie the browser sends by itself; the
// header marks requests as coming from this client (the server's CSRF check).
export async function api(path, opts = {}) {
  const headers = { "X-Requested-With": "keepstack", ...opts.headers };
  if (opts.json) { headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(opts.json); opts.method ??= "POST"; }
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) { onUnauthorized(); throw new Error("unauthorised"); }
  if (!res.ok) { const t = await res.text(); throw new Error(t || res.statusText); }
  return res.headers.get("content-type")?.includes("json") ? res.json() : res;
}

export function toast(msg, kind = "ok") {
  const t = $("#toast"); t.textContent = msg; t.className = "toast " + kind;
  setTimeout(() => t.classList.add("hidden"), 2600);
}
export const fmtBytes = (b) => { if (!b) return "0 B"; const u = ["B","KB","MB","GB","TB"]; const i = Math.floor(Math.log(b)/Math.log(1024)); return (b/Math.pow(1024,i)).toFixed(i?1:0)+" "+u[i]; };
export const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

// Mirrors auth.ROLES on the server: each role includes the ones after it.
const ROLE_ORDER = ["admin", "editor", "contributor", "uploader", "viewer"];
export const roleAtLeast = (min) =>
  state.user && ROLE_ORDER.indexOf(state.user.role) !== -1 && ROLE_ORDER.indexOf(state.user.role) <= ROLE_ORDER.indexOf(min);

// The API returns errors as {"detail": "..."}; show that text when present.
export function errorMessage(err, fallback = "Something went wrong") {
  try { return JSON.parse(err.message).detail || fallback; } catch { return err.message || fallback; }
}

// Plain left click; ctrl/shift/middle clicks are left to the browser (new tab).
export const isPlainClick = (e) => e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;

// Assets were added, edited or deleted; views showing the catalog refresh.
export const notifyCatalogChanged = () => document.dispatchEvent(new Event("keepstack:catalog-changed"));
