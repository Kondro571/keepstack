// Collections view: list collections; a card opens the library filtered to it.
import { $, $$, api, esc } from "./core.js";
import { t } from "./i18n.js";
import { navigate, registerView } from "./router.js";

async function loadCollections() {
  const data = await api("/api/collections");
  $("#collection-list").innerHTML = data.collections.map(c =>
    `<div class="collection-card" data-id="${c.id}"><span class="n">${esc(c.name)}</span><span class="muted">${esc(t("collections.assets", { n: c.asset_count }))}</span><span class="muted">${esc(c.description||"")}</span></div>`).join("")
    || `<p class="muted">${esc(t("collections.none"))}</p>`;
  $$("#collection-list .collection-card").forEach(card => card.addEventListener("click", () => {
    navigate("/library?collection=" + encodeURIComponent(card.dataset.id));
  }));
}
registerView("collections", loadCollections);

$("#btn-new-collection").addEventListener("click", async () => {
  const name = prompt(t("collections.namePrompt")); if (!name) return;
  await api("/api/collections", { json: { name } }); loadCollections();
});
