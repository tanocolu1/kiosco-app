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

  const [mode, setMode] = useState("scanning"); // scanning | loading | result | error
  const [productName, setProductName] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");
  const [lastScan, setLastScan] = useState("");

  // Ajustes kiosco
  const RESET_MS = 7000; // cuánto tiempo queda el precio visible
  const ERROR_RESET_MS = 2500; // cuánto queda el error visible
  const FPS = 10;
  const QR_BOX = 260;

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
      setProductName("");
      setPrice("");
      setLastScan("");
      setMode("scanning");

      // Asegura que el contenedor exista
      const el = document.getElementById("reader");
      if (el) el.innerHTML = "";

      await stopScanner();

      const scanner = new Html5Qrcode("reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: FPS, qrbox: QR_BOX },
        async (decodedText) => {
          // Evitar múltiples lecturas seguidas
          await stopScanner();

          setLastScan(decodedText);
          setMode("loading");

          // feedback suave
          try {
            if (navigator.vibrate) navigator.vibrate(30);
          } catch {}

          try {
            if (!API) throw new Error("VITE_API_BASE no está configurado");

            const r = await fetch(`${API}/resolve`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: decodedText }),
            });

            const bodyText = await r.text();
            if (!r.ok) throw new Error(bodyText || `HTTP ${r.status}`);

            const data = JSON.parse(bodyText);

            setProductName(data.productName || "Producto");
            setPrice(formatARS(data.sellingPrice ?? data.price));
            setMode("result");

            setTimeout(() => {
              startScanner();
            }, RESET_MS);
          } catch (e) {
            setMode("error");
            setError(String(e?.message || e));

            setTimeout(() => {
              startScanner();
            }, ERROR_RESET_MS);
          }
        }
      );
    } catch (e) {
      setMode("error");
      setError(String(e?.message || e));
      setTimeout(() => startScanner(), ERROR_RESET_MS);
    } finally {
      restartingRef.current = false;
    }
  }

  useEffect(() => {
    // Arranca solo al cargar
    startScanner();

    // Limpieza al salir
    return () => {
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#111",
        color: "#eee",
        padding: 28,
        fontFamily: "system-ui",
      }}
    >
      {/* Header centrado */}
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <img
          src="/logo.png?v=2"
          alt="Tienda Colucci"
          style={{
            height: 90,
            width: "auto",
            objectFit: "contain",
            marginBottom: 18,
          }}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />

        <div style={{ fontSize: 48, fontWeight: 900, lineHeight: 1.1 }}>
          Consulta de precios
        </div>

        <div style={{ opacity: 0.75, marginTop: 10, fontSize: 22 }}>
          Escaneá el producto para ver el precio
        </div>
      </div>

      {/* Body */}
      <div
        style={{
          display: "grid",
          gap: 16,
          justifyItems: "center",
        }}
      >
        {/* Scanner container */}
        <div
          id="reader"
          style={{
            width: "100%",
            maxWidth: 720,
            borderRadius: 18,
            overflow: "hidden",
            background: "#1b1b1b",
            display: mode === "scanning" ? "block" : "none",
          }}
        />

        {mode === "loading" && (
          <div style={{ fontSize: 24, opacity: 0.85 }}>Consultando precio…</div>
        )}

        {mode === "result" && (
          <div
            style={{
              background: "#0f172a",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 18,
              padding: 22,
              maxWidth: 960,
              width: "100%",
            }}
          >
            <div style={{ fontSize: 30, opacity: 0.9, textAlign: "center" }}>
              {productName}
            </div>

            <div
              style={{
                fontSize: 110,
                fontWeight: 1000,
                marginTop: 12,
                textAlign: "center",
              }}
            >
              {price}
            </div>

            <div style={{ marginTop: 6, opacity: 0.65, textAlign: "center" }}>
              Volviendo a escanear…
            </div>
          </div>
        )}

        {mode === "error" && (
          <div
            style={{
              background: "#2a0f0f",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 18,
              padding: 18,
              maxWidth: 960,
              width: "100%",
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, textAlign: "center" }}>
              No se pudo consultar
            </div>

            {lastScan && (
              <div
                style={{
                  marginTop: 6,
                  opacity: 0.7,
                  wordBreak: "break-word",
                  textAlign: "center",
                }}
              >
                QR leído: {lastScan}
              </div>
            )}

            <div
              style={{
                marginTop: 10,
                opacity: 0.85,
                whiteSpace: "pre-wrap",
                textAlign: "center",
              }}
            >
              {error}
            </div>

            <div style={{ marginTop: 8, opacity: 0.65, textAlign: "center" }}>
              Reintentando automáticamente…
            </div>
          </div>
        )}
      </div>
    </div>
  );
}