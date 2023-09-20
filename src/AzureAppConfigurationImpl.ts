// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient, ConfigurationSetting } from "@azure/app-configuration";
import { AzureAppConfiguration } from "./AzureAppConfiguration";
import { AzureAppConfigurationOptions } from "./AzureAppConfigurationOptions";
import { IKeyValueAdapter } from "./IKeyValueAdapter";
import { KeyFilter } from "./KeyFilter";
import { LabelFilter } from "./LabelFilter";
import { AzureKeyVaultKeyValueAdapter } from "./keyvault/AzureKeyVaultKeyValueAdapter";
import { JsonKeyValueAdapter } from "./JsonKeyValueAdapter";

export class AzureAppConfigurationImpl extends Map<string, unknown> implements AzureAppConfiguration {
    private adapters: IKeyValueAdapter[] = [];
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
        // TODO: should add more adapters to process different type of values
        // feature flag, others
        this.adapters.push(new AzureKeyVaultKeyValueAdapter(options?.keyVaultOptions));
        this.adapters.push(new JsonKeyValueAdapter());
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
                if (setting.key) {
                    const [key, value] = await this.processAdapters(setting);
                    const trimmedKey = this.keyWithPrefixesTrimmed(key);
                    keyValues.push([trimmedKey, value]);
                }
            }
        }
        for (const [k, v] of keyValues) {
            this.set(k, v);
        }
    }

    private async processAdapters(setting: ConfigurationSetting<string>): Promise<[string, unknown]> {
        for(const adapter of this.adapters) {
            if (adapter.canProcess(setting)) {
                return adapter.processKeyValue(setting);
            }
        }
        return [setting.key, setting.value];
    }

    private keyWithPrefixesTrimmed(key: string): string {
        if (this.sortedTrimKeyPrefixes) {
            for (const prefix of this.sortedTrimKeyPrefixes) {
                if (key.startsWith(prefix)) {
                    return key.slice(prefix.length);
                }
            }
        }
        return key;
    }
}
