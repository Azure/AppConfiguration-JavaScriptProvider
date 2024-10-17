// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ConfigurationSetting, ConfigurationSettingId, GetConfigurationSettingOptions, GetConfigurationSettingResponse, ListConfigurationSettingsOptions, featureFlagPrefix, isFeatureFlag } from "@azure/app-configuration";
import { isRestError } from "@azure/core-rest-pipeline";
import { AzureAppConfiguration, ConfigurationObjectConstructionOptions } from "./AzureAppConfiguration.js";
import { AzureAppConfigurationOptions } from "./AzureAppConfigurationOptions.js";
import { IKeyValueAdapter } from "./IKeyValueAdapter.js";
import { JsonKeyValueAdapter } from "./JsonKeyValueAdapter.js";
import { DEFAULT_REFRESH_INTERVAL_IN_MS, MIN_REFRESH_INTERVAL_IN_MS } from "./RefreshOptions.js";
import { Disposable } from "./common/disposable.js";
import { FEATURE_FLAGS_KEY_NAME, FEATURE_MANAGEMENT_KEY_NAME, TELEMETRY_KEY_NAME, ENABLED_KEY_NAME, METADATA_KEY_NAME, ETAG_KEY_NAME, FEATURE_FLAG_ID_KEY_NAME, FEATURE_FLAG_REFERENCE_KEY_NAME } from "./featureManagement/constants.js";
import { AzureKeyVaultKeyValueAdapter } from "./keyvault/AzureKeyVaultKeyValueAdapter.js";
import { RefreshTimer } from "./refresh/RefreshTimer.js";
import { getConfigurationSettingWithTrace, listConfigurationSettingsWithTrace, requestTracingEnabled } from "./requestTracing/utils.js";
import { KeyFilter, LabelFilter, SettingSelector } from "./types.js";
import { ConfigurationClientManager } from "./ConfigurationClientManager.js";
import { updateClientBackoffStatus } from "./ConfigurationClientWrapper.js";

type PagedSettingSelector = SettingSelector & {
    /**
     * Key: page eTag, Value: feature flag configurations
     */
    pageEtags?: string[];
};

export class AzureAppConfigurationImpl implements AzureAppConfiguration {
    /**
     * Hosting key-value pairs in the configuration store.
     */
    #configMap: Map<string, any> = new Map<string, any>();

    #adapters: IKeyValueAdapter[] = [];
    /**
     * Trim key prefixes sorted in descending order.
     * Since multiple prefixes could start with the same characters, we need to trim the longest prefix first.
     */
    #sortedTrimKeyPrefixes: string[] | undefined;
    readonly #requestTracingEnabled: boolean;
    #clientManager: ConfigurationClientManager;
    #options: AzureAppConfigurationOptions | undefined;
    #isInitialLoadCompleted: boolean = false;
    #isFailoverRequest: boolean = false;

    // Refresh
    #refreshInterval: number = DEFAULT_REFRESH_INTERVAL_IN_MS;
    #onRefreshListeners: Array<() => any> = [];
    /**
     * Aka watched settings.
     */
    #sentinels: ConfigurationSettingId[] = [];
    #refreshTimer: RefreshTimer;

    // Feature flags
    #featureFlagRefreshInterval: number = DEFAULT_REFRESH_INTERVAL_IN_MS;
    #featureFlagRefreshTimer: RefreshTimer;

    // selectors
    #featureFlagSelectors: PagedSettingSelector[] = [];

