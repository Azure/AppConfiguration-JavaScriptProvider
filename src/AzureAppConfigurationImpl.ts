// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
    AppConfigurationClient,
    ConfigurationSetting,
    ConfigurationSettingId,
    GetConfigurationSettingOptions,
    GetConfigurationSettingResponse,
    ListConfigurationSettingsOptions,
    featureFlagPrefix,
    isFeatureFlag,
    GetSnapshotOptions,
    GetSnapshotResponse,
    KnownSnapshotComposition
} from "@azure/app-configuration";
import { isRestError } from "@azure/core-rest-pipeline";
import { AzureAppConfiguration, ConfigurationObjectConstructionOptions } from "./AzureAppConfiguration.js";
import { AzureAppConfigurationOptions } from "./AzureAppConfigurationOptions.js";
import { IKeyValueAdapter } from "./IKeyValueAdapter.js";
import { JsonKeyValueAdapter } from "./JsonKeyValueAdapter.js";
import { DEFAULT_REFRESH_INTERVAL_IN_MS, MIN_REFRESH_INTERVAL_IN_MS } from "./RefreshOptions.js";
import { Disposable } from "./common/disposable.js";
import {
    FEATURE_FLAGS_KEY_NAME,
    FEATURE_MANAGEMENT_KEY_NAME,
    NAME_KEY_NAME,
    TELEMETRY_KEY_NAME,
    ENABLED_KEY_NAME,
    METADATA_KEY_NAME,
    ETAG_KEY_NAME,
    FEATURE_FLAG_REFERENCE_KEY_NAME,
    ALLOCATION_KEY_NAME,
    SEED_KEY_NAME,
    VARIANTS_KEY_NAME,
    CONDITIONS_KEY_NAME,
    CLIENT_FILTERS_KEY_NAME
} from "./featureManagement/constants.js";
import { FM_PACKAGE_NAME, AI_MIME_PROFILE, AI_CHAT_COMPLETION_MIME_PROFILE } from "./requestTracing/constants.js";
import { parseContentType, isJsonContentType, isFeatureFlagContentType, isSecretReferenceContentType } from "./common/contentType.js";
import { AzureKeyVaultKeyValueAdapter } from "./keyvault/AzureKeyVaultKeyValueAdapter.js";
import { RefreshTimer } from "./refresh/RefreshTimer.js";
import {
    RequestTracingOptions,
    getConfigurationSettingWithTrace,
    listConfigurationSettingsWithTrace,
    getSnapshotWithTrace,
    listConfigurationSettingsForSnapshotWithTrace,
    requestTracingEnabled
} from "./requestTracing/utils.js";
import { FeatureFlagTracingOptions } from "./requestTracing/FeatureFlagTracingOptions.js";
import { AIConfigurationTracingOptions } from "./requestTracing/AIConfigurationTracingOptions.js";
import { KeyFilter, LabelFilter, SettingSelector } from "./types.js";
import { ConfigurationClientManager } from "./ConfigurationClientManager.js";

