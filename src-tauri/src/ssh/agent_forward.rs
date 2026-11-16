//! SSH Agent Forwarding (`auth-agent@openssh.com`) 通道桥接与策略控制。
//!
//! 当服务器配置开启 `forward_agent == true` 且在 shell 通道上请求了 `agent_forward(true)` 后，
//! 远端 `sshd` 会通过 `SSH_MSG_CHANNEL_OPEN "auth-agent@openssh.com"` 回调客户端。
//! 本模块负责：
//! 1. 按 `forward_agent` 开关严格策略门控（默认关闭，拒绝未授权的主动探测）；
//! 2. 将远端 agent 转发通道双向桥接到本地 SSH Agent（Unix `$SSH_AUTH_SOCK` 或 Windows 命名管道）。

use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

/// 策略判定：仅当当前连接明确启用了 `forward_agent` 时才允许接收远端 Agent 转发通道。
pub fn should_accept_agent_forward_channel(forward_agent_enabled: bool) -> bool {
    forward_agent_enabled
}

trait AgentByteStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> AgentByteStream for T {}

struct DynAgentStream(Pin<Box<dyn AgentByteStream>>);

impl AsyncRead for DynAgentStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        self.0.as_mut().poll_read(cx, buf)
    }
}

impl AsyncWrite for DynAgentStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        self.0.as_mut().poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        self.0.as_mut().poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        self.0.as_mut().poll_shutdown(cx)
    }
}

async fn open_local_agent_stream() -> Result<DynAgentStream, String> {
    #[cfg(unix)]
    {
        let sock = std::env::var("SSH_AUTH_SOCK")
            .map_err(|_| "未设置 SSH_AUTH_SOCK 环境变量，无法连接本地 SSH Agent".to_string())?;
        let stream = tokio::net::UnixStream::connect(&sock)
            .await
            .map_err(|e| format!("连接 SSH_AUTH_SOCK ({}) 失败: {}", sock, e))?;
        return Ok(DynAgentStream(Box::pin(stream)));
    }

    #[cfg(windows)]
    {
        let mut last_err = None;
        for pipe_name in [r"\\.\pipe\openssh-ssh-agent", r"\\.\pipe\pageant"] {
            for attempt in 0..5 {
                match tokio::net::windows::named_pipe::ClientOptions::new().open(pipe_name) {
                    Ok(pipe) => return Ok(DynAgentStream(Box::pin(pipe))),
                    Err(e) => {
                        // Windows ERROR_PIPE_BUSY (231): agent 实例瞬时繁忙时短暂退避重试
                        if e.raw_os_error() == Some(231) && attempt < 4 {
                            last_err = Some(e);
                            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
                            continue;
                        }
                        last_err = Some(e);
                        break;
                    }
                }
            }
        }
        return Err(format!(
            "无法连接本地 Windows OpenSSH Agent / Pageant 管道: {}",
            last_err
                .map(|e| e.to_string())
                .unwrap_or_else(|| "unknown error".to_string())
        ));
    }

    #[cfg(not(any(unix, windows)))]
    {
        Err("当前平台不支持 SSH Agent 转发".to_string())
    }
}

async fn copy_bidirectional_logged<A, B>(
    a: &mut A,
    b: &mut B,
    server_id: &str,
) -> std::io::Result<(u64, u64)>
where
    A: AsyncRead + AsyncWrite + Unpin + ?Sized,
    B: AsyncRead + AsyncWrite + Unpin + ?Sized,
{
    use tokio::io::AsyncWriteExt;

    let (mut a_read, mut a_write) = tokio::io::split(a);
    let (mut b_read, mut b_write) = tokio::io::split(b);

    let mut a_to_b = Box::pin(async {
        let copied = tokio::io::copy(&mut a_read, &mut b_write).await;
        let _ = b_write.shutdown().await;
        copied
    });
    let mut b_to_a = Box::pin(async {
        let copied = tokio::io::copy(&mut b_read, &mut a_write).await;
        let _ = a_write.shutdown().await;
        copied
    });

    // Windows 命名管道 `NamedPipeClient::poll_shutdown` 为空实现，服务端保持长连接时不主动 EOF。
    // 当 SSH 通道侧 (`a_to_b`) 先收到远端 CHANNEL_EOF 时，保留短暂排空窗口让 Agent 回包写完即退出，避免任务泄漏。
    let res = tokio::select! {
        r1 = &mut a_to_b => {
            let to_local = r1?;
            let to_remote = match tokio::time::timeout(std::time::Duration::from_millis(250), &mut b_to_a).await {
                Ok(Ok(n)) => n,
                Ok(Err(e)) => return Err(e),
                Err(_) => {
                    let _ = b_to_a.as_mut();
                    0
                }
            };
            Ok((to_local, to_remote))
        }
        r2 = &mut b_to_a => {
            let to_remote = r2?;
            let to_local = match tokio::time::timeout(std::time::Duration::from_millis(250), &mut a_to_b).await {
                Ok(Ok(n)) => n,
                Ok(Err(e)) => return Err(e),
                Err(_) => 0,
            };
            Ok((to_local, to_remote))
        }
    };

    match &res {
        Ok((to_local, to_remote)) => {
            tracing::debug!(
                "[AgentForward] {} 转发通道结束: remote->agent={}B, agent->remote={}B",
                server_id,
                to_local,
                to_remote
            );
        }
        Err(e) => {
            tracing::debug!("[AgentForward] {} 转发通道 I/O 结束: {}", server_id, e);
        }
    }
    res
}

