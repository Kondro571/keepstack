// Upload dialog: file upload and bulk tag import, both by drag and drop or browse.
import { $, api, errorMessage, esc, notifyCatalogChanged } from "./core.js";

const uploadModal = $("#upload-modal");
let inFlight = 0;  // uploads/imports still running; their rows must not be cleared

$("#btn-upload").addEventListener("click", () => {
  // Each opening starts clean, unless work from last time is still running.
  if (!inFlight) resetDialog();
  uploadModal.classList.remove("hidden"); document.body.classList.add("modal-open");
});
function closeUpload() { uploadModal.classList.add("hidden"); document.body.classList.remove("modal-open"); notifyCatalogChanged(); }
$("#upload-cancel").addEventListener("click", closeUpload);
$("#upload-modal .modal-backdrop").addEventListener("click", closeUpload);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !uploadModal.classList.contains("hidden")) closeUpload(); });
// A file dropped beside a drop zone would otherwise open in the tab and leave the app.
["dragover", "drop"].forEach(t => uploadModal.addEventListener(t, (e) => e.preventDefault()));

function resetDialog() {
  Object.assign(tally, { total: 0, done: 0, dup: 0, failed: 0 });
  $("#upload-list").innerHTML = "";
  $("#tag-import-result").innerHTML = "";
  $("#upload-summary").classList.add("hidden");
}

// Wire a drop zone: click opens the file picker, dropped or picked files go to `handle`.
function dropZone(zone, input, handle) {
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag"); });
  zone.addEventListener("dragleave", (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove("drag"); });
  zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("drag"); handle([...e.dataTransfer.files]); });
  // reset so picking the same files again still fires "change"
  input.addEventListener("change", () => { handle([...input.files]); input.value = ""; });
}

function addRow(list, name, status) {
  const row = document.createElement("div");
  row.className = "upload-item"; row.innerHTML = `<span>${esc(name)}</span><span>${esc(status)}</span>`;
  list.prepend(row);
  return row;
}

// ---------- file upload ----------
// Running totals for this dialog session, shown above the list.
const tally = { total: 0, done: 0, dup: 0, failed: 0 };
function renderTally() {
  const finished = tally.done + tally.dup + tally.failed;
  const parts = [`${finished} of ${tally.total} processed`];
  if (tally.dup) parts.push(`${tally.dup} duplicate`);
  if (tally.failed) parts.push(`${tally.failed} failed`);
  $("#upload-summary").textContent = parts.join(" · ");
  $("#upload-summary").classList.remove("hidden");
}

dropZone($("#dropzone"), $("#file-input"), uploadFiles);

async function uploadFiles(files) {
  if (!files.length) return;
  tally.total += files.length; renderTally();
  inFlight++;
  try {
    for (const file of files) {
      const row = addRow($("#upload-list"), file.name, "uploading...");
      const fd = new FormData(); fd.append("files", file); fd.append("run_ai", $("#ai-toggle").checked);
      try {
        const r = await api("/api/assets", { method: "POST", body: fd });
        const created = r.created[0];
        row.classList.add(created.duplicate ? "dup" : "ok");
        row.lastChild.textContent = created.duplicate ? "duplicate (deduped)" : "done";
        tally[created.duplicate ? "dup" : "done"]++;
      } catch (err) { row.classList.add("err"); row.lastChild.textContent = "failed"; tally.failed++; }
      renderTally();
    }
  } finally { inFlight--; }
}

// ---------- tag import ----------
const TAG_FILE = /\.(csv|xlsx|xml)$/i;
dropZone($("#tag-dropzone"), $("#tag-import-input"), importTagFiles);

async function importTagFiles(files) {
  inFlight++;
  try {
    for (const file of files) await importTagFile(file);
  } finally { inFlight--; }
}

async function importTagFile(file) {
  const list = $("#tag-import-result");
  const row = addRow(list, file.name, "importing...");
  if (!TAG_FILE.test(file.name)) {
    row.classList.add("err"); row.lastChild.textContent = "use a .csv, .xlsx or .xml file";
    return;
  }
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
    row.lastChild.textContent = errorMessage(err, "failed");
  }
}
