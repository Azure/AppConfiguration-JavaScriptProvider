// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { isRestError } from "@azure/core-rest-pipeline";

export class OperationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OperationError";
    }
}

export class FailoverError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FailoverError";
    }
}

export function isFailoverableError(error: any): boolean {
    // ENOTFOUND: DNS lookup failed, ENOENT: no such file or directory
    return isRestError(error) && (error.code === "ENOTFOUND" || error.code === "ENOENT" ||
        (error.statusCode !== undefined && (error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500)));
}

export function isRetriableError(error: any): boolean {
    if (error instanceof OperationError || 
        error instanceof RangeError) {
        return false;
    }
    return true;
}