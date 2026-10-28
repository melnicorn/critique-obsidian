// Tiny DevTools-protocol client for checking the plugin inside a running Obsidian started with
// --remote-debugging-port=9222. Usage:
//   node scripts/cdp.mjs eval '<js expression>'      (result printed as JSON)
//   node scripts/cdp.mjs shot <out.png> [selector]   (screenshot of the page, or of one element)
//   node scripts/cdp.mjs targets
const port = process.env.CDP_PORT ?? "9222";

async function targets() {
  const r = await fetch(`http://127.0.0.1:${port}/json`);
  return r.json();
}

async function connect() {
  const list = await targets();
  const want = process.env.CDP_TITLE ?? "Other Vault"; const page = list.find((t) => t.type === "page" && t.title.includes(want) && (process.env.CDP_TITLE || t.url.startsWith("app://"))) ?? list.find((t) => t.type === "page");
  if (!page) throw new Error("No page target. Targets: " + JSON.stringify(list.map((t) => [t.type, t.url])));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const myId = ++id;
      pending.set(myId, res);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  return { ws, send };
}

async function evaluate(send, expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "targets") {
  console.log(JSON.stringify(await targets(), null, 2));
  process.exit(0);
}
const { ws, send } = await connect();
try {
  if (process.env.CDP_FOCUS) await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  if (cmd === "eval" || cmd === "evalshot") {
    const v = await evaluate(send, a);
    if (cmd === "evalshot") {
      const r = await send("Page.captureScreenshot", { format: "png" });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(b, Buffer.from(r.result.data, "base64"));
    }
    console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  } else if (cmd === "shot") {
    let clip;
    if (b) {
      const rect = await evaluate(send, `(() => { const el = document.querySelector(${JSON.stringify(b)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }; })()`);
      if (!rect) throw new Error("selector not found: " + b);
      clip = rect;
    }
    const r = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(a, Buffer.from(r.result.data, "base64"));
    console.log("wrote", a);
  } else {
    console.log("unknown command");
  }
} finally {
  ws.close();
}
