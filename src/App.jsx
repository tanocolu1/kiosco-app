import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

// ─── Constantes ───────────────────────────────────────────────────────────────
const API            = import.meta.env.VITE_API_BASE;
const NO_PRICE_MSG   = "No encontramos el precio. Consultá a un vendedor.";
const RESET_MS       = 7000;
const ERROR_RESET_MS = 2500;
const FETCH_TIMEOUT  = 8000;
const CACHE_TTL      = 60_000;
const MAX_RETRIES    = 1;

// Clave localStorage para contador diario
const COUNTER_KEY = "kiosco_scan_count";
const COUNTER_DATE_KEY = "kiosco_scan_date";

const priceCache = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatARS(cents) {
  if (cents == null) return "";
  return (cents / 100).toLocaleString("es-AR", {
    style: "currency", currency: "ARS", maximumFractionDigits: 0,
  });
}

async function hasAnyCamera() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return false;
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === "videoinput");
  } catch { return false; }
}

function httpErrorMessage(status) {
  if (status === 404) return "Producto no encontrado en el sistema.";
  if (status >= 500) return "Error del servidor. Intentá de nuevo.";
  return NO_PRICE_MSG;
}

// Leer/incrementar contador diario en localStorage
function getTodayCount() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const savedDate = localStorage.getItem(COUNTER_DATE_KEY);
    if (savedDate !== today) {
      localStorage.setItem(COUNTER_DATE_KEY, today);
      localStorage.setItem(COUNTER_KEY, "0");
      return 0;
    }
    return parseInt(localStorage.getItem(COUNTER_KEY) || "0", 10);
  } catch { return 0; }
}

function incrementCount() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(COUNTER_DATE_KEY, today);
    const next = getTodayCount() + 1;
    localStorage.setItem(COUNTER_KEY, String(next));
    return next;
  } catch { return 0; }
}

