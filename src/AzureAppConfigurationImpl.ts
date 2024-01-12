// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient, ConfigurationSetting, ConfigurationSettingId, GetConfigurationSettingOptions, GetConfigurationSettingResponse, ListConfigurationSettingsOptions } from "@azure/app-configuration";
import { RestError } from "@azure/core-rest-pipeline";
import { AzureAppConfiguration } from "./AzureAppConfiguration";
import { AzureAppConfigurationOptions } from "./AzureAppConfigurationOptions";
import { IKeyValueAdapter } from "./IKeyValueAdapter";
import { JsonKeyValueAdapter } from "./JsonKeyValueAdapter";
import { DefaultRefreshIntervalInMs, MinimumRefreshIntervalInMs } from "./RefreshOptions";
import { Disposable } from "./common/disposable";
import { AzureKeyVaultKeyValueAdapter } from "./keyvault/AzureKeyVaultKeyValueAdapter";
import { RefreshTimer } from "./refresh/RefreshTimer";
import { CorrelationContextHeaderName } from "./requestTracing/constants";
import { createCorrelationContextHeader, requestTracingEnabled } from "./requestTracing/utils";
import { KeyFilter, LabelFilter, SettingSelector } from "./types";

export class AzureAppConfigurationImpl extends Map<string, any> implements AzureAppConfiguration {
    #adapters: IKeyValueAdapter[] = [];
    /**
     * Trim key prefixes sorted in descending order.
     * Since multiple prefixes could start with the same characters, we need to trim the longest prefix first.
     */
    #sortedTrimKeyPrefixes: string[] | undefined;
    readonly #requestTracingEnabled: boolean;
    #client: AppConfigurationClient;
    #options: AzureAppConfigurationOptions | undefined;
    #isInitialLoadCompleted: boolean = false;

    // Refresh
    #refreshInterval: number = DefaultRefreshIntervalInMs;
    #onRefreshListeners: Array<() => any> = [];
    /**
     * Aka watched settings.
     */
    #sentinels: ConfigurationSettingId[] = [];
    #refreshTimer: RefreshTimer;

    constructor(
        client: AppConfigurationClient,
        options: AzureAppConfigurationOptions | undefined
    ) {
        super();
        this.#client = client;
        this.#options = options;

        // Enable request tracing if not opt-out
        this.#requestTracingEnabled = requestTracingEnabled();

        if (options?.trimKeyPrefixes) {
            this.#sortedTrimKeyPrefixes = [...options.trimKeyPrefixes].sort((a, b) => b.localeCompare(a));
        }

        if (options?.refreshOptions?.enabled) {
            const { watchedSettings, refreshIntervalInMs } = options.refreshOptions;
            // validate watched settings
            if (watchedSettings === undefined || watchedSettings.length === 0) {
                throw new Error("Refresh is enabled but no watched settings are specified.");
            }

            // custom refresh interval
            if (refreshIntervalInMs !== undefined) {
                if (refreshIntervalInMs < MinimumRefreshIntervalInMs) {
                    throw new Error(`The refresh interval cannot be less than ${MinimumRefreshIntervalInMs} milliseconds.`);

                } else {
                    this.#refreshInterval = refreshIntervalInMs;
                }
            }

            for (const setting of watchedSettings) {
                if (setting.key.includes("*") || setting.key.includes(",")) {
                    throw new Error("The characters '*' and ',' are not supported in key of watched settings.");
                }
                if (setting.label?.includes("*") || setting.label?.includes(",")) {
                    throw new Error("The characters '*' and ',' are not supported in label of watched settings.");
                }
                this.#sentinels.push(setting);
            }

            this.#refreshTimer = new RefreshTimer(this.#refreshInterval);
        }

        // TODO: should add more adapters to process different type of values
        // feature flag, others
        this.#adapters.push(new AzureKeyVaultKeyValueAdapter(options?.keyVaultOptions));
        this.#adapters.push(new JsonKeyValueAdapter());
    }


