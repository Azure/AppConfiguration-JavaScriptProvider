// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ConfigurationSetting, featureFlagContentType, secretReferenceContentType } from "@azure/app-configuration";
import { stripComments } from "jsonc-parser";
import { parseContentType, isJsonContentType } from "./common/contentType.js";
import { IKeyValueAdapter } from "./keyValueAdapter.js";

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
            const parseResult = this.#tryParseJson(setting.value);
            if (parseResult.success) {
                parsedValue = parseResult.result;
            } else {
                // Try parsing with comments stripped
                const parseWithoutCommentsResult = this.#tryParseJson(stripComments(setting.value));
                if (parseWithoutCommentsResult.success) {
                    parsedValue = parseWithoutCommentsResult.result;
                } else {
                    // If still not valid JSON, return the original value
                    parsedValue = setting.value;
                }
            }
        }
        return [setting.key, parsedValue];
    }

    async onChangeDetected(): Promise<void> {
        return;
    }

        #tryParseJson(value: string): { success: true; result: unknown } | { success: false } {
        try {
            return { success: true, result: JSON.parse(value) };
        } catch (error) {
            if (error instanceof SyntaxError) {
                return { success: false };
            }
            throw error;
        }
    }
}
