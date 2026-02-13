import { useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

const API = import.meta.env.VITE_API_BASE;
const NO_PRICE_MSG = "No encontramos el precio. Consultá a un vendedor.";

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

    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, []);

  return isLandscape;
}

export default function App() {
  const scannerRef = useRef(null);
  const beepRef = useRef(null);
  const restartingRef = useRef(false);

  const isLandscape = useIsLandscape();

  const [mode, setMode] = useState("scanning"); // scanning | loading | result | error
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

  // ✅ Stop + clear + wipe DOM (robusto)
  async function stopScanner() {
    const s = scannerRef.current;
    if (!s) return;

    try {
      if (s.isScanning) {
        await s.stop();
      }
    } catch (e) {
      console.log("Error stopping scanner:", e);
    }

    try {
      await s.clear();
    } catch {}

    scannerRef.current = null;

    const el = document.getElementById("reader");
    if (el) el.innerHTML = "";
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
      setProductName("");
      setPrice("");
      setMode("scanning");

      await stopScanner();

      const el = document.getElementById("reader");
      if (el) el.innerHTML = "";

      const scanner = new Html5Qrcode("reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: qrboxSize },
        async (decodedText) => {
          // Parar scanner inmediatamente para evitar doble lectura
          await stopScanner();
          setMode("loading");

          // 🔊 beep + vibración
          try {
            beepRef.current.currentTime = 0;
            await beepRef.current.play();
          } catch {}
          try {
            navigator.vibrate?.(40);
          } catch {}

          try {
            if (!API) throw new Error(NO_PRICE_MSG);

            const r = await fetch(`${API}/resolve`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: decodedText }),
            });

            const text = await r.text();

            // Backend no OK → mensaje amigable
            if (!r.ok) throw new Error(NO_PRICE_MSG);

            const data = JSON.parse(text);
            const cents = data.sellingPrice ?? data.price;

            // OK pero sin precio válido
            if (cents == null || Number.isNaN(Number(cents)) || Number(cents) <= 0) {
              throw new Error(NO_PRICE_MSG);
            }

            setProductName(data.productName || "Producto");
            setPrice(formatARS(Number(cents)));
            setMode("result");

            // ✅ Reset robusto
            setTimeout(async () => {
              await stopScanner();
              await new Promise((res) => setTimeout(res, 250)); // pequeño delay evita bugs en Android
              startScanner();
            }, RESET_MS);
          } catch (e) {
            setError(NO_PRICE_MSG);
            setMode("error");

            // ✅ Reset robusto también en error
            setTimeout(async () => {
              await stopScanner();
              await new Promise((res) => setTimeout(res, 250));
              startScanner();
            }, ERROR_RESET_MS);
          }
        }
      );
    } catch (e) {
      setError(String(e?.message || e));
      setMode("error");

      setTimeout(async () => {
        await stopScanner();
        await new Promise((res) => setTimeout(res, 250));
        startScanner();
      }, ERROR_RESET_MS);
    } finally {
      restartingRef.current = false;
    }
  }

  useEffect(() => {
    startScanner();
    return () => stopScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          src="/logo.png?v=9"
          alt="Tienda Colucci"
          style={{
            width: "clamp(140px, 18vw, 260px)",
            marginBottom: "1.5vh",
          }}
        />
        <div style={{ fontSize: "clamp(26px, 3vw, 52px)", fontWeight: 900 }}>
          Consulta de precios
        </div>
        <div
          style={{
            opacity: 0.7,
            marginTop: 6,
            fontSize: "clamp(16px, 1.6vw, 22px)",
          }}
        >
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
         <div
  id="reader"
  style={{
    display: mode === "scanning" || mode === "loading" ? "block" : "none",
    borderRadius: 16,
    overflow: "hidden",
    background: "#1b1b1b",
    width: "100%",
  }}
/>
          {mode === "loading" && (
            <div style={{ marginTop: 14, textAlign: "center", opacity: 0.85, fontSize: 22 }}>
              Consultando precio…
            </div>
          )}
        </div>

        {/* Resultado / Error */}
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
            <div
              style={{
                background: "#2a0f0f",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 18,
                padding: "2vh 2vw",
                color: "#ffdddd",
              }}
            >
              <div style={{ fontSize: "clamp(18px, 2vw, 28px)", fontWeight: 900 }}>
                Sin precio disponible
              </div>
              <div style={{ marginTop: 10, opacity: 0.9 }}>{error}</div>
              <div style={{ marginTop: 10, opacity: 0.7 }}>
                Consultá a un vendedor.
              </div>
            </div>
          )}

          {isLandscape && mode === "scanning" && (
            <div
              style={{
                border: "1px dashed rgba(255,255,255,0.18)",
                borderRadius: 18,
                padding: "3vh 2vw",
                opacity: 0.65,
              }}
            >
              <div style={{ fontSize: "clamp(18px, 2vw, 28px)", fontWeight: 800 }}>
                Listo para escanear
              </div>
              <div style={{ marginTop: 10, fontSize: "clamp(14px, 1.4vw, 20px)" }}>
                Apuntá la cámara al QR del producto
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}