// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function base64Helper(str: string): string {
    const bytes = new TextEncoder().encode(str); // UTF-8 encoding
    let chars = "";
    for (let i = 0; i < bytes.length; i++) {
        chars += String.fromCharCode(bytes[i]);
    }
    return btoa(chars);
}

export function jsonSorter(key, value) {
    if (value === null) {
        return null;
    }
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value === "object") {
        return Object.fromEntries(Object.entries(value).sort());
    }
    return value;
}