/* pdf.js: a minimal PDF writer for the LinkedIn carousel. One page per card, each page one JPEG image (DCTDecode)
   drawn edge to edge. No fonts, no compression of our own, no network: the report's CSP and no-dependency rule
   stay intact. Pure byte work, so tests can build and parse files without a browser. */
const PdfWriter = (() => {
  "use strict";
  // LinkedIn's limits for a document post, from its help pages (checked 2026-11):
  //   https://www.linkedin.com/help/linkedin/answer/a518909  "The file size cannot exceed 100MB and 300 pages."
  //   https://www.linkedin.com/help/linkedin/answer/a564109  the same 100 MB and 300 pages.
  // LinkedIn names no recommended page size; it only asks that every page has the same size, which a deck of
  // square cards always does.
  const LIMITS = Object.freeze({ pages: 300, bytes: 100 * 1000 * 1000 });

  const latin1 = (text) => {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  };
  /** A PDF literal string: printable ASCII only, with the three special characters escaped. */
  const pdfString = (text) => `(${String(text).replace(/[^\x20-\x7e]/g, "").replace(/[\\()]/g, (c) => "\\" + c)})`;

  /**
   * pages: [{ jpeg: Uint8Array, width, height }] in page order (pixel size of each JPEG).
   * opts.size: page edge in points (square pages); opts.title: the document title.
   * Returns the file as a Uint8Array.
   */
  function build(pages, opts = {}) {
    if (!Array.isArray(pages) || pages.length === 0) throw new Error("a PDF needs at least one page");
    const size = Math.max(72, Math.round(opts.size || 1080));
    const chunks = [];
    const offsets = [];
    let length = 0;
    const push = (bytes) => { chunks.push(bytes); length += bytes.length; };
    const text = (s) => push(latin1(s));
    const object = (num, body, stream) => {
      offsets[num] = length;
      text(`${num} 0 obj\n${body}\n`);
      if (stream) { text("stream\n"); push(stream); text("\nendstream\n"); }
      text("endobj\n");
    };

    // 1 catalog, 2 page tree, 3 info, then three objects per page: page, contents, image.
    const pageNum = (i) => 4 + i * 3;
    text("%PDF-1.4\n%âãÏÓ\n");
    object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    object(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageNum(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`);
    object(3, `<< /Title ${pdfString(opts.title || "Recap")} /Producer (AI Insights) >>`);
    pages.forEach((page, i) => {
      if (!(page.jpeg instanceof Uint8Array) || !(page.width > 0) || !(page.height > 0)) throw new Error(`page ${i + 1} has no image`);
      const n = pageNum(i);
      const draw = latin1(`q ${size} 0 0 ${size} 0 0 cm /Im0 Do Q`);
      object(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size} ${size}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${n + 1} 0 R >>`);
      object(n + 1, `<< /Length ${draw.length} >>`, draw);
      object(n + 2, `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`, page.jpeg);
    });

    const count = 4 + pages.length * 3;
    const xref = length;
    // Each xref entry is exactly 20 bytes: 10-digit offset, space, 5-digit generation, space, keyword, CR LF.
    text(`xref\n0 ${count}\n0000000000 65535 f\r\n`);
    for (let num = 1; num < count; num++) text(`${String(offsets[num]).padStart(10, "0")} 00000 n\r\n`);
    text(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
    return out;
  }

  return { LIMITS, build };
})();
