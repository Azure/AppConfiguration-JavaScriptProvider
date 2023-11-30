// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient, ConfigurationSetting, ConfigurationSettingId, ListConfigurationSettingsOptions } from "@azure/app-configuration";
import { AzureAppConfiguration } from "./AzureAppConfiguration";
import { AzureAppConfigurationOptions } from "./AzureAppConfigurationOptions";
import { IKeyValueAdapter } from "./IKeyValueAdapter";
import { JsonKeyValueAdapter } from "./JsonKeyValueAdapter";
import { KeyFilter, LabelFilter } from "./types";
import { AzureKeyVaultKeyValueAdapter } from "./keyvault/AzureKeyVaultKeyValueAdapter";
import { CorrelationContextHeaderName, RequestType } from "./requestTracing/constants";
import { createCorrelationContextHeader, requestTracingEnabled } from "./requestTracing/utils";
import { DefaultRefreshIntervalInMs, MinimumRefreshIntervalInMs } from "./RefreshOptions";
import { LinkedList } from "./common/linkedList";
import { Disposable } from "./common/disposable";
import { SettingSelector } from "./types";

export class AzureAppConfigurationImpl extends Map<string, any> implements AzureAppConfiguration {
    private adapters: IKeyValueAdapter[] = [];
    /**
     * Trim key prefixes sorted in descending order.
     * Since multiple prefixes could start with the same characters, we need to trim the longest prefix first.
     */
    private sortedTrimKeyPrefixes: string[] | undefined;
    private readonly requestTracingEnabled: boolean;
    // Refresh
    private refreshInterval: number = DefaultRefreshIntervalInMs;
    private onRefreshListeners: LinkedList<() => any> = new LinkedList();
    private lastUpdateTimestamp: number;
    private sentinels: ConfigurationSettingId[];

    constructor(
        private client: AppConfigurationClient,
        private options: AzureAppConfigurationOptions | undefined
    ) {
        super();
        // Enable request tracing if not opt-out
        this.requestTracingEnabled = requestTracingEnabled();

        if (options?.trimKeyPrefixes) {
            this.sortedTrimKeyPrefixes = [...options.trimKeyPrefixes].sort((a, b) => b.localeCompare(a));
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
                    throw new Error(`The refresh interval time cannot be less than ${MinimumRefreshIntervalInMs} milliseconds.`);
                } else {
                    this.refreshInterval = refreshIntervalInMs;
                }
            }

            this.sentinels = watchedSettings.map(setting => {
                if (setting.key.includes("*") || setting.label?.includes("*")) {
                    throw new Error("The character '*' is not supported in key or label.");
                }
                return { ...setting };
            });
        }

        // TODO: should add more adapters to process different type of values
        // feature flag, others
        this.adapters.push(new AzureKeyVaultKeyValueAdapter(options?.keyVaultOptions));
        this.adapters.push(new JsonKeyValueAdapter());
    }


    private get refreshEnabled(): boolean {
        return !!this.options?.refreshOptions?.enabled;
    }

    public async load(requestType: RequestType = RequestType.Startup) {
        const keyValues: [key: string, value: unknown][] = [];

        // validate selectors
        const selectors = getValidSelectors(this.options?.selectors);

        for (const selector of selectors) {
            const listOptions: ListConfigurationSettingsOptions = {
                keyFilter: selector.keyFilter,
                labelFilter: selector.labelFilter
            };
            if (this.requestTracingEnabled) {
                listOptions.requestOptions = {
                    customHeaders: this.customHeaders(requestType)
                }
            }

            const settings = this.client.listConfigurationSettings(listOptions);

            for await (const setting of settings) {
                if (setting.key) {
                    const keyValuePair = await this.processKeyValues(setting);
                    keyValues.push(keyValuePair);
                }
                // update etag of sentinels if refresh is enabled
                if (this.refreshEnabled) {
                    const matchedSentinel = this.sentinels.find(s => s.key === setting.key && s.label === setting.label);
                    if (matchedSentinel) {
                        matchedSentinel.etag = setting.etag;
                    }
                }
            }
        }
        for (const [k, v] of keyValues) {
            this.set(k, v);
        }
        this.lastUpdateTimestamp = Date.now();
    }

    public async refresh(): Promise<void> {
        if (!this.refreshEnabled) {
            return Promise.resolve();
        }
        // if still within refresh interval, return
        const now = Date.now();
        if (now < this.lastUpdateTimestamp + this.refreshInterval) {
            return Promise.resolve();
        }

        // try refresh if any of watched settings is changed.
        let needRefresh = false;
        for (const sentinel of this.sentinels) {
            const response = await this.client.getConfigurationSetting(sentinel, {
                onlyIfChanged: true,
                requestOptions: {
                    customHeaders: this.customHeaders(RequestType.Watch)
                }
            });
            if (response.statusCode === 200) {
                // sentinel changed.
                sentinel.etag = response.etag;// update etag of the sentinel
                needRefresh = true;
                break;
            }
        }
        if (needRefresh) {
            await this.load(RequestType.Watch);
            // run callbacks in async
            for (const listener of this.onRefreshListeners) {
                listener();
            }
        }
    }

    public onRefresh(listener: () => any, thisArg?: any): Disposable {
        if (!this.refreshEnabled) {
            throw new Error("Refresh is not enabled.");
        }

        const boundedListener = listener.bind(thisArg);
        const remove = this.onRefreshListeners.push(boundedListener);
        return new Disposable(remove);
    }

    private async processKeyValues(setting: ConfigurationSetting<string>): Promise<[string, unknown]> {
        const [key, value] = await this.processAdapters(setting);
        const trimmedKey = this.keyWithPrefixesTrimmed(key);
        return [trimmedKey, value];
    }

    private async processAdapters(setting: ConfigurationSetting<string>): Promise<[string, unknown]> {
        for (const adapter of this.adapters) {
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

    private customHeaders(requestType: RequestType) {
        if (!this.requestTracingEnabled) {
            return undefined;
        }

        const headers = {};
        headers[CorrelationContextHeaderName] = createCorrelationContextHeader(this.options, requestType);
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