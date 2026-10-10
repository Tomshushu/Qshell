//! Windows OS 探测命令构造
//!
//! 输出格式与 Linux 一致，三段以 `---SEP---` 分隔：
//! ```text
//! <release_content，含 ID= / PRETTY_NAME=>
//! ---SEP---
//! <arch>
//! ---SEP---
//! <kernel>
//! ```
//!
//! 使用 `cmd /c "..."` 将整条命令链用双引号包裹传给 cmd.exe，
//! 确保 `&` 由 cmd.exe 解释为"顺序执行分隔符"，
//! 而不会被 bash（Git Bash）误解为"后台运行符"，
//! 也不会被 PowerShell 解释为调用运算符导致语法错误。

/// 返回 Windows OS 探测命令字符串
///
/// 命令：`cmd /c "echo ID=windows& echo PRETTY_NAME=Microsoft Windows& echo ---SEP---& echo %PROCESSOR_ARCHITECTURE%& echo ---SEP---& ver"`
///
/// - `ver` 输出 "Microsoft Windows [Version 10.0.19045.xxx]"，作为 PRETTY_NAME
/// - `%PROCESSOR_ARCHITECTURE%` 输出 AMD64 / x86 / ARM64
pub fn os_detect_command() -> String {
    "cmd /c \"echo ID=windows& echo PRETTY_NAME=Microsoft Windows& echo ---SEP---& echo %PROCESSOR_ARCHITECTURE%& echo ---SEP---& ver\"".to_string()
}
