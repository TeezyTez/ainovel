// 文件职责：单测 Validator 的帧校验——协议版本/类型方向/payload 尺寸/content type/frame_id。
// 主要依赖：标准库 testing 与生成 DTO algorithmv1.Envelope。
// 调用边界：纯单元测试，不启动 gRPC、不触碰网络或数据库。
// 状态边界：只构造 Envelope 值，无副作用。
// 安全边界：测试数据为本地合成帧，不含真实凭据或用户正文。

package channel

import (
	"testing"

	algorithmv1 "elselife/backend/internal/contract/generated/algorithm/v1"
)

// validFrame 构造一帧满足全部 V0.1 校验要求的合法帧，供各用例复用。
// type 与 payload 由调用方指定，其余字段填默认合法值。
func validFrame(typ string, payload []byte) *algorithmv1.Envelope {
	return &algorithmv1.Envelope{
		ProtocolVersion: ProtocolVersion,
		FrameId:         "frm_0001",
		ConversationId:  "cnv_0001",
		Type:            typ,
		ContentType:     ContentTypeProtobuf,
		Payload:         payload,
	}
}

// TestValidateAcceptsValidFrames 验证 V0.1 全部类型在正确方向上通过校验。
func TestValidateAcceptsValidFrames(t *testing.T) {
	v := Validator{}
	cases := []struct {
		typ       string
		direction Direction
	}{
		{"request.route", DirectionBackendToAlgorithm},
		{"request.summary", DirectionBackendToAlgorithm},
		{"request.goal", DirectionBackendToAlgorithm},
		{"request.taskgraph", DirectionBackendToAlgorithm},
		{"request.verify", DirectionBackendToAlgorithm},
		{"request.model", DirectionAlgorithmToBackend},
		{"result.model", DirectionBackendToAlgorithm},
		{"request.context_read", DirectionAlgorithmToBackend},
		{"result.context_read", DirectionBackendToAlgorithm},
		{"event.execution", DirectionBackendToAlgorithm},
		{"decision.route", DirectionAlgorithmToBackend},
		{"decision.summary", DirectionAlgorithmToBackend},
		{"decision.goal", DirectionAlgorithmToBackend},
		{"decision.taskgraph", DirectionAlgorithmToBackend},
		{"decision.verification", DirectionAlgorithmToBackend},
	}
	for _, c := range cases {
		if err := v.Validate(validFrame(c.typ, []byte("x")), c.direction); err != nil {
			t.Errorf("%s 方向 %v 应通过校验，得到 %v", c.typ, c.direction, err)
		}
	}
}

// TestValidateRejectsUnknownType 验证未知类型被拒绝且分类为 unknown_type。
func TestValidateRejectsUnknownType(t *testing.T) {
	v := Validator{}
	err := v.Validate(validFrame("request.unknown", nil), DirectionBackendToAlgorithm)
	if !isReason(err, ReasonUnknownType) {
		t.Fatalf("未知类型应归 unknown_type，得到 %v", err)
	}
}

// TestValidateRejectsWrongDirection 验证类型与流向不符时被拒绝且分类为 wrong_direction。
func TestValidateRejectsWrongDirection(t *testing.T) {
	v := Validator{}
	err := v.Validate(validFrame("request.route", nil), DirectionAlgorithmToBackend)
	if !isReason(err, ReasonWrongDirection) {
		t.Fatalf("方向错误应归 wrong_direction，得到 %v", err)
	}
}

// TestValidateRejectsOversizedPayload 验证超过上限的 payload 被拒绝。
func TestValidateRejectsOversizedPayload(t *testing.T) {
	v := Validator{MaxPayloadBytes: 4}
	err := v.Validate(validFrame("request.route", []byte("12345")), DirectionBackendToAlgorithm)
	if !isReason(err, ReasonPayloadTooLarge) {
		t.Fatalf("超尺寸应归 payload_too_large，得到 %v", err)
	}
}

// TestValidateRejectsVersionMismatch 验证协议版本不一致被拒绝。
func TestValidateRejectsVersionMismatch(t *testing.T) {
	v := Validator{}
	frame := validFrame("request.route", nil)
	frame.ProtocolVersion = "v9.9"
	err := v.Validate(frame, DirectionBackendToAlgorithm)
	if !isReason(err, ReasonVersionMismatch) {
		t.Fatalf("版本不一致应归 version_mismatch，得到 %v", err)
	}
}

// TestValidateRejectsInvalidContentType 验证非 protobuf 内容类型被拒绝。
func TestValidateRejectsInvalidContentType(t *testing.T) {
	v := Validator{}
	frame := validFrame("request.route", nil)
	frame.ContentType = "application/json"
	err := v.Validate(frame, DirectionBackendToAlgorithm)
	if !isReason(err, ReasonInvalidContentType) {
		t.Fatalf("非法内容类型应归 invalid_content_type，得到 %v", err)
	}
}

// TestValidateRejectsMissingFrameID 验证缺失 frame_id 被拒绝。
func TestValidateRejectsMissingFrameID(t *testing.T) {
	v := Validator{}
	frame := validFrame("request.route", nil)
	frame.FrameId = ""
	err := v.Validate(frame, DirectionBackendToAlgorithm)
	if !isReason(err, ReasonInvalidFrameID) {
		t.Fatalf("缺失 frame_id 应归 invalid_frame_id，得到 %v", err)
	}
}

// TestValidateRejectsNilFrame 验证 nil 帧被拒绝。
func TestValidateRejectsNilFrame(t *testing.T) {
	v := Validator{}
	if err := v.Validate(nil, DirectionBackendToAlgorithm); err == nil {
		t.Fatal("nil 帧应被拒绝")
	}
}

// isReason 判断错误是否归类为给定拒绝原因；非 *FrameError 或分类不符返回 false。
func isReason(err error, reason Reason) bool {
	fe, ok := err.(*FrameError)
	return ok && fe.Reason == reason
}
