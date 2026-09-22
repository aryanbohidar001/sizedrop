(() => {
  const $ = id => document.getElementById(id);
  const MAX = 50 * 1024 * 1024;
  let selected = null, outputUrl = null;
  const fmt = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(2)} MB`;
  const getTargetSize = () => {
    const selectedTarget = Number($("targetSize").value || 0);
    const customValue = Number($("customTargetSize").value || 0);
    if (customValue > 0) return customValue * 1024;
    return selectedTarget;
  };
  const setProgress = (n, text) => { $("progressBox").classList.remove("hidden"); $("progressBar").style.width = `${n}%`; $("progressPercent").textContent = `${n}%`; $("progressText").textContent = text; };

  const compressWithTarget = async (canvas, mime, baseQuality, targetSize) => {
    if (!targetSize) return await new Promise(resolve => canvas.toBlob(resolve, mime, baseQuality));
    let quality = baseQuality;
    let lastBlob = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      lastBlob = await new Promise(resolve => canvas.toBlob(resolve, mime, quality));
      if (!lastBlob) return null;
      if (lastBlob.size <= targetSize) return lastBlob;
      quality *= 0.72;
      if (quality < 0.08) break;
    }
    return lastBlob;
  };

  const choose = file => {
    if (!file) return;
    if (file.size > MAX) return alert("This file is larger than the 50 MB limit.");
    const ok = ["image/jpeg","image/png","image/webp","application/pdf"].includes(file.type) ||
      /\.(jpe?g|png|webp|pdf)$/i.test(file.name);
    if (!ok) return alert("Please choose a JPG, PNG, WebP or PDF file.");
    selected = file;
    $("fileName").textContent = file.name;
    $("fileMeta").textContent = `${file.type || "file"} • ${fmt(file.size)}`;
    $("workspace").classList.remove("hidden"); $("result").classList.add("hidden");
    const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(file.name);
    $("settings").classList.remove("hidden"); $("maxWidth").parentElement.classList.toggle("hidden", !isImage);
    $("pdfInfo").classList.toggle("hidden", isImage);
    $("imagePreviewWrap").classList.toggle("hidden", !isImage);
    if (isImage) $("imagePreview").src = URL.createObjectURL(file);
  };

  const openFilePicker = e => {
    if (e) e.preventDefault();
    $("fileInput").click();
  };

  $("fileInput").addEventListener("click", e => e.stopPropagation());
  $("fileInput").addEventListener("change", e => choose(e.target.files[0]));
  $("dropzone").addEventListener("click", openFilePicker);
  $("dropzone").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") openFilePicker(e); });
  ["dragenter","dragover"].forEach(ev => $("dropzone").addEventListener(ev, e => { e.preventDefault(); $("dropzone").classList.add("drag"); }));
  ["dragleave","drop"].forEach(ev => $("dropzone").addEventListener(ev, e => { e.preventDefault(); $("dropzone").classList.remove("drag"); }));
  $("dropzone").addEventListener("drop", e => choose(e.dataTransfer.files[0]));
  document.querySelector('label[for="fileInput"]')?.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    openFilePicker(e);
  });
  $("quality").addEventListener("input", e => $("qualityValue").textContent = `${e.target.value}%`);
  $("targetSize").addEventListener("change", () => {
    if (Number($("targetSize").value) > 0) $("customTargetSize").value = "";
  });
  $("customTargetSize").addEventListener("input", () => {
    if (Number($("customTargetSize").value) > 0) $("targetSize").value = "0";
  });

  $("removeBtn").addEventListener("click", () => {
    selected = null; $("fileInput").value = ""; $("workspace").classList.add("hidden"); $("result").classList.add("hidden");
  });
  $("againBtn").addEventListener("click", () => $("removeBtn").click());

  async function compressImage(file) {
    setProgress(15, "Reading image…");
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    let w = img.naturalWidth, h = img.naturalHeight;
    const max = Number($("maxWidth").value);
    if (max && w > max) { h = Math.round(h * max / w); w = max; }
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: true }); ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h).data;
    let hasTransparency = false;
    for (let i = 3; i < imageData.length; i += 4) {
      if (imageData[i] < 255) { hasTransparency = true; break; }
    }
    setProgress(55, "Optimizing image…");
    const quality = Number($("quality").value) / 100;
    const mime = file.type === "image/png" && hasTransparency ? "image/png" : "image/jpeg";
    const targetSize = getTargetSize();
    const blob = await compressWithTarget(canvas, mime, quality, targetSize);
    URL.revokeObjectURL(url);
    if (!blob) throw new Error("Could not create compressed image.");
    return { blob, name: file.name.replace(/\.[^.]+$/, "") + (mime === "image/jpeg" ? ".jpg" : ".png") };
  }

  async function loadJsPdf() {
    if (window.jspdf?.jsPDF) return window.jspdf;
    const mod = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm");
    window.jspdf = mod;
    return mod;
  }

  async function compressPdf(file) {
    if (!window.pdfjsLib) throw new Error("PDF libraries are still loading. Please wait a moment and try again.");
    setProgress(5, "Loading PDF…");
    const { jsPDF } = await loadJsPdf();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await window.pdfjsLib.getDocument({data: bytes}).promise;
    const targetSize = getTargetSize();
    let candidateQuality = Number($("quality").value || 70) / 100;
    let lastBlob = null;

    const buildPdf = async qualityValue => {
      let out = null;
      for (let i = 1; i <= pdf.numPages; i++) {
        setProgress(Math.round((i-1)/pdf.numPages*85)+10, `Compressing page ${i} of ${pdf.numPages}…`);
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({scale: 1.5});
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({canvasContext: canvas.getContext("2d"), viewport}).promise;
        const data = canvas.toDataURL("image/jpeg", qualityValue);
        const orientation = viewport.width >= viewport.height ? "landscape" : "portrait";
        const pageW = orientation === "landscape" ? 297 : 210;
        const pageH = orientation === "landscape" ? 210 : 297;
        if (!out) out = new jsPDF({orientation, unit:"mm", format:"a4", compress:true});
        else out.addPage("a4", orientation);
        out.addImage(data, "JPEG", 0, 0, pageW, pageH, undefined, "FAST");
      }
      return out.output("blob");
    };

    if (!targetSize) {
      lastBlob = await buildPdf(candidateQuality);
    } else {
      for (let attempt = 0; attempt < 8; attempt++) {
        lastBlob = await buildPdf(candidateQuality);
        if (lastBlob.size <= targetSize || candidateQuality < 0.12) break;
        candidateQuality *= 0.72;
      }
    }

    setProgress(98, "Building compressed PDF…");
    return {blob: lastBlob, name: file.name.replace(/\.pdf$/i,"") + "-compressed.pdf"};
  }

  $("compressBtn").addEventListener("click", async () => {
    if (!selected) return;
    $("compressBtn").disabled = true;
    try {
      const isPdf = selected.type === "application/pdf" || /\.pdf$/i.test(selected.name);
      const result = isPdf ? await compressPdf(selected) : await compressImage(selected);
      if (outputUrl) URL.revokeObjectURL(outputUrl);
      outputUrl = URL.createObjectURL(result.blob);
      const saved = Math.max(0, (1 - result.blob.size / selected.size) * 100);
      $("beforeSize").textContent = fmt(selected.size);
      $("afterSize").textContent = fmt(result.blob.size);
      $("savedSize").textContent = `${saved.toFixed(1)}%`;
      $("resultMessage").textContent = result.blob.size < selected.size
        ? `Your file is ${saved.toFixed(1)}% smaller.`
        : "This version did not reduce the file size. Try lower quality or a smaller image width.";
      $("downloadBtn").href = outputUrl; $("downloadBtn").download = result.name;
      $("result").classList.remove("hidden");
      setProgress(100, "Done");
      $("result").scrollIntoView({behavior:"smooth", block:"nearest"});
    } catch (err) {
      alert(err.message || "Compression failed. Please try another file.");
    } finally {
      $("compressBtn").disabled = false;
    }
  });

  $("menuBtn").addEventListener("click", () => $("navLinks").classList.toggle("open"));

  // PDF.js 4.x ESM exposes pdfjsLib only through its module. Load it dynamically so
  // the static site works without a build step.
  import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs").then(mod => {
    window.pdfjsLib = mod;
    if (mod.GlobalWorkerOptions) mod.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  }).catch(() => {});
})();
