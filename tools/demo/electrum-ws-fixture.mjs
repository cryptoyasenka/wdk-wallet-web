// Local, offline Electrum-over-WebSocket fixture — demo recorder ONLY.
//
// This is NOT part of the wallet. Nothing under packages/ or apps/ imports it,
// it never imports @tetherto/*, and it is outside the pnpm workspace so it is
// not linted, type-checked, tested or built by the quartet. Its sole job: let
// `pnpm demo` shows a populated BTC row without a real Electrum endpoint or any
// secret, by binding 127.0.0.1 on an ephemeral port and answering the handful
// of JSON-RPC 2.0 methods the WDK BTC client (ElectrumWs) actually calls.
//
// The BTC *address* in the demo is real client-side key math (no socket). This
// fixture only answers the lazy balance / history / fee reads, with fixed
// canned data so the recorded GIF is byte-stable across runs. It deliberately
// does not simulate a real chain — that matches the honest residual documented
// in docs/RN-TO-WEB-MAP.md (BTC needs a public Electrum-WS endpoint), it does
// not fake it.

import { WebSocketServer } from "ws";

// Canned answers keyed by Electrum method. Values are intentionally constant.
// 1_234_567 sats = 0.01234567 BTC — a recognisably round, obviously-demo number.
// estimatefee is BTC/kB and must be > 0 (the client throws on the -1 Electrum
// "fee unavailable" sentinel), so the send-quote step renders a real fee line.
const CANNED = {
  "blockchain.scripthash.get_balance": { confirmed: 1234567, unconfirmed: 0 },
  "blockchain.scripthash.listunspent": [],
  "blockchain.scripthash.get_history": [],
  "blockchain.estimatefee": 0.00001,
  "server.version": ["wdk-demo-fixture", "1.4"],
  "server.ping": null,
};

function resultFor(method) {
  // hasOwnProperty so a canned `null` (server.ping) is distinguishable from
  // "method not in the map". Unknown / unused methods get a benign null, which
  // keeps the JSON-RPC client unblocked without pretending to be a real node.
  return Object.prototype.hasOwnProperty.call(CANNED, method) ? CANNED[method] : null;
}

const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ignore non-JSON frames
    }
    // ElectrumWs sends one request, or a JSON array (batch). Echo each id back
    // with its result; reply shape mirrors the request shape (array ↔ array).
    const isBatch = Array.isArray(msg);
    const reqs = isBatch ? msg : [msg];
    const replies = reqs.map((req) => ({
      jsonrpc: "2.0",
      id: req.id,
      result: resultFor(req.method),
    }));
    socket.send(JSON.stringify(isBatch ? replies : replies[0]));
  });
});

wss.on("listening", () => {
  const { port } = wss.address();
  // The recorder parses this exact line to build the ws:// URL it injects as
  // NEXT_PUBLIC_BTC_ELECTRUM_WS_URL for the Next build + start.
  process.stdout.write(`FIXTURE_PORT=${port}\n`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => wss.close(() => process.exit(0)));
}
