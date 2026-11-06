// Tags view (contributor+): every tag with its usage count and a label per
// interface language. A label is saved when its field loses focus or on
// Enter; an empty field removes it.
import { $, $$, api, errorMessage, esc, isPlainClick, toast } from "./core.js";
import { fmtNum, lang, t } from "./i18n.js";
import { loadTagLabels } from "./tags.js";
import { registerView } from "./router.js";

const PAGE = 100;
let langs = ["en", "pl"], offset = 0, total = 0, seq = 0, searchTimer;

registerView("tags", () => { offset = 0; loadVocab(); });
document.addEventListener("keepstack:lang-changed", () => {
  if (!$("#view-tags").classList.contains("hidden")) loadVocab();
});
$("#tv-search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { offset = 0; loadVocab(); }, 250);
});
$("#tv-missing").addEventListener("change", () => { offset = 0; loadVocab(); });

async function loadVocab() {
  const p = new URLSearchParams({ q: $("#tv-search").value.trim(), limit: PAGE, offset });
  if ($("#tv-missing").checked) p.set("missing", lang);
  const mine = ++seq;
  const data = await api("/api/tags/vocabulary?" + p);
  if (mine !== seq) return;  // a newer search superseded this one
  langs = data.langs; total = data.total;
  $("#tv-head").innerHTML = `<th>${esc(t("tv.colTag"))}</th><th class="num">${esc(t("tv.colFiles"))}</th>`
    + langs.map(l => `<th>${esc(t("tv.lang." + l))}</th>`).join("");
  $("#tv-rows").innerHTML = data.items.map(tag => `<tr data-id="${tag.id}">
      <td><strong>${esc(tag.name)}</strong></td>
      <td class="num">${fmtNum(tag.count)}</td>
      ${langs.map(l => {
        const tr = tag.translations[l];
        return `<td><input class="tv-input${tr?.source === "auto" ? " auto" : ""}" data-lang="${l}" maxlength="100"
          value="${esc(tr?.label || "")}" data-saved="${esc(tr?.label || "")}" placeholder="${esc(tag.name)}"
          aria-label="${esc(t("tv.lang." + l))}: ${esc(tag.name)}"
          ${tr?.source === "auto" ? `title="${esc(t("tv.auto"))}"` : ""}></td>`;
      }).join("")}
    </tr>`).join("") || `<tr><td colspan="${2 + langs.length}" class="muted">${esc(t("tv.none"))}</td></tr>`;
  renderPager();
}

function renderPager() {
  const pager = $("#tv-pager");
  pager.classList.toggle("hidden", total <= PAGE);
  if (total <= PAGE) { pager.innerHTML = ""; return; }
  const to = Math.min(offset + PAGE, total);
  pager.innerHTML = (offset > 0 ? `<a class="btn btn-ghost" href="#" data-off="${offset - PAGE}">&lsaquo; ${esc(t("pager.prev"))}</a>` : "")
    + (to < total ? `<a class="btn btn-ghost" href="#" data-off="${offset + PAGE}">${esc(t("pager.next"))} &rsaquo;</a>` : "")
    + `<span class="range muted">${esc(t("pager.range", { from: fmtNum(offset + 1), to: fmtNum(to), total: fmtNum(total) }))}</span>`;
  $$("#tv-pager a").forEach(a => a.addEventListener("click", (e) => {
    if (!isPlainClick(e)) return;
    e.preventDefault(); offset = Number(a.dataset.off); loadVocab();
  }));
}

async function save(input) {
  const label = input.value.trim().toLowerCase();
  if (label === input.dataset.saved) return;
  const row = input.closest("tr"), name = row.querySelector("strong").textContent;
  try {
    const r = await api(`/api/tags/${row.dataset.id}/translations/${input.dataset.lang}`, { method: "PUT", json: { label } });
    input.value = input.dataset.saved = r.label || "";
    input.classList.remove("auto"); input.removeAttribute("title");
    input.classList.add("saved"); setTimeout(() => input.classList.remove("saved"), 1200);
    toast(r.label ? t("tv.saved", { name, label: r.label }) : t("tv.removed", { name }));
    loadTagLabels();  // library and drawer show the new label from now on
  } catch (err) {
    toast(errorMessage(err), "err");
    input.value = input.dataset.saved;
  }
}
$("#tv-rows").addEventListener("change", (e) => { if (e.target.matches(".tv-input")) save(e.target); });
$("#tv-rows").addEventListener("keydown", (e) => {
  if (e.target.matches(".tv-input") && e.key === "Enter") { e.preventDefault(); e.target.blur(); }
  if (e.target.matches(".tv-input") && e.key === "Escape") { e.target.value = e.target.dataset.saved; e.target.blur(); }
});
