package browser

// In-page relay hook: installed before any document runs on the runner's
// Chromium. It watches the game's own ticket request, lifts turnstileToken
// out of the body, freezes the request so the token is never spent from the
// runner's IP, and pushes the token toward the tunnel. The WebSocket class is
// swapped for a dummy so the frozen page cannot open a game socket and draw
// 4401/4403 against the disposable session.

import "strconv"

// TicketRelayHook builds the init script for relay sessions. tunnelURL is the
// Cloudflare tunnel base the runner pushes to; with an empty URL the hook
// still freezes and records the token for the Go side to collect.
func TicketRelayHook(tunnelURL string) string {
	return `(() => {
  if (window.__ticketRelayInstalled) return;
  window.__ticketRelayInstalled = true;
  const TUNNEL = ` + strconv.Quote(tunnelURL) + `;
  const MATCH = /\/auth\/world-ticket(\?|$)/;

  const push = (payload) => {
    try { window.__ticketRelay = payload; } catch (e) {}
    if (!TUNNEL) return;
    try {
      fetch(TUNNEL + "/api/ticket", {
        method: "POST",
        mode: "no-cors",
        keepalive: true,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch (e) {}
  };

  const tokenFrom = (body) => {
    let text = "";
    try {
      if (typeof body === "string") text = body;
      else if (body instanceof URLSearchParams) text = body.toString();
      else if (typeof TextDecoder !== "undefined" && body instanceof ArrayBuffer) text = new TextDecoder().decode(body);
      else if (typeof TextDecoder !== "undefined" && body && body.buffer instanceof ArrayBuffer) text = new TextDecoder().decode(body);
    } catch (e) {}
    if (!text) return "";
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.turnstileToken === "string") return parsed.turnstileToken;
    } catch (e) {}
    const m = text.match(/"turnstileToken"\s*:\s*"([^"]+)"/);
    return m ? m[1] : "";
  };

  // Returns true when the request belongs to the relay: the caller must drop
  // it on the floor (fetch answers a promise that never settles, XHR never
  // sends) so the token stays unspent.
  const intercept = (url, body, method) => {
    if (!url || !MATCH.test(String(url))) return false;
    if (method && String(method).toUpperCase() !== "POST") return false;
    push({ token: tokenFrom(body), url: String(url), at: Date.now(), frozen: true, source: "fetch-hook" });
    return true;
  };

  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      try {
        const url = typeof input === "string" ? input : (input && input.url) || "";
        const method = (init && init.method) || (input && input.method) || "GET";
        const body = init ? init.body : (input && input.body) || null;
        if (intercept(url, body, method)) return new Promise(() => {});
      } catch (e) {}
      return nativeFetch(input, init);
    };
  }

  if (window.XMLHttpRequest) {
    const proto = window.XMLHttpRequest.prototype;
    const nativeOpen = proto.open;
    const nativeSend = proto.send;
    proto.open = function (method, url) {
      this.__relayMethod = method;
      this.__relayURL = url;
      return nativeOpen.apply(this, arguments);
    };
    proto.send = function (body) {
      try {
        if (intercept(this.__relayURL, body, this.__relayMethod)) return;
      } catch (e) {}
      return nativeSend.apply(this, arguments);
    };
  }

  if (window.WebSocket) {
    window.__ticketRelayNativeWS = window.WebSocket;
    window.WebSocket = class DummyWebSocket {
      constructor(url) {
        this.url = String(url);
        this.readyState = 0;
        this.protocol = "";
        this.extensions = "";
        this.binaryType = "blob";
        this.bufferedAmount = 0;
        setTimeout(() => {
          if (this.readyState !== 0) return;
          this.readyState = 1;
          try { if (this.onopen) this.onopen({ target: this }); } catch (e) {}
        }, 0);
      }
      send() {}
      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        try { if (this.onclose) this.onclose({ target: this, code: 1000, reason: "relay" }); } catch (e) {}
      }
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() { return true; }
    };
  }
})();
`
}
