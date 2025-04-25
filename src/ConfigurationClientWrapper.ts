// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient } from "@azure/app-configuration";

const MaxBackoffDuration = 10 * 60 * 1000; // 10 minutes in milliseconds
const MinBackoffDuration = 30 * 1000; // 30 seconds in milliseconds
const JITTER_RATIO = 0.25;

export class ConfigurationClientWrapper {
    endpoint: string;
    client: AppConfigurationClient;
    backoffEndTime: number = 0; // Timestamp
    #failedAttempts: number = 0;

    constructor(endpoint: string, client: AppConfigurationClient) {
        this.endpoint = endpoint;
        this.client = client;
    }

    updateBackoffStatus(successfull: boolean) {
        if (successfull) {
            this.#failedAttempts = 0;
            this.backoffEndTime = Date.now();
        } else {
            this.#failedAttempts += 1;
            this.backoffEndTime = Date.now() + calculateBackoffDuration(this.#failedAttempts);
        }
    }
}

export function calculateBackoffDuration(failedAttempts: number) {
    if (failedAttempts <= 1) {
        return MinBackoffDuration;
    }

    // exponential: minBackoff * 2 ^ (failedAttempts - 1)
    // The right shift operator is not used in order to avoid potential overflow. Bitwise operations in JavaScript are limited to 32 bits.
    let calculatedBackoffDuration = MinBackoffDuration * Math.pow(2, failedAttempts - 1);
    if (calculatedBackoffDuration > MaxBackoffDuration) {
        calculatedBackoffDuration = MaxBackoffDuration;
    }

    // jitter: random value between [-1, 1) * jitterRatio * calculatedBackoffMs
    const jitter = JITTER_RATIO * (Math.random() * 2 - 1);

    return calculatedBackoffDuration * (1 + jitter);
}
