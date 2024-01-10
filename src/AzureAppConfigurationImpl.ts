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
import { CorrelationContextHeaderName, RequestType } from "./requestTracing/constants";
import { createCorrelationContextHeader, requestTracingEnabled } from "./requestTracing/utils";
import { KeyFilter, LabelFilter, SettingSelector } from "./types";

/**
 * Key-value identifier, used as key of a Map.
 * A primitive string type is actually used, because operator === is used to compare identifiers and we cannot override it.
 */
type KeyValueIdentifier = string; // key::label
function toKeyValueIdentifier(key: string, label: string | undefined): KeyValueIdentifier {
    return `${key}::${label ?? ""}`;
}

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

    // Refresh
    #refreshInterval: number = DefaultRefreshIntervalInMs;
    #onRefreshListeners: Array<() => any> = [];
    #sentinels: Map<KeyValueIdentifier, ConfigurationSettingId> = new Map();
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
                const id = toKeyValueIdentifier(setting.key, setting.label);
                this.#sentinels.set(id, setting);
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

    async #loadSelectedKeyValues(requestType: RequestType): Promise<Map<KeyValueIdentifier, ConfigurationSetting>> {
        const loadedSettings = new Map<string, ConfigurationSetting>();

        // validate selectors
        const selectors = getValidSelectors(this.#options?.selectors);

        for (const selector of selectors) {
            const listOptions: ListConfigurationSettingsOptions = {
                keyFilter: selector.keyFilter,
                labelFilter: selector.labelFilter
            };
            if (this.#requestTracingEnabled) {
                listOptions.requestOptions = {
                    customHeaders: this.#customHeaders(requestType)
                }
            }

            const settings = this.#client.listConfigurationSettings(listOptions);

            for await (const setting of settings) {
                const id = toKeyValueIdentifier(setting.key, setting.label);
                loadedSettings.set(id, setting);
            }
        }
        return loadedSettings;
    }

    /**
     * Load watched key-values from Azure App Configuration service if not coverred by the selectors. Update etag of sentinels.
     */
    async #loadWatchedKeyValues(requestType: RequestType, existingSettings: Map<KeyValueIdentifier, ConfigurationSetting>): Promise<Map<KeyValueIdentifier, ConfigurationSetting>> {
        const watchedSettings = new Map<KeyValueIdentifier, ConfigurationSetting>();

        if (!this.#refreshEnabled) {
            return watchedSettings;
        }

        for (const [id, sentinel] of this.#sentinels) {
            const matchedSetting = existingSettings.get(id);
            if (matchedSetting) {
                watchedSettings.set(id, matchedSetting);
                sentinel.etag = matchedSetting.etag;
            } else {
                // Send a request to retrieve key-value since it may be either not loaded or loaded with a different label or different casing
                const { key, label } = sentinel;
                const response = await this.#getConfigurationSettingWithTrace(requestType, { key, label });
                if (response) {
                    watchedSettings.set(id, response);
                    sentinel.etag = response.etag;
                } else {
                    sentinel.etag = undefined;
                }
            }
        }
        return watchedSettings;
    }

    async load(requestType: RequestType = RequestType.Startup) {
        const keyValues: [key: string, value: unknown][] = [];

        const loadedSettings = await this.#loadSelectedKeyValues(requestType);
        const watchedSettings = await this.#loadWatchedKeyValues(requestType, loadedSettings);

        // process key-values, watched settings have higher priority
        for (const setting of [...loadedSettings.values(), ...watchedSettings.values()]) {
            if (setting.key) {
                const [key, value] = await this.#processKeyValues(setting);
                keyValues.push([key, value]);
            }
        }

        this.clear(); // clear existing key-values in case of configuration setting deletion
        for (const [k, v] of keyValues) {
            this.set(k, v);
        }
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
            const response = await this.#getConfigurationSettingWithTrace(RequestType.Watch, sentinel, {
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
                await this.load(RequestType.Watch);
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

    #customHeaders(requestType: RequestType) {
        if (!this.#requestTracingEnabled) {
            return undefined;
        }

        const headers = {};
        headers[CorrelationContextHeaderName] = createCorrelationContextHeader(this.#options, requestType);
        return headers;
    }

    async #getConfigurationSettingWithTrace(requestType: RequestType, configurationSettingId: ConfigurationSettingId, options?: GetConfigurationSettingOptions): Promise<GetConfigurationSettingResponse | undefined> {
        let response: GetConfigurationSettingResponse | undefined;
        try {
            response = await this.#client.getConfigurationSetting(configurationSettingId, {
                ...options ?? {},
                requestOptions: {
                    customHeaders: this.#customHeaders(requestType)
                }
            });
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
