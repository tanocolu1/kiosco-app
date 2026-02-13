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
    typeof window !== "undefined" ? window.matchMedia("(orientation: landscape)").matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape)");
    const handler = () => setIsLandscape(mq.matches);
    // Safari compatibility
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);
    handler();
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
    const w = window.innerWidth || 800;
    const h = window.innerHeight || 600;
    // En horizontal, QR box más grande
    if (w > h) return Math.min(w * 0.28, 380);
    return Math.min(w * 0.55, 350);
  }, [isLandscape]);

  async function startScanner() {
    if (restartingRef.current) return;
    restartingRef.current = true;

    try {
      setError("");
      setProductName("");
      setPrice("");
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

          // 🔊 beep + vibración
          try {
            beepRef.current?.currentTime && (beepRef.current.currentTime = 0);
            await beepRef.current?.play();
          } catch {}
          try {
            navigator.vibrate?.(40);
          } catch {}

          try {
            if (!API) throw new Error("VITE_API_BASE no está configurado");

            const r = await fetch(`${API}/resolve`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: decodedText }),
            });

            const body = await r.text();
            if (!r.ok) throw new Error(body || `HTTP ${r.status}`);

            const data = JSON.parse(body);

            setProductName(data.productName || "Producto");
            setPrice(formatARS(data.sellingPrice ?? data.price));
            setMode("result");

            setTimeout(startScanner, RESET_MS);
          } catch (e) {
            setError(String(e?.message || e));
            setMode("error");
            setTimeout(startScanner, ERROR_RESET_MS);
          }
        }
      );
    } catch (e) {
      setError(String(e?.message || e));
      setMode("error");
      setTimeout(startScanner, ERROR_RESET_MS);
    } finally {
      restartingRef.current = false;
    }
  }

  useEffect(() => {
    startScanner();
    return () => stopScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLandscape]); // reinicia scanner al rotar (mejor UX)

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
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "2.2vh" }}>
        <img
          src="/logo.png?v=6"
          alt="Tienda Colucci"
          style={{
            width: "clamp(140px, 18vw, 260px)",
            height: "auto",
            marginBottom: "1.6vh",
          }}
        />
        <div style={{ fontSize: "clamp(26px, 3.2vw, 54px)", fontWeight: 900, lineHeight: 1.1 }}>
          Consulta de precios
        </div>
        <div style={{ opacity: 0.72, marginTop: 8, fontSize: "clamp(16px, 1.7vw, 24px)" }}>
          Escaneá el producto para ver el precio
        </div>
      </div>

      {/* Layout */}
      <div
        style={{
          display: "grid",
          gap: "2.2vw",
          alignItems: "center",
          gridTemplateColumns: isLandscape ? "1fr 1.4fr" : "1fr",
        }}
      >
        {/* Scanner */}
        <div
          style={{
            display: mode === "scanning" || mode === "loading" ? "block" : "none",
            width: "100%",
          }}
        >
          <div
            id="reader"
            style={{
              width: "100%",
              borderRadius: 18,
              overflow: "hidden",
              background: "#1b1b1b",
              // En horizontal, dejamos que use todo el ancho de la columna
              maxWidth: isLandscape ? "unset" : 720,
              margin: isLandscape ? "0" : "0 auto",
            }}
          />
          {mode === "loading" && (
            <div style={{ marginTop: 14, textAlign: "center", opacity: 0.85, fontSize: 22 }}>
              Consultando precio…
            </div>
          )}
        </div>

        {/* Resultado / Error */}
        <div style={{ width: "100%" }}>
          {mode === "result" && (
            <div
              style={{
                background: "#0f172a",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 18,
                padding: "2.2vh 2.2vw",
                width: "100%",
              }}
            >
              <div
                style={{
                  fontSize: "clamp(18px, 2.2vw, 34px)",
                  opacity: 0.92,
                  textAlign: "center",
                }}
              >
                {productName}
              </div>

              {/* ✅ En horizontal ocupa todo el ancho */}
              <div
                style={{
                  width: "100%",
                  fontSize: isLandscape
                    ? "clamp(72px, 8.5vw, 170px)" // enorme y ancho
                    : "clamp(54px, 10vw, 140px)",
                  fontWeight: 1000,
                  marginTop: "1.2vh",
                  textAlign: "center",
                  letterSpacing: "-0.02em",
                  color: "#00ff88",
                }}
              >
                {price}
              </div>

              <div style={{ marginTop: 10, opacity: 0.65, textAlign: "center" }}>
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
                padding: "2vh 2vw",
                width: "100%",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 900 }}>No se pudo consultar</div>
              <div style={{ marginTop: 10, opacity: 0.85, whiteSpace: "pre-wrap" }}>{error}</div>
              <div style={{ marginTop: 10, opacity: 0.65 }}>Reintentando automáticamente…</div>
            </div>
          )}

          {/* En modo scanning (sin resultado aún), mostramos un panel “vacío” en horizontal
              para que la columna derecha no quede vacía */}
          {isLandscape && mode === "scanning" && (
            <div
              style={{
                border: "1px dashed rgba(255,255,255,0.18)",
                borderRadius: 18,
                padding: "3vh 2vw",
                opacity: 0.6,
                textAlign: "center",
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