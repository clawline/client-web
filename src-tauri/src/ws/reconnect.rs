//! Reconnect backoff arithmetic — pure, testable.

use rand::Rng;
use std::time::Duration;

pub const MAX_RECONNECT_ATTEMPTS: u32 = 6;
const BASE_MS: u32 = 1000;
const MAX_MS: u32 = 15_000;
const JITTER_MS: u32 = 250;

/// Compute the delay before the *Nth* reconnect attempt (1-indexed).
/// Returns `None` once the attempt count exceeds the cap.
pub fn delay_for_attempt(attempt: u32) -> Option<Duration> {
    if attempt == 0 || attempt > MAX_RECONNECT_ATTEMPTS {
        return None;
    }
    // 1s, 2s, 4s, 8s, 15s, 15s
    let base = BASE_MS.saturating_mul(1u32 << (attempt - 1));
    let capped = base.min(MAX_MS);
    let jitter = rand::thread_rng().gen_range(0..=JITTER_MS);
    Some(Duration::from_millis((capped + jitter) as u64))
}

/// Same shape as JS `getReconnectInfo` returns.
pub fn delay_ms(attempt: u32) -> u32 {
    if attempt == 0 || attempt > MAX_RECONNECT_ATTEMPTS {
        return 0;
    }
    let base = BASE_MS.saturating_mul(1u32 << (attempt - 1));
    base.min(MAX_MS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_matches_js() {
        // Mirrors clawChannel.ts JS schedule (without jitter).
        assert_eq!(delay_ms(1), 1_000);
        assert_eq!(delay_ms(2), 2_000);
        assert_eq!(delay_ms(3), 4_000);
        assert_eq!(delay_ms(4), 8_000);
        assert_eq!(delay_ms(5), 15_000);
        assert_eq!(delay_ms(6), 15_000);
    }

    #[test]
    fn cap_after_max_attempts() {
        assert!(delay_for_attempt(0).is_none());
        assert!(delay_for_attempt(7).is_none());
        assert!(delay_for_attempt(MAX_RECONNECT_ATTEMPTS).is_some());
    }

    #[test]
    fn jitter_within_bounds() {
        for attempt in 1..=MAX_RECONNECT_ATTEMPTS {
            for _ in 0..50 {
                let d = delay_for_attempt(attempt).unwrap();
                let lower = delay_ms(attempt) as u128;
                let upper = (delay_ms(attempt) + JITTER_MS) as u128;
                assert!(d.as_millis() >= lower && d.as_millis() <= upper);
            }
        }
    }
}
