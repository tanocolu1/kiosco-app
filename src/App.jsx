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
  const beepRef = useRef(null);
  const restartingRef = useRef(false);

  const [mode, setMode] = useState("scanning");
  const [productName, setProductName] = useState("");
  const [price, setPrice] = useState("");

  const RESET_MS = 7000;

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

  async function startScanner() {
    if (restartingRef.current) return;
    restartingRef.current = true;

    try {
      setMode("scanning");

      const el = document.getElementById("reader");
      if (el) el.innerHTML = "";

      await stopScanner();

      const scanner = new Html5Qrcode("reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: Math.min(window.innerWidth * 0.5, 350) },
        async (decodedText) => {
          await stopScanner();

          beepRef.current?.play();
          navigator.vibrate?.(40);

          const r = await fetch(`${API}/resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: decodedText }),
          });

          const data = await r.json();

          setProductName(data.productName || "Producto");
          setPrice(formatARS(data.sellingPrice ?? data.price));
          setMode("result");

          setTimeout(startScanner, RESET_MS);
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
        padding: "4vh 4vw",
        fontFamily: "system-ui",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <img
        src="/logo.png?v=5"
        alt="Tienda Colucci"
        style={{
          width: "clamp(120px, 20vw, 260px)",
          marginBottom: "3vh",
        }}
      />

      <div
        style={{
          fontSize: "clamp(28px, 4vw, 56px)",
          fontWeight: 900,
        }}
      >
        Consulta de precios
      </div>

      <div
        style={{
          fontSize: "clamp(16px, 2vw, 24px)",
          opacity: 0.7,
          marginBottom: "4vh",
        }}
      >
        Escaneá el producto para ver el precio
      </div>

      <div
        id="reader"
        style={{
          display: mode === "scanning" ? "block" : "none",
          width: "100%",
          maxWidth: "600px",
        }}
      />

      {mode === "result" && (
        <div style={{ marginTop: "5vh" }}>
          <div
            style={{
              fontSize: "clamp(18px, 2.5vw, 34px)",
              opacity: 0.9,
            }}
          >
            {productName}
          </div>

          <div
            style={{
              fontSize: "clamp(48px, 10vw, 140px)",
              fontWeight: 1000,
              color: "#00ff88",
              marginTop: "2vh",
            }}
          >
            {price}
          </div>

          <div style={{ opacity: 0.6, marginTop: "2vh" }}>
            Volviendo a escanear...
          </div>
        </div>
      )}
    </div>
  );
}