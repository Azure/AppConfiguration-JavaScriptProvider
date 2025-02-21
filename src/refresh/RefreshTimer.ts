// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ArgumentError } from "../error.js";

export class RefreshTimer {
    #backoffEnd: number; // Timestamp
    #interval: number;

    constructor(interval: number) {
        if (interval <= 0) {
            throw new ArgumentError(`Refresh interval must be greater than 0. Given: ${this.#interval}`);
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