const MAX_TAG_FILTERS = 5;

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
    #featureFlagTracing: FeatureFlagTracingOptions | undefined;
    #fmVersion: string | undefined;
    #aiConfigurationTracing: AIConfigurationTracingOptions | undefined;

    // Refresh
    #refreshInProgress: boolean = false;

    #onRefreshListeners: Array<() => any> = [];
    /**
     * Aka watched settings.
     */
    #sentinels: ConfigurationSettingId[] = [];
    #watchAll: boolean = false;
    #kvRefreshInterval: number = DEFAULT_REFRESH_INTERVAL_IN_MS;
    #kvRefreshTimer: RefreshTimer;

    // Feature flags
    #ffRefreshInterval: number = DEFAULT_REFRESH_INTERVAL_IN_MS;
    #ffRefreshTimer: RefreshTimer;

    /**
     * Selectors of key-values obtained from @see AzureAppConfigurationOptions.selectors
     */
    #kvSelectors: PagedSettingSelector[] = [];
    /**
     * Selectors of feature flags obtained from @see AzureAppConfigurationOptions.featureFlagOptions.selectors
     */
    #ffSelectors: PagedSettingSelector[] = [];

    // Load balancing
    #lastSuccessfulEndpoint: string = "";

    constructor(
        clientManager: ConfigurationClientManager,
        options: AzureAppConfigurationOptions | undefined,
    ) {
        this.#options = options;
        this.#clientManager = clientManager;

        // enable request tracing if not opt-out
        this.#requestTracingEnabled = requestTracingEnabled();
        if (this.#requestTracingEnabled) {
            this.#aiConfigurationTracing = new AIConfigurationTracingOptions();
            this.#featureFlagTracing = new FeatureFlagTracingOptions();
        }

        if (options?.trimKeyPrefixes) {
            this.#sortedTrimKeyPrefixes = [...options.trimKeyPrefixes].sort((a, b) => b.localeCompare(a));
        }

        // if no selector is specified, always load key values using the default selector: key="*" and label="\0"
        this.#kvSelectors = getValidKeyValueSelectors(options?.selectors);

        if (options?.refreshOptions?.enabled) {
            const { refreshIntervalInMs, watchedSettings } = options.refreshOptions;
            if (watchedSettings === undefined || watchedSettings.length === 0) {
                this.#watchAll = true; // if no watched settings is specified, then watch all
            } else {
                for (const setting of watchedSettings) {
                    if (setting.key.includes("*") || setting.key.includes(",")) {
                        throw new Error("The characters '*' and ',' are not supported in key of watched settings.");
                    }
                    if (setting.label?.includes("*") || setting.label?.includes(",")) {
                        throw new Error("The characters '*' and ',' are not supported in label of watched settings.");
                    }
                    this.#sentinels.push(setting);
                }
            }

            // custom refresh interval
            if (refreshIntervalInMs !== undefined) {
                if (refreshIntervalInMs < MIN_REFRESH_INTERVAL_IN_MS) {
                    throw new Error(`The refresh interval cannot be less than ${MIN_REFRESH_INTERVAL_IN_MS} milliseconds.`);
                } else {
                    this.#kvRefreshInterval = refreshIntervalInMs;
                }
            }
            this.#kvRefreshTimer = new RefreshTimer(this.#kvRefreshInterval);
        }

        // feature flag options
        if (options?.featureFlagOptions?.enabled) {
            // validate feature flag selectors, only load feature flags when enabled
            this.#ffSelectors = getValidFeatureFlagSelectors(options.featureFlagOptions.selectors);

            if (options.featureFlagOptions.refresh?.enabled) {
                const { refreshIntervalInMs } = options.featureFlagOptions.refresh;
                // custom refresh interval
                if (refreshIntervalInMs !== undefined) {
                    if (refreshIntervalInMs < MIN_REFRESH_INTERVAL_IN_MS) {
                        throw new Error(`The feature flag refresh interval cannot be less than ${MIN_REFRESH_INTERVAL_IN_MS} milliseconds.`);
                    } else {
                        this.#ffRefreshInterval = refreshIntervalInMs;
                    }
                }

                this.#ffRefreshTimer = new RefreshTimer(this.#ffRefreshInterval);
            }
        }

        this.#adapters.push(new AzureKeyVaultKeyValueAdapter(options?.keyVaultOptions));
        this.#adapters.push(new JsonKeyValueAdapter());
    }

    get #refreshEnabled(): boolean {
        return !!this.#options?.refreshOptions?.enabled;
    }

    get #featureFlagEnabled(): boolean {
        return !!this.#options?.featureFlagOptions?.enabled;
    }

    get #featureFlagRefreshEnabled(): boolean {
        return this.#featureFlagEnabled && !!this.#options?.featureFlagOptions?.refresh?.enabled;
    }

    get #requestTraceOptions(): RequestTracingOptions {
        return {
            enabled: this.#requestTracingEnabled,
            appConfigOptions: this.#options,
            initialLoadCompleted: this.#isInitialLoadCompleted,
            replicaCount: this.#clientManager.getReplicaCount(),
            isFailoverRequest: this.#isFailoverRequest,
            featureFlagTracing: this.#featureFlagTracing,
            fmVersion: this.#fmVersion,
            aiConfigurationTracing: this.#aiConfigurationTracing
        };
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

    /**
     * Loads the configuration store for the first time.
     */
    async load() {
        await this.#inspectFmPackage();
        await this.#loadSelectedAndWatchedKeyValues();
        if (this.#featureFlagEnabled) {
            await this.#loadFeatureFlags();
        }
        // Mark all settings have loaded at startup.
        this.#isInitialLoadCompleted = true;
    }

    /**
     * Constructs hierarchical data object from map.
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
     * Refreshes the configuration.
     */
    async refresh(): Promise<void> {
        if (!this.#refreshEnabled && !this.#featureFlagRefreshEnabled) {
            throw new Error("Refresh is not enabled for key-values or feature flags.");
        }

        if (this.#refreshInProgress) {
            return;
        }
        this.#refreshInProgress = true;
        try {
            await this.#refreshTasks();
        } finally {
            this.#refreshInProgress = false;
        }
    }

    /**
     * Registers a callback function to be called when the configuration is refreshed.
     */
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

    /**
     * Inspects the feature management package version.
     */
    async #inspectFmPackage() {
        if (this.#requestTracingEnabled && !this.#fmVersion) {
            try {
                // get feature management package version
                const fmPackage = await import(FM_PACKAGE_NAME);
                this.#fmVersion = fmPackage?.VERSION;
            } catch (error) {
                // ignore the error
            }
        }
    }

    async #refreshTasks(): Promise<void> {
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
                console.warn("Refresh failed:", result.reason);
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
     * Loads configuration settings from App Configuration, either key-value settings or feature flag settings.
     * Additionally, updates the `pageEtags` property of the corresponding @see PagedSettingSelector after loading.
     *
     * @param loadFeatureFlag - Determines which type of configurationsettings to load:
     *                          If true, loads feature flag using the feature flag selectors;
     *                          If false, loads key-value using the key-value selectors. Defaults to false.
     */
    async #loadConfigurationSettings(loadFeatureFlag: boolean = false): Promise<ConfigurationSetting[]> {
        const selectors = loadFeatureFlag ? this.#ffSelectors : this.#kvSelectors;
        const funcToExecute = async (client) => {
            const loadedSettings: ConfigurationSetting[] = [];
            // deep copy selectors to avoid modification if current client fails
            const selectorsToUpdate = JSON.parse(
                JSON.stringify(selectors)
            );

            for (const selector of selectorsToUpdate) {
                if (selector.snapshotName === undefined) {
                    const listOptions: ListConfigurationSettingsOptions = {
                        keyFilter: selector.keyFilter,
                        labelFilter: selector.labelFilter,
                        tagsFilter: selector.tagFilters
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
                            if (loadFeatureFlag === isFeatureFlag(setting)) {
                                loadedSettings.push(setting);
                            }
                        }
                    }
                    selector.pageEtags = pageEtags;
                } else { // snapshot selector
                    const snapshot = await this.#getSnapshot(selector.snapshotName);
                    if (snapshot === undefined) {
                        throw new Error(`Could not find snapshot with name ${selector.snapshotName}.`);
                    }
                    if (snapshot.compositionType != KnownSnapshotComposition.Key) {
                        throw new Error(`Composition type for the selected snapshot with name ${selector.snapshotName} must be 'key'.`);
                    }
                    const pageIterator = listConfigurationSettingsForSnapshotWithTrace(
                        this.#requestTraceOptions,
                        client,
                        selector.snapshotName
                    ).byPage();

                    for await (const page of pageIterator) {
                        for (const setting of page.items) {
                            if (loadFeatureFlag === isFeatureFlag(setting)) {
                                loadedSettings.push(setting);
                            }
                        }
                    }
                }
            }

            if (loadFeatureFlag) {
                this.#ffSelectors = selectorsToUpdate;
            } else {
                this.#kvSelectors = selectorsToUpdate;
            }
            return loadedSettings;
        };

        return await this.#executeWithFailoverPolicy(funcToExecute) as ConfigurationSetting[];
    }

    /**
     * Loads selected key-values and watched settings (sentinels) for refresh from App Configuration to the local configuration.
     */
    async #loadSelectedAndWatchedKeyValues() {
        const keyValues: [key: string, value: unknown][] = [];
        const loadedSettings = await this.#loadConfigurationSettings();
        if (this.#refreshEnabled && !this.#watchAll) {
            await this.#updateWatchedKeyValuesEtag(loadedSettings);
        }

        if (this.#requestTracingEnabled && this.#aiConfigurationTracing !== undefined) {
            // Reset old AI configuration tracing in order to track the information present in the current response from server.
            this.#aiConfigurationTracing.reset();
        }

        // process key-values, watched settings have higher priority
        for (const setting of loadedSettings) {
            const [key, value] = await this.#processKeyValue(setting);
            keyValues.push([key, value]);
        }

        this.#clearLoadedKeyValues(); // clear existing key-values in case of configuration setting deletion
        for (const [k, v] of keyValues) {
            this.#configMap.set(k, v); // reset the configuration
        }
    }

    /**
     * Updates etag of watched settings from loaded data. If a watched setting is not covered by any selector, a request will be sent to retrieve it.
     */
    async #updateWatchedKeyValuesEtag(existingSettings: ConfigurationSetting[]): Promise<void> {
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

    /**
     * Clears all existing key-values in the local configuration except feature flags.
     */
    async #clearLoadedKeyValues() {
        for (const key of this.#configMap.keys()) {
            if (key !== FEATURE_MANAGEMENT_KEY_NAME) {
                this.#configMap.delete(key);
            }
        }
    }

    /**
     * Loads feature flags from App Configuration to the local configuration.
     */
    async #loadFeatureFlags() {
        const loadFeatureFlag = true;
        const featureFlagSettings = await this.#loadConfigurationSettings(loadFeatureFlag);

        if (this.#requestTracingEnabled && this.#featureFlagTracing !== undefined) {
            // Reset old feature flag tracing in order to track the information present in the current response from server.
            this.#featureFlagTracing.reset();
        }

        // parse feature flags
        const featureFlags = await Promise.all(
            featureFlagSettings.map(setting => this.#parseFeatureFlag(setting))
        );

        // feature_management is a reserved key, and feature_flags is an array of feature flags
        this.#configMap.set(FEATURE_MANAGEMENT_KEY_NAME, { [FEATURE_FLAGS_KEY_NAME]: featureFlags });
    }

    /**
     * Refreshes key-values.
     * @returns true if key-values are refreshed, false otherwise.
     */
    async #refreshKeyValues(): Promise<boolean> {
        // if still within refresh interval/backoff, return
        if (!this.#kvRefreshTimer.canRefresh()) {
            return Promise.resolve(false);
        }

        // try refresh if any of watched settings is changed.
        let needRefresh = false;
        if (this.#watchAll) {
            needRefresh = await this.#checkConfigurationSettingsChange(this.#kvSelectors);
        }
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
            await this.#loadSelectedAndWatchedKeyValues();
        }

        this.#kvRefreshTimer.reset();
        return Promise.resolve(needRefresh);
    }

    /**
     * Refreshes feature flags.
     * @returns true if feature flags are refreshed, false otherwise.
     */
    async #refreshFeatureFlags(): Promise<boolean> {
        // if still within refresh interval/backoff, return
        if (!this.#ffRefreshTimer.canRefresh()) {
            return Promise.resolve(false);
        }

        const needRefresh = await this.#checkConfigurationSettingsChange(this.#ffSelectors);
        if (needRefresh) {
            await this.#loadFeatureFlags();
        }

        this.#ffRefreshTimer.reset();
        return Promise.resolve(needRefresh);
    }

    /**
     * Checks whether the key-value collection has changed.
     * @param selectors - The @see PagedSettingSelector of the kev-value collection.
     * @returns true if key-value collection has changed, false otherwise.
     */
    async #checkConfigurationSettingsChange(selectors: PagedSettingSelector[]): Promise<boolean> {
        const funcToExecute = async (client) => {
            for (const selector of selectors) {
                if (selector.snapshotName) { // skip snapshot selector
                    continue;
                }
                const listOptions: ListConfigurationSettingsOptions = {
                    keyFilter: selector.keyFilter,
                    labelFilter: selector.labelFilter,
                    tagsFilter: selector.tagFilters,
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
            return false;
        };

        const isChanged = await this.#executeWithFailoverPolicy(funcToExecute);
        return isChanged;
    }

    /**
     * Gets a configuration setting by key and label.If the setting is not found, return undefine instead of throwing an error.
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

    async #getSnapshot(snapshotName: string, customOptions?: GetSnapshotOptions): Promise<GetSnapshotResponse | undefined> {
        const funcToExecute = async (client) => {
            return getSnapshotWithTrace(
                this.#requestTraceOptions,
                client,
                snapshotName,
                customOptions
            );
        };

        let response: GetSnapshotResponse | undefined;
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

    async #executeWithFailoverPolicy(funcToExecute: (client: AppConfigurationClient) => Promise<any>): Promise<any> {
        let clientWrappers = await this.#clientManager.getClients();
        if (this.#options?.loadBalancingEnabled && this.#lastSuccessfulEndpoint !== "" && clientWrappers.length > 1) {
            let nextClientIndex = 0;
            // Iterate through clients to find the index of the client with the last successful endpoint
            for (const clientWrapper of clientWrappers) {
                nextClientIndex++;
                if (clientWrapper.endpoint === this.#lastSuccessfulEndpoint) {
                    break;
                }
            }
            // If we found the last successful client, rotate the list so that the next client is at the beginning
            if (nextClientIndex < clientWrappers.length) {
                clientWrappers = [...clientWrappers.slice(nextClientIndex), ...clientWrappers.slice(0, nextClientIndex)];
            }
        }

        let successful: boolean;
        for (const clientWrapper of clientWrappers) {
            successful = false;
            try {
                const result = await funcToExecute(clientWrapper.client);
                this.#isFailoverRequest = false;
                this.#lastSuccessfulEndpoint = clientWrapper.endpoint;
                successful = true;
                clientWrapper.updateBackoffStatus(successful);
                return result;
            } catch (error) {
                if (isFailoverableError(error)) {
                    clientWrapper.updateBackoffStatus(successful);
                    this.#isFailoverRequest = true;
                    continue;
                }

                throw error;
            }
        }

        this.#clientManager.refreshClients();
        throw new Error("All clients failed to get configuration settings.");
    }

    async #processKeyValue(setting: ConfigurationSetting<string>): Promise<[string, unknown]> {
        this.#setAIConfigurationTracing(setting);

        const [key, value] = await this.#processAdapters(setting);
        const trimmedKey = this.#keyWithPrefixesTrimmed(key);
        return [trimmedKey, value];
    }

    #setAIConfigurationTracing(setting: ConfigurationSetting<string>): void {
        if (this.#requestTracingEnabled && this.#aiConfigurationTracing !== undefined) {
            const contentType = parseContentType(setting.contentType);
            // content type: "application/json; profile=\"https://azconfig.io/mime-profiles/ai\"""
            if (isJsonContentType(contentType) &&
                !isFeatureFlagContentType(contentType) &&
                !isSecretReferenceContentType(contentType)) {
                const profile = contentType?.parameters["profile"];
                if (profile === undefined) {
                    return;
                }
                if (profile.includes(AI_MIME_PROFILE)) {
                    this.#aiConfigurationTracing.usesAIConfiguration = true;
                }
                if (profile.includes(AI_CHAT_COMPLETION_MIME_PROFILE)) {
                    this.#aiConfigurationTracing.usesAIChatCompletionConfiguration = true;
                }
            }
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
                [FEATURE_FLAG_REFERENCE_KEY_NAME]: this.#createFeatureFlagReference(setting),
                ...(metadata || {})
            };
        }

        this.#setFeatureFlagTracing(featureFlag);

        return featureFlag;
    }

    #createFeatureFlagReference(setting: ConfigurationSetting<string>): string {
        let featureFlagReference = `${this.#clientManager.endpoint.origin}/kv/${setting.key}`;
        if (setting.label && setting.label.trim().length !== 0) {
            featureFlagReference += `?label=${setting.label}`;
        }
        return featureFlagReference;
    }

    #setFeatureFlagTracing(featureFlag: any): void {
        if (this.#requestTracingEnabled && this.#featureFlagTracing !== undefined) {
            if (featureFlag[CONDITIONS_KEY_NAME] &&
                featureFlag[CONDITIONS_KEY_NAME][CLIENT_FILTERS_KEY_NAME] &&
                Array.isArray(featureFlag[CONDITIONS_KEY_NAME][CLIENT_FILTERS_KEY_NAME])) {
                for (const filter of featureFlag[CONDITIONS_KEY_NAME][CLIENT_FILTERS_KEY_NAME]) {
                    this.#featureFlagTracing.updateFeatureFilterTracing(filter[NAME_KEY_NAME]);
                }
            }
            if (featureFlag[VARIANTS_KEY_NAME] && Array.isArray(featureFlag[VARIANTS_KEY_NAME])) {
                this.#featureFlagTracing.notifyMaxVariants(featureFlag[VARIANTS_KEY_NAME].length);
            }
            if (featureFlag[TELEMETRY_KEY_NAME] && featureFlag[TELEMETRY_KEY_NAME][ENABLED_KEY_NAME]) {
                this.#featureFlagTracing.usesTelemetry = true;
            }
            if (featureFlag[ALLOCATION_KEY_NAME] && featureFlag[ALLOCATION_KEY_NAME][SEED_KEY_NAME]) {
                this.#featureFlagTracing.usesSeed = true;
            }
        }
    }
}

function getValidSettingSelectors(selectors: SettingSelector[]): SettingSelector[] {
    // below code deduplicates selectors, the latter selector wins
    const uniqueSelectors: SettingSelector[] = [];
    for (const selector of selectors) {
        const existingSelectorIndex = uniqueSelectors.findIndex(s => s.keyFilter === selector.keyFilter && s.labelFilter === selector.labelFilter && s.snapshotName === selector.snapshotName);
        if (existingSelectorIndex >= 0) {
            uniqueSelectors.splice(existingSelectorIndex, 1);
        }
        uniqueSelectors.push(selector);
    }

    return uniqueSelectors.map(selectorCandidate => {
        const selector = { ...selectorCandidate };
        if (selector.snapshotName) {
            if (selector.keyFilter || selector.labelFilter || selector.tagFilters) {
                throw new Error("Key, label or tag filter should not be used for a snapshot.");
            }
        } else {
            if (!selector.keyFilter) {
                throw new Error("Key filter cannot be null or empty.");
            }
            if (!selector.labelFilter) {
                selector.labelFilter = LabelFilter.Null;
            }
            if (selector.labelFilter.includes("*") || selector.labelFilter.includes(",")) {
                throw new Error("The characters '*' and ',' are not supported in label filters.");
            }
            if (selector.tagFilters) {
                validateTagFilters(selector.tagFilters);
            }
        }
        return selector;
    });
}

function getValidKeyValueSelectors(selectors?: SettingSelector[]): SettingSelector[] {
    if (selectors === undefined || selectors.length === 0) {
        // Default selector: key: *, label: \0
        return [{ keyFilter: KeyFilter.Any, labelFilter: LabelFilter.Null }];
    }
    return getValidSettingSelectors(selectors);
}

function getValidFeatureFlagSelectors(selectors?: SettingSelector[]): SettingSelector[] {
    if (selectors === undefined || selectors.length === 0) {
        // Default selector: key: *, label: \0
        return [{ keyFilter: `${featureFlagPrefix}${KeyFilter.Any}`, labelFilter: LabelFilter.Null }];
    }
    selectors.forEach(selector => {
        selector.keyFilter = `${featureFlagPrefix}${selector.keyFilter}`;
    });
    return getValidSettingSelectors(selectors);
}

function validateTagFilters(tagFilters: string[]): void {
    if (tagFilters.length > MAX_TAG_FILTERS) {
        throw new Error(`The number of tag filters cannot exceed ${MAX_TAG_FILTERS}.`);
    }
    for (const tagFilter of tagFilters) {
        if (!tagFilter.includes("=")) {
            throw new Error(`Invalid tag filter: ${tagFilter}. Tag filter must follow the format "tagName=tagValue".`);
        }
        const [tagName, tagValue] = tagFilter.split("=");
        if (tagName === "" || tagValue === "") {
            throw new Error(`Invalid tag filter: ${tagFilter}. Tag name and value cannot be empty.`);
        }
    }
}

function isFailoverableError(error: any): boolean {
    // ENOTFOUND: DNS lookup failed, ENOENT: no such file or directory
    return isRestError(error) && (error.code === "ENOTFOUND" || error.code === "ENOENT" ||
        (error.statusCode !== undefined && (error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500)));
}
