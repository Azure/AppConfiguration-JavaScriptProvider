// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export class RefreshTimer {
    #backoffEnd: number; // Timestamp
    #interval: number;

    constructor(interval: number) {
        if (interval <= 0) {
            throw new RangeError(`Refresh interval must be greater than 0. Given: ${interval}`);
        }

        this.#interval = interval;
        this.#backoffEnd = Date.now() + this.#interval;
    }

    canRefresh(): boolean {
        return Date.now() >= this.#backoffEnd;
    }

    reset(): void {
        this.#backoffEnd = Date.now() + this.#interval;
    }
}
