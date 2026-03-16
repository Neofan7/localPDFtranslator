import { useState, useRef, useEffect, useCallback, useMemo } from "react";

const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
const BATCH = 5;

/* ═══════════ PDF.js Loader ═══════════ */
function loadPdfJs() {
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib) return resolve(window.pdfjsLib);
    const s = document.createElement("script");
    s.src = `${PDFJS_CDN}/pdf.min.js`;
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error("無法載入 PDF 解析引擎"));
    document.head.appendChild(s);
  });
}

/* ═══════════ Text Extraction ═══════════ */
function extractBlocks(textItems, pageH) {
  if (!textItems?.length) return [];
  const parsed = textItems.filter(i => i.str.trim()).map(i => {
    const tx = i.transform;
    const fs = Math.abs(tx[3]) || Math.abs(tx[0]) || 12;
    return { str: i.str, x: tx[4], y: tx[5], fs, w: i.width || 0 };
  });
  parsed.sort((a, b) => b.y - a.y || a.x - b.x);

  // → Lines
  const lines = [];
  let ln = null;
  for (const it of parsed) {
    if (!ln || Math.abs(it.y - ln.y) > it.fs * 0.4) {
      if (ln) lines.push(ln);
      ln = { items: [it], y: it.y, x: it.x, endX: it.x + it.w, fs: it.fs };
    } else {
      ln.items.push(it);
      ln.endX = Math.max(ln.endX, it.x + it.w);
      ln.x = Math.min(ln.x, it.x);
      ln.fs = Math.max(ln.fs, it.fs);
    }
  }
  if (ln) lines.push(ln);

  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    let t = "", prev = l.items[0].x;
    for (const it of l.items) {
      if (it.x - prev > it.fs * 0.25 && t) t += " ";
      t += it.str; prev = it.x + it.w;
    }
    l.text = t; l.width = l.endX - l.x;
  }

  // → Paragraph blocks
  const blocks = [];
  let cur = null, curBullet = false;
  for (const l of lines) {
    if (!l.text.trim()) { if (cur) { blocks.push(cur); cur = null; curBullet = false; } continue; }
    const bullet = /^[\s]*[•●◦▪▸►‣⁃\-–—]\s/.test(l.text) || /^\s*\d+[\.\)]\s/.test(l.text);

    if (!cur) { cur = { lines: [l] }; curBullet = bullet; continue; }

    const prev = cur.lines[cur.lines.length - 1];
    const gap = prev.y - l.y;
    const bfs = prev.fs;
    const consec = gap > 0 && gap < bfs * 2.2;
    const fsChanged = l.fs / cur.lines[0].fs < 0.8 || l.fs / cur.lines[0].fs > 1.2;
    const cont = curBullet && !bullet && Math.abs(l.x - prev.x) < bfs * 3 && consec;
    const bigIndent = !curBullet && Math.abs(l.x - cur.lines[0].x) > bfs * 8;
    const split = fsChanged || bullet || (!cont && (!consec || bigIndent));

    if (split) { blocks.push(cur); cur = { lines: [l] }; curBullet = bullet; }
    else cur.lines.push(l);
  }
  if (cur) blocks.push(cur);

  const allFs = blocks.flatMap(b => b.lines.map(l => l.fs)).sort((a, b) => a - b);
  const median = allFs.length ? allFs[Math.floor(allFs.length / 2)] : 12;

  return blocks.map(b => {
    const text = b.lines.map(l => l.text).join(" ");
    const first = b.lines[0], last = b.lines[b.lines.length - 1];
    const fs = first.fs;
    const left = Math.min(...b.lines.map(l => l.x));
    const right = Math.max(...b.lines.map(l => l.endX));
    const pdfTop = first.y + fs * 0.85;
    const pdfBot = last.y - fs * 0.25;
    return {
      text,
      hasEng: /[a-zA-Z]{2,}/.test(text),
      left, top: pageH - pdfTop,
      width: right - left,
      height: (pageH - pdfBot) - (pageH - pdfTop),
      fontSize: fs,
      lineCount: b.lines.length,
      isTitle: fs > median * 1.15 && b.lines.length <= 3,
      isBullet: /^[\s]*[•●◦▪▸►‣⁃\-–—]\s/.test(text) || /^\s*\d+[\.\)]\s/.test(text),
    };
  });
}

