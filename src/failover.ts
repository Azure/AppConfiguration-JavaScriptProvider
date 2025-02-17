// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const MIN_BACKOFF_DURATION = 30_000; // 30 seconds in milliseconds
const MAX_BACKOFF_DURATION = 10 * 60 * 1000; // 10 minutes in milliseconds
const MAX_SAFE_EXPONENTIAL = 30; // Used to avoid overflow. bitwise operations in JavaScript are limited to 32 bits. It overflows at 2^31 - 1.
const JITTER_RATIO = 0.25;

// Reference: https://github.com/Azure/AppConfiguration-DotnetProvider/blob/main/src/Microsoft.Extensions.Configuration.AzureAppConfiguration/Extensions/TimeSpanExtensions.cs#L14
export function getFixedBackoffDuration(timeElapsed: number): number | undefined {
    if (timeElapsed <= 100_000) { // 100 seconds in milliseconds
        return 5_000; // 5 seconds in milliseconds
    }
    if (timeElapsed <= 200_000) { // 200 seconds in milliseconds
        return 10_000; // 10 seconds in milliseconds
    }
    if (timeElapsed <= 10 * 60 * 1000) { // 10 minutes in milliseconds
        return MIN_BACKOFF_DURATION;
    }
    return undefined;
}

export function calculateDynamicBackoffDuration(failedAttempts: number) {
    if (failedAttempts <= 1) {
        return MIN_BACKOFF_DURATION;
    }

    // exponential: minBackoff * 2 ^ (failedAttempts - 1)
    const exponential = Math.min(failedAttempts - 1, MAX_SAFE_EXPONENTIAL);
    let calculatedBackoffDuration = MIN_BACKOFF_DURATION * (1 << exponential);
    if (calculatedBackoffDuration > MAX_BACKOFF_DURATION) {
        calculatedBackoffDuration = MAX_BACKOFF_DURATION;
    }

    // jitter: random value between [-1, 1) * jitterRatio * calculatedBackoffMs
    const jitter = JITTER_RATIO * (Math.random() * 2 - 1);

    return calculatedBackoffDuration * (1 + jitter);
}
