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

const MinimumBackoffInMs = 30 * 1000; // 30s
const MaximumBackoffInMs = 10 * 60 * 1000; // 10min
const MaxSafeExponential = 30; // Used to avoid overflow. bitwise operations in JavaScript are limited to 32 bits. It overflows at 2^31 - 1.
const JitterRatio = 0.25;

export class RefreshTimer {
    private _minBackoff: number = MinimumBackoffInMs;
    private _maxBackoff: number = MaximumBackoffInMs;
    private _failedAttempts: number = 0;
    private _backoffEnd: number; // Timestamp
    constructor(
        private _interval: number
    ) {
        if (this._interval <= 0) {
            throw new Error(`Refresh interval must be greater than 0. Given: ${this._interval}`);
        }

        this._backoffEnd = Date.now() + this._interval;
    }

    public canRefresh(): boolean {
        return Date.now() >= this._backoffEnd;
    }

    public backoff(): void {
        this._failedAttempts += 1;
        this._backoffEnd = Date.now() + this._calculateBackoffTime();
    }

    public reset(): void {
        this._failedAttempts = 0;
        this._backoffEnd = Date.now() + this._interval;
    }

    private _calculateBackoffTime(): number {
        let minBackoffMs: number;
        let maxBackoffMs: number;
        if (this._interval <= this._minBackoff) {
            return this._interval;
        }

        // _minBackoff <= _interval
        if (this._interval <= this._maxBackoff) {
            minBackoffMs = this._minBackoff;
            maxBackoffMs = this._interval;
        } else {
            minBackoffMs = this._minBackoff;
            maxBackoffMs = this._maxBackoff;
        }

        // exponential: minBackoffMs * 2^(failedAttempts-1)
        const exponential = Math.min(this._failedAttempts - 1, MaxSafeExponential);
        let calculatedBackoffMs = minBackoffMs * (1 << exponential);
        if (calculatedBackoffMs > maxBackoffMs) {
            calculatedBackoffMs = maxBackoffMs;
        }

        // jitter: random value between [-1, 1) * jitterRatio * calculatedBackoffMs
        const jitter = JitterRatio * (Math.random() * 2 - 1);

        return calculatedBackoffMs * (1 + jitter);
    }

}
