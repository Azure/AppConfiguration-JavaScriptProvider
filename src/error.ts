// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { isRestError } from "@azure/core-rest-pipeline";

/**
 * Error thrown when an operation cannot be performed by the Azure App Configuration provider.
 */
export class OperationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OperationError";
    }
}

/**
 * Error thrown when an argument or configuration is invalid.
 */
export class ArgumentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ArgumentError";
    }
}

/**
 * Error thrown when it fails to get the secret from the Key Vault.
 */
export class KeyVaultReferenceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "KeyVaultReferenceError";
    }
}

export function isFailoverableError(error: any): boolean {
    if (!isRestError(error)) {
        return false;
    }
    // ENOTFOUND: DNS lookup failed, ENOENT: no such file or directory
    if (error.code == "ENOTFOUND" || error.code === "ENOENT") {
        return true;
    }
    // 401 Unauthorized, 403 Forbidden, 408 Request Timeout, 429 Too Many Requests, 5xx Server Errors
    if (error.statusCode !== undefined &&
        (error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500)) {
        return true;
    }

    return false;
}

export function isRetriableError(error: any): boolean {
    if (error instanceof ArgumentError ||
        error instanceof OperationError ||
        error instanceof TypeError ||
        error instanceof RangeError) {
        return false;
    }
    return true;
}
