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
        let parsedValue: any;
        try {
            parsedValue = JSON.parse(setting.value);
        } catch (error) {
            throw new Error("Failed to parse JSON string.", { cause: error })
        }
        return [setting.key, parsedValue];
    }
}

function isJsonContentType(contentType: string) {
    contentType = contentType.trim().toLowerCase();
    const mimeType = contentType.split(";")[0].trim();
    const [mainType, subTypes, ...restParts] = mimeType.split("/");
    return restParts.length === 0 && mainType === "application" && subTypes.split("+").includes("json");
}