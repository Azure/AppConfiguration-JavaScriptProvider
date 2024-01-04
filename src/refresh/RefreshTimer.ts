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
const MaxAttempts = 63;
const JitterRatio = 0.25;

export class RefreshTimer {
    private _minBackoff: number;
    private _maxBackoff: number;
    private _attempts: number;
    private _backoffEnd: number; // Timestamp
    constructor(
        private _interval: number
    ) {
        this._minBackoff = Math.min(this._interval, MinimumBackoffInMs);
        this._maxBackoff = Math.min(this._interval, MaximumBackoffInMs);
        this._attempts = 0;
        this._backoffEnd = Date.now() + this._interval;
    }

    public canRefresh(): boolean {
        return Date.now() >= this._backoffEnd;
    }

    public backoff(): void {
        this._backoffEnd = Date.now() + this._calculateBackoffTime();
        this._attempts += 1;
    }

    public reset(): void {
        this._backoffEnd = Date.now() + this._interval;
        this._attempts = 0;
    }

    private _calculateBackoffTime(): number {
        let minBackoffMs: number;
        let maxBackoffMs: number;
        if (this._interval <= this._minBackoff) {
            return this._interval;
        }

        // _minBackoff <= _interval
        if (this._interval <= this._maxBackoff) {
            minBackoffMs = MinimumBackoffInMs
            maxBackoffMs = this._interval;
        } else {
            minBackoffMs = MinimumBackoffInMs;
            maxBackoffMs = MaximumBackoffInMs;
        }

        // exponential: minBackoffMs * 2^attempts
        let calculatedBackoffMs = Math.max(1, minBackoffMs) * (1 << Math.min(this._attempts, MaxAttempts));
        if (calculatedBackoffMs > maxBackoffMs) {
            calculatedBackoffMs = maxBackoffMs;
        }

        // jitter: random value between [-1, 1) * jitterRatio * calculatedBackoffMs
        const jitter = JitterRatio * (Math.random() * 2 - 1);

        return calculatedBackoffMs * (1 + jitter);
    }

}