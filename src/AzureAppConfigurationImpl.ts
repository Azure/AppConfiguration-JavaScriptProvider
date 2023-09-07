// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient, ConfigurationSetting, featureFlagContentType, isSecretReference, parseSecretReference } from "@azure/app-configuration";
import { AzureAppConfiguration } from "./AzureAppConfiguration";
import { AzureAppConfigurationOptions } from "./AzureAppConfigurationOptions";
import { KeyFilter } from "./KeyFilter";
import { LabelFilter } from "./LabelFilter";

export class AzureAppConfigurationImpl extends Map<string, unknown> implements AzureAppConfiguration {
    /**
     * Trim key prefixes sorted in descending order.
     * Since multiple prefixes could start with the same characters, we need to trim the longest prefix first.
     */
    private sortedTrimKeyPrefixes: string[] | undefined;

    constructor(
        private client: AppConfigurationClient,
        private options: AzureAppConfigurationOptions | undefined
    ) {
        super();
        if (options?.trimKeyPrefixes) {
            this.sortedTrimKeyPrefixes = [...options.trimKeyPrefixes].sort((a, b) => b.localeCompare(a));
        }
    }

    public async load() {
        const keyValues: [key: string, value: unknown][] = [];
        const selectors = this.options?.selectors ?? [{ keyFilter: KeyFilter.Any, labelFilter: LabelFilter.Null }];
        for (const selector of selectors) {
            const settings = this.client.listConfigurationSettings({
                keyFilter: selector.keyFilter,
                labelFilter: selector.labelFilter
            });

            for await (const setting of settings) {
                if (setting.key && setting.value) {
                    const trimmedKey = keyWithPrefixesTrimmed(setting.key, this.sortedTrimKeyPrefixes);
                    const value = await this.processKeyValue(setting);
                    keyValues.push([trimmedKey, value]);
                }
            }
        }
        for (const [k, v] of keyValues) {
            this.set(k, v);
        }
    }

    private async processKeyValue(setting: ConfigurationSetting<string>) {
        // TODO: should process different type of values
        // keyvault reference, feature flag, json, others
        return setting.value;
    }
}

function keyWithPrefixesTrimmed(key: string, prefixesToTrim: string[] | undefined): string {
    if (prefixesToTrim) {
        for (const prefix of prefixesToTrim) {
            if (key.startsWith(prefix)) {
                return key.slice(prefix.length);
            }
        }
    }
    return key;
}
