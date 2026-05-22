/**
 * Operator status page. Shown at http://localhost:3003/ — a plain HTML
 * landing for humans who hit the hostname by accident. The real surface
 * is /.well-known/agent.json, /openapi.json, /api/health, and /api/tools/*.
 */

export default function Page() {
  return (
    <main
      style={{
        maxWidth: 560,
        margin: "64px auto",
        padding: "0 24px",
        color: "#0B0E14",
      }}
    >
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Lumo Restaurant Agent</h1>
      <p style={{ color: "#8A8F99", marginTop: 0 }}>
        Service endpoint for the Lumo shell. No UI here — users talk to the shell.
      </p>
      <h2 style={{ fontSize: 16, marginTop: 32 }}>Endpoints</h2>
      <ul style={{ lineHeight: 1.8, paddingLeft: 20 }}>
        <li>
          <code>GET /.well-known/agent.json</code> — manifest
        </li>
        <li>
          <code>GET /openapi.json</code> — OpenAPI 3.1 spec with x-orchet-* extensions
        </li>
        <li>
          <code>GET /api/health</code> — liveness &amp; readiness
        </li>
        <li>
          <code>POST /api/tools/restaurant_search_restaurants</code>
        </li>
        <li>
          <code>POST /api/tools/restaurant_check_availability</code>
        </li>
        <li>
          <code>POST /api/tools/restaurant_create_reservation</code> — money tool
        </li>
        <li>
          <code>POST /api/tools/restaurant_cancel_reservation</code> — Saga rollback
        </li>
      </ul>
    </main>
  );
}
