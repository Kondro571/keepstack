// Asset detail drawer: preview, metadata editing, tags, sharing, deletion.
import { $, $$, api, esc, fmtBytes, notifyCatalogChanged, roleAtLeast, toast } from "./core.js";
import { mediaLabel, t } from "./i18n.js";
import { tagLabel } from "./tags.js";

const drawer = $("#drawer");
$("#drawer-close").addEventListener("click", closeDrawer);
$(".drawer-backdrop").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !drawer.classList.contains("hidden")) closeDrawer(); });
function closeDrawer() { drawer.classList.add("hidden"); document.body.classList.remove("modal-open"); openUuid = null; }
let openUuid = null;
// Redraw an open drawer in the new language.
document.addEventListener("keepstack:lang-changed", () => { if (openUuid) openAsset(openUuid); });

export async function openAsset(uuid) {
  drawer.classList.remove("hidden");
  document.body.classList.add("modal-open");
  openUuid = uuid;
  $("#drawer-body").innerHTML = `<p class="muted">${esc(t("common.loading"))}</p>`;
  const [d, meta, sim] = await Promise.all([
    api("/api/assets/" + uuid),
    api("/api/assets/" + uuid + "/metadata"),
    api("/api/assets/" + uuid + "/similar"),
  ]);
  const a = d.asset;
  const canEdit = roleAtLeast("contributor");
  // /preview falls back to the grid thumbnail for files without a usable rendition
  const preview = `<img class="detail-preview" src="/api/assets/${uuid}/preview" alt="${esc(a.alt_text||a.title)}">`;
  const dc = a.dublin_core || {};
  $("#drawer-body").innerHTML = `
    ${preview}
    <h2 class="detail-title">${esc(a.title)}</h2>
    <p class="muted">${esc(mediaLabel(a.media_type))} &middot; ${a.ext?.toUpperCase()} &middot; ${fmtBytes(a.size)} ${a.width?`&middot; ${a.width}&times;${a.height}`:""}</p>
    <div class="btn-row">
      <a class="btn" href="/api/assets/${uuid}/file" download>${esc(t("asset.download"))}</a>
      ${canEdit?`<button class="btn" id="d-share">${esc(t("asset.share"))}</button>`:""}
      ${roleAtLeast("editor")?`<button class="btn btn-danger" id="d-delete">${esc(t("common.delete"))}</button>`:""}
    </div>

    ${canEdit ? `<div class="detail-section"><h4>${esc(t("asset.edit"))}</h4>
      <div class="edit-grid">
        <label>${esc(t("asset.fTitle"))}<input id="e-title" value="${esc(a.title)}"></label>
        <label>${esc(t("asset.fDescription"))}<textarea id="e-description" rows="2">${esc(a.description)}</textarea></label>
        <label>${esc(t("asset.fAlt"))}<input id="e-alt_text" value="${esc(a.alt_text)}"></label>
        <label>${esc(t("asset.fCreator"))}<input id="e-dc_creator" value="${esc(a.dc_creator)}"></label>
        <label>${esc(t("asset.fRights"))}<input id="e-rights_statement" value="${esc(a.rights_statement)}"></label>
        <label>${esc(t("asset.fRetention"))}<input id="e-retention_until" type="date" value="${esc((a.retention_until||'').slice(0,10))}"></label>
      </div>
      <div class="btn-row"><button class="btn btn-primary" id="d-save">${esc(t("asset.saveChanges"))}</button></div></div>` : ""}

    <div class="detail-section"><h4>${esc(t("asset.tags"))}</h4>
      <div class="tag-row" id="tag-row">
        ${d.tags.map(tag => `<span class="tag ${tag.source==='ai'?'ai':''}" title="${esc(tag.name)}">${esc(tagLabel(tag.name))}${canEdit?`<span class="rm" data-tag="${esc(tag.name)}">&times;</span>`:""}</span>`).join("")}
        ${canEdit?`<input class="tag-add" id="tag-add" placeholder="${esc(t("asset.addTag"))}">`:""}
      </div></div>

    ${sim.items.length?`<div class="detail-section"><h4>${esc(t("asset.similar"))}</h4>
      <div class="similar-strip">${sim.items.slice(0,8).map(s=>`<img src="/api/assets/${s.uuid}/thumb" data-uuid="${s.uuid}" title="${esc(s.title)}">`).join("")}</div></div>`:""}

    <div class="detail-section"><h4>Dublin Core</h4>
      ${Object.entries(dc).filter(([,v])=>v).map(([k,v])=>`<div class="field-row"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join("")}
      <div class="btn-row"><a class="btn btn-ghost" href="/oai?verb=GetRecord&metadataPrefix=oai_dc&identifier=oai::${a.uuid}" target="_blank">${esc(t("asset.oai"))}</a></div>
    </div>

    ${Object.keys(meta.exif||{}).length||Object.keys(meta.iptc||{}).length?`<div class="detail-section"><h4>${esc(t("asset.embedded"))}</h4>
      <div class="kv-scroll">${[...Object.entries(meta.iptc||{}),...Object.entries(meta.exif||{})].slice(0,40).map(([k,v])=>`<div class="field-row"><span class="k">${esc(k)}</span><span class="v">${esc(typeof v==='object'?JSON.stringify(v):v)}</span></div>`).join("")}</div></div>`:""}

    ${d.versions.length?`<div class="detail-section"><h4>${esc(t("asset.versions"))}</h4>${d.versions.map(v=>`<div class="field-row"><span class="k">v${v.version_no}</span><span class="v">${esc(v.note||'')} &middot; ${fmtBytes(v.size)} &middot; ${(v.created_at||'').slice(0,10)}</span></div>`).join("")}</div>`:""}
  `;

  // wire detail actions
  $$("#drawer-body .similar-strip img").forEach(img => img.addEventListener("click", () => openAsset(img.dataset.uuid)));
  if (canEdit) {
    $("#d-save")?.addEventListener("click", async () => {
      const body = {};
      ["title","description","alt_text","dc_creator","rights_statement","retention_until"].forEach(f => { const el = $("#e-"+f); if (el) body[f] = el.value; });
      await api("/api/assets/"+uuid, { method: "PATCH", json: body });
      toast(t("asset.saved")); openAsset(uuid); notifyCatalogChanged();
    });
    $("#tag-add")?.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" && e.target.value.trim()) {
        try { await api("/api/assets/"+uuid+"/tags", { json: { name: e.target.value.trim() } }); }
        catch (err) { console.error("Add tag failed:", err); toast(t("asset.tagFailed"), "err"); return; }
        openAsset(uuid);
      }
    });
    $$("#tag-row .rm").forEach(rm => rm.addEventListener("click", async () => {
      await api("/api/assets/"+uuid+"/tags/"+encodeURIComponent(rm.dataset.tag), { method: "DELETE" });
      openAsset(uuid);
    }));
    $("#d-share")?.addEventListener("click", async () => {
      const r = await api("/api/shares", { json: { target_type: "asset", target_id: a.id, permission: "download" } });
      await navigator.clipboard?.writeText(r.url).catch(()=>{});
      toast(t("asset.shareCopied", { url: r.url }));
    });
  }
  $("#d-delete")?.addEventListener("click", async () => {
    if (!confirm(t("asset.confirmDelete"))) return;
    await api("/api/assets/"+uuid, { method: "DELETE" });
    toast(t("asset.deleted")); closeDrawer(); notifyCatalogChanged();
  });
}
