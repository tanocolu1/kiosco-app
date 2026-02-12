import { useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

const API = import.meta.env.VITE_API_BASE;
console.log("API =>", API);

function formatARS(cents) {
  if (cents == null) return "";
  return (cents / 100).toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

export default function App() {
  const scannerRef = useRef(null);

  const [mode, setMode] = useState("idle"); // idle | scanning | loading | result | error
  const [productName, setProductName] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");
  const [lastScan, setLastScan] = useState("");

  const RESET_MS = 10000;

  async function stop() {
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

  async function start() {
    try {
      setError("");
      setLastScan("");
      setProductName("");
      setPrice("");
      setMode("scanning");

      const scanner = new Html5Qrcode("reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        async (decodedText) => {
          await stop();
          setLastScan(decodedText);
          setMode("loading");

          try {
            if (!API) throw new Error("VITE_API_BASE no está configurado (.env)");

            const r = await fetch(`${API}/resolve`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: decodedText }),
            });

            const bodyText = await r.text(); // leemos texto para mostrar errores

            if (!r.ok) {
              throw new Error(`Backend respondió ${r.status}:\n${bodyText}`);
            }

            const data = JSON.parse(bodyText);
            setProductName(data.productName || data.slug || "Producto");
            setPrice(formatARS(data.sellingPrice ?? data.price));
            setMode("result");

            setTimeout(() => start(), RESET_MS);
          } catch (e) {
            setMode("error");
            setError(String(e?.message || e));
          }
        }
      );
    } catch (e) {
      setMode("error");
      setError(String(e?.message || e));
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: "system-ui" }}>
      <h1 style={{ marginTop: 0 }}>Consulta de precios</h1>

      <div
        id="reader"
        style={{
          width: "100%",
          maxWidth: 520,
          borderRadius: 12,
          overflow: "hidden",
          display: mode === "scanning" ? "block" : "none",
        }}
      />

      {mode === "idle" && (
        <button onClick={start} style={{ fontSize: 22, padding: "14px 18px", borderRadius: 12 }}>
          Iniciar escáner
        </button>
      )}

      {mode === "loading" && (
        <>
          <h2>Consultando…</h2>
          <p style={{ opacity: 0.7, wordBreak: "break-word" }}>{lastScan}</p>
        </>
      )}

      {mode === "result" && (
        <>
          <h2 style={{ opacity: 0.8 }}>{productName}</h2>
          <div style={{ fontSize: 72, fontWeight: 900 }}>{price}</div>
          <p style={{ opacity: 0.7 }}>Volviendo a escanear…</p>
        </>
      )}

      {mode === "error" && (
        <>
          <h2>Error al escanear / consultar</h2>
          {lastScan && (
            <p style={{ opacity: 0.7, wordBreak: "break-word" }}>
              QR leído: <b>{lastScan}</b>
            </p>
          )}
          <pre
            style={{
              background: "#fee",
              padding: 12,
              borderRadius: 8,
              color: "#900",
              whiteSpace: "pre-wrap",
            }}
          >
            {error}
          </pre>
          <button onClick={start} style={{ fontSize: 18, padding: "10px 14px", borderRadius: 10 }}>
            Reintentar
          </button>
        </>
      )}
    </div>
  );
}
