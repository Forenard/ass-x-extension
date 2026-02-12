// ============================================================
// Ass X — Content Script (ISOLATED world)
// ============================================================
// injector.js (MAIN world) hooks img.src setter so that
// pbs.twimg.com URLs are replaced with a blank GIF before
// the browser can fetch/display anything. The real URL is
// stored in data-assx-real-src.
//
// This script (ISOLATED world):
//   1. Reads data-assx-real-src to get the original URL
//   2. Fetches it via fetch() (no img.src involved)
//   3. Compresses it
//   4. Places the compressed version as an overlay
//
// User sees: blank/nothing → compressed. Never the original.
// ============================================================

(() => {
  "use strict";

  let enabled = true;
  let quality = 0.05;
  let passes = 3;
  let videoFps = 8;
  let redactRatio = 0.5;

  const ATTR = "data-assx";
  const REAL_SRC = "data-assx-real-src";
  const OVERLAY_CLASS = "assx-overlay";
  const REDACT_TAG = "assx-r";
  const TEXT_ATTR = "data-assx-text";
  const activeVideos = new Map();
  const overlayRefs = [];

  // -------------------------------------------------------
  // 1. Toggle — uses data attribute on <html> so both
  //    MAIN and ISOLATED worlds can read it.
  // -------------------------------------------------------
  function setEnabled(on) {
    enabled = on;
    if (on) {
      document.documentElement.removeAttribute("data-assx-off");
    } else {
      document.documentElement.setAttribute("data-assx-off", "");
    }
  }

  // -------------------------------------------------------
  // 2. Early crossOrigin for <video>
  // -------------------------------------------------------
  let earlyObs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === "VIDEO" && !node.crossOrigin) {
          node.crossOrigin = "anonymous";
        }
        if (node.querySelectorAll) {
          node.querySelectorAll("video:not([crossorigin])").forEach((v) => {
            v.crossOrigin = "anonymous";
          });
        }
      }
    }
  });
  earlyObs.observe(document.documentElement, { childList: true, subtree: true });
  document.querySelectorAll("video").forEach((v) => {
    if (!v.crossOrigin) v.crossOrigin = "anonymous";
  });

  // -------------------------------------------------------
  // 3. Image queue
  // -------------------------------------------------------
  let activeJobs = 0;
  const MAX_JOBS = 6;
  const jobQueue = [];

  function enqueue(img) {
    jobQueue.push(img);
    drain();
  }

  function drain() {
    while (activeJobs < MAX_JOBS && jobQueue.length) {
      const img = jobQueue.shift();
      if (!document.contains(img)) continue;
      if (img.getAttribute(ATTR) === "done") continue;
      activeJobs++;
      processImage(img).finally(() => { activeJobs--; drain(); });
    }
  }

  // -------------------------------------------------------
  // 4. JPEG multi-pass compression
  // -------------------------------------------------------
  function jpegCompress(source, q, numPasses) {
    return new Promise((resolve, reject) => {
      const srcW = source.naturalWidth || source.videoWidth || source.width;
      const srcH = source.naturalHeight || source.videoHeight || source.height;
      if (!srcW || !srcH) return reject("no size");

      const scale = q < 0.1 ? Math.max(0.12, q * 2) : 1;
      const w = Math.max(4, Math.round(srcW * scale));
      const h = Math.max(4, Math.round(srcH * scale));

      const cvs = document.createElement("canvas");
      cvs.width = w;
      cvs.height = h;
      const ctx = cvs.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(source, 0, 0, w, h);

      const tmp = new Image();
      let left = numPasses;

      function pass() {
        const url = cvs.toDataURL("image/jpeg", q);
        left--;
        if (left <= 0) {
          if (scale < 1) {
            const up = document.createElement("canvas");
            up.width = srcW;
            up.height = srcH;
            const uc = up.getContext("2d");
            uc.imageSmoothingEnabled = false;
            tmp.onload = () => {
              uc.drawImage(tmp, 0, 0, srcW, srcH);
              const result = up.toDataURL("image/jpeg", Math.min(q * 3, 0.5));
              up.width = 0; cvs.width = 0;
              resolve(result);
            };
            tmp.onerror = () => { up.width = 0; cvs.width = 0; reject("up fail"); };
            tmp.src = url;
          } else {
            cvs.width = 0;
            resolve(url);
          }
          return;
        }
        tmp.onload = () => { ctx.drawImage(tmp, 0, 0, w, h); pass(); };
        tmp.onerror = () => { cvs.width = 0; reject("pass fail"); };
        tmp.src = url;
      }
      pass();
    });
  }

  // -------------------------------------------------------
  // 5. Image processing
  //    The real URL is in data-assx-real-src (set by
  //    injector.js hook). The actual img.src is a blank GIF.
  // -------------------------------------------------------
  async function processImage(el) {
    const src = el.getAttribute(REAL_SRC);
    if (!src) {
      el.setAttribute(ATTR, "skip");
      return;
    }

    el.setAttribute(ATTR, "loading");

    try {
      const resp = await fetch(src, { mode: "cors", cache: "default" });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const blob = await resp.blob();
      const bitmap = await createImageBitmap(blob);
      const compressed = await jpegCompress(bitmap, quality, passes);
      bitmap.close();

      if (!document.contains(el) || !enabled) return;

      removeOverlay(el);

      const parent = el.parentElement;
      if (!parent) return;
      ensurePositioned(parent);

      const overlay = document.createElement("img");
      overlay.className = OVERLAY_CLASS;
      overlay.src = compressed;
      overlay.draggable = false;
      overlay.setAttribute("aria-hidden", "true");
      overlay.setAttribute(ATTR, "overlay");

      el._assxOverlay = overlay;
      overlayRefs.push({
        ref: new WeakRef(overlay),
        origRef: new WeakRef(el),
      });

      el.after(overlay);
      el.setAttribute(ATTR, "done");
    } catch (e) {
      el.setAttribute(ATTR, "skip");
    }
  }

  function removeOverlay(el) {
    if (el._assxOverlay) {
      el._assxOverlay.remove();
      el._assxOverlay = null;
    }
  }

  function ensurePositioned(el) {
    const pos = getComputedStyle(el).position;
    if (pos === "static" || pos === "") {
      el.style.position = "relative";
    }
  }

  // -------------------------------------------------------
  // 6. Video processing
  //    Video compression always uses 2 passes for
  //    performance (independent of the image passes setting).
  // -------------------------------------------------------
  const VIDEO_PASSES = 2;

  function processVideo(videoEl) {
    if (activeVideos.has(videoEl)) return;

    if (!videoEl.crossOrigin) {
      videoEl.crossOrigin = "anonymous";
      videoEl.load();
    }

    const canvas = document.createElement("canvas");
    canvas.className = OVERLAY_CLASS;
    canvas.style.objectFit = "";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "0";
    canvas.style.visibility = "hidden";

    const parent = videoEl.parentElement;
    if (!parent) return;
    ensurePositioned(parent);
    videoEl.after(canvas);
    videoEl.setAttribute(ATTR, "video");

    const dCtx = canvas.getContext("2d");
    const buf = document.createElement("canvas");
    const bCtx = buf.getContext("2d");

    const state = { canvas, buf, raf: null, stopped: false, firstFrame: false };
    activeVideos.set(videoEl, state);

    let lastT = 0;
    let prevSW = 0, prevSH = 0;
    const blitImg = new Image();
    let blitPending = false;
    const passImg = new Image();

    blitImg.onload = () => {
      if (state.stopped) { blitPending = false; return; }
      const cw = videoEl.clientWidth;
      const ch = videoEl.clientHeight;
      if (!cw || !ch) { blitPending = false; return; }
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      dCtx.imageSmoothingEnabled = false;
      dCtx.drawImage(blitImg, 0, 0, cw, ch);
      blitPending = false;

      if (!state.firstFrame) {
        state.firstFrame = true;
        canvas.style.visibility = "visible";
      }
    };
    blitImg.onerror = () => { blitPending = false; };

    function loop(ts) {
      if (state.stopped) return;
      state.raf = requestAnimationFrame(loop);

      if (!enabled) {
        canvas.style.visibility = "hidden";
        return;
      }
      if (state.firstFrame) canvas.style.visibility = "visible";

      if (ts - lastT < 1000 / videoFps) return;
      lastT = ts;
      if (blitPending) return;

      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      if (!vw || !vh) return;

      const scale = quality < 0.1 ? Math.max(0.12, quality * 2) : 1;
      const sw = Math.max(4, Math.round(vw * scale));
      const sh = Math.max(4, Math.round(vh * scale));

      if (sw !== prevSW || sh !== prevSH) {
        buf.width = sw;
        buf.height = sh;
        prevSW = sw;
        prevSH = sh;
      }
      bCtx.imageSmoothingEnabled = false;

      let url1;
      try {
        bCtx.drawImage(videoEl, 0, 0, sw, sh);
        url1 = buf.toDataURL("image/jpeg", quality);
      } catch {
        return;
      }

      blitPending = true;

      if (VIDEO_PASSES >= 2) {
        passImg.onload = () => {
          bCtx.drawImage(passImg, 0, 0, sw, sh);
          try {
            blitImg.src = buf.toDataURL("image/jpeg", quality);
          } catch {
            blitImg.src = url1;
          }
        };
        passImg.onerror = () => { blitImg.src = url1; };
        passImg.src = url1;
      } else {
        blitImg.src = url1;
      }
    }

    function startLoop() {
      if (!state.stopped) state.raf = requestAnimationFrame(loop);
    }

    if (videoEl.readyState >= 1) startLoop();
    else videoEl.addEventListener("loadedmetadata", startLoop, { once: true });
  }

  function cleanupVideo(videoEl) {
    const st = activeVideos.get(videoEl);
    if (!st) return;
    st.stopped = true;
    if (st.raf) cancelAnimationFrame(st.raf);
    st.canvas.remove();
    st.buf.width = 0; st.buf.height = 0;
    videoEl.removeAttribute(ATTR);
    activeVideos.delete(videoEl);
  }

  // -------------------------------------------------------
  // 7. Text redaction
  // -------------------------------------------------------
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT",
    "SVG", "MATH", "CODE", "PRE", REDACT_TAG.toUpperCase(),
  ]);

  function shouldSkipNode(node) {
    if (!node.parentElement) return true;
    if (node.parentElement.closest(REDACT_TAG)) return true;
    if (node.parentElement.getAttribute(TEXT_ATTR)) return true;
    let el = node.parentElement;
    while (el) {
      if (SKIP_TAGS.has(el.tagName)) return true;
      if (el.isContentEditable) return true;
      el = el.parentElement;
    }
    return false;
  }

  function redactTextNode(textNode) {
    if (redactRatio <= 0) return;
    const text = textNode.textContent;
    if (!text || text.trim().length === 0) return;
    if (shouldSkipNode(textNode)) return;

    const frag = document.createDocumentFragment();
    let run = "";

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (/\s/.test(ch)) { run += ch; continue; }
      if (Math.random() < redactRatio) {
        if (run) { frag.appendChild(document.createTextNode(run)); run = ""; }
        const r = document.createElement(REDACT_TAG);
        r.textContent = ch;
        frag.appendChild(r);
      } else {
        run += ch;
      }
    }
    if (run) frag.appendChild(document.createTextNode(run));

    if (frag.querySelector(REDACT_TAG)) {
      const wrapper = textNode.parentElement;
      textNode.replaceWith(frag);
      if (wrapper) wrapper.setAttribute(TEXT_ATTR, "1");
    }
  }

  function scanText(root) {
    if (redactRatio <= 0 || !enabled) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent || node.textContent.trim().length < 2) return NodeFilter.FILTER_SKIP;
        if (node.parentElement && node.parentElement.getAttribute(TEXT_ATTR)) return NodeFilter.FILTER_SKIP;
        if (shouldSkipNode(node)) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) redactTextNode(n);
  }

  function removeRedactions() {
    const parents = new Set();
    document.querySelectorAll(REDACT_TAG).forEach((el) => {
      if (el.parentElement) parents.add(el.parentElement);
      el.replaceWith(document.createTextNode(el.textContent));
    });
    document.querySelectorAll(`[${TEXT_ATTR}]`).forEach((el) => {
      el.removeAttribute(TEXT_ATTR);
      parents.add(el);
    });
    parents.forEach((p) => { if (document.contains(p)) p.normalize(); });
  }

  // -------------------------------------------------------
  // 8. Orphan cleanup
  // -------------------------------------------------------
  setInterval(() => {
    activeVideos.forEach((_, el) => {
      if (!document.contains(el)) cleanupVideo(el);
    });
    const kept = [];
    for (const entry of overlayRefs) {
      const overlay = entry.ref.deref();
      const orig = entry.origRef.deref();
      if (!overlay || !orig || !document.contains(orig)) {
        if (overlay) overlay.remove();
      } else {
        kept.push(entry);
      }
    }
    overlayRefs.length = 0;
    overlayRefs.push(...kept);
  }, 3000);

  // -------------------------------------------------------
  // 9. Scan
  //    Look for images that have data-assx-real-src
  //    (set by injector.js hook) but haven't been processed.
  // -------------------------------------------------------
  function scan() {
    if (!enabled) return;

    // Process images that injector has intercepted
    document.querySelectorAll(
      "img[" + REAL_SRC + "]:not([" + ATTR + "])"
    ).forEach((img) => {
      if (img.classList.contains(OVERLAY_CLASS)) return;
      img.setAttribute(ATTR, "queued");
      enqueue(img);
    });

    // Mark non-twitter images as skip
    document.querySelectorAll(
      "img:not([" + ATTR + "]):not([" + REAL_SRC + "])"
    ).forEach((img) => {
      if (img.classList.contains(OVERLAY_CLASS)) return;
      img.setAttribute(ATTR, "skip");
    });

    document.querySelectorAll("video:not([" + ATTR + "])").forEach(processVideo);
    scanText(document.body);
  }

  // -------------------------------------------------------
  // 10. Restore / reprocess
  // -------------------------------------------------------
  function restoreAll() {
    // Tell injector to stop intercepting
    setEnabled(false);

    document.querySelectorAll("." + OVERLAY_CLASS + ":not(canvas)").forEach((o) => o.remove());

    // Restore original src from data-assx-real-src
    // With data-assx-off set, the setter hook passes through
    document.querySelectorAll("img[" + REAL_SRC + "]").forEach((img) => {
      const realSrc = img.getAttribute(REAL_SRC);
      if (realSrc) img.src = realSrc;
      img._assxOverlay = null;
      img.removeAttribute(ATTR);
      img.removeAttribute(REAL_SRC);
      img.removeAttribute("data-assx-real-srcset");
    });

    activeVideos.forEach((_, el) => cleanupVideo(el));
    removeRedactions();
  }

  function reprocess() {
    document.querySelectorAll('img[' + ATTR + '="done"]').forEach((img) => {
      removeOverlay(img);
      img.removeAttribute(ATTR);
      img.setAttribute(ATTR, "queued");
      enqueue(img);
    });
    removeRedactions();
    scanText(document.body);
    scan();
  }

  // -------------------------------------------------------
  // 11. DOM observer
  //     Watch for new nodes AND data-assx-real-src attribute
  //     changes (set by injector.js in MAIN world).
  // -------------------------------------------------------
  let scanTimer = null;
  const contentObs = new MutationObserver(() => {
    if (!enabled) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 80);
  });

  // -------------------------------------------------------
  // 12. Init
  // -------------------------------------------------------
  function init() {
    chrome.storage.local.get(
      ["assx_enabled", "assx_quality", "assx_passes", "assx_fps", "assx_redact"],
      (d) => {
        if (d.assx_enabled !== undefined) {
          setEnabled(d.assx_enabled);
        } else {
          setEnabled(true);
        }
        if (d.assx_quality !== undefined) quality = d.assx_quality;
        if (d.assx_passes !== undefined) passes = d.assx_passes;
        if (d.assx_fps !== undefined) videoFps = d.assx_fps;
        if (d.assx_redact !== undefined) redactRatio = d.assx_redact;

        // earlyObs is no longer needed; contentObs + processVideo handle crossOrigin
        if (earlyObs) { earlyObs.disconnect(); earlyObs = null; }

        if (enabled) scan();
        contentObs.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [REAL_SRC],
        });
      }
    );

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      let changed = false;

      if (changes.assx_enabled) {
        if (changes.assx_enabled.newValue) {
          setEnabled(true);
          changed = true;
        } else {
          restoreAll();
          return;
        }
      }
      if (changes.assx_quality) { quality = changes.assx_quality.newValue; changed = true; }
      if (changes.assx_passes) { passes = changes.assx_passes.newValue; changed = true; }
      if (changes.assx_fps) { videoFps = changes.assx_fps.newValue; }
      if (changes.assx_redact) {
        redactRatio = changes.assx_redact.newValue;
        removeRedactions();
        if (enabled && redactRatio > 0) scanText(document.body);
      }

      if (changed && enabled) reprocess();
    });
  }

  function waitForBody() {
    if (document.body) {
      init();
    } else {
      const bodyObs = new MutationObserver(() => {
        if (document.body) {
          bodyObs.disconnect();
          init();
        }
      });
      bodyObs.observe(document.documentElement, { childList: true });
    }
  }
  waitForBody();
})();
