export default function Home() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: "12px",
      }}
    >
      <h1 style={{ fontSize: "24px", fontWeight: 600 }}>LINE Webhook Proxy</h1>
      <p style={{ color: "#888", fontSize: "14px" }}>
        Forwarding LINE events to configured targets.
      </p>
      <p style={{ color: "#555", fontSize: "12px" }}>
        Health check:{" "}
        <code style={{ background: "#1a1a1a", padding: "2px 8px", borderRadius: "4px" }}>
          GET /api/webhook
        </code>
      </p>
    </main>
  );
}
