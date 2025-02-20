// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export class RefreshTimer {
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

    reset(): void {
        this.#backoffEnd = Date.now() + this.#interval;
    }
}
