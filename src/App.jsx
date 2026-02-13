import { useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

const API = import.meta.env.VITE_API_BASE;

function formatARS(cents) {
  if (cents == null) return "";
  return (cents / 100).toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

function useIsLandscape() {
  const [isLandscape, setIsLandscape] = useState(
    window.matchMedia("(orientation: landscape)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape)");
    const handler = () => setIsLandscape(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isLandscape;
}

export default function App() {
  const scannerRef = useRef(null);
  const beepRef = useRef(null);
  const restartingRef = useRef(false);

  const isLandscape = useIsLandscape();

  const [mode, setMode] = useState("scanning");
  const [productName, setProductName] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");

  const RESET_MS = 7000;
  const ERROR_RESET_MS = 2500;

  useEffect(() => {
    beepRef.current = new Audio("/beep.mp3");
  }, []);

  function enableFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }

  async function stopScanner() {
    const s = scannerRef.current;
    if (!s) return;
    try {
      if (s.isScanning) await s.stop();
    } catch {}
    try {
      await s.clear();
    } catch {}
    scannerRef.current = null;
  }

  const qrboxSize = useMemo(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w > h) return Math.min(w * 0.3, 420);
    return Math.min(w * 0.55, 360);
  }, [isLandscape]);

  async function startScanner() {
    if (restartingRef.current) return;
    restartingRef.current = true;

    try {
      setError("");
      setMode("scanning");

      const el = document.getElementById("reader");
      if (el) el.innerHTML = "";

      await stopScanner();

      const scanner = new Html5Qrcode("reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: qrboxSize },
        async (decodedText) => {
          await stopScanner();
          setMode("loading");

          try {
            beepRef.current.currentTime = 0;
            await beepRef.current.play();
          } catch {}

          navigator.vibrate?.(40);

          try {
            const r = await fetch(`${API}/resolve`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: decodedText }),
            });

            if (!r.ok) throw new Error("Error consultando precio");

            const data = await r.json();

            setProductName(data.productName || "Producto");
            setPrice(formatARS(data.sellingPrice ?? data.price));
            setMode("result");

            setTimeout(startScanner, RESET_MS);
          } catch (e) {
            setError(String(e.message || e));
            setMode("error");
            setTimeout(startScanner, ERROR_RESET_MS);
          }
        }
      );
    } finally {
      restartingRef.current = false;
    }
  }

  useEffect(() => {
    startScanner();
    return () => stopScanner();
  }, [isLandscape]);

  return (
    <div
      onClick={enableFullscreen}
      style={{
        minHeight: "100vh",
        background: "#111",
        color: "#fff",
        padding: "3vh 3vw",
        fontFamily: "system-ui",
      }}
    >
      {/* Forzar ancho completo del scanner */}
      <style>{`
        #reader,
        #reader > div,
        #reader video,
        #reader canvas,
        #reader__scan_region {
          width: 100% !important;
          max-width: 100% !important;
          height: auto !important;
        }
      `}</style>

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "2vh" }}>
        <img
          src="/logo.png?v=7"
          alt="Tienda Colucci"
          style={{
            width: "clamp(140px, 18vw, 260px)",
            marginBottom: "1.5vh",
          }}
        />
        <div style={{ fontSize: "clamp(26px, 3vw, 52px)", fontWeight: 900 }}>
          Consulta de precios
        </div>
        <div style={{ opacity: 0.7, marginTop: 6, fontSize: "clamp(16px, 1.6vw, 22px)" }}>
          Escaneá el producto para ver el precio
        </div>
      </div>

      {/* Layout */}
      <div
        style={{
          display: "grid",
          gap: "2vw",
          alignItems: "center",
          gridTemplateColumns: isLandscape ? "1fr 1.4fr" : "1fr",
        }}
      >
        {/* Scanner */}
        <div style={{ width: "100%" }}>
          {(mode === "scanning" || mode === "loading") && (
            <div id="reader" style={{ borderRadius: 16, overflow: "hidden" }} />
          )}
        </div>

        {/* Resultado */}
        <div style={{ width: "100%", textAlign: "center" }}>
          {mode === "result" && (
            <>
              <div style={{ fontSize: "clamp(18px, 2vw, 32px)", opacity: 0.9 }}>
                {productName}
              </div>

              <div
                style={{
                  fontSize: isLandscape
                    ? "clamp(80px, 9vw, 170px)"
                    : "clamp(60px, 10vw, 140px)",
                  fontWeight: 1000,
                  color: "#00ff88",
                  marginTop: "1vh",
                }}
              >
                {price}
              </div>

              <div style={{ opacity: 0.6, marginTop: "1vh" }}>
                Volviendo a escanear...
              </div>
            </>
          )}

          {mode === "error" && (
            <div style={{ color: "#ff4444" }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}