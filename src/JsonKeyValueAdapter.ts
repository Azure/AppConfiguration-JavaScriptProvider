// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ConfigurationSetting, featureFlagContentType, secretReferenceContentType } from "@azure/app-configuration";
import { IKeyValueAdapter } from "./IKeyValueAdapter";

export class JsonKeyValueAdapter implements IKeyValueAdapter {
    static readonly #ExcludedJsonContentTypes: string[] = [
        secretReferenceContentType,
        featureFlagContentType
    ];

    canProcess(setting: ConfigurationSetting): boolean {
        if (!setting.contentType) {
            return false;
        }
        if (JsonKeyValueAdapter.#ExcludedJsonContentTypes.includes(setting.contentType)) {
            return false;
        }
        return isJsonContentType(setting.contentType);
    }

    async processKeyValue(setting: ConfigurationSetting): Promise<[string, unknown]> {
        let parsedValue: unknown;
        if (setting.value !== undefined) {
            try {
                parsedValue = JSON.parse(setting.value);
            } catch (error) {
                parsedValue = setting.value;
            }
        } else {
            parsedValue = setting.value;
        }
        return [setting.key, parsedValue];
    }
}

// Determine whether a content type string is a valid JSON content type.
// https://docs.microsoft.com/en-us/azure/azure-app-configuration/howto-leverage-json-content-type
function isJsonContentType(contentTypeValue: string): boolean {
    if (!contentTypeValue) {
        return false;
    }

    const contentTypeNormalized: string = contentTypeValue.trim().toLowerCase();
    const mimeType: string = contentTypeNormalized.split(";", 1)[0].trim();
    const typeParts: string[] = mimeType.split("/");
    if (typeParts.length !== 2) {
        return false;
    }

    if (typeParts[0] !== "application") {
        return false;
    }

    return typeParts[1].split("+").includes("json");
}
