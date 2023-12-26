// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const DefaultMinimumBackoffInMs = 30 * 1000; // 30s
const DefaultMaximumBackoffInMs = 10 * 60 * 1000; // 10min

export class RefreshTimer {
    private _minBackoff: number;
    private _maxBackoff: number;
    private _attempts: number;
    private _nextRefreshTime: number;
    constructor(
        private _interval: number
    ) {
        this._minBackoff = Math.min(this._interval, DefaultMinimumBackoffInMs);
        this._maxBackoff = Math.min(this._interval, DefaultMaximumBackoffInMs);
        this._attempts = 0;
        this._nextRefreshTime = Date.now() + this._interval;
    }

    // TODO: add apis.

}