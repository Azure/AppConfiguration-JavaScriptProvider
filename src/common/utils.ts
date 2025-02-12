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

export function shuffleList<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
