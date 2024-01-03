// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient, ConfigurationSetting, ListConfigurationSettingsOptions } from "@azure/app-configuration";
import { AzureAppConfiguration } from "./AzureAppConfiguration";
import { AzureAppConfigurationOptions } from "./AzureAppConfigurationOptions";
import { IKeyValueAdapter } from "./IKeyValueAdapter";
import { JsonKeyValueAdapter } from "./JsonKeyValueAdapter";
import { KeyFilter, LabelFilter } from "./types";
import { AzureKeyVaultKeyValueAdapter } from "./keyvault/AzureKeyVaultKeyValueAdapter";
import { CorrelationContextHeaderName } from "./requestTracing/constants";
import { createCorrelationContextHeader, requestTracingEnabled } from "./requestTracing/utils";
import { SettingSelector } from "./types";

export class AzureAppConfigurationImpl extends Map<string, unknown> implements AzureAppConfiguration {
    #adapters: IKeyValueAdapter[] = [];
    /**
     * Trim key prefixes sorted in descending order.
     * Since multiple prefixes could start with the same characters, we need to trim the longest prefix first.
     */
    #sortedTrimKeyPrefixes: string[] | undefined;
    readonly #requestTracingEnabled: boolean;
    #correlationContextHeader: string | undefined;
    #client: AppConfigurationClient;
    #options: AzureAppConfigurationOptions | undefined;

    constructor(
        client: AppConfigurationClient,
        options: AzureAppConfigurationOptions | undefined
    ) {
        super();
        this.#client = client;
        this.#options = options;

        // Enable request tracing if not opt-out
        this.#requestTracingEnabled = requestTracingEnabled();
        if (this.#requestTracingEnabled) {
            this.#enableRequestTracing();
        }

        if (options?.trimKeyPrefixes) {
            this.#sortedTrimKeyPrefixes = [...options.trimKeyPrefixes].sort((a, b) => b.localeCompare(a));
        }
        // TODO: should add more adapters to process different type of values
        // feature flag, others
        this.#adapters.push(new AzureKeyVaultKeyValueAdapter(options?.keyVaultOptions));
        this.#adapters.push(new JsonKeyValueAdapter());
    }

    async load() {
        const keyValues: [key: string, value: unknown][] = [];

        // validate selectors
        const selectors = getValidSelectors(this.#options?.selectors);

        for (const selector of selectors) {
            const listOptions: ListConfigurationSettingsOptions = {
                keyFilter: selector.keyFilter,
                labelFilter: selector.labelFilter
            };
            if (this.#requestTracingEnabled) {
                listOptions.requestOptions = {
                    customHeaders: this.#customHeaders()
                }
            }

            const settings = this.#client.listConfigurationSettings(listOptions);

            for await (const setting of settings) {
                if (setting.key) {
                    const [key, value] = await this.#processAdapters(setting);
                    const trimmedKey = this.#keyWithPrefixesTrimmed(key);
                    keyValues.push([trimmedKey, value]);
                }
            }
        }
        for (const [k, v] of keyValues) {
            this.set(k, v);
        }
    }

    async #processAdapters(setting: ConfigurationSetting<string>): Promise<[string, unknown]> {
        for (const adapter of this.#adapters) {
            if (adapter.canProcess(setting)) {
                return adapter.processKeyValue(setting);
            }
        }
        return [setting.key, setting.value];
    }

    #keyWithPrefixesTrimmed(key: string): string {
        if (this.#sortedTrimKeyPrefixes) {
            for (const prefix of this.#sortedTrimKeyPrefixes) {
                if (key.startsWith(prefix)) {
                    return key.slice(prefix.length);
                }
            }
        }
        return key;
    }

    #enableRequestTracing() {
        this.#correlationContextHeader = createCorrelationContextHeader(this.#options);
    }

    #customHeaders() {
        if (!this.#requestTracingEnabled) {
            return undefined;
        }

        const headers = {};
        headers[CorrelationContextHeaderName] = this.#correlationContextHeader;
        return headers;
    }
}

function getValidSelectors(selectors?: SettingSelector[]) {
    if (!selectors || selectors.length === 0) {
        // Default selector: key: *, label: \0
        return [{ keyFilter: KeyFilter.Any, labelFilter: LabelFilter.Null }];
    }

    // below code dedupes selectors by keyFilter and labelFilter, the latter selector wins
    const dedupedSelectors: SettingSelector[] = [];
    for (const selector of selectors) {
        const existingSelectorIndex = dedupedSelectors.findIndex(s => s.keyFilter === selector.keyFilter && s.labelFilter === selector.labelFilter);
        if (existingSelectorIndex >= 0) {
            dedupedSelectors.splice(existingSelectorIndex, 1);
        }
        dedupedSelectors.push(selector);
    }

    return dedupedSelectors.map(selectorCandidate => {
        const selector = { ...selectorCandidate };
        if (!selector.keyFilter) {
            throw new Error("Key filter cannot be null or empty.");
        }
        if (!selector.labelFilter) {
            selector.labelFilter = LabelFilter.Null;
        }
        if (selector.labelFilter.includes("*") || selector.labelFilter.includes(",")) {
            throw new Error("The characters '*' and ',' are not supported in label filters.");
        }
        return selector;
    });
}