    constructor(
        clientManager: ConfigurationClientManager,
        options: AzureAppConfigurationOptions | undefined,
    ) {
        this.#options = options;
        this.#clientManager = clientManager;

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
                if (refreshIntervalInMs < MIN_REFRESH_INTERVAL_IN_MS) {
                    throw new Error(`The refresh interval cannot be less than ${MIN_REFRESH_INTERVAL_IN_MS} milliseconds.`);

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

        // feature flag options
        if (options?.featureFlagOptions?.enabled) {
            // validate feature flag selectors
            this.#featureFlagSelectors = getValidFeatureFlagSelectors(options.featureFlagOptions.selectors);

            if (options.featureFlagOptions.refresh?.enabled) {
                const { refreshIntervalInMs } = options.featureFlagOptions.refresh;
                // custom refresh interval
                if (refreshIntervalInMs !== undefined) {
                    if (refreshIntervalInMs < MIN_REFRESH_INTERVAL_IN_MS) {
                        throw new Error(`The feature flag refresh interval cannot be less than ${MIN_REFRESH_INTERVAL_IN_MS} milliseconds.`);
                    } else {
                        this.#featureFlagRefreshInterval = refreshIntervalInMs;
                    }
                }

                this.#featureFlagRefreshTimer = new RefreshTimer(this.#featureFlagRefreshInterval);
            }
        }

        this.#adapters.push(new AzureKeyVaultKeyValueAdapter(options?.keyVaultOptions));
        this.#adapters.push(new JsonKeyValueAdapter());
    }

    // #region ReadonlyMap APIs
    get<T>(key: string): T | undefined {
        return this.#configMap.get(key);
    }

    forEach(callbackfn: (value: any, key: string, map: ReadonlyMap<string, any>) => void, thisArg?: any): void {
        this.#configMap.forEach(callbackfn, thisArg);
    }

    has(key: string): boolean {
        return this.#configMap.has(key);
    }

    get size(): number {
        return this.#configMap.size;
    }

    entries(): MapIterator<[string, any]> {
        return this.#configMap.entries();
    }

    keys(): MapIterator<string> {
        return this.#configMap.keys();
    }

    values(): MapIterator<any> {
        return this.#configMap.values();
    }

    [Symbol.iterator](): MapIterator<[string, any]> {
        return this.#configMap[Symbol.iterator]();
    }
    // #endregion

    get #refreshEnabled(): boolean {
        return !!this.#options?.refreshOptions?.enabled;
    }

