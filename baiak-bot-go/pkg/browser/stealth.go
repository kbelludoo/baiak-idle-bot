package browser

// Stealth fingerprint layer: patches applied before any page script runs.
// Defeats the baseline automation probes — navigator.webdriver, missing
// chrome runtime object, empty plugin/mimeType lists, permissions query
// anomalies. Real Chrome/Edge binary + real UA + these patches is what
// reCAPTCHA v3 and similar JS heuristics score against.

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

const stealthScript = `
(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
  } catch (e) {}
  try {
    delete Object.getPrototypeOf(navigator).webdriver;
  } catch (e) {}

  if (!window.chrome) window.chrome = {};
  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: { INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY: 'ready', RUNNING: 'running' },
      getDetails: () => null,
      getIsInstalled: () => false,
      installState: () => {},
      runningState: () => 'cannot_run'
    };
  }
  if (!window.chrome.csi) {
    window.chrome.csi = () => ({
      startE: 0,
      onloadT: 0,
      pageT: 0,
      tran: 15
    });
  }
  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = () => {
      const t = performance.timing || {};
      return {
        requestTime: (t.navigationStart || 0) / 1000,
        startLoadTime: (t.navigationStart || 0) / 1000,
        commitLoadTime: (t.responseStart || 0) / 1000,
        finishDocumentLoadTime: (t.domContentLoadedEventEnd || 0) / 1000,
        finishLoadTime: (t.loadEventEnd || 0) / 1000,
        firstPaintTime: 0,
        firstContentfulPaintTime: 0,
        navigationType: 'Other',
        wasFetchedViaSpdy: false,
        wasNpnNegotiated: false,
        npnNegotiatedProtocol: 'unknown',
        wasAlternateProtocolAvailable: false,
        connectionInfo: 'http/1.1'
      };
    };
  }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
      PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
      PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
      RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
      connect: () => ({
        onMessage: { addListener() {}, removeListener() {} },
        onDisconnect: { addListener() {}, removeListener() {} },
        postMessage() {},
        disconnect() {},
        sender: undefined
      }),
      sendMessage: () => Promise.resolve(),
      id: undefined
    };
  }

  try {
    const originalQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (params) => {
      if (params && params.name === 'notifications') {
        const state = (typeof Notification !== 'undefined' && Notification.permission) || 'prompt';
        return Promise.resolve({ state: state, status: state, onchange: null });
      }
      return originalQuery(params);
    };
  } catch (e) {}

  try {
    if (navigator.plugins.length === 0) {
      Object.defineProperty(navigator.plugins, 'length', { get: () => 5, configurable: true });
    }
    if (navigator.mimeTypes.length === 0) {
      Object.defineProperty(navigator.mimeTypes, 'length', { get: () => 5, configurable: true });
    }
  } catch (e) {}

  try {
    if (!navigator.languages || navigator.languages.length === 0) {
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true });
    }
  } catch (e) {}

  try {
    if (!navigator.connection) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          rtt: 50,
          downlink: 10,
          effectiveType: '4g',
          saveData: false,
          onchange: null
        }),
        configurable: true
      });
    }
  } catch (e) {}
})();
`

// RenderStealth fetches the fully rendered DOM of a URL through a stealth
// CDP session: real browser binary, patched fingerprint, real network stack.
// Use this instead of --dump-dom headless wherever the target runs JS
// bot detection.
func RenderStealth(browserPath, targetURL string, timeout time.Duration) ([]byte, error) {
	if timeout <= 0 {
		timeout = 25 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	s, err := LaunchStealth(ctx, StealthConfig{BrowserPath: browserPath, Headless: true})
	if err != nil {
		return nil, err
	}
	defer s.Close()

	if err := s.Navigate(ctx, targetURL); err != nil {
		return nil, err
	}
	// Give SPA hydration and async detection scripts time to settle.
	time.Sleep(1500 * time.Millisecond)
	s.MouseJitter(ctx, 2)

	raw, err := s.Evaluate(ctx, "document.documentElement.outerHTML")
	if err != nil {
		return nil, err
	}
	var html string
	if err := json.Unmarshal(raw, &html); err != nil {
		return nil, fmt.Errorf("unexpected DOM type: %w", err)
	}
	if html == "" {
		return nil, fmt.Errorf("stealth render returned empty DOM")
	}
	return []byte(html), nil
}