    get #refreshEnabled(): boolean {
        return !!this.#options?.refreshOptions?.enabled;
    }

    async #loadSelectedKeyValues(): Promise<ConfigurationSetting[]> {
        const loadedSettings: ConfigurationSetting[] = [];

        // validate selectors
        const selectors = getValidSelectors(this.#options?.selectors);

        for (const selector of selectors) {
            const listOptions: ListConfigurationSettingsOptions = {
                keyFilter: selector.keyFilter,
                labelFilter: selector.labelFilter
            };
            if (this.#requestTracingEnabled) {
                listOptions.requestOptions = {
                    customHeaders: {
                        [CorrelationContextHeaderName]: createCorrelationContextHeader(this.#options, this.#isInitialLoadCompleted)
                    }
                }
            }

            const settings = this.#client.listConfigurationSettings(listOptions);

            for await (const setting of settings) {
                loadedSettings.push(setting);
            }
        }
        return loadedSettings;
    }

    /**
     * Update etag of watched settings from loaded data. If a watched setting is not covered by any selector, a request will be sent to retrieve it.
     */
    async #updateWatchedKeyValuesEtag(existingSettings: ConfigurationSetting[]): Promise<void> {
        if (!this.#refreshEnabled) {
            return;
        }

        for (const sentinel of this.#sentinels) {
            const matchedSetting = existingSettings.find(s => s.key === sentinel.key && s.label === sentinel.label);
            if (matchedSetting) {
                sentinel.etag = matchedSetting.etag;
            } else {
                // Send a request to retrieve key-value since it may be either not loaded or loaded with a different label or different casing
                const { key, label } = sentinel;
                const response = await this.#getConfigurationSettingWithTrace({ key, label });
                if (response) {
                    sentinel.etag = response.etag;
                } else {
                    sentinel.etag = undefined;
                }
            }
        }
    }

    async #loadSelectedAndWatchedKeyValues() {
        const keyValues: [key: string, value: unknown][] = [];

        const loadedSettings = await this.#loadSelectedKeyValues();
        await this.#updateWatchedKeyValuesEtag(loadedSettings);

        // process key-values, watched settings have higher priority
        for (const setting of loadedSettings) {
            const [key, value] = await this.#processKeyValues(setting);
            keyValues.push([key, value]);
        }

        this.clear(); // clear existing key-values in case of configuration setting deletion
        for (const [k, v] of keyValues) {
            this.set(k, v);
        }
    }

    /**
     * Load the configuration store for the first time.
     */
    async load() {
        await this.#loadSelectedAndWatchedKeyValues();

        // Mark all settings have loaded at startup.
        this.#isInitialLoadCompleted = true;
    }

    /**
     * Refresh the configuration store.
     */
    public async refresh(): Promise<void> {
        if (!this.#refreshEnabled) {
            throw new Error("Refresh is not enabled.");
        }

        // if still within refresh interval/backoff, return
        if (!this.#refreshTimer.canRefresh()) {
            return Promise.resolve();
        }

        // try refresh if any of watched settings is changed.
        let needRefresh = false;
        for (const sentinel of this.#sentinels.values()) {
            const response = await this.#getConfigurationSettingWithTrace(sentinel, {
                onlyIfChanged: true
            });

            if (response === undefined || response.statusCode === 200) {
                // sentinel deleted / changed.
                sentinel.etag = response?.etag;// update etag of the sentinel
                needRefresh = true;
                break;
            }
        }
        if (needRefresh) {
            try {
                await this.#loadSelectedAndWatchedKeyValues();
                this.#refreshTimer.reset();
            } catch (error) {
                // if refresh failed, backoff
                this.#refreshTimer.backoff();
                throw error;
            }

            // successfully refreshed, run callbacks in async
            for (const listener of this.#onRefreshListeners) {
                listener();
            }
        }
    }

    onRefresh(listener: () => any, thisArg?: any): Disposable {
        if (!this.#refreshEnabled) {
            throw new Error("Refresh is not enabled.");
        }

        const boundedListener = listener.bind(thisArg);
        this.#onRefreshListeners.push(boundedListener);

        const remove = () => {
            const index = this.#onRefreshListeners.indexOf(boundedListener);
            if (index >= 0) {
                this.#onRefreshListeners.splice(index, 1);
            }
        }
        return new Disposable(remove);
    }

    async #processKeyValues(setting: ConfigurationSetting<string>): Promise<[string, unknown]> {
        const [key, value] = await this.#processAdapters(setting);
        const trimmedKey = this.#keyWithPrefixesTrimmed(key);
        return [trimmedKey, value];
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

    async #getConfigurationSettingWithTrace(configurationSettingId: ConfigurationSettingId, customOptions?: GetConfigurationSettingOptions): Promise<GetConfigurationSettingResponse | undefined> {
        let response: GetConfigurationSettingResponse | undefined;
        try {
            const options = {...customOptions ?? {}};
            if (this.#requestTracingEnabled) {
                options.requestOptions = {
                    customHeaders: {
                        [CorrelationContextHeaderName]: createCorrelationContextHeader(this.#options, this.#isInitialLoadCompleted)
                    }
                }
            }
            response = await this.#client.getConfigurationSetting(configurationSettingId, options);
        } catch (error) {
            if (error instanceof RestError && error.statusCode === 404) {
                response = undefined;
            } else {
                throw error;
            }
        }
        return response;
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
