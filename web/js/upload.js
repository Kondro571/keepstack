// Upload dialog: file upload (drag and drop or browse) and bulk tag import.
import { $, api, esc, notifyCatalogChanged } from "./core.js";

const uploadModal = $("#upload-modal");
$("#btn-upload").addEventListener("click", () => { uploadModal.classList.remove("hidden"); document.body.classList.add("modal-open"); });
$("#upload-cancel").addEventListener("click", () => { uploadModal.classList.add("hidden"); document.body.classList.remove("modal-open"); notifyCatalogChanged(); });
$("#upload-modal .modal-backdrop").addEventListener("click", () => { uploadModal.classList.add("hidden"); document.body.classList.remove("modal-open"); });
const dz = $("#dropzone"), fileInput = $("#file-input");
dz.addEventListener("click", () => fileInput.click());
dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag"); });
dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("drag"); uploadFiles(e.dataTransfer.files); });
fileInput.addEventListener("change", () => uploadFiles(fileInput.files));

async function uploadFiles(files) {
  const list = $("#upload-list");
  for (const file of files) {
    const row = document.createElement("div");
    row.className = "upload-item"; row.innerHTML = `<span>${esc(file.name)}</span><span>uploading...</span>`;
    list.prepend(row);
    const fd = new FormData(); fd.append("files", file); fd.append("run_ai", $("#ai-toggle").checked);
    try {
      const r = await api("/api/assets", { method: "POST", body: fd });
      const created = r.created[0];
      row.classList.add(created.duplicate ? "dup" : "ok");
      row.lastChild.textContent = created.duplicate ? "duplicate (deduped)" : "done";
    } catch (err) { row.classList.add("err"); row.lastChild.textContent = "failed"; }
  }
}

// ---------- tag import ----------
const tagImportInput = $("#tag-import-input");
$("#btn-tag-import").addEventListener("click", () => tagImportInput.click());
tagImportInput.addEventListener("change", async () => {
  const file = tagImportInput.files[0]; tagImportInput.value = "";
  if (!file) return;
  const row = document.createElement("div");
  row.className = "upload-item"; row.innerHTML = `<span>${esc(file.name)}</span><span>importing...</span>`;
  $("#tag-import-result").prepend(row);
  const fd = new FormData(); fd.append("file", file);
  try {
    const r = await api("/api/tags/import", { method: "POST", body: fd });
    row.classList.add(r.unmatched.length ? "dup" : "ok");
    row.lastChild.textContent = `${r.assets_tagged} files tagged, ${r.tags_added} tags added`;
    if (r.unmatched.length) {
      const miss = document.createElement("div");
      miss.className = "upload-item err";
      miss.innerHTML = `<span>Not found (${r.unmatched.length}): ${esc(r.unmatched.slice(0, 20).join(", "))}${r.unmatched.length > 20 ? "..." : ""}</span>`;
      row.after(miss);
    }
  } catch (err) {
    row.classList.add("err");
    let msg = "failed";
    try { msg = JSON.parse(err.message).detail || msg; } catch {}
    row.lastChild.textContent = msg;
  }
});
