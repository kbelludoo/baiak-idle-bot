package network

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"
)

type HTTPClient struct {
	client  *http.Client
	baseURL string
	headers http.Header
}

func NewHTTPClient(baseURL string, timeout time.Duration, bindIP string) *HTTPClient {
	transport := &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 20,
		IdleConnTimeout:     90 * time.Second,
	}

	if bindIP != "" {
		localTCPAddr, err := net.ResolveTCPAddr("tcp", bindIP+":0")
		if err == nil {
			transport.DialContext = (&net.Dialer{
				Timeout:   timeout,
				KeepAlive: 30 * time.Second,
				LocalAddr: localTCPAddr,
			}).DialContext
		}
	}

	client := &http.Client{
		Transport: transport,
		Timeout:   timeout,
	}

	headers := make(http.Header)
	headers.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
	headers.Set("Accept", "application/json, text/plain, */*")
	headers.Set("Accept-Language", "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7")

	return &HTTPClient{
		client:  client,
		baseURL: baseURL,
		headers: headers,
	}
}

func (h *HTTPClient) SetHeader(key, val string) {
	h.headers.Set(key, val)
}

func (h *HTTPClient) Client() *http.Client {
	return h.client
}

func (h *HTTPClient) PostJSON(ctx context.Context, path string, reqBody any, respTarget any) error {
	var bodyReader io.Reader
	if reqBody != nil {
		data, err := json.Marshal(reqBody)
		if err != nil {
			return fmt.Errorf("marshal request error: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	url := h.baseURL + path
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bodyReader)
	if err != nil {
		return fmt.Errorf("create request error: %w", err)
	}

	for k, vv := range h.headers {
		for _, v := range vv {
			req.Header.Add(k, v)
		}
	}
	if reqBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return fmt.Errorf("http request failed: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response body error: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("http error %d: %s", resp.StatusCode, string(bodyBytes))
	}

	if respTarget != nil {
		if err := json.Unmarshal(bodyBytes, respTarget); err != nil {
			return fmt.Errorf("unmarshal response error (%s): %w", string(bodyBytes), err)
		}
	}

	return nil
}

func (h *HTTPClient) GetJSON(ctx context.Context, path string, respTarget any) error {
	url := h.baseURL + path
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("create request error: %w", err)
	}

	for k, vv := range h.headers {
		for _, v := range vv {
			req.Header.Add(k, v)
		}
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return fmt.Errorf("http request failed: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response body error: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("http error %d: %s", resp.StatusCode, string(bodyBytes))
	}

	if respTarget != nil {
		if err := json.Unmarshal(bodyBytes, respTarget); err != nil {
			return fmt.Errorf("unmarshal response error (%s): %w", string(bodyBytes), err)
		}
	}

	return nil
}
