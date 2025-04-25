// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const MIN_BACKOFF_DURATION = 30_000; // 30 seconds in milliseconds
const MAX_BACKOFF_DURATION = 10 * 60 * 1000; // 10 minutes in milliseconds
const JITTER_RATIO = 0.25;

export function getFixedBackoffDuration(timeElapsedInMs: number): number | undefined {
    if (timeElapsedInMs < 100_000) {
        return 5_000;
    }
    if (timeElapsedInMs < 200_000) {
        return 10_000;
    }
    if (timeElapsedInMs < 10 * 60 * 1000) {
        return MIN_BACKOFF_DURATION;
    }
    return undefined;
}

export function getExponentialBackoffDuration(failedAttempts: number): number {
    if (failedAttempts <= 1) {
        return MIN_BACKOFF_DURATION;
    }

    // exponential: minBackoff * 2 ^ (failedAttempts - 1)
    // The right shift operator is not used in order to avoid potential overflow. Bitwise operations in JavaScript are limited to 32 bits.
    let calculatedBackoffDuration = MIN_BACKOFF_DURATION * Math.pow(2, failedAttempts - 1);
    if (calculatedBackoffDuration > MAX_BACKOFF_DURATION) {
        calculatedBackoffDuration = MAX_BACKOFF_DURATION;
    }

    // jitter: random value between [-1, 1) * jitterRatio * calculatedBackoffMs
    const jitter = JITTER_RATIO * (Math.random() * 2 - 1);

    return calculatedBackoffDuration * (1 + jitter);
}
