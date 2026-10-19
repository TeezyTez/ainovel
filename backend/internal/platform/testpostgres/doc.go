// Package testpostgres 提供临时 PostgreSQL 16 集成测试集群的启动与清理。
//
// 设计边界：
//   - 每次 StartCluster 都在独立临时目录执行 initdb，仅监听该目录下的 Unix socket，
//     不监听任何 TCP 地址，因此绝不触碰 127.0.0.1:15432、:5432 或开发库。
//   - 认证仅限临时 socket 的 trust；供集成测试使用，禁止用于生产。
//   - 停止幂等：正常结束、测试失败或 panic 均可通过 t.Cleanup 或显式 Stop 停库并清理。
package testpostgres
