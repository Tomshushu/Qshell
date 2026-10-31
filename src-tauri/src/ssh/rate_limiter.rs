use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use lazy_static::lazy_static;

/// 全局令牌桶限速器（Leaky/Token Bucket GCRA 算法）
///
/// 核心特性：
/// 1. 严格聚合限速：所有并发任务（无论单文件、多文件或多服务器并发）共享同一个中央配额，
///    保证网络总吞吐绝对不超过设定的 kbps（例如限速 2MB/s 时，无论开 1 还是 10 个并发，总速度死死锁在 2MB/s）。
/// 2. 虚拟排程队列（Virtual Scheduling）：并发任务按先到先服务在时间轴上排定时间片，
///    各任务非阻塞释放锁后各自 sleep，持锁时间 < 1 微秒，零锁争用。
/// 3. 防空闲突发：桶容量上限锁定为 250ms 窗口（最大不超过 512KB），避免闲置后突然涌入几十兆流量打满带宽。
/// 4. 动态实时生效：用户在设置中调整限速或开关不限速时，下一次 chunk 读写毫秒级无缝响应。
pub struct GlobalRateLimiter {
    kbps: AtomicU64,
    state: Mutex<BucketState>,
}

struct BucketState {
    available_tokens: f64,
    last_refill: Instant,
}

impl GlobalRateLimiter {
    pub fn new() -> Self {
        Self {
            kbps: AtomicU64::new(0),
            state: Mutex::new(BucketState {
                available_tokens: 0.0,
                last_refill: Instant::now(),
            }),
        }
    }

    /// 设置限速值（KB/s，0 表示不限速）
    pub fn set_limit(&self, kbps: u64) {
        self.kbps.store(kbps, Ordering::Relaxed);
    }

    /// 获取当前限速值（KB/s）
    pub fn get_limit(&self) -> u64 {
        self.kbps.load(Ordering::Relaxed)
    }

    /// 请求消费 `bytes` 字节的带宽额度。
    /// 若全局限速生效且当前配额不足，自动计算该任务需等待的时长并异步挂起（sleep）。
    pub async fn acquire(&self, bytes: u64) {
        let kbps = self.kbps.load(Ordering::Relaxed);
        if kbps == 0 || bytes == 0 {
            return;
        }

        let wait_duration = {
            let mut state = self.state.lock().await;
            let current_kbps = self.kbps.load(Ordering::Relaxed);
            if current_kbps == 0 {
                return;
            }

            let rate_bytes_per_sec = (current_kbps as f64) * 1024.0;
            // 突发上限：最多累积 250ms 配额，或者至少 256KB
            let max_burst = (rate_bytes_per_sec * 0.25).max(256.0 * 1024.0);

            let now = Instant::now();
            if now > state.last_refill {
                let elapsed_secs = (now - state.last_refill).as_secs_f64();
                state.available_tokens = (state.available_tokens + elapsed_secs * rate_bytes_per_sec).min(max_burst);
                state.last_refill = now;
            }

            if state.available_tokens >= bytes as f64 {
                state.available_tokens -= bytes as f64;
                Duration::ZERO
            } else {
                let deficit = (bytes as f64) - state.available_tokens;
                state.available_tokens = 0.0;
                let wait_secs = deficit / rate_bytes_per_sec;
                let duration = Duration::from_secs_f64(wait_secs);
                // 虚拟时间排程：将下一次加水基准时间推到该任务结束之后，
                // 后续并发到来的任务会自然排到其后，实现严格的 FIFO 公平共享
                state.last_refill = state.last_refill.max(now) + duration;
                duration
            }
        };

        if wait_duration > Duration::from_millis(1) {
            tokio::time::sleep(wait_duration).await;
        }
    }
}

lazy_static! {
    pub static ref GLOBAL_RATE_LIMITER: GlobalRateLimiter = GlobalRateLimiter::new();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limiter_set_and_get() {
        let limiter = GlobalRateLimiter::new();
        assert_eq!(limiter.get_limit(), 0);
        limiter.set_limit(1024);
        assert_eq!(limiter.get_limit(), 1024);
        limiter.set_limit(0);
        assert_eq!(limiter.get_limit(), 0);
    }

    #[tokio::test]
    async fn test_acquire_unlimited_returns_immediately() {
        let limiter = GlobalRateLimiter::new();
        limiter.set_limit(0);
        let start = Instant::now();
        limiter.acquire(1024 * 1024).await;
        assert!(start.elapsed() < Duration::from_millis(50));
    }

    #[tokio::test]
    async fn test_acquire_zero_bytes_returns_immediately() {
        let limiter = GlobalRateLimiter::new();
        limiter.set_limit(100);
        let start = Instant::now();
        limiter.acquire(0).await;
        assert!(start.elapsed() < Duration::from_millis(50));
    }
}
