/* Shared helpers and state for the Keepstack client. Vanilla JS, no build step. */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const state = { token: localStorage.getItem("keepstack_token"), user: null,
  q: "", mode: "keyword", media: null, tag: null, sort: "newest", collection: null };

// ---------- API helper ----------
let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, opts = {}) {
  const headers = opts.headers || {};
  if (state.token) headers["Authorization"] = "Bearer " + state.token;
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

// Plain left click; ctrl/shift/middle clicks are left to the browser (new tab).
export const isPlainClick = (e) => e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;

// Assets were added, edited or deleted; views showing the catalog refresh.
export const notifyCatalogChanged = () => document.dispatchEvent(new Event("keepstack:catalog-changed"));