    get #featureFlagEnabled(): boolean {
        return !!this.#options?.featureFlagOptions?.enabled;
    }

    get #featureFlagRefreshEnabled(): boolean {
        return this.#featureFlagEnabled && !!this.#options?.featureFlagOptions?.refresh?.enabled;
    }

    get #requestTraceOptions() {
        return {
            requestTracingEnabled: this.#requestTracingEnabled,
            initialLoadCompleted: this.#isInitialLoadCompleted,
            appConfigOptions: this.#options,
            isFailoverRequest: this.#isFailoverRequest
        };
    }

    async #executeWithFailoverPolicy(funcToExecute) {
        const clients = await this.#clientManager.getClients();
        if (clients.length === 0) {
            this.#clientManager.refreshClients();
            throw new Error("No client is available to connect to the target App Configuration store.");
        }

        for (const client of clients) {
            let successful = false;
            try {
                const result = await funcToExecute(client.client);
                this.#isFailoverRequest = false;
                successful = true;
                updateClientBackoffStatus(client, successful);
                return result;
            } catch (error) {
                if (isFailoverableError(error)) {
                    updateClientBackoffStatus(client, successful);
                    this.#isFailoverRequest = true;
                    continue;
                }

                throw error;
            }
        }

        this.#clientManager.refreshClients();
        throw new Error("All app configuration clients failed to get settings.");
    }

    async #loadSelectedKeyValues(): Promise<ConfigurationSetting[]> {
        // validate selectors
        const selectors = getValidKeyValueSelectors(this.#options?.selectors);
        let loadedSettings: ConfigurationSetting[] = [];

        const funcToExecute = async (client) => {
            const loadedSettings: ConfigurationSetting[] = [];
            for (const selector of selectors) {
                const listOptions: ListConfigurationSettingsOptions = {
                    keyFilter: selector.keyFilter,
                    labelFilter: selector.labelFilter
                };

                const settings = listConfigurationSettingsWithTrace(
                    this.#requestTraceOptions,
                    client,
                    listOptions
                );

                for await (const setting of settings) {
                    if (!isFeatureFlag(setting)) { // exclude feature flags
                        loadedSettings.push(setting);
                    }
                }
            }
            return loadedSettings;
        };

        loadedSettings = await this.#executeWithFailoverPolicy(funcToExecute);
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
                const response = await this.#getConfigurationSetting({ key, label });
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

        this.#clearLoadedKeyValues(); // clear existing key-values in case of configuration setting deletion
        for (const [k, v] of keyValues) {
            this.#configMap.set(k, v);
        }
    }

    async #clearLoadedKeyValues() {
        for (const key of this.#configMap.keys()) {
            if (key !== FEATURE_MANAGEMENT_KEY_NAME) {
                this.#configMap.delete(key);
            }
        }
    }

    async #loadFeatureFlags() {
        // Temporary map to store feature flags, key is the key of the setting, value is the raw value of the setting
        const funcToExecute = async (client) => {
            const featureFlagSettings: ConfigurationSetting[] = [];
            const selectors = JSON.parse(
                JSON.stringify(this.#featureFlagSelectors)
            );

            for (const selector of selectors) {
                const listOptions: ListConfigurationSettingsOptions = {
                    keyFilter: `${featureFlagPrefix}${selector.keyFilter}`,
                    labelFilter: selector.labelFilter
                };

                const pageEtags: string[] = [];
                const pageIterator = listConfigurationSettingsWithTrace(
                    this.#requestTraceOptions,
                    client,
                    listOptions
                ).byPage();
                for await (const page of pageIterator) {
                    pageEtags.push(page.etag ?? "");
                    for (const setting of page.items) {
                        if (isFeatureFlag(setting)) {
                            featureFlagSettings.push(setting);
                        }
                    }
                }
                selector.pageEtags = pageEtags;
            }

            this.#featureFlagSelectors = selectors;
            return featureFlagSettings;
        };

        let featureFlagSettings: ConfigurationSetting[] = [];
        featureFlagSettings = await this.#executeWithFailoverPolicy(funcToExecute);

        // parse feature flags
        const featureFlags = await Promise.all(
            featureFlagSettings.map(setting => this.#parseFeatureFlag(setting))
        );

        // feature_management is a reserved key, and feature_flags is an array of feature flags
        this.#configMap.set(FEATURE_MANAGEMENT_KEY_NAME, { [FEATURE_FLAGS_KEY_NAME]: featureFlags });
    }

    /**
     * Load the configuration store for the first time.
     */
    async load() {
        await this.#loadSelectedAndWatchedKeyValues();
        if (this.#featureFlagEnabled) {
            await this.#loadFeatureFlags();
        }
        // Mark all settings have loaded at startup.
        this.#isInitialLoadCompleted = true;
    }

    /**
     * Construct hierarchical data object from map.
     */
    constructConfigurationObject(options?: ConfigurationObjectConstructionOptions): Record<string, any> {
        const separator = options?.separator ?? ".";
        const validSeparators = [".", ",", ";", "-", "_", "__", "/", ":"];
        if (!validSeparators.includes(separator)) {
            throw new Error(`Invalid separator '${separator}'. Supported values: ${validSeparators.map(s => `'${s}'`).join(", ")}.`);
        }

        // construct hierarchical data object from map
        const data: Record<string, any> = {};
        for (const [key, value] of this.#configMap) {
            const segments = key.split(separator);
            let current = data;
            // construct hierarchical data object along the path
            for (let i = 0; i < segments.length - 1; i++) {
                const segment = segments[i];
                // undefined or empty string
                if (!segment) {
                    throw new Error(`invalid key: ${key}`);
                }
                // create path if not exist
                if (current[segment] === undefined) {
                    current[segment] = {};
                }
                // The path has been occupied by a non-object value, causing ambiguity.
                if (typeof current[segment] !== "object") {
                    throw new Error(`Ambiguity occurs when constructing configuration object from key '${key}', value '${value}'. The path '${segments.slice(0, i + 1).join(separator)}' has been occupied.`);
                }
                current = current[segment];
            }

            const lastSegment = segments[segments.length - 1];
            if (current[lastSegment] !== undefined) {
                throw new Error(`Ambiguity occurs when constructing configuration object from key '${key}', value '${value}'. The key should not be part of another key.`);
            }
            // set value to the last segment
            current[lastSegment] = value;
        }
        return data;
    }

    /**
     * Refresh the configuration store.
     */
    async refresh(): Promise<void> {
        if (!this.#refreshEnabled && !this.#featureFlagRefreshEnabled) {
            throw new Error("Refresh is not enabled for key-values or feature flags.");
        }

        const refreshTasks: Promise<boolean>[] = [];
        if (this.#refreshEnabled) {
            refreshTasks.push(this.#refreshKeyValues());
        }
        if (this.#featureFlagRefreshEnabled) {
            refreshTasks.push(this.#refreshFeatureFlags());
        }

        // wait until all tasks are either resolved or rejected
        const results = await Promise.allSettled(refreshTasks);

        // check if any refresh task failed
        for (const result of results) {
            if (result.status === "rejected") {
                throw result.reason;
            }
        }

        // check if any refresh task succeeded
        const anyRefreshed = results.some(result => result.status === "fulfilled" && result.value === true);
        if (anyRefreshed) {
            // successfully refreshed, run callbacks in async
            for (const listener of this.#onRefreshListeners) {
                listener();
            }
        }
    }

    /**
     * Refresh key-values.
     * @returns true if key-values are refreshed, false otherwise.
     */
    async #refreshKeyValues(): Promise<boolean> {
        // if still within refresh interval/backoff, return
        if (!this.#refreshTimer.canRefresh()) {
            return Promise.resolve(false);
        }

        // try refresh if any of watched settings is changed.
        let needRefresh = false;
        for (const sentinel of this.#sentinels.values()) {
            const response = await this.#getConfigurationSetting(sentinel, {
                onlyIfChanged: true
            });

            if (response?.statusCode === 200 // created or changed
                || (response === undefined && sentinel.etag !== undefined) // deleted
            ) {
                sentinel.etag = response?.etag;// update etag of the sentinel
                needRefresh = true;
                break;
            }
        }

        if (needRefresh) {
            try {
                await this.#loadSelectedAndWatchedKeyValues();
            } catch (error) {
                // if refresh failed, backoff
                this.#refreshTimer.backoff();
                throw error;
            }
        }

        this.#refreshTimer.reset();
        return Promise.resolve(needRefresh);
    }

    /**
     * Refresh feature flags.
     * @returns true if feature flags are refreshed, false otherwise.
     */
    async #refreshFeatureFlags(): Promise<boolean> {
        // if still within refresh interval/backoff, return
        if (!this.#featureFlagRefreshTimer.canRefresh()) {
            return Promise.resolve(false);
        }

        // check if any feature flag is changed
        const funcToExecute = async (client) => {
            const needRefresh = false;
            for (const selector of this.#featureFlagSelectors) {
                const listOptions: ListConfigurationSettingsOptions = {
                    keyFilter: `${featureFlagPrefix}${selector.keyFilter}`,
                    labelFilter: selector.labelFilter,
                    pageEtags: selector.pageEtags
                };

                const pageIterator = listConfigurationSettingsWithTrace(
                    this.#requestTraceOptions,
                    client,
                    listOptions
                ).byPage();

                for await (const page of pageIterator) {
                    if (page._response.status === 200) { // created or changed
                        return true;
                    }
                }
            }
            return needRefresh;
        };

        const needRefresh: boolean = await this.#executeWithFailoverPolicy(funcToExecute);
        if (needRefresh) {
            try {
                await this.#loadFeatureFlags();
            } catch (error) {
                // if refresh failed, backoff
                this.#featureFlagRefreshTimer.backoff();
                throw error;
            }
        }

        this.#featureFlagRefreshTimer.reset();
        return Promise.resolve(needRefresh);
    }

    onRefresh(listener: () => any, thisArg?: any): Disposable {
        if (!this.#refreshEnabled && !this.#featureFlagRefreshEnabled) {
            throw new Error("Refresh is not enabled for key-values or feature flags.");
        }

        const boundedListener = listener.bind(thisArg);
        this.#onRefreshListeners.push(boundedListener);

        const remove = () => {
            const index = this.#onRefreshListeners.indexOf(boundedListener);
            if (index >= 0) {
                this.#onRefreshListeners.splice(index, 1);
            }
        };
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

    /**
     * Get a configuration setting by key and label. If the setting is not found, return undefine instead of throwing an error.
     */
    async #getConfigurationSetting(configurationSettingId: ConfigurationSettingId, customOptions?: GetConfigurationSettingOptions): Promise<GetConfigurationSettingResponse | undefined> {
        const funcToExecute = async (client) => {
            return getConfigurationSettingWithTrace(
                this.#requestTraceOptions,
                client,
                configurationSettingId,
                customOptions
            );
        };

        let response: GetConfigurationSettingResponse | undefined;
        try {
            response = await this.#executeWithFailoverPolicy(funcToExecute);
        } catch (error) {
            if (isRestError(error) && error.statusCode === 404) {
                response = undefined;
            } else {
                throw error;
            }
        }
        return response;
    }

    async #parseFeatureFlag(setting: ConfigurationSetting<string>): Promise<any> {
        const rawFlag = setting.value;
        if (rawFlag === undefined) {
            throw new Error("The value of configuration setting cannot be undefined.");
        }
        const featureFlag = JSON.parse(rawFlag);

        if (featureFlag[TELEMETRY_KEY_NAME] && featureFlag[TELEMETRY_KEY_NAME][ENABLED_KEY_NAME] === true) {
            const metadata = featureFlag[TELEMETRY_KEY_NAME][METADATA_KEY_NAME];
            featureFlag[TELEMETRY_KEY_NAME][METADATA_KEY_NAME] = {
                [ETAG_KEY_NAME]: setting.etag,
                [FEATURE_FLAG_ID_KEY_NAME]: await this.#calculateFeatureFlagId(setting),
                [FEATURE_FLAG_REFERENCE_KEY_NAME]: this.#createFeatureFlagReference(setting),
                ...(metadata || {})
            };
        }

        return featureFlag;
    }

    async #calculateFeatureFlagId(setting: ConfigurationSetting<string>): Promise<string> {
        let crypto;

        // Check for browser environment
        if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
            crypto = window.crypto;
        }
        // Check for Node.js environment
        else if (typeof global !== "undefined" && global.crypto) {
            crypto = global.crypto;
        }
        // Fallback to native Node.js crypto module
        else {
            try {
                if (typeof module !== "undefined" && module.exports) {
                    crypto = require("crypto");
                }
                else {
                    crypto = await import("crypto");
                }
            } catch (error) {
                console.error("Failed to load the crypto module:", error.message);
                throw error;
            }
        }

        let baseString = `${setting.key}\n`;
        if (setting.label && setting.label.trim().length !== 0) {
            baseString += `${setting.label}`;
        }

        // Convert to UTF-8 encoded bytes
        const data = new TextEncoder().encode(baseString);

        // In the browser, use crypto.subtle.digest
        if (crypto.subtle) {
            const hashBuffer = await crypto.subtle.digest("SHA-256", data);
            const hashArray = new Uint8Array(hashBuffer);
            const base64String = btoa(String.fromCharCode(...hashArray));
            const base64urlString = base64String.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
            return base64urlString;
        }
        // In Node.js, use the crypto module's hash function
        else {
            const hash = crypto.createHash("sha256").update(data).digest();
            return hash.toString("base64url");
        }
    }

    #createFeatureFlagReference(setting: ConfigurationSetting<string>): string {
        let featureFlagReference = `${this.#clientManager.endpoint}/kv/${setting.key}`;
        if (setting.label && setting.label.trim().length !== 0) {
            featureFlagReference += `?label=${setting.label}`;
        }
        return featureFlagReference;
    }
}

