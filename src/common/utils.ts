// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function shuffleList<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

export function getEndpointUrl(endpoint: string): URL {
    try {
        return new URL(endpoint);
    } catch (error) {
        throw new TypeError(`Invalid Endpoint URL: ${endpoint}`);
    }
}

export function getUrlHost(url: string): string {
    return new URL(url).host;
}

export function instanceOfTokenCredential(obj: unknown) {
    return obj && typeof obj === "object" && "getToken" in obj && typeof obj.getToken === "function";
}
