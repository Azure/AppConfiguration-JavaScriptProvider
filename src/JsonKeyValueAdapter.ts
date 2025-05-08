// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ConfigurationSetting, featureFlagContentType, secretReferenceContentType } from "@azure/app-configuration";
import { parseContentType, isJsonContentType } from "./common/contentType.js";
import { IKeyValueAdapter } from "./IKeyValueAdapter.js";

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
        const contentType = parseContentType(setting.contentType);
        return isJsonContentType(contentType);
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

    async onChangeDetected(): Promise<void> {
        return;
    }
}
