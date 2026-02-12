"use strict";

const tog = document.getElementById("tog");
const qSlider = document.getElementById("qSlider");
const qVal = document.getElementById("qVal");
const pSlider = document.getElementById("pSlider");
const pVal = document.getElementById("pVal");
const fSlider = document.getElementById("fSlider");
const fVal = document.getElementById("fVal");
const rSlider = document.getElementById("rSlider");
const rVal = document.getElementById("rVal");

function save() {
  chrome.storage.local.set({
    assx_enabled: tog.checked,
    assx_quality: +qSlider.value / 100,
    assx_passes: +pSlider.value,
    assx_fps: +fSlider.value,
    assx_redact: +rSlider.value / 100,
  });
  qVal.textContent = qSlider.value + " %";
  pVal.textContent = pSlider.value;
  fVal.textContent = fSlider.value;
  rVal.textContent = rSlider.value + " %";
}

chrome.storage.local.get(
  ["assx_enabled", "assx_quality", "assx_passes", "assx_fps", "assx_redact"],
  (d) => {
    if (d.assx_enabled !== undefined) tog.checked = d.assx_enabled;
    if (d.assx_quality !== undefined) qSlider.value = Math.round(d.assx_quality * 100);
    if (d.assx_passes !== undefined) pSlider.value = d.assx_passes;
    if (d.assx_fps !== undefined) fSlider.value = d.assx_fps;
    if (d.assx_redact !== undefined) rSlider.value = Math.round(d.assx_redact * 100);
    qVal.textContent = qSlider.value + " %";
    pVal.textContent = pSlider.value;
    fVal.textContent = fSlider.value;
    rVal.textContent = rSlider.value + " %";
  }
);

tog.addEventListener("change", save);
qSlider.addEventListener("input", save);
pSlider.addEventListener("input", save);
fSlider.addEventListener("input", save);
rSlider.addEventListener("input", save);

document.querySelectorAll(".preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    qSlider.value = btn.dataset.q;
    pSlider.value = btn.dataset.p;
    fSlider.value = btn.dataset.f;
    rSlider.value = btn.dataset.r;
    tog.checked = true;
    save();
  });
});
