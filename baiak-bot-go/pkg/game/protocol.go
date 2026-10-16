package game

import (
	"bytes"
	"fmt"
	"io"

	"github.com/vmihailenco/msgpack/v5"
)

const (
	OpHandshake      byte = 9
	OpJoinRoom       byte = 10
	OpError          byte = 11
	OpLeaveRoom      byte = 12
	OpRoomData       byte = 13
	OpRoomState      byte = 14
	OpRoomStatePatch byte = 15
	OpRoomDataSchema byte = 16
	OpPing           byte = 18
	OpPong           byte = 19
)

var OpcodeNames = map[byte]string{
	OpHandshake:      "HANDSHAKE",
	OpJoinRoom:       "JOIN_ROOM",
	OpError:          "ERROR",
	OpLeaveRoom:      "LEAVE_ROOM",
	OpRoomData:       "ROOM_DATA",
	OpRoomState:      "ROOM_STATE",
	OpRoomStatePatch: "ROOM_STATE_PATCH",
	OpRoomDataSchema: "ROOM_DATA_SCHEMA",
	OpPing:           "PING",
	OpPong:           "PONG",
}

// EncodeRoomData serializa [type, payload] em MsgPack com prefixo 0x0D (padrão Colyseus 0.16)
func EncodeRoomData(msgType string, payload any) ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteByte(OpRoomData)
	enc := msgpack.NewEncoder(&buf)
	if err := enc.Encode(msgType); err != nil {
		return nil, fmt.Errorf("falha ao codificar tipo msgpack: %w", err)
	}
	if payload == nil {
		payload = map[string]any{}
	}
	if err := enc.Encode(payload); err != nil {
		return nil, fmt.Errorf("falha ao codificar payload msgpack: %w", err)
	}
	return buf.Bytes(), nil
}

// readRawString lê [len:uint8][bytes UTF-8] conforme o @colyseus/binary no handshake JOIN_ROOM
func readRawString(r io.Reader) (string, error) {
	var lenBuf [1]byte
	if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
		return "", err
	}
	length := int(lenBuf[0])
	if length == 0 {
		return "", nil
	}
	strBuf := make([]byte, length)
	if _, err := io.ReadFull(r, strBuf); err != nil {
		return "", err
	}
	return string(strBuf), nil
}

// DecodeFrame decodifica o pacote recebido via WebSocket
func DecodeFrame(raw []byte) (*DecodedFrame, error) {
	if len(raw) == 0 {
		return nil, nil
	}

	opcode := raw[0]
	frameName := OpcodeNames[opcode]
	if frameName == "" {
		frameName = fmt.Sprintf("UNKNOWN_0x%02X", opcode)
	}

	frame := &DecodedFrame{
		Opcode: opcode,
		Frame:  frameName,
	}

	switch opcode {
	case OpJoinRoom:
		r := bytes.NewReader(raw[1:])
		reconToken, _ := readRawString(r)
		serializer, _ := readRawString(r)
		frame.Payload = map[string]string{
			"reconnectionToken": reconToken,
			"serializerId":      serializer,
		}

	case OpError:
		r := bytes.NewReader(raw[1:])
		dec := msgpack.NewDecoder(r)
		var code int
		var msg string
		_ = dec.Decode(&code)
		_ = dec.Decode(&msg)
		frame.Payload = map[string]any{
			"code":    code,
			"message": msg,
		}

	case OpRoomData:
		r := bytes.NewReader(raw[1:])
		dec := msgpack.NewDecoder(r)
		var msgType string
		if err := dec.Decode(&msgType); err == nil {
			frame.Type = msgType
			var payload any
			if err := dec.Decode(&payload); err == nil {
				frame.Payload = payload
			}
		}

	case OpRoomState, OpRoomStatePatch, OpRoomDataSchema:
		// Estado binário de schema
		frame.Payload = len(raw)
	}

	return frame, nil
}
