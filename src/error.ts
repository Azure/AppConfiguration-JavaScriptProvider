// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { isRestError } from "@azure/core-rest-pipeline";

/**
 * Error thrown when an operation is not allowed to be performed.
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
    if (error instanceof OperationError ||
        error instanceof RangeError) {
        return false;
    }
    return true;
}
