package game

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	DefaultUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
	DeviceFileName   = "baiak_device"
)

// yt calcula o hash djb2 em 32-bit uint idêntico à implementação do bundle do Baiak Idle
func yt(input string) string {
	var t uint32 = 5381
	for i := 0; i < len(input); i++ {
		t = ((t << 5) + t + uint32(input[i]))
	}
	return fmt.Sprintf("%08x", t)
}

func newDeviceID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

type FingerprintEnv struct {
	UserAgent         string
	ScreenWidth       int
	ScreenHeight      int
	ColorDepth        int
	TimezoneOffsetMin int
	Language          string
}

func DefaultEnv() FingerprintEnv {
	return FingerprintEnv{
		UserAgent:         DefaultUserAgent,
		ScreenWidth:       1280,
		ScreenHeight:      720,
		ColorDepth:        24,
		TimezoneOffsetMin: -180,
		Language:          "pt-BR",
	}
}

// BuildFingerprint gera a string de fingerprint no padrão do jogo: `${deviceId32}-${yt(raw)}`
func BuildFingerprint(deviceID string, env FingerprintEnv) string {
	raw := fmt.Sprintf("%s|%d|%d|%d|%d|%s",
		env.UserAgent,
		env.ScreenWidth,
		env.ScreenHeight,
		env.ColorDepth,
		env.TimezoneOffsetMin,
		env.Language,
	)
	cleanID := deviceID
	if len(cleanID) > 32 {
		cleanID = cleanID[:32]
	}
	return fmt.Sprintf("%s-%s", cleanID, yt(raw))
}

// LoadOrCreateDeviceID carrega o device ID estável do disco para manter o fingerprint persistente
func LoadOrCreateDeviceID(dataDir string) string {
	path := filepath.Join(dataDir, DeviceFileName)
	if content, err := os.ReadFile(path); err == nil {
		id := strings.TrimSpace(string(content))
		if len(id) >= 16 && len(id) <= 64 {
			return id
		}
	}

	id := newDeviceID()
	_ = os.MkdirAll(dataDir, 0755)
	_ = os.WriteFile(path, []byte(id), 0644)
	return id
}
