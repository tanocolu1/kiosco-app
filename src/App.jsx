import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

const API            = import.meta.env.VITE_API_BASE;
const NO_PRICE_MSG   = "No encontramos el precio. Consultá a un vendedor.";
const RESET_MS       = 7000;
const ERROR_RESET_MS = 2500;

const priceCache = new Map();
const CACHE_TTL  = 60_000;

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

export default function App() {
  const isLandscape = useIsLandscape();
  const isOnline    = useOnlineStatus();

  const scannerRef    = useRef(null);
  const restartingRef = useRef(false);
  const abortRef      = useRef(null);
  const resetTimerRef = useRef(null);
  const beepRef       = useRef(null);
  const audioUnlocked = useRef(false);
  const inputRef      = useRef(null);
  const bufferRef     = useRef("");

  const [scanSource,  setScanSource]  = useState("camera");
  const [mode,        setMode]        = useState("scanning");
  const [productName, setProductName] = useState("");
  const [price,       setPrice]       = useState("");
  const [errorMsg,    setErrorMsg]    = useState("");

  useEffect(() => { beepRef.current = new Audio("/beep.mp3"); }, []);

  function unlockAudio() {
    if (audioUnlocked.current || !beepRef.current) return;
    beepRef.current.play()
      .then(() => { beepRef.current.pause(); beepRef.current.currentTime = 0; })
      .catch(() => {});
    audioUnlocked.current = true;
  }

  async function playFeedback() {
    try { beepRef.current.currentTime = 0; await beepRef.current.play(); } catch {}
    try { navigator.vibrate?.(40); } catch {}
  }

  function enableFullscreen() {
    if (!document.fullscreenElement)
      document.documentElement.requestFullscreen?.().catch(() => {});
  }

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

  function clearResetTimer() {
    if (resetTimerRef.current) { clearTimeout(resetTimerRef.current); resetTimerRef.current = null; }
  }

  const scheduleReset = useCallback((delayMs, currentSource) => {
    clearResetTimer();
    resetTimerRef.current = setTimeout(async () => {
      setMode("scanning"); setProductName(""); setPrice(""); setErrorMsg("");
      if (currentSource === "hid") {
        bufferRef.current = ""; inputRef.current?.focus(); return;
      }
      await stopScanner();
      await new Promise((res) => setTimeout(res, 250));
      startCameraScanner(); // eslint-disable-line no-use-before-define
    }, delayMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAndShow = useCallback(async (codeOrUrl, currentSource) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setMode("loading"); setErrorMsg("");
    await playFeedback();

    const cached = priceCache.get(codeOrUrl);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      const { data } = cached;
      setProductName(data.productName || "Producto");
      setPrice(formatARS(data.cents));
      setMode("result");
      scheduleReset(RESET_MS, currentSource);
      return;
    }

    try {
      if (!API) throw new Error(NO_PRICE_MSG);
      const r = await fetch(`${API}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: codeOrUrl }),
        signal: abortRef.current.signal,
      });
      if (!r.ok) throw new Error(httpErrorMessage(r.status));
      const data  = await r.json();
      const cents = data.sellingPrice ?? data.price;
      if (cents == null || Number.isNaN(Number(cents)) || Number(cents) <= 0)
        throw new Error(NO_PRICE_MSG);
      const n = Number(cents);
      priceCache.set(codeOrUrl, { data: { productName: data.productName, cents: n }, ts: Date.now() });
      setProductName(data.productName || "Producto");
      setPrice(formatARS(n));
      setMode("result");
      scheduleReset(RESET_MS, currentSource);
    } catch (err) {
      if (err.name === "AbortError") return;
      setErrorMsg(err.message || NO_PRICE_MSG);
      setMode("error");
      scheduleReset(ERROR_RESET_MS, currentSource);
    }
  }, [scheduleReset]);

  const startCameraScanner = useCallback(async () => {
    if (restartingRef.current) return;
    restartingRef.current = true;
    try {
      clearResetTimer();
      setScanSource("camera"); setMode("scanning"); setErrorMsg(""); setProductName(""); setPrice("");
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

  const startHidMode = useCallback(() => {
    clearResetTimer(); stopScanner();
    setScanSource("hid"); setMode("scanning"); setErrorMsg(""); setProductName(""); setPrice("");
    bufferRef.current = ""; inputRef.current?.focus();
  }, []);

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

  useEffect(() => {
    (async () => {
      const hasCam = await hasAnyCamera();
      hasCam ? startCameraScanner() : startHidMode();
    })();
    return () => { clearResetTimer(); stopScanner(); abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showReader = scanSource === "camera" && (mode === "scanning" || mode === "loading");

  return (
    <div
      className="kiosco-root"
      onClick={() => { unlockAudio(); enableFullscreen(); if (scanSource === "hid") inputRef.current?.focus(); }}
    >
      <input ref={inputRef} inputMode="none" autoCapitalize="off" autoCorrect="off"
        spellCheck={false} readOnly className="hid-input" />

      {!isOnline && (
        <div className="offline-banner">⚠️ Sin conexión a internet — verificá la red del local</div>
      )}

      <header className="header">
        <img src="/logo.png?v=10" alt="Tienda Colucci" className="header__logo" />
        <h1 className="header__title">Consulta de precios</h1>
        <p className="header__subtitle">
          <span className={`status-dot status-dot--${mode === "loading" ? "yellow" : mode === "error" ? "red" : "green"}`} />
          {mode === "loading" ? "Consultando…" : mode === "result" ? "Precio encontrado"
            : mode === "error" ? "Sin precio" : "Escaneá el producto para ver el precio"}
        </p>
        <div className="mode-toggle">
          <button className={`mode-toggle__btn ${scanSource === "camera" ? "mode-toggle__btn--active" : ""}`}
            onClick={(e) => { e.stopPropagation(); startCameraScanner(); }}>📷 Cámara</button>
          <button className={`mode-toggle__btn ${scanSource === "hid" ? "mode-toggle__btn--active" : ""}`}
            onClick={(e) => { e.stopPropagation(); startHidMode(); }}>🔫 Escáner</button>
        </div>
        {scanSource === "hid" && <p className="hid-hint">Modo escáner activo — acercá el código al lector</p>}
      </header>

      <main className={`main-grid ${isLandscape ? "main-grid--landscape" : "main-grid--portrait"}`}>
        <div className="camera-panel">
          <div id="reader" className="camera-panel__reader" style={{ display: showReader ? "block" : "none" }} />
          {scanSource === "camera" && mode === "loading" && <p className="camera-panel__loading">Consultando precio…</p>}
        </div>

        <div className="result-panel">
          {mode === "result" && (
            <div className="fade-in">
              <p className="result-panel__name">{productName}</p>
              <p className={`result-panel__price ${isLandscape ? "result-panel__price--lg" : "result-panel__price--sm"}`}>{price}</p>
              <p className="result-panel__ready">Listo para el próximo…</p>
            </div>
          )}
          {mode === "error" && (
            <div className="error-panel fade-in">
              <p className="error-panel__title">Sin precio disponible</p>
              <p className="error-panel__msg">{errorMsg}</p>
              <p className="error-panel__hint">Consultá a un vendedor.</p>
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

      <footer className="footer">TIENDA COLUCCI · CONSULTA DE PRECIOS</footer>
    </div>
  );
}