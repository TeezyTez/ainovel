// Package channel 实现 Backend 与 Algorithm 之间的 gRPC RuntimeChannel 传输适配器（Ticket 18）。
//
// 本包只做协议边界：连接生命周期、双向流收发与 correlation 关联、context 取消、
// 帧校验（协议版本 / 类型方向 / payload 尺寸 / content type）、会话授权与传输错误分类，
// 不拥有业务终态——请求与决策的具体语义由上层 FrameHandler 与后续 Outbox/Inbox（Ticket 19）负责。
//
// 传输 DTO 复用 Ticket 2 生成的 internal/contract/generated/algorithm/v1 Envelope 与
// request/decision 消息，不手写第二套序列化；protoc-gen-go 未生成 _grpc.pb.go，本包按生成
// 代码同构手写服务描述与双向流接口，序列化仍走 protobuf codec。
//
// 安全边界：生产强制 mTLS，明文仅限显式开发开关且缺配置 fail-closed；审计日志只记
// frame/category/conversation ID 与分类原因，禁止记录 payload 字节或 raw peer 错误。
package channel
