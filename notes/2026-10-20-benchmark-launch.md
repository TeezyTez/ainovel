# 真实基准启动器：独立构建与运行目录保护

改动范围：`tools/run-deep-benchmark.sh`、`tests/test_benchmark_launch.py`、`tools/benchmark/README.md`。没有改动产品、Go/Rust 合同或旧运行目录。

## 复现与原因

原启动器仅复制全局 `ELSELIFE_TEST_RUST_RUNTIME`，无法确认它由当前登记源码及所需特性构建。普通 Cargo target 中的同名二进制可能被并发 `--no-default-features` 构建替换；用户已有真实运行遇到该产物退出 2。原来的 `mkdir -p` 还允许重用旧输出目录并覆盖 `source-manifest.json`。

新增测试使用真实 Bash、真实文件系统和独立 Python 编译命令替身：旧脚本实际复制了返回 2 的模拟 no-channel runtime，也实际覆盖了已有 manifest。修改前 7 项测试中有 6 项失败；原有 Go 构建前后源变化检测这一项已经有效，不把它冒称为新修复。后来补充的空白外部理由负例也先观察到失败。

## 最终行为

- 最后一级运行目录使用不带 `-p` 的原子 mkdir；即便已有目录为空，也拒绝复用。父目录可以创建，原运行内容不被改写。
- 默认模式 `source` 从当前仓库以 `cargo build --locked --offline --features channel --jobs 2 --bin algorithm-runtime` 构建。每次运行分配新的独立 target，显式 `--target-dir` 覆盖普通 `CARGO_TARGET_DIR`，避免与其他特性构建共享可执行文件。
- Cargo、Go 都在首次源码清单与构建后清单之间执行；两者不一致则退出，保留产物但不执行测试二进制，不调用模型。源码清单生成错误也不会被 `export VAR=$(...)` 掩盖。
- 构建后的 runtime 复制到运行目录固定位置；正式测试只使用该副本。runtime 哈希以 64 KiB 分块计算，不一次读取约 91 MB 的真实二进制。
- 保存 `rust-build.log`、`go-build.log`、cargo/go 版本、前后源码清单、`binaries.sha256`、`runtime-build.json`。后者记录 mode、源码清单哈希、实际 runtime 哈希、构建命令与原产物路径。本地稳定性检查不是外部公证，也不能排除恶意操作者整体改写证据。
- 兼容外部 runtime 需要显式 `ELSELIFE_DEEP_RUNTIME_MODE=external`、`ELSELIFE_TEST_RUST_RUNTIME`、非空白 `ELSELIFE_DEEP_EXTERNAL_RUNTIME_REASON`。仍复制并哈希，但明确记录 `source_correspondence=unverified_external_binary`；不把当前源码清单当成外部二进制的来源证明。
- `ELSELIFE_DEEP_BUILD_JOBS` 可设置正整数；默认 2，避免小内存 WSL 的自动高并发编译。可显式指定 Go/Cargo 可执行文件。

## 验证和取舍

- `python3 -m unittest discover -s tests -p 'test_*.py'`：52 项通过，23.233 秒，退出 0。
- 加入流式 runtime 哈希和默认 jobs=2 后，再执行 `python3 -m unittest discover -s tests -p 'test_benchmark_launch.py'`：8 项通过，2.184 秒；`bash -n tools/run-deep-benchmark.sh` 退出 0。
- 8 项启动器测试覆盖已有目录不变、默认源码产物与哈希绑定、普通 target 不被使用、Rust/Go 编译期源码变化阻止执行、外部理由校验、外部来源诚实标记、编译失败日志保留、基准子进程退出 2 不被管道转成成功。含空白/路径空格控制。

测试中的编译器和 runtime 是明确的替身，只验证启动与证据机制，不测试真实模型、不证明叙事或真实编译质量。真实冷编译与模型执行由主线程另建运行目录完成。

当前独立 target 保留在运行输出目录内，便于审计与隔离；在 Windows 挂载目录上会增加冷编译延迟及磁盘占用。没有为节省这笔成本重新共用普通 feature target。构建时间应单独记录，不计入模型生成延迟。
