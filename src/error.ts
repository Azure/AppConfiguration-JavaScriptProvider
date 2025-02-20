// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { isRestError } from "@azure/core-rest-pipeline";
import { AuthenticationError } from "@azure/identity";

/**
 * Error thrown when an operation cannot be performed by the Azure App Configuration provider.
 */
export class OperationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OperationError";
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
    if (error instanceof AuthenticationError || // this error occurs when using wrong credential to access the key vault
        error instanceof RangeError || // this error is caused by misconfiguration of the Azure App Configuration provider
        error instanceof OperationError) {
        return false;
    }
    return true;
}
