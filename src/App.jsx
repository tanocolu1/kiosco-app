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

async function hasAnyCamera() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return false;
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === "videoinput");
  } catch {
    return false;
  }
}

export default function App() {
  const isLandscape = useIsLandscape();

  const scannerRef = useRef(null);
  const restartingRef = useRef(false);

  const beepRef = useRef(null);

  // HID “teclado”
  const inputRef = useRef(null);
  const bufferRef = useRef("");

  // camera | hid
  const [scanSource, setScanSource] = useState("camera");

  // scanning | loading | result | error
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

    const el = document.getElementById("reader");
    if (el) el.innerHTML = "";
  }

  const qrboxSize = useMemo(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w > h) return Math.min(w * 0.3, 420);
    return Math.min(w * 0.55, 360);
  }, [isLandscape]);

  async function playFeedback() {
    try {
      beepRef.current.currentTime = 0;
      await beepRef.current.play();
    } catch {}
    try {
      navigator.vibrate?.(40);
    } catch {}
  }

  async function fetchAndShow(codeOrUrl) {
    setMode("loading");
    setError("");

    await playFeedback();

    try {
      if (!API) throw new Error(NO_PRICE_MSG);

      const r = await fetch(`${API}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: codeOrUrl }),
      });

      const txt = await r.text();
      if (!r.ok) throw new Error(NO_PRICE_MSG);

      const data = JSON.parse(txt);
      const cents = data.sellingPrice ?? data.price;

      if (cents == null || Number.isNaN(Number(cents)) || Number(cents) <= 0) {
        throw new Error(NO_PRICE_MSG);
      }

      setProductName(data.productName || "Producto");
      setPrice(formatARS(Number(cents)));
      setMode("result");

      setTimeout(async () => {
        setMode("scanning");
        setProductName("");
        setPrice("");
        setError("");

        if (scanSource === "hid") {
          bufferRef.current = "";
          inputRef.current?.focus();
          return;
        }

        await stopScanner();
        await new Promise((res) => setTimeout(res, 250));
        startCameraScanner();
      }, RESET_MS);
    } catch {
      setError(NO_PRICE_MSG);
      setMode("error");

      setTimeout(async () => {
        setMode("scanning");
        setProductName("");
        setPrice("");
        setError("");

        if (scanSource === "hid") {
          bufferRef.current = "";
          inputRef.current?.focus();
          return;
        }

        await stopScanner();
        await new Promise((res) => setTimeout(res, 250));
        startCameraScanner();
      }, ERROR_RESET_MS);
    }
  }

  async function startCameraScanner() {
    if (restartingRef.current) return;
    restartingRef.current = true;

    try {
      setScanSource("camera");
      setMode("scanning");
      setError("");
      setProductName("");
      setPrice("");

      // reader SIEMPRE existe en el DOM
      const reader = document.getElementById("reader");
      if (!reader) throw new Error("Reader missing");

      await stopScanner();

      const scanner = new Html5Qrcode("reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: qrboxSize },
        async (decodedText) => {
          // parar para evitar doble lectura
          await stopScanner();
          await fetchAndShow(decodedText);
        }
      );
    } catch (e) {
      // Si falla getUserMedia (NotFoundError, NotAllowedError, etc.) → HID
      setScanSource("hid");
      setMode("scanning");
      setError(""); // no mostramos el error técnico
      bufferRef.current = "";
      inputRef.current?.focus();
    } finally {
      restartingRef.current = false;
    }
  }

  function startHidMode() {
    stopScanner();
    setScanSource("hid");
    setMode("scanning");
    setError("");
    setProductName("");
    setPrice("");
    bufferRef.current = "";
    inputRef.current?.focus();
  }

  // Listener global para capturar “teclado escáner”
  useEffect(() => {
    const onKeyDown = (e) => {
      if (scanSource !== "hid") return;

      // Mantener foco en input invisible
      if (document.activeElement !== inputRef.current) {
        inputRef.current?.focus();
      }

      // Muchos scanners mandan Enter al final
      if (e.key === "Enter") {
        const value = (bufferRef.current || "").trim();
        bufferRef.current = "";

        if (value) {
          fetchAndShow(value);
        }
        e.preventDefault();
        return;
      }

      // Ignorar teclas especiales
      if (e.key.length !== 1) return;

      bufferRef.current += e.key;
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scanSource]);

  // Arranque automático: si no hay cámara, cae a HID
  useEffect(() => {
    (async () => {
      const hasCam = await hasAnyCamera();
      if (!hasCam) {
        startHidMode();
        return;
      }
      startCameraScanner();
    })();

    return () => stopScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLandscape]);

  return (
    <div
      onClick={() => {
        enableFullscreen();
        if (scanSource === "hid") inputRef.current?.focus();
      }}
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

      {/* Input invisible para HID */}
      <input
        ref={inputRef}
        inputMode="none"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        style={{
          position: "absolute",
          opacity: 0,
          height: 1,
          width: 1,
          left: -9999,
          top: -9999,
        }}
        onChange={() => {}}
      />

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "2vh" }}>
        <img
          src="/logo.png?v=10"
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

        {/* Selector modo */}
        <div style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "center" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              startCameraScanner();
            }}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.15)",
              background: scanSource === "camera" ? "#1f3a2a" : "#1a1a1a",
              color: "#fff",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Cámara
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              startHidMode();
            }}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.15)",
              background: scanSource === "hid" ? "#1f3a2a" : "#1a1a1a",
              color: "#fff",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Escáner (USB/Bluetooth)
          </button>
        </div>

        {scanSource === "hid" && (
          <div style={{ marginTop: 10, opacity: 0.7 }}>
            Modo escáner activo: acercá el código al lector (envía Enter).
          </div>
        )}
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
        {/* Reader SIEMPRE existe, solo se oculta */}
        <div style={{ width: "100%" }}>
          <div
            id="reader"
            style={{
              display: scanSource === "camera" && (mode === "scanning" || mode === "loading") ? "block" : "none",
              borderRadius: 16,
              overflow: "hidden",
              background: "#1b1b1b",
              width: "100%",
            }}
          />
          {scanSource === "camera" && mode === "loading" && (
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
                  fontSize: isLandscape ? "clamp(80px, 9vw, 170px)" : "clamp(60px, 10vw, 140px)",
                  fontWeight: 1000,
                  color: "#00ff88",
                  marginTop: "1vh",
                }}
              >
                {price}
              </div>
              <div style={{ opacity: 0.6, marginTop: "1vh" }}>Listo para el próximo…</div>
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
              <div style={{ marginTop: 10, opacity: 0.7 }}>Consultá a un vendedor.</div>
            </div>
          )}

          {mode === "scanning" && scanSource === "hid" && (
            <div
              style={{
                border: "1px dashed rgba(255,255,255,0.18)",
                borderRadius: 18,
                padding: "3vh 2vw",
                opacity: 0.75,
              }}
            >
              <div style={{ fontSize: "clamp(18px, 2vw, 28px)", fontWeight: 800 }}>
                Listo para escanear (lector)
              </div>
              <div style={{ marginTop: 10, fontSize: "clamp(14px, 1.4vw, 20px)" }}>
                Apuntá el código al escáner. Se consulta automáticamente.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
