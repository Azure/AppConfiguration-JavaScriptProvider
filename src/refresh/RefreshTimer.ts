// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

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

    public isDuringBackoff(): boolean {
        return Date.now() < this._backoffEnd;
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
        } else if (this._interval <= this._maxBackoff) {
            minBackoffMs = MinimumBackoffInMs
            maxBackoffMs = this._interval;
        } else {
            // _interval > _maxBackoff
            minBackoffMs = MinimumBackoffInMs;
            maxBackoffMs = MaximumBackoffInMs;
        }

        // exponential
        let calculatedBackoffMs = Math.max(1, minBackoffMs) * (1 << Math.min(this._attempts, MaxAttempts));
        if (calculatedBackoffMs > maxBackoffMs) {
            calculatedBackoffMs = maxBackoffMs;
        }

        // jitter
        const jitter = JitterRatio * (Math.random() * 2 - 1);
        return calculatedBackoffMs * (1 + jitter);
    }

}