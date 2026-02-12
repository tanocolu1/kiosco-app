import { useEffect, useRef, useState } from "react";
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

export default function App() {
  const scannerRef = useRef(null);
  const restartingRef = useRef(false);
  const beepRef = useRef(null);

  const [mode, setMode] = useState("scanning");
  const [productName, setProductName] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");

  const RESET_MS = 7000;
  const ERROR_RESET_MS = 2500;

  // 🔊 Inicializar sonido
  useEffect(() => {
    beepRef.current = new Audio("/beep.mp3");
  }, []);

  // 🖥 Fullscreen automático
  function enableFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
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
        { fps: 10, qrbox: 260 },
        async (decodedText) => {
          await stopScanner();
          setMode("loading");

          // 🔊 Beep
          try {
            beepRef.current?.play();
          } catch {}

          // 📳 Vibración
          try {
            navigator.vibrate?.(40);
          } catch {}

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
  }, []);

  return (
    <div
      onClick={enableFullscreen}
      style={{
        minHeight: "100vh",
        background: "#111",
        color: "#fff",
        padding: 30,
        fontFamily: "system-ui",
        textAlign: "center",
      }}
    >
      {/* Logo */}
      <img
        src="/logo.png?v=3"
        alt="Tienda Colucci"
        style={{ height: 100, marginBottom: 20 }}
      />

      <div style={{ fontSize: 48, fontWeight: 900 }}>
        Consulta de precios
      </div>

      <div style={{ opacity: 0.7, fontSize: 22, marginBottom: 30 }}>
        Escaneá el producto para ver el precio
      </div>

      <div
        id="reader"
        style={{
          display: mode === "scanning" ? "block" : "none",
          maxWidth: 700,
          margin: "0 auto",
        }}
      />

      {mode === "loading" && <div>Consultando...</div>}

      {mode === "result" && (
        <div>
          <div style={{ fontSize: 32, marginTop: 20 }}>
            {productName}
          </div>
          <div
            style={{
              fontSize: 110,
              fontWeight: 1000,
              marginTop: 10,
              color: "#00ff88",
            }}
          >
            {price}
          </div>
          <div style={{ opacity: 0.6 }}>Volviendo a escanear...</div>
        </div>
      )}

      {mode === "error" && (
        <div style={{ color: "#ff4444" }}>
          {error}
        </div>
      )}
    </div>
  );
}