// 文件职责：测试传输安全配置——生产 mTLS 强制、显式开发明文、缺配置 fail-closed 与真实 mTLS 握手。
// 主要依赖：crypto 系列、os、testing、google.golang.org/grpc 与本包客户端/服务端适配器。
// 调用边界：生成自签名证书写临时文件；mTLS 握手在 127.0.0.1 临时端口完成，不触碰公网。
// 状态边界：证书与临时文件每用例独立，测试结束自动清理。
// 安全边界：证书为测试合成物，不含真实私钥；fail-closed 断言验证绝无降级或伪造连接。

package channel

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"google.golang.org/grpc"

	algorithmv1 "elselife/backend/internal/contract/generated/algorithm/v1"
)

// certBundle 承载一套测试用 CA/服务端/客户端证书与私钥（PEM 字节）。
type certBundle struct {
	caCert, caKey         []byte
	serverCert, serverKey []byte
	clientCert, clientKey []byte
}

// newCertBundle 生成一套自签名测试证书：CA 签发服务端与客户端证书。
// 服务端证书 SAN 含 localhost 与 127.0.0.1，客户端证书用途为 ClientAuth。
func newCertBundle(t *testing.T) certBundle {
	t.Helper()
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("生成 CA 私钥: %v", err)
	}
	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test-ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("签发 CA: %v", err)
	}
	caCert := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})
	caKeyDER, _ := x509.MarshalECPrivateKey(caKey)
	caKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: caKeyDER})
	ca, _ := x509.ParseCertificate(caDER)

	serverCert, serverKey := issueCert(t, ca, caKey, big.NewInt(2), "localhost",
		[]x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, []string{"localhost"}, []string{"127.0.0.1"})
	clientCert, clientKey := issueCert(t, ca, caKey, big.NewInt(3), "test-client",
		[]x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}, nil, nil)

	return certBundle{
		caCert: caCert, caKey: caKeyPEM,
		serverCert: serverCert, serverKey: serverKey,
		clientCert: clientCert, clientKey: clientKey,
	}
}

// issueCert 用 CA 签发一张证书并返回其 PEM 与私钥 PEM。
// 用途、DNS 与 IP 由调用方指定；私钥为临时生成的 P-256 密钥。
func issueCert(t *testing.T, ca *x509.Certificate, caKey *ecdsa.PrivateKey, serial *big.Int, cn string, usage []x509.ExtKeyUsage, dns, ips []string) (certPEM, keyPEM []byte) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("生成证书私钥: %v", err)
	}
	ipAddrs := make([]net.IP, 0, len(ips))
	for _, s := range ips {
		ipAddrs = append(ipAddrs, net.ParseIP(s))
	}
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: cn},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  usage,
		DNSNames:     dns,
		IPAddresses:  ipAddrs,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca, &key.PublicKey, caKey)
	if err != nil {
		t.Fatalf("签发证书: %v", err)
	}
	keyDER, _ := x509.MarshalECPrivateKey(key)
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
}

// writeTemp 把字节写入 t.TempDir 下的命名文件并返回路径。
func writeTemp(t *testing.T, name string, data []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("写临时文件 %s: %v", name, err)
	}
	return path
}

// TestProductionRefusesIncompleteMTLS 验证生产（非明文）缺任一 mTLS 配置即拒绝（AC3 fail-closed）。
func TestProductionRefusesIncompleteMTLS(t *testing.T) {
	if err := (ClientTransportConfig{}).Validate(); err == nil {
		t.Fatal("客户端空配置（生产）应拒绝")
	}
	if _, err := (ClientTransportConfig{}).DialOption(); err == nil {
		t.Fatal("客户端空配置 DialOption 应失败，不得伪造连接")
	}
	if err := (ClientTransportConfig{
		ClientCertFile: "c", ClientKeyFile: "k", ServerCAFile: "ca",
	}).Validate(); err == nil {
		t.Fatal("缺少 ServerName 的客户端 mTLS 应拒绝")
	}
	if err := (ServerTransportConfig{}).Validate(); err == nil {
		t.Fatal("服务端空配置（生产）应拒绝")
	}
	if _, err := (ServerTransportConfig{CertFile: "c", KeyFile: "k"}).ServerOption(); err == nil {
		t.Fatal("缺少客户端 CA 的服务端 mTLS 应拒绝")
	}
}

// TestPlaintextRequiresExplicitFlag 验证明文只在显式开关时放行。
func TestPlaintextRequiresExplicitFlag(t *testing.T) {
	if err := (ClientTransportConfig{InsecurePlaintext: true}).Validate(); err != nil {
		t.Fatalf("显式明文开关应放行，得到 %v", err)
	}
	if err := (ServerTransportConfig{InsecurePlaintext: true}).Validate(); err != nil {
		t.Fatalf("服务端显式明文开关应放行，得到 %v", err)
	}
}

// TestMTLSRoundTrip 验证生产 mTLS 配置下合法帧在真实 TLS 流上往返（AC1+AC3）。
func TestMTLSRoundTrip(t *testing.T) {
	bundle := newCertBundle(t)
	caFile := writeTemp(t, "ca.pem", bundle.caCert)
	serverCertFile := writeTemp(t, "server.pem", bundle.serverCert)
	serverKeyFile := writeTemp(t, "server.key", bundle.serverKey)
	clientCertFile := writeTemp(t, "client.pem", bundle.clientCert)
	clientKeyFile := writeTemp(t, "client.key", bundle.clientKey)

	serverCfg := ServerTransportConfig{
		CertFile:     serverCertFile,
		KeyFile:      serverKeyFile,
		ClientCAFile: caFile,
	}
	serverOpt, err := serverCfg.ServerOption()
	if err != nil {
		t.Fatalf("服务端 mTLS 选项: %v", err)
	}

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("监听: %v", err)
	}
	srv, err := NewServer(ServerOptions{Handler: echoHandler{}, Authorizer: allowAllAuthorizer{}})
	if err != nil {
		t.Fatalf("构造服务端: %v", err)
	}
	gs := grpc.NewServer(serverOpt)
	srv.Register(gs)
	go func() { _ = gs.Serve(lis) }()
	defer gs.Stop()

	client, err := Dial(context.Background(), ClientOptions{
		Addr: lis.Addr().String(),
		Transport: ClientTransportConfig{
			ClientCertFile: clientCertFile,
			ClientKeyFile:  clientKeyFile,
			ServerCAFile:   caFile,
			ServerName:     "localhost",
		},
	})
	if err != nil {
		t.Fatalf("客户端 mTLS 拨号: %v", err)
	}
	defer client.Close()

	request := validFrame("request.goal", mustMarshal(&algorithmv1.GoalRequest{ConversationId: "cnv_mtls", TurnId: 3}))
	request.FrameId = "frm_mtls_01"
	resp, err := client.Request(context.Background(), request)
	if err != nil {
		t.Fatalf("mTLS 往返失败: %v", err)
	}
	if resp.Type != "decision.goal" {
		t.Fatalf("期望 decision.goal，得到 %q", resp.Type)
	}
	if resp.CorrelationFrameId != request.FrameId {
		t.Fatalf("关联错误: %q", resp.CorrelationFrameId)
	}
}
