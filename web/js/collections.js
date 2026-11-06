// Collections view: list collections; a card opens the library filtered to it.
import { $, $$, api, esc } from "./core.js";
import { navigate, registerView } from "./router.js";

async function loadCollections() {
  const data = await api("/api/collections");
  $("#collection-list").innerHTML = data.collections.map(c =>
    `<div class="collection-card" data-id="${c.id}"><span class="n">${esc(c.name)}</span><span class="muted">${c.asset_count} assets</span><span class="muted">${esc(c.description||"")}</span></div>`).join("")
    || '<p class="muted">No collections yet.</p>';
  $$("#collection-list .collection-card").forEach(card => card.addEventListener("click", () => {
    navigate("/library?collection=" + encodeURIComponent(card.dataset.id));
  }));
}
registerView("collections", loadCollections);

$("#btn-new-collection").addEventListener("click", async () => {
  const name = prompt("Collection name"); if (!name) return;
  await api("/api/collections", { json: { name } }); loadCollections();
});
