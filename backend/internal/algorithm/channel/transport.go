// 文件职责：Algorithm 通道的传输安全配置——生产 mTLS 与显式开发明文，缺配置 fail-closed。
// 主要依赖：crypto/tls、crypto/x509、os 与 google.golang.org/grpc（credentials/insecure）。
// 调用边界：由装配层构建 grpc.ServerOption / grpc.DialOption；只读证书文件，不改状态。
// 状态边界：配置是纯值，Validate 只做完整性判定，不建立连接。
// 安全边界：生产（非明文）要求 mTLS 全套证书文件，缺任一即返回错误，绝不降级为明文或伪造连接。

package channel

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

// ClientTransportConfig 是后端作为客户端连接 Algorithm 时的传输安全配置。
// 地址属于拨号关注点（ClientOptions.Addr），本结构只承载 TLS 凭据与明文开关。
type ClientTransportConfig struct {
	InsecurePlaintext bool   // 显式开发明文开关；生产必须保持 false
	ClientCertFile    string // 客户端证书（PEM）
	ClientKeyFile     string // 客户端私钥（PEM）
	ServerCAFile      string // 服务端 CA（PEM，校验服务端证书）
	ServerName        string // 服务端证书 SAN / 主机名
}

// ServerTransportConfig 是后端作为服务端（如合同 Fake Algorithm）接受连接时的传输配置。
type ServerTransportConfig struct {
	InsecurePlaintext bool   // 显式开发明文开关；生产必须保持 false
	CertFile          string // 服务端证书（PEM）
	KeyFile           string // 服务端私钥（PEM）
	ClientCAFile      string // 客户端 CA（PEM，校验客户端证书，实现 mTLS）
}

// Validate 校验客户端传输配置完整性。
//
// 非明文（生产）模式要求客户端证书/私钥、服务端 CA 与 ServerName 全部非空，
// 缺任一即返回错误（fail-closed）；明文模式仅经显式开关进入。
func (c ClientTransportConfig) Validate() error {
	if c.InsecurePlaintext {
		return nil
	}
	switch {
	case c.ClientCertFile == "":
		return fmt.Errorf("生产 mTLS 缺少客户端证书文件")
	case c.ClientKeyFile == "":
		return fmt.Errorf("生产 mTLS 缺少客户端私钥文件")
	case c.ServerCAFile == "":
		return fmt.Errorf("生产 mTLS 缺少服务端 CA 文件")
	case c.ServerName == "":
		return fmt.Errorf("生产 mTLS 缺少服务端主机名")
	}
	return nil
}

// Validate 校验服务端传输配置完整性：生产模式要求证书/私钥/客户端 CA 全部非空。
func (s ServerTransportConfig) Validate() error {
	if s.InsecurePlaintext {
		return nil
	}
	switch {
	case s.CertFile == "":
		return fmt.Errorf("生产 mTLS 缺少服务端证书文件")
	case s.KeyFile == "":
		return fmt.Errorf("生产 mTLS 缺少服务端私钥文件")
	case s.ClientCAFile == "":
		return fmt.Errorf("生产 mTLS 缺少客户端 CA 文件")
	}
	return nil
}

// DialOption 构建客户端拨号凭据：明文返回 insecure，生产返回 mTLS credentials。
//
// 先做 Validate；生产模式读取并解析客户端证书与 CA，任一步失败即返回错误，
// 绝不降级为明文或伪造 TLS 配置。
func (c ClientTransportConfig) DialOption() (grpc.DialOption, error) {
	if err := c.Validate(); err != nil {
		return nil, err
	}
	if c.InsecurePlaintext {
		return grpc.WithTransportCredentials(insecure.NewCredentials()), nil
	}
	clientCert, err := tls.LoadX509KeyPair(c.ClientCertFile, c.ClientKeyFile)
	if err != nil {
		return nil, fmt.Errorf("加载客户端证书: %w", err)
	}
	caPEM, err := os.ReadFile(c.ServerCAFile)
	if err != nil {
		return nil, fmt.Errorf("读取服务端 CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("解析服务端 CA 失败")
	}
	tlsCfg := &tls.Config{
		Certificates: []tls.Certificate{clientCert},
		RootCAs:      pool,
		ServerName:   c.ServerName,
		MinVersion:   tls.VersionTLS12,
	}
	return grpc.WithTransportCredentials(credentials.NewTLS(tlsCfg)), nil
}

// ServerOption 构建服务端 TLS 凭据：明文返回 insecure，生产返回要求客户端证书的 mTLS credentials。
//
// 先做 Validate；生产模式读取服务端证书与客户端 CA，ClientAuth 设为 RequireAndVerifyClientCert，
// 任一步失败即返回错误，绝不接受未验证的对端。
func (s ServerTransportConfig) ServerOption() (grpc.ServerOption, error) {
	if err := s.Validate(); err != nil {
		return nil, err
	}
	if s.InsecurePlaintext {
		return grpc.Creds(insecure.NewCredentials()), nil
	}
	serverCert, err := tls.LoadX509KeyPair(s.CertFile, s.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("加载服务端证书: %w", err)
	}
	caPEM, err := os.ReadFile(s.ClientCAFile)
	if err != nil {
		return nil, fmt.Errorf("读取客户端 CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("解析客户端 CA 失败")
	}
	tlsCfg := &tls.Config{
		Certificates: []tls.Certificate{serverCert},
		ClientCAs:    pool,
		ClientAuth:   tls.RequireAndVerifyClientCert,
		MinVersion:   tls.VersionTLS12,
	}
	return grpc.Creds(credentials.NewTLS(tlsCfg)), nil
}
