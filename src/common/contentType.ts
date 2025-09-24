// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { secretReferenceContentType, featureFlagContentType } from "@azure/app-configuration";

export type ContentType = {
    mediaType: string;
    parameters: Record<string, string>;
}

export function parseContentType(contentTypeValue: string | undefined): ContentType | undefined {
    if (!contentTypeValue) {
        return undefined;
    }
    const [mediaType, ...args] = contentTypeValue.split(";").map((s) => s.trim().toLowerCase());
    const parameters: Record<string, string> = {};

    for (const param of args) {
        const [key, value] = param.split("=").map((s) => s.trim().toLowerCase());
        if (key && value) {
            parameters[key] = value;
        }
    }

    return { mediaType, parameters };
}

// Determine whether a content type string is a valid JSON content type.
// https://docs.microsoft.com/en-us/azure/azure-app-configuration/howto-leverage-json-content-type
export function isJsonContentType(contentType: ContentType | undefined): boolean {
    const mediaType = contentType?.mediaType;
    if (!mediaType) {
        return false;
    }

    const typeParts: string[] = mediaType.split("/");
    if (typeParts.length !== 2) {
        return false;
    }

    if (typeParts[0] !== "application") {
        return false;
    }

    return typeParts[1].split("+").includes("json");
}

export function isFeatureFlagContentType(contentType: ContentType | undefined): boolean {
    const mediaType = contentType?.mediaType;
    if (!mediaType) {
        return false;
    }
    return mediaType === featureFlagContentType;
}

export function isSecretReferenceContentType(contentType: ContentType | undefined): boolean {
    const mediaType = contentType?.mediaType;
    if (!mediaType) {
        return false;
    }
    return mediaType === secretReferenceContentType;
}

export function isSnapshotReferenceContentType(contentType: ContentType | undefined): boolean {
    const mediaType = contentType?.mediaType;
    if (!mediaType) {
        return false;
    }
    // TODO: replace with constant when available in Azure SDK
    return mediaType === "application/json; profile=\"https://azconfig.io/mime-profiles/snapshot-ref\"; charset=utf-8";
}