// ─── Hooks ────────────────────────────────────────────────────────────────────
function useIsLandscape() {
  const [isLandscape, setIsLandscape] = useState(
    () => window.matchMedia("(orientation: landscape)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape)");
    const handler = (e) => setIsLandscape(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isLandscape;
}

function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up   = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener("online",  up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online",  up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return isOnline;
}

// ─── Componente ───────────────────────────────────────────────────────────────
export default function App() {
  const isLandscape = useIsLandscape();
  const isOnline    = useOnlineStatus();

  const scannerRef    = useRef(null);
  const restartingRef = useRef(false);
  const abortRef      = useRef(null);
  const resetTimerRef = useRef(null);
  const beepRef       = useRef(null);
  const errorBeepRef  = useRef(null);
  const audioUnlocked = useRef(false);
  const inputRef      = useRef(null);
  const bufferRef     = useRef("");

  const [scanSource,  setScanSource]  = useState("camera");
  const [mode,        setMode]        = useState("scanning");
  const [productName, setProductName] = useState("");
  const [price,       setPrice]       = useState("");
  const [listPrice,   setListPrice]   = useState("");
  const [imageUrl,    setImageUrl]    = useState("");
  const [errorMsg,    setErrorMsg]    = useState("");
  const [scanCount,   setScanCount]   = useState(() => getTodayCount());
  const [resetPct,    setResetPct]    = useState(100); // barra de progreso 100→0
  const [theme,       setTheme]       = useState("dark"); // "dark" | "light"

  // ── Audio ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    beepRef.current      = new Audio("/beep.mp3");
    // Beep de error: misma fuente pero pitido doble via replay rápido
    errorBeepRef.current = new Audio("/beep.mp3");
  }, []);

  function unlockAudio() {
    if (audioUnlocked.current) return;
    [beepRef, errorBeepRef].forEach((ref) => {
      if (!ref.current) return;
      ref.current.play().then(() => { ref.current.pause(); ref.current.currentTime = 0; }).catch(() => {});
    });
    audioUnlocked.current = true;
  }

  async function playSuccess() {
    try { beepRef.current.currentTime = 0; await beepRef.current.play(); } catch {}
    try { navigator.vibrate?.(40); } catch {}
  }

  async function playError() {
    // Doble beep para indicar error
    try {
      errorBeepRef.current.currentTime = 0;
      await errorBeepRef.current.play();
      setTimeout(async () => {
        try { errorBeepRef.current.currentTime = 0; await errorBeepRef.current.play(); } catch {}
      }, 200);
    } catch {}
    try { navigator.vibrate?.([60, 80, 60]); } catch {}
  }

  // ── Fullscreen ─────────────────────────────────────────────────────────────
  function enableFullscreen() {
    if (!document.fullscreenElement)
      document.documentElement.requestFullscreen?.().catch(() => {});
  }

  // ── Scanner ────────────────────────────────────────────────────────────────
  async function stopScanner() {
    const s = scannerRef.current;
    if (!s) return;
    try { if (s.isScanning) await s.stop(); } catch {}
    try { await s.clear(); } catch {}
    scannerRef.current = null;
    const el = document.getElementById("reader");
    if (el) el.innerHTML = "";
  }

  const qrboxSize = useMemo(() => {
    const w = window.innerWidth, h = window.innerHeight;
    return w > h ? Math.min(w * 0.3, 420) : Math.min(w * 0.55, 360);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLandscape]);

  // ── Timer de reset con barra de progreso ───────────────────────────────────
  function clearResetTimer() {
    if (resetTimerRef.current) { clearTimeout(resetTimerRef.current); resetTimerRef.current = null; }
    setResetPct(100);
  }

  const scheduleReset = useCallback((delayMs, currentSource) => {
    clearResetTimer();

    // Barra de progreso: actualizar cada 100ms
    const startTime = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.max(0, 100 - (elapsed / delayMs) * 100);
      setResetPct(pct);
      if (pct <= 0) clearInterval(tick);
    }, 100);

    resetTimerRef.current = setTimeout(async () => {
      clearInterval(tick);
      setResetPct(100);
      setMode("scanning");
      setProductName(""); setPrice(""); setListPrice(""); setImageUrl(""); setErrorMsg("");
      if (currentSource === "hid") {
        bufferRef.current = ""; inputRef.current?.focus(); return;
      }
      await stopScanner();
      await new Promise((res) => setTimeout(res, 250));
      startCameraScanner(); // eslint-disable-line no-use-before-define
    }, delayMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch con timeout y reintento ──────────────────────────────────────────
  async function fetchWithRetry(codeOrUrl, signal, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const timeoutId = setTimeout(() => { try { signal.reason || signal.abort?.(); } catch {} }, FETCH_TIMEOUT);
      try {
        const r = await fetch(`${API}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: codeOrUrl }),
          signal,
        });
        clearTimeout(timeoutId);
        return r;
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === "AbortError") throw err;           // cancelado: no reintentar
        if (attempt === retries) throw err;                 // último intento: propagar
        await new Promise((res) => setTimeout(res, 600));   // esperar antes de reintentar
      }
    }
  }

  const fetchAndShow = useCallback(async (codeOrUrl, currentSource) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setMode("loading"); setErrorMsg("");
    await playSuccess();

    // Cache hit
    const cached = priceCache.get(codeOrUrl);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      const { data } = cached;
      setProductName(data.productName || "Producto");
      setPrice(formatARS(data.cents));
      setListPrice(data.listCents && data.listCents > data.cents ? formatARS(data.listCents) : "");
      setImageUrl(data.imageUrl || "");
      setMode("result");
      const newCount = incrementCount();
      setScanCount(newCount);
      scheduleReset(RESET_MS, currentSource);
      return;
    }

    try {
      if (!API) throw new Error(NO_PRICE_MSG);
      const r = await fetchWithRetry(codeOrUrl, abortRef.current.signal);
      if (!r.ok) throw new Error(httpErrorMessage(r.status));
      const data  = await r.json();
      const cents = data.sellingPrice ?? data.price;
      if (cents == null || Number.isNaN(Number(cents)) || Number(cents) <= 0)
        throw new Error(NO_PRICE_MSG);
      const n         = Number(cents);
      const listCents = data.listPrice ? Number(data.listPrice) : null;
      priceCache.set(codeOrUrl, {
        data: { productName: data.productName, cents: n, listCents, imageUrl: data.imageUrl || "" },
        ts: Date.now(),
      });
      setProductName(data.productName || "Producto");
      setPrice(formatARS(n));
      setListPrice(listCents && listCents > n ? formatARS(listCents) : "");
      setImageUrl(data.imageUrl || "");
      setMode("result");
      const newCount = incrementCount();
      setScanCount(newCount);
      scheduleReset(RESET_MS, currentSource);
    } catch (err) {
      if (err.name === "AbortError") return;
      await playError();
      setErrorMsg(err.message || NO_PRICE_MSG);
      setMode("error");
      scheduleReset(ERROR_RESET_MS, currentSource);
    }
  }, [scheduleReset]);

  // ── Modo cámara ────────────────────────────────────────────────────────────
  const startCameraScanner = useCallback(async () => {
    if (restartingRef.current) return;
    restartingRef.current = true;
    try {
      clearResetTimer();
      setScanSource("camera"); setMode("scanning"); setErrorMsg("");
      setProductName(""); setPrice(""); setListPrice(""); setImageUrl("");
      const reader = document.getElementById("reader");
      if (!reader) throw new Error("Reader missing");
      await stopScanner();
      const scanner = new Html5Qrcode("reader");
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: qrboxSize },
        async (decodedText) => { await stopScanner(); await fetchAndShow(decodedText, "camera"); }
      );
    } catch {
      setScanSource("hid"); setMode("scanning"); setErrorMsg("");
      bufferRef.current = ""; inputRef.current?.focus();
    } finally {
      restartingRef.current = false;
    }
  }, [qrboxSize, fetchAndShow]);

  // ── Modo HID ───────────────────────────────────────────────────────────────
  const startHidMode = useCallback(() => {
    clearResetTimer(); stopScanner();
    setScanSource("hid"); setMode("scanning"); setErrorMsg("");
    setProductName(""); setPrice(""); setListPrice(""); setImageUrl("");
    bufferRef.current = ""; inputRef.current?.focus();
  }, []);

  // ── Listener teclado HID ───────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e) => {
      if (scanSource !== "hid") return;
      if (document.activeElement !== inputRef.current) inputRef.current?.focus();
      if (e.key === "Enter") {
        const value = bufferRef.current.trim();
        bufferRef.current = "";
        if (value) fetchAndShow(value, "hid");
        e.preventDefault(); return;
      }
      if (e.key.length !== 1) return;
      bufferRef.current += e.key;
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scanSource, fetchAndShow]);

  // ── Arranque ───────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const hasCam = await hasAnyCamera();
      hasCam ? startCameraScanner() : startHidMode();
    })();
    return () => { clearResetTimer(); stopScanner(); abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  const showReader = scanSource === "camera" && (mode === "scanning" || mode === "loading");

  return (
    <div
      className={`kiosco-root kiosco-root--${theme}`}
      onClick={() => { unlockAudio(); enableFullscreen(); if (scanSource === "hid") inputRef.current?.focus(); }}
    >
      <input ref={inputRef} inputMode="none" autoCapitalize="off" autoCorrect="off"
        spellCheck={false} readOnly className="hid-input" />

      {/* Banner offline */}
      {!isOnline && (
        <div className="offline-banner">⚠️ Sin conexión a internet — verificá la red del local</div>
      )}

      {/* Header */}
      <header className="header">
        <img src="/logo.png?v=10" alt="Tienda Colucci" className="header__logo" />
        <h1 className="header__title">Consulta de precios</h1>
        <p className="header__subtitle">
          <span className={`status-dot status-dot--${mode === "loading" ? "yellow" : mode === "error" ? "red" : "green"}`} />
          {mode === "loading" ? "Consultando…" : mode === "result" ? "Precio encontrado"
            : mode === "error" ? "Sin precio" : "Escaneá el producto para ver el precio"}
        </p>

        <div className="header__controls">
          {/* Selector modo escaneo */}
          <div className="mode-toggle">
            <button className={`mode-toggle__btn ${scanSource === "camera" ? "mode-toggle__btn--active" : ""}`}
              onClick={(e) => { e.stopPropagation(); startCameraScanner(); }}>📷 Cámara</button>
            <button className={`mode-toggle__btn ${scanSource === "hid" ? "mode-toggle__btn--active" : ""}`}
              onClick={(e) => { e.stopPropagation(); startHidMode(); }}>🔫 Escáner</button>
          </div>

          {/* Toggle tema claro/oscuro */}
          <button
            className="theme-toggle"
            onClick={(e) => { e.stopPropagation(); setTheme((t) => t === "dark" ? "light" : "dark"); }}
            title="Cambiar tema"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>

        {scanSource === "hid" && <p className="hid-hint">Modo escáner activo — acercá el código al lector</p>}
      </header>

      {/* Grid principal */}
      <main className={`main-grid ${isLandscape ? "main-grid--landscape" : "main-grid--portrait"}`}>
        <div className="camera-panel">
          <div id="reader" className="camera-panel__reader" style={{ display: showReader ? "block" : "none" }} />
          {scanSource === "camera" && mode === "loading" && <p className="camera-panel__loading">Consultando precio…</p>}
        </div>

        <div className="result-panel">
          {mode === "result" && (
            <div className="fade-in">
              {imageUrl && (
                <div className="result-panel__image-wrap">
                  <img src={imageUrl} alt={productName} className="result-panel__image"
                    onError={(e) => { e.currentTarget.style.display = "none"; }} />
                </div>
              )}
              <p className="result-panel__name">{productName}</p>
              {listPrice && (
                <p className="result-panel__list-price">{listPrice}</p>
              )}
              <p className={`result-panel__price ${isLandscape ? "result-panel__price--lg" : "result-panel__price--sm"}`}>
                {price}
              </p>
              <p className="result-panel__ready">Listo para el próximo…</p>

              {/* Barra de progreso del reset */}
              <div className="reset-bar">
                <div className="reset-bar__fill" style={{ width: `${resetPct}%` }} />
              </div>
            </div>
          )}

          {mode === "error" && (
            <div className="error-panel fade-in">
              <p className="error-panel__title">Sin precio disponible</p>
              <p className="error-panel__msg">{errorMsg}</p>
              <p className="error-panel__hint">Consultá a un vendedor.</p>
              <div className="reset-bar reset-bar--error">
                <div className="reset-bar__fill" style={{ width: `${resetPct}%` }} />
              </div>
            </div>
          )}

          {mode === "scanning" && scanSource === "hid" && (
            <div className="hid-waiting fade-in">
              <p className="hid-waiting__title">Listo para escanear</p>
              <p className="hid-waiting__sub">Apuntá el código al lector. El precio se muestra automáticamente.</p>
            </div>
          )}
        </div>
      </main>

      {/* Footer con contador */}
      <footer className="footer">
        <span>TIENDA COLUCCI · CONSULTA DE PRECIOS</span>
        <span className="footer__counter">{scanCount} consultas hoy</span>
      </footer>
    </div>
  );
}