/* ═══════════ Translation Engine ═══════════ */
async function apiCall(prompt, maxTokens = 4000, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!r.ok) { if (i < retries) { await delay(1000 * (i + 1)); continue; } throw new Error(`API ${r.status}`); }
      return (await r.json()).content?.[0]?.text || "";
    } catch (e) { if (i < retries) { await delay(1000 * (i + 1)); continue; } throw e; }
  }
}
const delay = ms => new Promise(r => setTimeout(r, ms));

async function analyzeContext(text) {
  try {
    const raw = await apiCall(`Analyze this document. Return JSON: {"domain":"...","organizations":"...","key_terms":["..."]}\nOnly valid JSON, no markdown.\n\n${text.slice(0, 3000)}`, 600);
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch { return { domain: "general", organizations: "", key_terms: [] }; }
}

async function translateAll(blocks, ctx, onProgress) {
  const results = Array(blocks.length).fill(null);
  const glossary = {};
  const sys = `You translate English→Traditional Chinese (繁體中文) for "${ctx.domain || "general"}".
${ctx.organizations ? `Organizations: ${ctx.organizations}` : ""}
${ctx.key_terms?.length ? `Key terms: ${ctx.key_terms.join(", ")}` : ""}
Rules: precise domain terminology. Keep [N] prefix. Tags (TITLE)/(BULLET)/(BODY) indicate type—omit them in output. TITLE=concise heading. BULLET=list item. BODY=natural paragraph. Proper nouns: keep English in parentheses first time. End with "GLOSSARY:" and "English → 中文" pairs. ONLY output translations+glossary.`;

  for (let i = 0; i < blocks.length; i += BATCH) {
    const chunk = blocks.slice(i, i + BATCH);
    const input = chunk.map((b, j) => {
      const tag = b.isTitle ? "(TITLE)" : b.isBullet ? "(BULLET)" : "(BODY)";
      return `[${i + j}] ${tag} ${b.text}`;
    }).join("\n\n");

    try {
      const raw = await apiCall(`${sys}\n\nTranslate:\n\n${input}`);
      const gIdx = raw.indexOf("GLOSSARY:");
      const tPart = gIdx >= 0 ? raw.slice(0, gIdx) : raw;
      const gPart = gIdx >= 0 ? raw.slice(gIdx + 9) : "";

      let m; const re = /\[(\d+)\]\s*([\s\S]*?)(?=\n\s*\[|\n\s*GLOSSARY|\s*$)/g;
      while ((m = re.exec(tPart))) {
        const idx = parseInt(m[1]);
        if (idx < blocks.length) results[idx] = m[2].trim();
      }
      for (const gl of gPart.split("\n")) {
        const p = gl.split(/→|->/).map(s => s.trim().replace(/^[-•*]\s*/, ""));
        if (p.length === 2 && p[0] && p[1]) glossary[p[0]] = p[1];
      }
    } catch (e) { console.error("Batch error:", e); }
    onProgress?.(Math.min(i + BATCH, blocks.length), blocks.length);
  }
  return { translations: results, glossary };
}

/* ═══════════ Chinese Overlay ═══════════ */
function CnOverlay({ block, translation, scale, visible }) {
  if (!translation) return null;
  const pad = scale * 2;
  const top = block.top * scale - pad;
  const left = block.left * scale - pad;
  const w = block.width * scale + pad * 2;
  const h = block.height * scale + pad * 2;
  const baseFs = block.fontSize * scale;

  let fs = baseFs;
  if (!block.isTitle) {
    const cpl = Math.max(1, Math.floor(w / (fs * 0.95)));
    const needed = Math.ceil(translation.length / cpl) * fs * 1.5;
    if (needed > h && h > 0) fs = baseFs * Math.max(0.5, Math.sqrt(h / needed));
  }

  let text = translation;
  if (block.isBullet) text = "● " + translation.replace(/^[•●◦▪▸►‣⁃\-–—]\s*/, "");

  return (
    <div style={{
      position: "absolute", top, left, width: w, minHeight: h,
      background: "#fff", boxSizing: "border-box", padding: pad,
      opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none",
      transition: "opacity 0.2s ease", zIndex: visible ? 5 : -1, overflow: "hidden",
    }}>
      <span style={{
        display: "block", fontSize: fs, lineHeight: block.isTitle ? 1.3 : 1.5,
        fontFamily: "'Noto Sans TC','Microsoft JhengHei','PingFang TC',sans-serif",
        fontWeight: block.isTitle ? 700 : 400,
        color: block.isTitle ? "#1a1a2e" : "#222",
        wordBreak: "break-all", overflowWrap: "break-word",
      }}>
        {text}
      </span>
    </div>
  );
}

/* ═══════════ Lazy Page ═══════════ */
function LazyPage({ page, pageNum, scale, showCN, blocks, translations }) {
  const ref = useRef(null);
  const cvs = useRef(null);
  const [inView, setInView] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect(); } },
      { rootMargin: "300px" }
    );
    obs.observe(el); return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || !page || !cvs.current) return;
    setReady(false);
    const vp = page.getViewport({ scale });
    const c = cvs.current; c.width = vp.width; c.height = vp.height;
    page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise.then(() => setReady(true));
  }, [inView, page, scale]);

  const vp = page ? page.getViewport({ scale }) : null;
  const w = vp ? vp.width : 595 * scale;
  const h = vp ? vp.height : 842 * scale;

  return (
    <div ref={ref} style={{
      position: "relative", marginBottom: 16,
      boxShadow: "0 1px 8px rgba(0,0,0,0.06),0 0 0 1px rgba(0,0,0,0.03)",
      borderRadius: 4, overflow: "hidden", background: "#fff",
      minHeight: inView ? "auto" : h, width: w, maxWidth: "100%",
    }}>
      <div style={{
        position: "absolute", top: 6, right: 8,
        background: "rgba(15,23,42,0.4)", color: "#cbd5e1",
        fontSize: 10, padding: "1px 6px", borderRadius: 7,
        zIndex: 60, fontFamily: "monospace",
      }}>{pageNum}</div>

      {inView ? (
        <>
          <canvas ref={cvs} style={{ display: "block", maxWidth: "100%", height: "auto" }} />
          {ready && blocks.map((b, i) =>
            b.hasEng && translations[i]
              ? <CnOverlay key={i} block={b} translation={translations[i]} scale={scale} visible={showCN} />
              : null
          )}
        </>
      ) : (
        <div style={{ height: h, display: "flex", alignItems: "center", justifyContent: "center", color: "#d1d5db", fontSize: 13 }}>
          第 {pageNum} 頁
        </div>
      )}
    </div>
  );
}

