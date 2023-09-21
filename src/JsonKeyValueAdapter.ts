// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ConfigurationSetting, secretReferenceContentType } from "@azure/app-configuration";
import { IKeyValueAdapter } from "./IKeyValueAdapter";


export class JsonKeyValueAdapter implements IKeyValueAdapter {
    private static readonly ExcludedJsonContentTypes: string[] = [
        secretReferenceContentType
        // TODO: exclude application/vnd.microsoft.appconfig.ff+json after feature management is supported
    ];

    public canProcess(setting: ConfigurationSetting): boolean {
        if (!setting.contentType) {
            return false;
        }
        if (JsonKeyValueAdapter.ExcludedJsonContentTypes.includes(setting.contentType)) {
            return false;
        }
        return isJsonContentType(setting.contentType);
    }

    public async processKeyValue(setting: ConfigurationSetting): Promise<[string, unknown]> {
        if (!setting.value) {
            throw new Error("Unexpected empty value for application/json content type.");
        }
        let parsedValue: unknown;
        try {
            parsedValue = JSON.parse(setting.value);
        } catch (error) {
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