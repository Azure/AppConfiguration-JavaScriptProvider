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
    isSecretReference,
    GetSnapshotOptions,
    GetSnapshotResponse,
    KnownSnapshotComposition
} from "@azure/app-configuration";
import { isRestError } from "@azure/core-rest-pipeline";
import { AzureAppConfiguration, ConfigurationObjectConstructionOptions } from "./AzureAppConfiguration.js";
import { AzureAppConfigurationOptions } from "./AzureAppConfigurationOptions.js";
import { IKeyValueAdapter } from "./IKeyValueAdapter.js";
import { JsonKeyValueAdapter } from "./JsonKeyValueAdapter.js";
import { DEFAULT_STARTUP_TIMEOUT_IN_MS } from "./StartupOptions.js";
import { DEFAULT_REFRESH_INTERVAL_IN_MS, MIN_REFRESH_INTERVAL_IN_MS } from "./refresh/refreshOptions.js";
import { Disposable } from "./common/disposable.js";
import { base64Helper, jsonSorter, getCryptoModule } from "./common/utils.js";
import {
    FEATURE_FLAGS_KEY_NAME,
    FEATURE_MANAGEMENT_KEY_NAME,
    NAME_KEY_NAME,
    TELEMETRY_KEY_NAME,
    ENABLED_KEY_NAME,
    METADATA_KEY_NAME,
    ETAG_KEY_NAME,
    FEATURE_FLAG_REFERENCE_KEY_NAME,
    ALLOCATION_ID_KEY_NAME,
    ALLOCATION_KEY_NAME,
    DEFAULT_WHEN_ENABLED_KEY_NAME,
    PERCENTILE_KEY_NAME,
    FROM_KEY_NAME,
    TO_KEY_NAME,
    SEED_KEY_NAME,
    VARIANT_KEY_NAME,
    VARIANTS_KEY_NAME,
    CONFIGURATION_VALUE_KEY_NAME,
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
import { ETAG_LOOKUP_HEADER } from "./EtagUrlPipelinePolicy.js";
import { getFixedBackoffDuration, getExponentialBackoffDuration } from "./common/backoffUtils.js";
import { InvalidOperationError, ArgumentError, isFailoverableError, isInputError } from "./common/error.js";

const MIN_DELAY_FOR_UNHANDLED_FAILURE = 5_000; // 5 seconds

type PagedSettingSelector = SettingSelector & {
    pageEtags?: string[];
};

type SettingSelectorCollection = {
    selectors: PagedSettingSelector[];

    /**
     * This is used to append to the request url for breaking the CDN cache.
     * It uses the etag which has changed after the last refresh.
     * It can either be the page etag or etag of a watched setting depending on the refresh monitoring strategy.
     * When a watched setting is deleted, the token value will be SHA-256 hash of `ResourceDeleted\n{previous-etag}`.
     */
    cdnCacheConsistencyToken?: string;
}

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

    // Key Vault references
    #resolveSecretsInParallel: boolean = false;

    /**
     * Selectors of key-values obtained from @see AzureAppConfigurationOptions.selectors
     */
    #kvSelectorCollection: SettingSelectorCollection = { selectors: [] };
    /**
     * Selectors of feature flags obtained from @see AzureAppConfigurationOptions.featureFlagOptions.selectors
     */
    #ffSelectorCollection: SettingSelectorCollection = { selectors: [] };

    // Load balancing
    #lastSuccessfulEndpoint: string = "";

    // CDN
    #isCdnUsed: boolean;

    constructor(
        clientManager: ConfigurationClientManager,
        options: AzureAppConfigurationOptions | undefined,
        isCdnUsed: boolean
    ) {
        this.#options = options;
        this.#isCdnUsed = isCdnUsed;
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

        if (options?.refreshOptions?.enabled) {
            const { refreshIntervalInMs, watchedSettings } = options.refreshOptions;
            if (watchedSettings === undefined || watchedSettings.length === 0) {
                this.#watchAll = true; // if no watched settings is specified, then watch all
            } else {
                for (const setting of watchedSettings) {
                    if (setting.key.includes("*") || setting.key.includes(",")) {
                        throw new ArgumentError("The characters '*' and ',' are not supported in key of watched settings.");
                    }
                    if (setting.label?.includes("*") || setting.label?.includes(",")) {
                        throw new ArgumentError("The characters '*' and ',' are not supported in label of watched settings.");
                    }
                    this.#sentinels.push(setting);
                }
            }

            // custom refresh interval
            if (refreshIntervalInMs !== undefined) {
                if (refreshIntervalInMs < MIN_REFRESH_INTERVAL_IN_MS) {
                    throw new RangeError(`The refresh interval cannot be less than ${MIN_REFRESH_INTERVAL_IN_MS} milliseconds.`);
                } else {
                    this.#kvRefreshInterval = refreshIntervalInMs;
                }
            }
            this.#kvRefreshTimer = new RefreshTimer(this.#kvRefreshInterval);
        }

        // if no selector is specified, always load key values using the default selector: key="*" and label="\0"
        this.#kvSelectorCollection.selectors = getValidKeyValueSelectors(options?.selectors);

        // feature flag options
        if (options?.featureFlagOptions?.enabled) {
            // validate feature flag selectors
            this.#ffSelectorCollection.selectors = getValidFeatureFlagSelectors(options.featureFlagOptions.selectors);

            if (options.featureFlagOptions.refresh?.enabled) {
                const { refreshIntervalInMs } = options.featureFlagOptions.refresh;
                // custom refresh interval
                if (refreshIntervalInMs !== undefined) {
                    if (refreshIntervalInMs < MIN_REFRESH_INTERVAL_IN_MS) {
                        throw new RangeError(`The feature flag refresh interval cannot be less than ${MIN_REFRESH_INTERVAL_IN_MS} milliseconds.`);
                    } else {
                        this.#ffRefreshInterval = refreshIntervalInMs;
                    }
                }

                this.#ffRefreshTimer = new RefreshTimer(this.#ffRefreshInterval);
            }
        }

        if (options?.keyVaultOptions?.parallelSecretResolutionEnabled) {
            this.#resolveSecretsInParallel = options.keyVaultOptions.parallelSecretResolutionEnabled;
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
            isCdnUsed: this.#isCdnUsed,
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
     * @internal
     */
    async load() {
        const startTimestamp = Date.now();
        const startupTimeout: number = this.#options?.startupOptions?.timeoutInMs ?? DEFAULT_STARTUP_TIMEOUT_IN_MS;
        const abortController = new AbortController();
        const abortSignal = abortController.signal;
        let timeoutId;
        try {
            // Promise.race will be settled when the first promise in the list is settled.
            // It will not cancel the remaining promises in the list.
            // To avoid memory leaks, we must ensure other promises will be eventually terminated.
            await Promise.race([
                this.#initializeWithRetryPolicy(abortSignal),
                // this promise will be rejected after timeout
                new Promise((_, reject) => {
                    timeoutId = setTimeout(() => {
                        abortController.abort(); // abort the initialization promise
                        reject(new Error("Load operation timed out."));
                    },
                    startupTimeout);
                })
            ]);
        } catch (error) {
            if (!isInputError(error)) {
                const timeElapsed = Date.now() - startTimestamp;
                if (timeElapsed < MIN_DELAY_FOR_UNHANDLED_FAILURE) {
                    // load() method is called in the application's startup code path.
                    // Unhandled exceptions cause application crash which can result in crash loops as orchestrators attempt to restart the application.
                    // Knowing the intended usage of the provider in startup code path, we mitigate back-to-back crash loops from overloading the server with requests by waiting a minimum time to propagate fatal errors.
                    await new Promise(resolve => setTimeout(resolve, MIN_DELAY_FOR_UNHANDLED_FAILURE - timeElapsed));
                }
            }
            throw new Error("Failed to load.", { cause: error });
        } finally {
            clearTimeout(timeoutId); // cancel the timeout promise
        }
    }

    /**
     * Constructs hierarchical data object from map.
     */
    constructConfigurationObject(options?: ConfigurationObjectConstructionOptions): Record<string, any> {
        const separator = options?.separator ?? ".";
        const validSeparators = [".", ",", ";", "-", "_", "__", "/", ":"];
        if (!validSeparators.includes(separator)) {
            throw new ArgumentError(`Invalid separator '${separator}'. Supported values: ${validSeparators.map(s => `'${s}'`).join(", ")}.`);
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
                    throw new InvalidOperationError(`Failed to construct configuration object: Invalid key: ${key}`);
                }
                // create path if not exist
                if (current[segment] === undefined) {
                    current[segment] = {};
                }
                // The path has been occupied by a non-object value, causing ambiguity.
                if (typeof current[segment] !== "object") {
                    throw new InvalidOperationError(`Ambiguity occurs when constructing configuration object from key '${key}', value '${value}'. The path '${segments.slice(0, i + 1).join(separator)}' has been occupied.`);
                }
                current = current[segment];
            }

            const lastSegment = segments[segments.length - 1];
            if (current[lastSegment] !== undefined) {
                throw new InvalidOperationError(`Ambiguity occurs when constructing configuration object from key '${key}', value '${value}'. The key should not be part of another key.`);
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
            throw new InvalidOperationError("Refresh is not enabled for key-values or feature flags.");
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
            throw new InvalidOperationError("Refresh is not enabled for key-values or feature flags.");
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
     * Initializes the configuration provider.
     */
    async #initializeWithRetryPolicy(abortSignal: AbortSignal): Promise<void> {
        if (!this.#isInitialLoadCompleted) {
            await this.#inspectFmPackage();
            const startTimestamp = Date.now();
            let postAttempts = 0;
            do { // at least try to load once
                try {
                    await this.#loadSelectedAndWatchedKeyValues();
                    if (this.#featureFlagEnabled) {
                        await this.#loadFeatureFlags();
                    }
                    this.#isInitialLoadCompleted = true;
                    break;
                } catch (error) {
                    if (isInputError(error)) {
                        throw error;
                    }
                    if (abortSignal.aborted) {
                        return;
                    }
                    const timeElapsed = Date.now() - startTimestamp;
                    let backoffDuration = getFixedBackoffDuration(timeElapsed);
                    if (backoffDuration === undefined) {
                        postAttempts += 1;
                        backoffDuration = getExponentialBackoffDuration(postAttempts);
                    }
                    console.warn(`Failed to load. Error message: ${error.message}. Retrying in ${backoffDuration} ms.`);
                    await new Promise(resolve => setTimeout(resolve, backoffDuration));
                }
            } while (!abortSignal.aborted);
        }
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
        const selectorCollection = loadFeatureFlag ? this.#ffSelectorCollection : this.#kvSelectorCollection;
        const funcToExecute = async (client) => {
            const loadedSettings: ConfigurationSetting[] = [];
            // deep copy selectors to avoid modification if current client fails
            const selectorsToUpdate: PagedSettingSelector[] = JSON.parse(
                JSON.stringify(selectorCollection.selectors)
            );
            for (const selector of selectorsToUpdate) {
                if (selector.snapshotName === undefined) {
                    let listOptions: ListConfigurationSettingsOptions = {
                        keyFilter: selector.keyFilter,
                        labelFilter: selector.labelFilter
                    };

                    // If CDN is used, add etag to request header so that the pipeline policy can retrieve and append it to the request URL
                    if (this.#isCdnUsed && selectorCollection.cdnCacheConsistencyToken) {
                        listOptions = {
                            ...listOptions,
                            requestOptions: { customHeaders: { [ETAG_LOOKUP_HEADER]: selectorCollection.cdnCacheConsistencyToken }}
                        };
                    }
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

                    if (pageEtags.length === 0) {
                        console.warn(`No page is found in the response of listing key-value selector: key=${selector.keyFilter} and label=${selector.labelFilter}.`);
                    }

                    selector.pageEtags = pageEtags;
                } else { // snapshot selector
                    const snapshot = await this.#getSnapshot(selector.snapshotName);
                    if (snapshot === undefined) {
                        throw new InvalidOperationError(`Could not find snapshot with name ${selector.snapshotName}.`);
                    }
                    if (snapshot.compositionType != KnownSnapshotComposition.Key) {
                        throw new InvalidOperationError(`Composition type for the selected snapshot with name ${selector.snapshotName} must be 'key'.`);
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

            selectorCollection.selectors = selectorsToUpdate;
            return loadedSettings;
        };

        return await this.#executeWithFailoverPolicy(funcToExecute) as ConfigurationSetting[];
    }

    /**
     * Loads selected key-values and watched settings (sentinels) for refresh from App Configuration to the local configuration.
     */
    async #loadSelectedAndWatchedKeyValues() {
        const keyValues: [key: string, value: unknown][] = [];
        const loadedSettings: ConfigurationSetting[] = await this.#loadConfigurationSettings();
        if (this.#refreshEnabled && !this.#watchAll) {
            await this.#updateWatchedKeyValuesEtag(loadedSettings);
        }

        if (this.#requestTracingEnabled && this.#aiConfigurationTracing !== undefined) {
            // Reset old AI configuration tracing in order to track the information present in the current response from server.
            this.#aiConfigurationTracing.reset();
        }

        const secretResolutionPromises: Promise<void>[] = [];
        for (const setting of loadedSettings) {
            if (this.#resolveSecretsInParallel && isSecretReference(setting)) {
                // secret references are resolved asynchronously to improve performance
                const secretResolutionPromise = this.#processKeyValue(setting)
                    .then(([key, value]) => {
                        keyValues.push([key, value]);
                    });
                secretResolutionPromises.push(secretResolutionPromise);
                continue;
            }
            // adapt configuration settings to key-values
            const [key, value] = await this.#processKeyValue(setting);
            keyValues.push([key, value]);
        }
        if (secretResolutionPromises.length > 0) {
            // wait for all secret resolution promises to be resolved
            await Promise.all(secretResolutionPromises);
        }

        this.#clearLoadedKeyValues(); // clear existing key-values in case of configuration setting deletion
        for (const [k, v] of keyValues) {
            this.#configMap.set(k, v); // reset the configuration
        }
    }

    /**
     * Updates etag of watched settings from loaded data.
     * If a watched setting is not covered by any selector, a request will be sent to retrieve it.
     * If there is no watched setting(sentinel key), this method does nothing.
     */
    async #updateWatchedKeyValuesEtag(loadedSettings: ConfigurationSetting[]): Promise<void> {
        for (const sentinel of this.#sentinels) {
            const loaded = loadedSettings.find(s => s.key === sentinel.key && s.label === sentinel.label);
            if (loaded) {
                sentinel.etag = loaded.etag;
            } else {
                // Send a request to retrieve watched key-value since it may be either not loaded or loaded with a different selector
                // If CDN is used, add etag to request header so that the pipeline policy can retrieve and append it to the request URL
                let getOptions: GetConfigurationSettingOptions = {};
                if (this.#isCdnUsed && this.#kvSelectorCollection.cdnCacheConsistencyToken) {
                    getOptions = { requestOptions: { customHeaders: { [ETAG_LOOKUP_HEADER]: this.#kvSelectorCollection.cdnCacheConsistencyToken } } };
                }
                const response = await this.#getConfigurationSetting(sentinel, getOptions);
                sentinel.etag = response?.etag;
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
        const featureFlagSettings: ConfigurationSetting[] = await this.#loadConfigurationSettings(loadFeatureFlag);

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
            needRefresh = await this.#checkConfigurationSettingsChange(this.#kvSelectorCollection);
        }
        // if watchAll is true, there should be no sentinels
        for (const sentinel of this.#sentinels.values()) {
            // if CDN is used, add etag to request header so that the pipeline policy can retrieve and append it to the request URL
            let getOptions: GetConfigurationSettingOptions = {};
            if (this.#isCdnUsed && this.#kvSelectorCollection.cdnCacheConsistencyToken) {
                // if CDN is used, add etag to request header so that the pipeline policy can retrieve and append it to the request URL
                getOptions = {
                    requestOptions: { customHeaders: { [ETAG_LOOKUP_HEADER]: this.#kvSelectorCollection.cdnCacheConsistencyToken ?? "" } },
                };
            }
            // send conditional request only when CDN is not used
            const response = await this.#getConfigurationSetting(sentinel, { ...getOptions, onlyIfChanged: !this.#isCdnUsed });

            if ((response?.statusCode === 200 && sentinel.etag !== response?.etag) ||
                (response === undefined && sentinel.etag !== undefined) // deleted
            ) {
                if (response === undefined) {
                    this.#kvSelectorCollection.cdnCacheConsistencyToken =
                        await this.#calculateResourceDeletedCacheConsistencyToken(sentinel.etag!);
                } else {
                    this.#kvSelectorCollection.cdnCacheConsistencyToken = response.etag;
                }
                sentinel.etag = response?.etag; // update etag of the sentinel
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

        const needRefresh = await this.#checkConfigurationSettingsChange(this.#ffSelectorCollection);
        if (needRefresh) {
            await this.#loadFeatureFlags();
        }

        this.#ffRefreshTimer.reset();
        return Promise.resolve(needRefresh);
    }

    /**
     * Checks whether the key-value collection has changed.
     * @param selectorCollection - The @see SettingSelectorCollection of the kev-value collection.
     * @returns true if key-value collection has changed, false otherwise.
     */
    async #checkConfigurationSettingsChange(selectorCollection: SettingSelectorCollection): Promise<boolean> {
        const funcToExecute = async (client) => {
            for (const selector of selectorCollection.selectors) {
                if (selector.snapshotName) { // skip snapshot selector
                    continue;
                }
                let listOptions: ListConfigurationSettingsOptions = {
                    keyFilter: selector.keyFilter,
                    labelFilter: selector.labelFilter
                };

                if (!this.#isCdnUsed) {
                    // if CDN is not used, add page etags to the listOptions to send conditional request
                    listOptions = {
                        ...listOptions,
                        pageEtags: selector.pageEtags
                    };
                } else if (selectorCollection.cdnCacheConsistencyToken) {
                    // If CDN is used, add etag to request header so that the pipeline policy can retrieve and append it to the request URL
                    listOptions = {
                        ...listOptions,
                        requestOptions: { customHeaders: { [ETAG_LOOKUP_HEADER]: selectorCollection.cdnCacheConsistencyToken } }
                    };
                }

                const pageIterator = listConfigurationSettingsWithTrace(
                    this.#requestTraceOptions,
                    client,
                    listOptions
                ).byPage();

                if (selector.pageEtags === undefined || selector.pageEtags.length === 0) {
                    return true; // no etag is retrieved from previous request, always refresh
                }

                let i = 0;
                for await (const page of pageIterator) {
                    if (i >= selector.pageEtags.length || // new page
                        (page._response.status === 200 && page.etag !== selector.pageEtags[i])) { // page changed
                        // 100 kvs will return two pages, one page with 100 items and another empty page
                        // kv collection change will always be detected by page etag change
                        if (this.#isCdnUsed) {
                            selectorCollection.cdnCacheConsistencyToken = page.etag;
                        }
                        return true;
                    }
                    i++;
                }
                if (i !== selector.pageEtags.length) { // page removed
                    if (this.#isCdnUsed) {
                        selectorCollection.cdnCacheConsistencyToken = selector.pageEtags[i];
                    }
                    return true;
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

    // Only operations related to Azure App Configuration should be executed with failover policy.
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
        throw new Error("All fallback clients failed to get configuration settings.");
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
            throw new ArgumentError("The value of configuration setting cannot be undefined.");
        }
        const featureFlag = JSON.parse(rawFlag);

        if (featureFlag[TELEMETRY_KEY_NAME] && featureFlag[TELEMETRY_KEY_NAME][ENABLED_KEY_NAME] === true) {
            const metadata = featureFlag[TELEMETRY_KEY_NAME][METADATA_KEY_NAME];
            let allocationId = "";
            if (featureFlag[ALLOCATION_KEY_NAME] !== undefined) {
                allocationId = await this.#generateAllocationId(featureFlag);
            }
            featureFlag[TELEMETRY_KEY_NAME][METADATA_KEY_NAME] = {
                [ETAG_KEY_NAME]: setting.etag,
                [FEATURE_FLAG_REFERENCE_KEY_NAME]: this.#createFeatureFlagReference(setting),
                ...(allocationId !== "" && { [ALLOCATION_ID_KEY_NAME]: allocationId }),
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

    async #generateAllocationId(featureFlag: any): Promise<string> {
        let rawAllocationId = "";
        // Only default variant when enabled and variants allocated by percentile involve in the experimentation
        // The allocation id is genearted from default variant when enabled and percentile allocation
        const variantsForExperimentation: string[] = [];

        rawAllocationId += `seed=${featureFlag[ALLOCATION_KEY_NAME][SEED_KEY_NAME] ?? ""}\ndefault_when_enabled=`;

        if (featureFlag[ALLOCATION_KEY_NAME][DEFAULT_WHEN_ENABLED_KEY_NAME]) {
            variantsForExperimentation.push(featureFlag[ALLOCATION_KEY_NAME][DEFAULT_WHEN_ENABLED_KEY_NAME]);
            rawAllocationId += `${featureFlag[ALLOCATION_KEY_NAME][DEFAULT_WHEN_ENABLED_KEY_NAME]}`;
        }

        rawAllocationId += "\npercentiles=";

        const percentileList = featureFlag[ALLOCATION_KEY_NAME][PERCENTILE_KEY_NAME];
        if (percentileList) {
            const sortedPercentileList = percentileList
                .filter(p =>
                    (p[FROM_KEY_NAME] !== undefined) &&
                    (p[TO_KEY_NAME] !== undefined) &&
                    (p[VARIANT_KEY_NAME] !== undefined) &&
                    (p[FROM_KEY_NAME] !== p[TO_KEY_NAME]))
                .sort((a, b) => a[FROM_KEY_NAME] - b[FROM_KEY_NAME]);

            const percentileAllocation: string[] = [];
            for (const percentile of sortedPercentileList) {
                variantsForExperimentation.push(percentile[VARIANT_KEY_NAME]);
                percentileAllocation.push(`${percentile[FROM_KEY_NAME]},${base64Helper(percentile[VARIANT_KEY_NAME])},${percentile[TO_KEY_NAME]}`);
            }
            rawAllocationId += percentileAllocation.join(";");
        }

        if (variantsForExperimentation.length === 0 && featureFlag[ALLOCATION_KEY_NAME][SEED_KEY_NAME] === undefined) {
            // All fields required for generating allocation id are missing, short-circuit and return empty string
            return "";
        }

        rawAllocationId += "\nvariants=";

        if (variantsForExperimentation.length !== 0) {
            const variantsList = featureFlag[VARIANTS_KEY_NAME];
            if (variantsList) {
                const sortedVariantsList = variantsList
                    .filter(v =>
                        (v[NAME_KEY_NAME] !== undefined) &&
                        variantsForExperimentation.includes(v[NAME_KEY_NAME]))
                    .sort((a, b) => (a.name > b.name ? 1 : -1));

                    const variantConfiguration: string[] = [];
                    for (const variant of sortedVariantsList) {
                        const configurationValue = JSON.stringify(variant[CONFIGURATION_VALUE_KEY_NAME], jsonSorter) ?? "";
                        variantConfiguration.push(`${base64Helper(variant[NAME_KEY_NAME])},${configurationValue}`);
                    }
                    rawAllocationId += variantConfiguration.join(";");
            }
        }

        const crypto = getCryptoModule();
        // Convert to UTF-8 encoded bytes
        const payload = new TextEncoder().encode(rawAllocationId);
        // In the browser or Node.js 18+, use crypto.subtle.digest
        if (crypto.subtle) {
            const hashBuffer = await crypto.subtle.digest("SHA-256", payload);
            const hashArray = new Uint8Array(hashBuffer);

            // Only use the first 15 bytes
            const first15Bytes = hashArray.slice(0, 15);
            const base64String = btoa(String.fromCharCode(...first15Bytes));
            const base64urlString = base64String.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
            return base64urlString;
        }
        // Use the crypto module's hash function
        else {
            const hash = crypto.createHash("sha256").update(payload).digest();

            // Only use the first 15 bytes
            const first15Bytes = hash.slice(0, 15);
            return first15Bytes.toString("base64url");
        }
    }

    async #calculateResourceDeletedCacheConsistencyToken(etag: string): Promise<string> {
        const crypto = getCryptoModule();
        const rawString = `ResourceDeleted\n${etag}`;
        const payload = new TextEncoder().encode(rawString);
         // In the browser or Node.js 18+, use crypto.subtle.digest
        if (crypto.subtle) {
            const hashBuffer = await crypto.subtle.digest("SHA-256", payload);
            const hashArray = new Uint8Array(hashBuffer);
            const base64String = btoa(String.fromCharCode(...hashArray));
            const base64urlString = base64String.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
            return base64urlString;
        }
        // Use the crypto module's hash function
        else {
            const hash = crypto.createHash("sha256").update(payload).digest();
            return hash.toString("base64url");
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
            if (selector.keyFilter || selector.labelFilter) {
                throw new ArgumentError("Key or label filter should not be used for a snapshot.");
            }
        } else {
            if (!selector.keyFilter) {
                throw new ArgumentError("Key filter cannot be null or empty.");
            }
            if (!selector.labelFilter) {
                selector.labelFilter = LabelFilter.Null;
            }
            if (selector.labelFilter.includes("*") || selector.labelFilter.includes(",")) {
                throw new ArgumentError("The characters '*' and ',' are not supported in label filters.");
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
        if (selector.keyFilter) {
            selector.keyFilter = `${featureFlagPrefix}${selector.keyFilter}`;
        }
    });
    return getValidSettingSelectors(selectors);
}