function getValidSelectors(selectors: SettingSelector[]): SettingSelector[] {
    // below code deduplicates selectors by keyFilter and labelFilter, the latter selector wins
    const uniqueSelectors: SettingSelector[] = [];
    for (const selector of selectors) {
        const existingSelectorIndex = uniqueSelectors.findIndex(s => s.keyFilter === selector.keyFilter && s.labelFilter === selector.labelFilter);
        if (existingSelectorIndex >= 0) {
            uniqueSelectors.splice(existingSelectorIndex, 1);
        }
        uniqueSelectors.push(selector);
    }

    return uniqueSelectors.map(selectorCandidate => {
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

function getValidKeyValueSelectors(selectors?: SettingSelector[]): SettingSelector[] {
    if (!selectors || selectors.length === 0) {
        // Default selector: key: *, label: \0
        return [{ keyFilter: KeyFilter.Any, labelFilter: LabelFilter.Null }];
    }
    return getValidSelectors(selectors);
}

function getValidFeatureFlagSelectors(selectors?: SettingSelector[]): SettingSelector[] {
    if (!selectors || selectors.length === 0) {
        // selectors must be explicitly provided.
        throw new Error("Feature flag selectors must be provided.");
    } else {
        return getValidSelectors(selectors);
    }
}

function isFailoverableError(error: any): boolean {
    return isRestError(error) && (error.statusCode === 408 || error.statusCode === 429 || (error.statusCode !== undefined && error.statusCode >= 500));
}
