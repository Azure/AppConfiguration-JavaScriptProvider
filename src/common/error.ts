// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { isRestError } from "@azure/core-rest-pipeline";

/**
 * Error thrown when an operation cannot be performed by the Azure App Configuration provider.
 */
export class InvalidOperationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidOperationError";
    }
}

/**
 * Error thrown when an input argument is invalid.
 */
export class ArgumentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ArgumentError";
    }
}

/**
 * Error thrown when a Key Vault reference cannot be resolved.
 */
export class KeyVaultReferenceError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "KeyVaultReferenceError";
    }
}

export function isFailoverableError(error: any): boolean {
    if (!isRestError(error)) {
        return false;
    }
    // https://nodejs.org/api/errors.html#common-system-errors
    // ENOTFOUND: DNS lookup failed, ENOENT: no such file or directory, ECONNREFUSED: connection refused, ECONNRESET: connection reset by peer, ETIMEDOUT: connection timed out
    if (error.code !== undefined &&
        (error.code === "ENOTFOUND" || error.code === "ENOENT" || error.code === "ECONNREFUSED" || error.code === "ECONNRESET" || error.code === "ETIMEDOUT")) {
        return true;
    }
    // 401 Unauthorized, 403 Forbidden, 408 Request Timeout, 429 Too Many Requests, 5xx Server Errors
    if (error.statusCode !== undefined &&
        (error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500)) {
        return true;
    }

    return false;
}

/**
 * Check if the error is an instance of ArgumentError, TypeError, or RangeError.
 */
export function isInputError(error: any): boolean {
    return error instanceof ArgumentError ||
        error instanceof TypeError ||
        error instanceof RangeError;
}
