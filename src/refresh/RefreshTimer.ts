// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The backoff time is between the minimum and maximum backoff time, based on the number of attempts.
 * An exponential backoff strategy is used, with a jitter factor to prevent clients from retrying at the same time.
 *
 * The backoff time is calculated as follows:
 *  - `basic backoff time` = `MinimumBackoffInMs` * 2 ^ `attempts`, and it is no larger than the `MaximumBackoffInMs`.
 *  - based on jitter ratio, the jittered time is between [-1, 1) * `JitterRatio` * basic backoff time.
 *  - the final backoff time is the basic backoff time plus the jittered time.
 *
 * Note: the backoff time usually is no larger than the refresh interval, which is specified by the user.
 *  - If the interval is less than the minimum backoff, the interval is used.
 *  - If the interval is between the minimum and maximum backoff, the interval is used as the maximum backoff.
 *  - Because of the jitter, the maximum backoff time is actually `MaximumBackoffInMs` * (1 + `JitterRatio`).
 */

const MIN_BACKOFF_IN_MS = 30 * 1000; // 30s
const MAX_BACKOFF_IN_MS = 10 * 60 * 1000; // 10min
const MAX_SAFE_EXPONENTIAL = 30; // Used to avoid overflow. bitwise operations in JavaScript are limited to 32 bits. It overflows at 2^31 - 1.
const JITTER_RATIO = 0.25;

export class RefreshTimer {
    #minBackoff: number = MIN_BACKOFF_IN_MS;
    #maxBackoff: number = MAX_BACKOFF_IN_MS;
    #failedAttempts: number = 0;
    #backoffEnd: number; // Timestamp
    #interval: number;

    constructor(
        interval: number
    ) {
        if (interval <= 0) {
            throw new Error(`Refresh interval must be greater than 0. Given: ${this.#interval}`);
        }

        this.#interval = interval;
        this.#backoffEnd = Date.now() + this.#interval;
    }

    canRefresh(): boolean {
        return Date.now() >= this.#backoffEnd;
    }

    backoff(): void {
        this.#failedAttempts += 1;
        this.#backoffEnd = Date.now() + this.#calculateBackoffTime();
    }

    reset(): void {
        this.#failedAttempts = 0;
        this.#backoffEnd = Date.now() + this.#interval;
    }

    #calculateBackoffTime(): number {
        let minBackoffMs: number;
        let maxBackoffMs: number;
        if (this.#interval <= this.#minBackoff) {
            return this.#interval;
        }

        // _minBackoff <= _interval
        if (this.#interval <= this.#maxBackoff) {
            minBackoffMs = this.#minBackoff;
            maxBackoffMs = this.#interval;
        } else {
            minBackoffMs = this.#minBackoff;
            maxBackoffMs = this.#maxBackoff;
        }

        // exponential: minBackoffMs * 2^(failedAttempts-1)
        const exponential = Math.min(this.#failedAttempts - 1, MAX_SAFE_EXPONENTIAL);
        let calculatedBackoffMs = minBackoffMs * (1 << exponential);
        if (calculatedBackoffMs > maxBackoffMs) {
            calculatedBackoffMs = maxBackoffMs;
        }

        // jitter: random value between [-1, 1) * jitterRatio * calculatedBackoffMs
        const jitter = JITTER_RATIO * (Math.random() * 2 - 1);

        return calculatedBackoffMs * (1 + jitter);
    }

}
