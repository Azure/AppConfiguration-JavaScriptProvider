// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ConfigurationSetting, featureFlagContentType, secretReferenceContentType } from "@azure/app-configuration";
import { stripComments } from "jsonc-parser";
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
                let rawJsonValue = setting.value;
                if (setting.value) {
                    rawJsonValue = stripComments(setting.value);
                }
                parsedValue = JSON.parse(rawJsonValue);
            } catch (error) {
                if (error instanceof SyntaxError) {
                    parsedValue = setting.value;
                } else {
                    // If the error is not a SyntaxError, rethrow it
                    throw error;
                }
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