/// 将远端 `auth-agent@openssh.com` 通道与本地 Agent socket/named-pipe 双向桥接。
pub async fn bridge_agent_channel(
    channel: russh::Channel<russh::client::Msg>,
    server_id: &str,
) {
    let mut agent_stream = match open_local_agent_stream().await {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("[AgentForward] {} 打开本地 SSH Agent 失败: {}", server_id, e);
            let _ = channel.eof().await;
            let _ = channel.close().await;
            return;
        }
    };

    let mut ch_stream = channel.into_stream();
    let _ = copy_bidirectional_logged(&mut ch_stream, &mut agent_stream, server_id).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn test_agent_forward_policy_denies_when_disabled() {
        assert!(!should_accept_agent_forward_channel(false));
    }

    #[test]
    fn test_agent_forward_policy_allows_when_enabled() {
        assert!(should_accept_agent_forward_channel(true));
    }

    #[tokio::test]
    async fn test_copy_bidirectional_logged_relays_both_directions() {
        let (mut remote_peer, mut remote_ch) = tokio::io::duplex(256);
        let (mut local_ch, mut local_agent) = tokio::io::duplex(256);

        let relay = tokio::spawn(async move {
            copy_bidirectional_logged(&mut remote_ch, &mut local_ch, "test-server").await
        });

        remote_peer.write_all(b"\x00\x00\x00\x01\x0b").await.unwrap();
        remote_peer.shutdown().await.unwrap();

        let mut req_buf = [0u8; 5];
        local_agent.read_exact(&mut req_buf).await.unwrap();
        assert_eq!(&req_buf, b"\x00\x00\x00\x01\x0b");

        local_agent.write_all(b"\x00\x00\x00\x01\x0c").await.unwrap();
        local_agent.shutdown().await.unwrap();

        let mut resp_buf = [0u8; 5];
        remote_peer.read_exact(&mut resp_buf).await.unwrap();
        assert_eq!(&resp_buf, b"\x00\x00\x00\x01\x0c");

        let counts = relay.await.unwrap().unwrap();
        assert_eq!(counts, (5, 5));
    }

    #[tokio::test]
    async fn test_copy_bidirectional_logged_does_not_hang_when_agent_keeps_pipe_open() {
        let (mut remote_peer, mut remote_ch) = tokio::io::duplex(256);
        let (mut local_ch, mut local_agent) = tokio::io::duplex(256);

        let relay = tokio::spawn(async move {
            copy_bidirectional_logged(&mut remote_ch, &mut local_ch, "test-server").await
        });

        remote_peer.write_all(b"\x00\x00\x00\x01\x0b").await.unwrap();
        let mut req_buf = [0u8; 5];
        local_agent.read_exact(&mut req_buf).await.unwrap();

        // 模拟 Windows OpenSSH Agent：写出响应后不关闭管道（不发 EOF），由 SSH 客户端关闭通道
        local_agent.write_all(b"\x00\x00\x00\x01\x0c").await.unwrap();
        let mut resp_buf = [0u8; 5];
        remote_peer.read_exact(&mut resp_buf).await.unwrap();
        assert_eq!(&resp_buf, b"\x00\x00\x00\x01\x0c");

        remote_peer.shutdown().await.unwrap();

        let finished = tokio::time::timeout(std::time::Duration::from_secs(2), relay)
            .await
            .expect("relay should finish instead of hanging when pipe stays open")
            .unwrap();
        assert!(finished.is_ok());
    }
}
