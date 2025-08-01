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
import { MIN_SECRET_REFRESH_INTERVAL_IN_MS } from "./keyvault/KeyVaultOptions.js";
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
import { getFixedBackoffDuration, getExponentialBackoffDuration } from "./common/backoffUtils.js";
import { InvalidOperationError, ArgumentError, isFailoverableError, isInputError } from "./common/error.js";

const MIN_DELAY_FOR_UNHANDLED_FAILURE = 5_000; // 5 seconds

type PagedSettingSelector = SettingSelector & {
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
    #refreshEnabled: boolean = false;
    #sentinels: ConfigurationSettingId[] = [];
    #watchAll: boolean = false;
    #kvRefreshInterval: number = DEFAULT_REFRESH_INTERVAL_IN_MS;
    #kvRefreshTimer: RefreshTimer;

    // Feature flags
    #featureFlagEnabled: boolean = false;
    #featureFlagRefreshEnabled: boolean = false;
    #ffRefreshInterval: number = DEFAULT_REFRESH_INTERVAL_IN_MS;
    #ffRefreshTimer: RefreshTimer;

    // Key Vault references
    #secretRefreshEnabled: boolean = false;
    #secretReferences: ConfigurationSetting[] = []; // cached key vault references
    #secretRefreshTimer: RefreshTimer;
    #resolveSecretsInParallel: boolean = false;

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

        if (options?.trimKeyPrefixes !== undefined) {
            this.#sortedTrimKeyPrefixes = [...options.trimKeyPrefixes].sort((a, b) => b.localeCompare(a));
        }

        // if no selector is specified, always load key values using the default selector: key="*" and label="\0"
        this.#kvSelectors = getValidKeyValueSelectors(options?.selectors);

        if (options?.refreshOptions?.enabled === true) {
            this.#refreshEnabled = true;
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
                }
                this.#kvRefreshInterval = refreshIntervalInMs;
            }
            this.#kvRefreshTimer = new RefreshTimer(this.#kvRefreshInterval);
        }

        // feature flag options
        if (options?.featureFlagOptions?.enabled === true) {
            this.#featureFlagEnabled = true;
            // validate feature flag selectors, only load feature flags when enabled
            this.#ffSelectors = getValidFeatureFlagSelectors(options.featureFlagOptions.selectors);

            if (options.featureFlagOptions.refresh?.enabled === true) {
                this.#featureFlagRefreshEnabled = true;
                const { refreshIntervalInMs } = options.featureFlagOptions.refresh;
                // custom refresh interval
                if (refreshIntervalInMs !== undefined) {
                    if (refreshIntervalInMs < MIN_REFRESH_INTERVAL_IN_MS) {
                        throw new RangeError(`The feature flag refresh interval cannot be less than ${MIN_REFRESH_INTERVAL_IN_MS} milliseconds.`);
                    }
                    this.#ffRefreshInterval = refreshIntervalInMs;
                }

                this.#ffRefreshTimer = new RefreshTimer(this.#ffRefreshInterval);
            }
        }

        if (options?.keyVaultOptions !== undefined) {
            const { secretRefreshIntervalInMs } = options.keyVaultOptions;
            if (secretRefreshIntervalInMs !== undefined) {
                if (secretRefreshIntervalInMs < MIN_SECRET_REFRESH_INTERVAL_IN_MS) {
                    throw new RangeError(`The Key Vault secret refresh interval cannot be less than ${MIN_SECRET_REFRESH_INTERVAL_IN_MS} milliseconds.`);
                }
                this.#secretRefreshEnabled = true;
                this.#secretRefreshTimer = new RefreshTimer(secretRefreshIntervalInMs);
            }
            this.#resolveSecretsInParallel = options.keyVaultOptions.parallelSecretResolutionEnabled ?? false;
        }
        this.#adapters.push(new AzureKeyVaultKeyValueAdapter(options?.keyVaultOptions, this.#secretRefreshTimer));
        this.#adapters.push(new JsonKeyValueAdapter());
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
        if (!this.#refreshEnabled && !this.#featureFlagRefreshEnabled && !this.#secretRefreshEnabled) {
            throw new InvalidOperationError("Refresh is not enabled for key-values, feature flags or Key Vault secrets.");
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
        if (!this.#refreshEnabled && !this.#featureFlagRefreshEnabled && !this.#secretRefreshEnabled) {
            throw new InvalidOperationError("Refresh is not enabled for key-values, feature flags or Key Vault secrets.");
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
        if (this.#refreshEnabled || this.#secretRefreshEnabled) {
            refreshTasks.push(
                this.#refreshKeyValues()
                .then(keyValueRefreshed => {
                    // Only refresh secrets if key values didn't change and secret refresh is enabled
                    // If key values are refreshed, all secret references will be refreshed as well.
                    if (!keyValueRefreshed && this.#secretRefreshEnabled) {
                        // Returns the refreshSecrets promise directly.
                        // in a Promise chain, this automatically flattens nested Promises without requiring await.
                        return this.#refreshSecrets();
                    }
                    return keyValueRefreshed;
                })
            );
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
                            if (loadFeatureFlag === isFeatureFlag(setting)) {
                                loadedSettings.push(setting);
                            }
                        }
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
        this.#secretReferences = []; // clear all cached key vault reference configuration settings
        const keyValues: [key: string, value: unknown][] = [];
        const loadedSettings: ConfigurationSetting[] = await this.#loadConfigurationSettings();
        if (this.#refreshEnabled && !this.#watchAll) {
            await this.#updateWatchedKeyValuesEtag(loadedSettings);
        }

        if (this.#requestTracingEnabled && this.#aiConfigurationTracing !== undefined) {
            // reset old AI configuration tracing in order to track the information present in the current response from server
            this.#aiConfigurationTracing.reset();
        }

        for (const setting of loadedSettings) {
            if (isSecretReference(setting)) {
                this.#secretReferences.push(setting); // cache secret references for resolve/refresh secret separately
                continue;
            }
            // adapt configuration settings to key-values
            const [key, value] = await this.#processKeyValue(setting);
            keyValues.push([key, value]);
        }

        if (this.#secretReferences.length > 0) {
            await this.#resolveSecretReferences(this.#secretReferences, (key, value) => {
                keyValues.push([key, value]);
            });
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
        if (this.#kvRefreshTimer === undefined || !this.#kvRefreshTimer.canRefresh()) {
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
            for (const adapter of this.#adapters) {
                await adapter.onChangeDetected();
            }
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
        if (this.#ffRefreshInterval === undefined || !this.#ffRefreshTimer.canRefresh()) {
            return Promise.resolve(false);
        }

        const needRefresh = await this.#checkConfigurationSettingsChange(this.#ffSelectors);
        if (needRefresh) {
            await this.#loadFeatureFlags();
        }

        this.#ffRefreshTimer.reset();
        return Promise.resolve(needRefresh);
    }

    async #refreshSecrets(): Promise<boolean> {
        // if still within refresh interval/backoff, return
        if (this.#secretRefreshTimer === undefined || !this.#secretRefreshTimer.canRefresh()) {
            return Promise.resolve(false);
        }

        // if no cached key vault references, return
        if (this.#secretReferences.length === 0) {
            return Promise.resolve(false);
        }

        await this.#resolveSecretReferences(this.#secretReferences, (key, value) => {
            this.#configMap.set(key, value);
        });

        this.#secretRefreshTimer.reset();
        return Promise.resolve(true);
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

    async #resolveSecretReferences(secretReferences: ConfigurationSetting[], resultHandler: (key: string, value: unknown) => void): Promise<void> {
        if (this.#resolveSecretsInParallel) {
            const secretResolutionPromises: Promise<void>[] = [];
            for (const setting of secretReferences) {
                const secretResolutionPromise = this.#processKeyValue(setting)
                    .then(([key, value]) => {
                        resultHandler(key, value);
                    });
                secretResolutionPromises.push(secretResolutionPromise);
            }

            // Wait for all secret resolution promises to be resolved
            await Promise.all(secretResolutionPromises);
        } else {
            for (const setting of secretReferences) {
                const [key, value] = await this.#processKeyValue(setting);
                resultHandler(key, value);
            }
        }
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