/* ═══════════ Glossary ═══════════ */
function Glossary({ glossary, show, onToggle, isMobile }) {
  const entries = Object.entries(glossary);
  if (!entries.length) return null;
  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 300,
      transition: "transform 0.3s ease",
      transform: show ? "translateY(0)" : "translateY(calc(100% - 36px))",
    }}>
      <div onClick={onToggle} style={{
        background: "rgba(15,23,42,0.96)", color: "#e2e8f0",
        padding: "8px 16px", cursor: "pointer",
        display: "flex", alignItems: "center", fontSize: 12, fontWeight: 600,
        borderTop: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(8px)",
      }}>
        <span>📖 專有名詞表 ({entries.length})</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#64748b" }}>{show ? "▼ 收起" : "▲ 展開"}</span>
      </div>
      {show && (
        <div style={{
          background: "rgba(15,23,42,0.97)", backdropFilter: "blur(12px)",
          maxHeight: isMobile ? "50vh" : "38vh", overflowY: "auto",
          padding: "8px 16px 20px",
        }}>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(280px,1fr))", gap: "2px 20px" }}>
            {entries.sort((a, b) => a[0].localeCompare(b[0])).map(([en, cn], i) => (
              <div key={i} style={{
                display: "flex", gap: 8, padding: "5px 0",
                borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12,
              }}>
                <span style={{ color: "#94a3b8", minWidth: isMobile ? 100 : 140, fontFamily: "monospace", fontSize: 11 }}>{en}</span>
                <span style={{ color: "#e2e8f0" }}>{cn}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════ Progress ═══════════ */
function Progress({ current, total, label }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div style={{ width: "100%", maxWidth: 360, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-color-secondary,#64748b)", marginBottom: 5 }}>
        <span>{label}</span><span>{pct}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "rgba(100,116,139,0.1)", overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 2, background: "linear-gradient(90deg,#6366f1,#8b5cf6)", width: `${pct}%`, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

/* ═══════════ Stats Summary ═══════════ */
function Stats({ pages, blocks, time }) {
  const totalBlocks = blocks.reduce((s, b) => s + b.filter(x => x.hasEng).length, 0);
  const totalWords = blocks.flat().filter(b => b.hasEng).reduce((s, b) => s + b.text.split(/\s+/).length, 0);
  return (
    <div style={{
      display: "flex", gap: 16, justifyContent: "center", padding: "6px 0",
      fontSize: 11, color: "var(--text-color-secondary,#94a3b8)",
    }}>
      <span>{pages} 頁</span>
      <span>{totalBlocks} 段落</span>
      <span>≈ {totalWords.toLocaleString()} 字</span>
      {time > 0 && <span>{Math.round(time / 1000)}s</span>}
    </div>
  );
}

/* ═══════════ Icons ═══════════ */
const IconDoc = () => (
  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M12 18v-6" /><path d="m9 15 3-3 3 3" />
  </svg>
);

/* ═══════════ Main App ═══════════ */
export default function App() {
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pages, setPages] = useState([]);
  const [pageBlocks, setPageBlocks] = useState([]);
  const [pageTrans, setPageTrans] = useState([]);
  const [glossary, setGlossary] = useState({});
  const [showGlossary, setShowGlossary] = useState(false);
  const [loading, setLoading] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState([0, 0]);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState("");
  const [scale, setScale] = useState(1.5);
  const [showCN, setShowCN] = useState(false);
  const [hint, setHint] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const wrapRef = useRef(null);
  const lpRef = useRef(null);

  const mobile = useMemo(() =>
    typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent), []);

  // Toggle: right-click (desktop) / long-press (mobile)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !pdfDoc || translating) return;
    const toggle = () => setShowCN(v => !v);
    const ctx = e => { e.preventDefault(); toggle(); };
    const ts = () => { lpRef.current = setTimeout(toggle, 500); };
    const te = () => clearTimeout(lpRef.current);

    el.addEventListener("contextmenu", ctx);
    if (mobile) {
      el.addEventListener("touchstart", ts, { passive: true });
      el.addEventListener("touchend", te);
      el.addEventListener("touchmove", te);
    }
    return () => {
      el.removeEventListener("contextmenu", ctx);
      if (mobile) { el.removeEventListener("touchstart", ts); el.removeEventListener("touchend", te); el.removeEventListener("touchmove", te); }
    };
  }, [pdfDoc, translating, mobile]);

  useEffect(() => { if (mobile) setScale(1.0); }, [mobile]);

  // Styles
  useEffect(() => {
    const l = document.createElement("link");
    l.href = "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap";
    l.rel = "stylesheet"; document.head.appendChild(l);
    const s = document.createElement("style");
    s.textContent = `
      @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
      *{-webkit-tap-highlight-color:transparent}
    `;
    document.head.appendChild(s);
  }, []);

  // Auto-dismiss hint
  useEffect(() => {
    if (hint && !translating && pageTrans.length > 0) {
      const t = setTimeout(() => setHint(false), 8000);
      return () => clearTimeout(t);
    }
  }, [hint, translating, pageTrans.length]);

  const go = useCallback(async (buf, name) => {
    setLoading(true); setError(null); setFileName(name);
    setPageBlocks([]); setPageTrans([]); setGlossary({});
    setShowCN(false); setElapsed(0);
    const t0 = Date.now();

    try {
      const lib = await loadPdfJs();
      const doc = await lib.getDocument({ data: buf }).promise;
      setPdfDoc(doc);
      const pArr = [];
      for (let i = 1; i <= doc.numPages; i++) pArr.push(await doc.getPage(i));
      setPages(pArr);
      setLoading(false);
      setTranslating(true);

      setPhase("分析文件結構...");
      const allB = []; let allText = "", totalEng = 0;
      for (const pg of pArr) {
        const c = await pg.getTextContent();
        const h = pg.getViewport({ scale: 1 }).height;
        const blocks = extractBlocks(c.items, h);
        allB.push(blocks);
        for (const b of blocks) { allText += b.text + "\n"; if (b.hasEng) totalEng++; }
      }
      setPageBlocks(allB);

      if (totalEng === 0) { setTranslating(false); setError("未偵測到英文內容"); return; }

      setPhase("辨識領域與專有名詞...");
      const ctx = await analyzeContext(allText);

      setPhase("翻譯中...");
      setProgress([0, totalEng]);
      const allT = []; const mG = {}; let done = 0;

      for (let pi = 0; pi < allB.length; pi++) {
        const blocks = allB[pi];
        const eng = blocks.filter(b => b.hasEng);
        if (!eng.length) { allT.push(Array(blocks.length).fill(null)); continue; }
        const { translations, glossary: g } = await translateAll(eng, ctx, c => setProgress([done + c, totalEng]));
        done += eng.length;
        const full = Array(blocks.length).fill(null);
        let ti = 0;
        blocks.forEach((b, bi) => { if (b.hasEng) { full[bi] = translations[ti++] || null; } });
        allT.push(full);
        Object.assign(mG, g);
        setPageTrans([...allT]); setGlossary({ ...mG });
      }

      setPageTrans(allT); setGlossary(mG);
      setElapsed(Date.now() - t0);
      setTranslating(false); setShowCN(true); setHint(true); setPhase("");
    } catch (e) {
      setError("錯誤：" + e.message);
      setLoading(false); setTranslating(false);
    }
  }, []);

  const handleFile = f => {
    if (!f) return;
    if (f.type !== "application/pdf") { setError("請上傳 PDF 檔案"); return; }
    if (f.size > 50 * 1024 * 1024) { setError("檔案過大（上限 50MB）"); return; }
    setError(null);
    const r = new FileReader();
    r.onload = e => go(e.target.result, f.name);
    r.onerror = () => setError("讀取檔案失敗");
    r.readAsArrayBuffer(f);
  };

  const reset = () => {
    setPdfDoc(null); setPages([]); setPageBlocks([]); setPageTrans([]);
    setGlossary({}); setShowGlossary(false); setTranslating(false);
    setShowCN(false); setError(null); setPhase(""); setHint(true); setElapsed(0);
  };

  /* ─── Upload Screen ─── */
  if (!pdfDoc) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        fontFamily: "'Inter','Noto Sans TC',sans-serif",
        padding: mobile ? "24px 16px" : 40,
        background: "var(--bg-color,#fafafa)",
      }}>
        {/* Desktop: clickable drop zone. Mobile: label-based button */}
        <div
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          {...(!mobile ? { onClick: () => !loading && fileRef.current?.click() } : {})}
          style={{
            width: "100%", maxWidth: 440,
            border: dragOver ? "2px solid #6366f1" : "2px dashed rgba(100,116,139,0.18)",
            borderRadius: 20, padding: mobile ? "40px 20px" : "52px 36px",
            textAlign: "center", cursor: mobile ? "default" : (loading ? "wait" : "pointer"),
            transition: "all 0.3s", animation: "fadeIn 0.5s ease",
            background: dragOver ? "rgba(99,102,241,0.03)" : "var(--bg-color,#fff)",
          }}
        >
          <div style={{ color: "#6366f1", marginBottom: 14, opacity: 0.8 }}><IconDoc /></div>
          <div style={{ fontSize: mobile ? 17 : 20, fontWeight: 700, color: "var(--text-color,#0f172a)", marginBottom: 6, fontFamily: "'DM Mono',monospace", letterSpacing: "-0.5px" }}>
            PDF 沉浸式翻譯
          </div>
          <div style={{ fontSize: 13, color: "var(--text-color-secondary,#64748b)", lineHeight: 1.7, marginBottom: 6 }}>
            {mobile ? "選擇 PDF 檔案開始翻譯" : "拖放 PDF 或點擊上傳"}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-color-secondary,#a0aab4)", lineHeight: 1.7, marginTop: 8 }}>
            ✦ 全文翻譯，保留原始排版<br />
            ✦ 領域專有名詞精準翻譯<br />
            ✦ {mobile ? "長按" : "右鍵"}即時切換中 ↔ 英
          </div>

          {/* Upload button: transparent real input layered over visible styled button */}
          <div style={{
            position: "relative", display: "inline-block",
            marginTop: mobile ? 24 : 20,
          }}>
            <div style={{
              background: "#6366f1", color: "#fff",
              padding: mobile ? "14px 40px" : "10px 28px",
              borderRadius: mobile ? 12 : 8,
              fontSize: mobile ? 15 : 13, fontWeight: 600,
              boxShadow: "0 2px 12px rgba(99,102,241,0.25)",
              pointerEvents: "none",
            }}>
              {mobile ? "選擇 PDF 檔案" : "選擇檔案"}
            </div>
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={e => { handleFile(e.target.files?.[0]); if (e.target) e.target.value = ""; }}
              style={{
                position: "absolute", inset: 0,
                width: "100%", height: "100%",
                opacity: 0, cursor: "pointer",
                fontSize: 0,
              }}
            />
          </div>

          {!mobile && (
            <input ref={fileRef} type="file" accept=".pdf"
              onChange={e => { handleFile(e.target.files?.[0]); if (e.target) e.target.value = ""; }}
              style={{ display: "none" }} />
          )}

          {loading && <div style={{ marginTop: 20, color: "#6366f1", fontSize: 13, animation: "pulse 1.5s ease infinite" }}>載入 PDF 中...</div>}
          {error && <div style={{ marginTop: 16, color: "#ef4444", fontSize: 13, background: "rgba(239,68,68,0.06)", borderRadius: 8, padding: "8px 12px" }}>{error}</div>}
        </div>
        <div style={{ marginTop: 28, fontSize: 11, color: "var(--text-color-secondary,#b8c0ca)", textAlign: "center", lineHeight: 1.6 }}>
          翻譯由 Claude 驅動 · 檔案僅在瀏覽器中處理，不會上傳
        </div>
      </div>
    );
  }

  /* ─── Reader Screen ─── */
  return (
    <div ref={wrapRef} style={{
      minHeight: "100vh", fontFamily: "'Inter','Noto Sans TC',sans-serif",
      paddingBottom: showGlossary ? "42vh" : 50,
      background: "var(--bg-color,#f0f2f5)",
    }}>
      {/* Toolbar */}
      <div style={{
        position: "sticky", top: 0, zIndex: 200,
        background: "rgba(15,23,42,0.97)", backdropFilter: "blur(12px)",
        padding: mobile ? "6px 10px" : "7px 14px",
        display: "flex", alignItems: "center", gap: mobile ? 6 : 10,
        color: "#e2e8f0", boxShadow: "0 1px 6px rgba(0,0,0,0.15)", fontSize: 12,
      }}>
        <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, fontSize: mobile ? 12 : 13 }}>PDF翻譯</span>
        {!mobile && <span style={{ color: "#94a3b8", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{fileName}</span>}
        <span style={{ color: "#475569", background: "rgba(255,255,255,0.06)", padding: "1px 6px", borderRadius: 5, fontSize: 10 }}>{pages.length}頁</span>
        <div style={{ flex: 1 }} />

        {!translating && pageTrans.length > 0 && (
          <>
            <button onClick={() => setShowCN(v => !v)} style={{
              background: showCN ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.08)",
              border: showCN ? "1px solid rgba(99,102,241,0.35)" : "1px solid rgba(255,255,255,0.1)",
              color: showCN ? "#c7d2fe" : "#94a3b8",
              padding: mobile ? "5px 10px" : "3px 12px",
              borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
            }}>
              {showCN ? "🇹🇼 中文" : "🇺🇸 EN"}
            </button>
            {Object.keys(glossary).length > 0 && (
              <button onClick={() => setShowGlossary(v => !v)} style={{
                background: showGlossary ? "rgba(139,92,246,0.25)" : "rgba(255,255,255,0.08)",
                border: "1px solid rgba(139,92,246,0.2)", color: "#c4b5fd",
                padding: mobile ? "5px 8px" : "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11,
              }}>📖</button>
            )}
          </>
        )}

        {!mobile && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={() => setScale(s => Math.max(0.5, s - 0.25))} style={zBtn}>−</button>
            <span style={{ fontFamily: "monospace", minWidth: 32, textAlign: "center", fontSize: 10 }}>{Math.round(scale * 100)}%</span>
            <button onClick={() => setScale(s => Math.min(3, s + 0.25))} style={zBtn}>+</button>
          </div>
        )}

        <button onClick={reset} style={{
          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
          color: "#94a3b8", padding: mobile ? "5px 8px" : "3px 8px",
          borderRadius: 5, cursor: "pointer", fontSize: 10,
        }}>✕</button>
      </div>

      {/* Progress */}
      {translating && (
        <div style={{ padding: "12px 16px", background: "var(--bg-color-secondary,rgba(241,245,249,0.6))", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
          <Progress current={progress[0]} total={progress[1]} label={phase} />
        </div>
      )}

      {/* Hint */}
      {!translating && pageTrans.length > 0 && hint && (
        <div onClick={() => setHint(false)} style={{
          textAlign: "center", padding: "10px 16px", fontSize: 12,
          color: "#4f46e5", background: "rgba(99,102,241,0.06)",
          borderBottom: "1px solid rgba(99,102,241,0.08)",
          cursor: "pointer", animation: "fadeIn 0.4s ease",
        }}>
          {showCN
            ? <>✅ 翻譯完成！{mobile ? "長按" : "右鍵"}畫面任意處切換回英文原文</>
            : <>📄 英文原文 · {mobile ? "長按" : "右鍵"}切換中文翻譯</>}
          <span style={{ marginLeft: 8, fontSize: 10, color: "#94a3b8" }}>點擊關閉</span>
        </div>
      )}

      {/* Stats */}
      {!translating && pageTrans.length > 0 && pageBlocks.length > 0 && (
        <Stats pages={pages.length} blocks={pageBlocks} time={elapsed} />
      )}

      {/* Pages */}
      <div style={{ padding: mobile ? "12px 8px" : 20, display: "flex", flexDirection: "column", alignItems: "center" }}>
        {pages.map((p, i) => (
          <LazyPage key={i} page={p} pageNum={i + 1} scale={scale}
            showCN={showCN} blocks={pageBlocks[i] || []} translations={pageTrans[i] || []} />
        ))}
      </div>

      <Glossary glossary={glossary} show={showGlossary} onToggle={() => setShowGlossary(v => !v)} isMobile={mobile} />
    </div>
  );
}

const zBtn = {
  background: "rgba(255,255,255,0.07)", border: "none", color: "#e2e8f0",
  width: 24, height: 24, borderRadius: 4, cursor: "pointer", fontSize: 13,
  display: "flex", alignItems: "center", justifyContent: "center",
};
