// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient } from "@azure/app-configuration";

const MaxBackoffDuration = 10 * 60 * 1000; // 10 minutes in milliseconds
const MinBackoffDuration = 30 * 1000; // 30 seconds in milliseconds
const MAX_SAFE_EXPONENTIAL = 30; // Used to avoid overflow. bitwise operations in JavaScript are limited to 32 bits. It overflows at 2^31 - 1.
const JITTER_RATIO = 0.25;

export class ConfigurationClientWrapper {
    endpoint: string;
    client: AppConfigurationClient;
    backoffEndTime: number = 0; // Timestamp
    failedAttempts: number = 0;

    constructor(endpoint: string, client: AppConfigurationClient) {
        this.endpoint = endpoint;
        this.client = client;
    }
}

export function updateClientBackoffStatus(clientWrapper: ConfigurationClientWrapper, successfull: boolean) {
    if (successfull) {
        clientWrapper.failedAttempts = 0;
        clientWrapper.backoffEndTime = Date.now();
    } else {
        clientWrapper.failedAttempts += 1;
        clientWrapper.backoffEndTime = Date.now() + calculateBackoffDuration(clientWrapper.failedAttempts);
    }
}

export function calculateBackoffDuration(failedAttempts: number) {
    if (failedAttempts <= 1) {
        return MinBackoffDuration;
    }

    // exponential: minBackoff * 2^(failedAttempts-1)
    const exponential = Math.min(failedAttempts - 1, MAX_SAFE_EXPONENTIAL);
    let calculatedBackoffDuration = MinBackoffDuration * (1 << exponential);
    if (calculatedBackoffDuration > MaxBackoffDuration) {
        calculatedBackoffDuration = MaxBackoffDuration;
    }

    // jitter: random value between [-1, 1) * jitterRatio * calculatedBackoffMs
    const jitter = JITTER_RATIO * (Math.random() * 2 - 1);

    return calculatedBackoffDuration * (1 + jitter);
}
