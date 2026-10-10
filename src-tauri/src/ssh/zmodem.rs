// Zmodem 协议检测与流切换（P0-3）
//
// 实现：
// 1. 在 shell 输出流中扫描 Zmodem 起始序列 `*\x18B`（ZPAD ZDLE ZHEX）
// 2. 检测到后切换 shell 到 passthrough 模式：
//    - 后续字节不再作为终端文本 emit，而是以 base64 形式 emit 到 shell:zmodem-data 事件
//    - 前端用 zmodem.js 解析协议，通过 ssh_shell_zmodem_write 命令回写响应字节
// 3. 前端在传输完成或取消时调用 ssh_shell_zmodem_end，backend 退出 passthrough 模式
//
// Zmodem 协议起始标志参考：
// - ZPAD = 0x2a ('*')
// - ZDLE = 0x18
// - 帧类型：'A'(binary 16) / 'B'(hex 16) / 'C'(binary 32)
// - ZRQINIT（发送方发起）/ ZRINIT（接收方应答）均以 `*\x18B` 开头（hex 帧）

/// Zmodem 起始前缀：`*\x18B` (3 字节)
pub const ZMODEM_PREFIX: &[u8] = &[0x2a, 0x18, 0x42];

/// Zmodem 取消序列：连续 8 个 CAN (0x18)
///
/// 前端用户主动取消传输时，frontend 调用 ssh_shell_zmodem_write 传入此字节序列。
pub const ZMODEM_CANCEL_SEQ: &[u8] = &[0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18];

/// 在 buffer 中查找 Zmodem 起始序列位置。
///
/// 返回 `Some(pos)` 表示在 `pos` 处发现 `*\x18B`，调用方应：
/// 1. 把 `buffer[..pos]` 作为普通终端输出 emit
/// 2. 把 `buffer[pos..]` 作为 Zmodem 数据 emit
/// 3. 切换到 zmodem passthrough 模式
pub fn find_zmodem_start(buffer: &[u8]) -> Option<usize> {
    if buffer.len() < 3 {
        return None;
    }
    buffer
        .windows(3)
        .position(|w| w == ZMODEM_PREFIX)
}

/// 计算跨块检测需要保留的尾部字节数（供 shell.rs 输出循环使用）。
///
/// 起始序列 `*\x18B` 可能被 TCP 分包切在任意字节边界。若本块结尾正好是
/// 起始序列的真前缀（`*` 或 `*\x18`），必须保留到下一块拼接后再判断；
/// 否则前缀会被当普通输出放行，`*\x18B` 永远拼不出来，zmodem 永不触发
/// （rz 会一直停在 "waiting to receive"）。
///
/// - 末 2 字节为 `*\x18` → 保留 2（分包切在 `\x18` 与 `B` 之间）
/// - 末 1 字节为 `*`     → 保留 1（分包切在 `*` 与 `\x18` 之间）
/// - 其他                → 0（立即全部放行，避免扣住正常输出末尾的字符）
pub fn zmodem_prefix_keep_len(tail: &[u8]) -> usize {
    let n = tail.len();
    if n >= 2 && tail[n - 2] == ZMODEM_PREFIX[0] && tail[n - 1] == ZMODEM_PREFIX[1] {
        2
    } else if n >= 1 && tail[n - 1] == ZMODEM_PREFIX[0] {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_zmodem_start() {
        // 普通输出 + Zmodem 起始
        let buf = b"hello\r\n**\x18B00000000000000";
        assert_eq!(find_zmodem_start(buf), Some(8));
    }

    #[test]
    fn no_zmodem_in_normal_output() {
        let buf = b"hello world\r\nsome normal output";
        assert_eq!(find_zmodem_start(buf), None);
    }

    #[test]
    fn detects_at_start() {
        let buf = b"*\x18B01";
        assert_eq!(find_zmodem_start(buf), Some(0));
    }

    #[test]
    fn too_short() {
        assert_eq!(find_zmodem_start(b"**"), None);
        assert_eq!(find_zmodem_start(b""), None);
    }

    #[test]
    fn keep_len_star_tail() {
        // 末字节为 '*'：可能是 `*\x18B` 的第一个字节被切在块尾
        assert_eq!(zmodem_prefix_keep_len(b"hello*"), 1);
        assert_eq!(zmodem_prefix_keep_len(b"*"), 1);
    }

    #[test]
    fn keep_len_star_zdle_tail() {
        // 末 2 字节为 `*\x18`：起始序列被切在 `\x18` 与 `B` 之间（H2 场景）
        assert_eq!(zmodem_prefix_keep_len(b"ab*\x18"), 2);
        assert_eq!(zmodem_prefix_keep_len(b"*\x18"), 2);
    }

    #[test]
    fn keep_len_no_prefix() {
        // 末字节不是前缀的任何真前缀：全部放行
        assert_eq!(zmodem_prefix_keep_len(b"ab\x18"), 0);
        assert_eq!(zmodem_prefix_keep_len(b"hello"), 0);
        assert_eq!(zmodem_prefix_keep_len(b""), 0);
        assert_eq!(zmodem_prefix_keep_len(b"\x18\x18"), 0);
    }

    #[test]
    fn keep_len_star_not_last() {
        // '*' 不在末尾：无需保留
        assert_eq!(zmodem_prefix_keep_len(b"he*llo"), 0);
    }
}
