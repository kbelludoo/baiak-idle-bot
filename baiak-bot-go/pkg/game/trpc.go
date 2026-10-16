package game

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"baiak-bot/pkg/network"
)

const DefaultTRPCBase = "https://baiakidle.com/api/trpc"

type TRPCClient struct {
	base    string
	token   string
	httpCli *network.HTTPClient
}

func NewTRPCClient(token, origin string, bindIP string) *TRPCClient {
	base := DefaultTRPCBase
	if origin != "" {
		base = strings.TrimRight(origin, "/") + "/api/trpc"
	}
	return &TRPCClient{
		base:    base,
		token:   token,
		httpCli: network.NewHTTPClient(base, 10*time.Second, bindIP),
	}
}

func (c *TRPCClient) unwrap(body []byte) (any, error) {
	var parsed any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("erro no json unmarshal: %w (raw: %s)", err, string(body))
	}

	// tRPC v10 batch retorna array: [{"result":{"data":{"json":...}}}]
	var list []any
	if arr, ok := parsed.([]any); ok {
		list = arr
	} else {
		list = []any{parsed}
	}

	if len(list) == 0 {
		return nil, nil
	}

	first, ok := list[0].(map[string]any)
	if !ok {
		return list[0], nil
	}

	// Checar erro retornado no corpo tRPC
	if errObj, hasErr := first["error"]; hasErr && errObj != nil {
		return nil, fmt.Errorf("trpc error: %v", errObj)
	}

	if res, ok := first["result"].(map[string]any); ok {
		if data, ok := res["data"].(map[string]any); ok {
			if jsonField, ok := data["json"]; ok {
				return jsonField, nil
			}
			return data, nil
		}
		return res["data"], nil
	}

	return first, nil
}

// Query realiza um tRPC GET query
func (c *TRPCClient) Query(ctx context.Context, path string, input any) (any, error) {
	wrapped := map[string]any{
		"0": input,
	}
	inputBytes, _ := json.Marshal(wrapped)
	reqURL := fmt.Sprintf("%s/%s?batch=1&input=%s", c.base, path, url.QueryEscape(string(inputBytes)))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("accept", "application/json")
	req.Header.Set("user-agent", DefaultUserAgent)
	if c.token != "" {
		req.Header.Set("authorization", "Bearer "+c.token)
	}

	res, err := c.httpCli.Client().Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	bodyBytes, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("tRPC query %s status %d: %s", path, res.StatusCode, string(bodyBytes))
	}

	return c.unwrap(bodyBytes)
}

// Mutate realiza um tRPC POST mutation
func (c *TRPCClient) Mutate(ctx context.Context, path string, input any) (any, error) {
	wrapped := map[string]any{
		"0": input,
	}
	inputBytes, _ := json.Marshal(wrapped)
	reqURL := fmt.Sprintf("%s/%s?batch=1", c.base, path)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, strings.NewReader(string(inputBytes)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("accept", "application/json")
	req.Header.Set("user-agent", DefaultUserAgent)
	if c.token != "" {
		req.Header.Set("authorization", "Bearer "+c.token)
	}

	res, err := c.httpCli.Client().Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	bodyBytes, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("tRPC mutate %s status %d: %s", path, res.StatusCode, string(bodyBytes))
	}

	return c.unwrap(bodyBytes)
}

// GetCharacters lista os personagens da conta
func (c *TRPCClient) GetCharacters(ctx context.Context) ([]CharacterInfo, error) {
	data, err := c.Query(ctx, "characters.list", nil)
	if err != nil {
		return nil, err
	}

	bytesData, _ := json.Marshal(data)
	var rawList []map[string]any
	_ = json.Unmarshal(bytesData, &rawList)

	var list []CharacterInfo
	for _, raw := range rawList {
		info := CharacterInfo{
			ID:       raw["id"],
			Name:     fmt.Sprint(raw["name"]),
			Vocation: fmt.Sprint(raw["vocation"]),
		}
		if lvl, ok := raw["level"].(float64); ok {
			info.Level = int(lvl)
		}
		if stam, ok := raw["stamina"].(float64); ok {
			info.Stamina = int(stam)
		}
		if gold, ok := raw["gold"].(float64); ok {
			info.Gold = int64(gold)
		}
		list = append(list, info)
	}

	return list, nil
}

// GetPartyConfig obtém a configuração da party
func (c *TRPCClient) GetPartyConfig(ctx context.Context) (*PartyConfig, error) {
	data, err := c.Query(ctx, "characters.partyConfig", nil)
	if err != nil {
		return nil, err
	}

	bytesData, _ := json.Marshal(data)
	var cfg PartyConfig
	if err := json.Unmarshal(bytesData, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// SetPartyConfig salva a configuração da party
func (c *TRPCClient) SetPartyConfig(ctx context.Context, leader any, disabled []any) error {
	payload := map[string]any{
		"leader":   leader,
		"disabled": disabled,
	}
	_, err := c.Mutate(ctx, "characters.setPartyConfig", payload)
	return err
}
