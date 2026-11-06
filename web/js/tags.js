// Tag labels in the interface language: a tag keeps one name (used by
// filters, URLs and the API) and is shown by its label when it has one,
// e.g. "dog" appears as "pies" in Polish. Loaded once per sign-in or
// language change, so lists render without extra requests.
import { api } from "./core.js";
import { lang } from "./i18n.js";

let labels = {};

export async function loadTagLabels() {
  try { labels = (await api("/api/tags/labels?lang=" + lang)).labels; } catch { labels = {}; }
}

export const tagLabel = (name) => labels[name] || name;

// For filtering tag lists by what the user types: the name or the label.
export const tagMatches = (name, needle) => name.includes(needle) || (labels[name] || "").includes(needle);
