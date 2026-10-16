package browser

import "fmt"

// conservativeSwitches are the background-service and automation-only switches
// applied to throwaway headless profiles. They mirror the set Playwright uses
// for its own temporary profiles, which is what the local comparison measures
// against. Persistent profiles keep extensions and synchronization.
//
// BackForwardCache is deliberately absent: this project restores documents
// from the back/forward cache, so disabling it would break a supported feature.
const conservativeSwitches = `AcceptCHFrame,AutoUpdateRemoteText,CertificateTransparencyComponentUpdater,CalculateNativeWinOcclusion,CloudImport,InterestFeedContentSuggestions,MediaRouter,OptimizationHints,OptimizationHintsFetching,PaintHolding,Translate,WinRetrieveSuggestionsOnHover`

func stealthLaunchArgs(cfg StealthConfig, userDataDir string, persisted bool) []string {
	args := []string{
		"--remote-debugging-port=0",
		"--user-data-dir=" + userDataDir,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-blink-features=AutomationControlled",
		"--disable-popup-blocking",
		"--mute-audio",
		"--lang=" + cfg.Lang,
		fmt.Sprintf("--window-size=%d,%d", cfg.Width, cfg.Height),
		"--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	}
	if cfg.Headless {
		// LaunchStealth creates the controlled target through CDP. Opening a
		// startup tab as well leaves an unused page and its renderer alive.
		args = append(args, "--headless=new", "--no-startup-window")
		// A headless session never presents a surface, so software rendering
		// removes GPU process startup and its resident memory.
		args = append(args, "--disable-gpu")
		if !persisted {
			// Match the conservative background-service switches used by
			// Playwright. Persistent profiles retain their extensions and sync.
			args = append(args,
				"--disable-background-networking",
				"--disable-background-timer-throttling",
				"--disable-backgrounding-occluded-windows",
				"--disable-breakpad",
				"--disable-client-side-phishing-detection",
				"--disable-component-extensions-with-background-pages",
				"--disable-component-update",
				"--disable-default-apps",
				"--disable-dev-shm-usage",
				"--disable-extensions",
				"--disable-field-trial-config",
				"--disable-hang-monitor",
				"--disable-ipc-flooding-protection",
				"--disable-lcd-text",
				"--disable-prompt-on-repost",
				"--disable-speech-api",
				"--disable-sync",
				"--disable-features="+conservativeSwitches,
				"--force-color-profile=srgb",
				"--hide-scrollbars",
				"--metrics-recording-only",
				"--no-pings",
				"--no-service-autorun",
				"--password-store=basic",
				"--use-mock-keychain",
			)
		}
	} else {
		args = append(args, "about:blank")
	}
	return args
}
