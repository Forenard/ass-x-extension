// ============================================================
// Ass X — MAIN World Injector (document_start)
// ============================================================
// Runs BEFORE any page JavaScript (React, etc).
// Two-layer defense:
//   Layer 1: Hooks img.src/srcset/setAttribute/innerHTML setters
//   Layer 2: MutationObserver catches ANYTHING that slips through
//
// Video compression is fixed at 2 passes for performance
// regardless of the image passes setting.
// ============================================================

(() => {
  "use strict";

  const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const TWITTER_MEDIA_RE = /pbs\.twimg\.com|abs\.twimg\.com/;

  function isTwitterMedia(url) {
    if (!url || typeof url !== "string") return false;
    if (url.charCodeAt(0) === 100 && url.startsWith("data:")) return false;
    return TWITTER_MEDIA_RE.test(url);
  }

  function isOff() {
    return document.documentElement &&
           document.documentElement.hasAttribute("data-assx-off");
  }

  // ---- Save original descriptors ----
  const imgProto = HTMLImageElement.prototype;
  const srcDesc = Object.getOwnPropertyDescriptor(imgProto, "src");
  const srcsetDesc = Object.getOwnPropertyDescriptor(imgProto, "srcset");
  const origSetAttr = Element.prototype.setAttribute;

  // Helper: blank a twitter image
  function blankImg(img) {
    const currentSrc = srcDesc.get.call(img);
    if (isTwitterMedia(currentSrc)) {
      origSetAttr.call(img, "data-assx-real-src", currentSrc);
      srcDesc.set.call(img, BLANK);
      return true;
    }
    return false;
  }

  function blankImgSrcset(img) {
    if (!srcsetDesc) return false;
    const currentSrcset = srcsetDesc.get.call(img);
    if (currentSrcset && isTwitterMedia(currentSrcset)) {
      origSetAttr.call(img, "data-assx-real-srcset", currentSrcset);
      srcsetDesc.set.call(img, "");
      return true;
    }
    return false;
  }

  // ============================================================
  // LAYER 1: Prototype hooks
  // ============================================================

  if (srcDesc && srcDesc.set) {
    Object.defineProperty(imgProto, "src", {
      get() { return srcDesc.get.call(this); },
      set(val) {
        if (!isOff() && isTwitterMedia(val)) {
          origSetAttr.call(this, "data-assx-real-src", val);
          srcDesc.set.call(this, BLANK);
        } else {
          srcDesc.set.call(this, val);
        }
      },
      configurable: true,
      enumerable: true,
    });
  }

  if (srcsetDesc && srcsetDesc.set) {
    Object.defineProperty(imgProto, "srcset", {
      get() { return srcsetDesc.get.call(this); },
      set(val) {
        if (!isOff() && isTwitterMedia(val)) {
          origSetAttr.call(this, "data-assx-real-srcset", val);
          srcsetDesc.set.call(this, "");
        } else {
          srcsetDesc.set.call(this, val);
        }
      },
      configurable: true,
      enumerable: true,
    });
  }

  Element.prototype.setAttribute = function (name, value) {
    if (!isOff() && this instanceof HTMLImageElement) {
      if (name === "src" && isTwitterMedia(value)) {
        origSetAttr.call(this, "data-assx-real-src", value);
        origSetAttr.call(this, "src", BLANK);
        return;
      }
      if (name === "srcset" && isTwitterMedia(value)) {
        origSetAttr.call(this, "data-assx-real-srcset", value);
        origSetAttr.call(this, "srcset", "");
        return;
      }
    }
    origSetAttr.call(this, name, value);
  };

  const origCloneNode = Node.prototype.cloneNode;
  Node.prototype.cloneNode = function (deep) {
    const clone = origCloneNode.call(this, deep);
    if (!isOff()) {
      if (clone instanceof HTMLImageElement) {
        blankImg(clone);
        blankImgSrcset(clone);
      }
      if (deep && clone.querySelectorAll) {
        const imgs = clone.querySelectorAll("img");
        for (let i = 0; i < imgs.length; i++) {
          blankImg(imgs[i]);
          blankImgSrcset(imgs[i]);
        }
      }
    }
    return clone;
  };

  const innerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  if (innerHTMLDesc && innerHTMLDesc.set) {
    Object.defineProperty(Element.prototype, "innerHTML", {
      get() { return innerHTMLDesc.get.call(this); },
      set(val) {
        innerHTMLDesc.set.call(this, val);
        if (!isOff() && val && TWITTER_MEDIA_RE.test(val)) {
          const imgs = this.querySelectorAll("img");
          for (let i = 0; i < imgs.length; i++) blankImg(imgs[i]);
        }
      },
      configurable: true,
      enumerable: true,
    });
  }

  const outerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, "outerHTML");
  if (outerHTMLDesc && outerHTMLDesc.set) {
    Object.defineProperty(Element.prototype, "outerHTML", {
      get() { return outerHTMLDesc.get.call(this); },
      set(val) {
        const parent = this.parentElement;
        outerHTMLDesc.set.call(this, val);
        if (!isOff() && parent && val && TWITTER_MEDIA_RE.test(val)) {
          const imgs = parent.querySelectorAll("img");
          for (let i = 0; i < imgs.length; i++) blankImg(imgs[i]);
        }
      },
      configurable: true,
      enumerable: true,
    });
  }

  const origInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (position, text) {
    origInsertAdjacentHTML.call(this, position, text);
    if (!isOff() && text && TWITTER_MEDIA_RE.test(text)) {
      const container = (position === "beforebegin" || position === "afterend")
        ? this.parentElement : this;
      if (container) {
        const imgs = container.querySelectorAll("img");
        for (let i = 0; i < imgs.length; i++) blankImg(imgs[i]);
      }
    }
  };

  const origParseFromString = DOMParser.prototype.parseFromString;
  DOMParser.prototype.parseFromString = function (str, type) {
    const doc = origParseFromString.call(this, str, type);
    if (!isOff() && str && TWITTER_MEDIA_RE.test(str)) {
      const imgs = doc.querySelectorAll("img");
      for (let i = 0; i < imgs.length; i++) blankImg(imgs[i]);
    }
    return doc;
  };

  const origCreateContextualFragment = Range.prototype.createContextualFragment;
  Range.prototype.createContextualFragment = function (html) {
    const frag = origCreateContextualFragment.call(this, html);
    if (!isOff() && html && TWITTER_MEDIA_RE.test(html)) {
      const imgs = frag.querySelectorAll("img");
      for (let i = 0; i < imgs.length; i++) blankImg(imgs[i]);
    }
    return frag;
  };

  // ============================================================
  // LAYER 2: MutationObserver safety net
  // ============================================================
  // Catches EVERYTHING that bypasses Layer 1:
  // - React internal property descriptor caching
  // - Reflect.set / native setter calls
  // - Any unknown bypass method
  // ============================================================

  function scanNode(node) {
    if (isOff()) return;
    if (node.nodeType === 1 && node.nodeName === "IMG") {
      blankImg(node);
    }
    if (node.nodeType === 1 && node.querySelectorAll) {
      const imgs = node.querySelectorAll("img");
      for (let i = 0; i < imgs.length; i++) {
        blankImg(imgs[i]);
      }
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (isOff()) return;
    for (let i = 0; i < mutations.length; i++) {
      const mut = mutations[i];

      if (mut.type === "childList") {
        const added = mut.addedNodes;
        for (let j = 0; j < added.length; j++) {
          scanNode(added[j]);
        }
      }

      if (
        mut.type === "attributes" &&
        mut.attributeName === "src" &&
        mut.target.nodeName === "IMG"
      ) {
        const img = mut.target;
        const current = srcDesc.get.call(img);
        // Skip if already blanked
        if (current === BLANK) continue;
        if (current && current.startsWith("data:")) continue;
        blankImg(img);
      }
    }
  });

  function startObserver() {
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src"],
      });
    } else {
      const earlyObserver = new MutationObserver(() => {
        if (document.documentElement) {
          earlyObserver.disconnect();
          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["src"],
          });
        }
      });
      earlyObserver.observe(document, { childList: true, subtree: true });
    }
  }

  startObserver();


})();
