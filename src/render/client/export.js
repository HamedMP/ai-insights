/* export.js: card -> pixels (SVG foreignObject), MP4 via WebCodecs + Mediabunny, PNG zip, caption text. */
const Exporter = (() => {
  const FPS = 30;
  const cardCss = () => document.getElementById("card-css").textContent;
  let cssCache = null;

  /** Rasterise one card instance at its current frame onto ctx. */
  async function rasterize(inst, ctx) {
    cssCache ??= cardCss();
    const { W, H } = inst;
    const html = new XMLSerializer().serializeToString(inst.el);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><foreignObject x="0" y="0" width="${W}" height="${H}"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${W}px;height:${H}px;overflow:hidden"><style>${cssCache}</style>${html.replace(/transform: scale\([^)]*\);?/, "")}</div></foreignObject></svg>`;
    const img = new Image();
    img.decoding = "sync";
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
  }

  /** Can this browser do the in-page path? Chromium only for now: Safari and Firefox are unverified. */
  let supportP = null;
  function support() {
    return (supportP ??= (async () => {
      const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
      const chromium = brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand)) || /HeadlessChrome/.test(navigator.userAgent);
      if (typeof VideoEncoder === "undefined" || typeof Mediabunny === "undefined") return { ok: false, why: "This browser has no WebCodecs video encoder." };
      try {
        const cfg = await VideoEncoder.isConfigSupported({ codec: "avc1.640028", width: 1920, height: 1080, bitrate: 8e6, framerate: FPS });
        if (!cfg.supported) return { ok: false, why: "This browser cannot encode H.264 at 1080p." };
      } catch (err) { console.warn("encoder probe failed", err); return { ok: false, why: "The video encoder probe failed." }; }
      // foreignObject must not taint the canvas
      try {
        const c = document.createElement("canvas"); c.width = c.height = 4;
        const img = new Image();
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><foreignObject width="4" height="4"><div xmlns="http://www.w3.org/1999/xhtml" style="width:4px;height:4px;background:red"></div></foreignObject></svg>');
        await img.decode();
        c.getContext("2d").drawImage(img, 0, 0);
        c.getContext("2d").getImageData(0, 0, 1, 1);
      } catch (err) { console.warn("foreignObject raster blocked", err); return { ok: false, why: "This browser blocks drawing page content into video frames." }; }
      if (!chromium) return { ok: false, why: "In-page export is only verified in Chrome, Edge and other Chromium browsers.", maybe: true };
      return { ok: true };
    })());
  }

  /**
   * Render cards to an MP4. seq: [{ make: () => inst, ms }]. Returns a Blob, or null when cancelled.
   * onProgress({ frame, frames, card, cards }).
   */
  async function video(seq, W, H, { onProgress, signal } = {}) {
    const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, QUALITY_HIGH } = Mediabunny;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    const src = new CanvasSource(canvas, { codec: "avc", bitrate: QUALITY_HIGH });
    output.addVideoTrack(src, { frameRate: FPS });
    await output.start();
    const frames = seq.reduce((n, s) => n + Math.round((s.ms / 1000) * FPS), 0);
    let f = 0;
    try {
      for (const [ci, item] of seq.entries()) {
        const inst = item.make();
        const n = Math.round((item.ms / 1000) * FPS);
        for (let i = 0; i < n; i++) {
          if (signal && signal.aborted) { await output.cancel(); return null; }
          render(inst, (i * 1000) / FPS);
          await rasterize(inst, ctx);
          const overlay = CardKit.frameOverlay(inst, (i * 1000) / FPS); // future watermark hook: draws nothing today
          if (overlay) ctx.drawImage(overlay, 0, 0, W, H);
          await src.add(f / FPS, 1 / FPS);
          f++;
          if (onProgress && (f % 3 === 0 || f === frames)) onProgress({ frame: f, frames, card: ci + 1, cards: seq.length });
        }
        item.done && item.done(inst);
      }
      await output.finalize();
    } catch (err) {
      try { await output.cancel(); } catch (e2) { console.warn("cancel after failure also failed", e2); }
      throw err;
    }
    return new Blob([output.target.buffer], { type: "video/mp4" });
  }

  async function png(inst, t) {
    render(inst, t ?? inst.dur);
    const canvas = document.createElement("canvas");
    canvas.width = inst.W; canvas.height = inst.H;
    const ctx = canvas.getContext("2d");
    await rasterize(inst, ctx);
    return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
  }

  // ---- minimal store-only ZIP (no compression: PNGs are already compressed)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  async function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [], now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    let offset = 0;
    for (const f of files) {
      const data = new Uint8Array(await f.blob.arrayBuffer()), name = enc.encode(f.name), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const csize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return url;
  }
  return { video, png, zip, download, support, FPS };
})();
