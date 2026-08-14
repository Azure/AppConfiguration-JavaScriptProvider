// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as sinon from "sinon";
import { AppConfigurationClient as ConfigurationClient, ConfigurationSetting, FeatureFlagClient, featureFlagContentType, secretReferenceContentType } from "@azure/app-configuration";
import { ClientSecretCredential } from "@azure/identity";
import { KeyVaultSecret, SecretClient } from "@azure/keyvault-secrets";
import * as uuid from "uuid";
import { RestError, PipelineRequest, PipelineResponse, SendRequest } from "@azure/core-rest-pipeline";
import { AppConfigurationClientManager } from "../../src/appConfigurationClientManager.js";
import { AppConfigurationClientWrapper } from "../../src/appConfigurationClientWrapper.js";
import { AppConfigurationClient } from "../../src/appConfigurationClient.js";

const sleepInMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Async, browser-safe SHA-256 using native crypto.subtle when available; falls back to tiny FNV-1a for Node without subtle.
async function _sha256(input: string): Promise<string> {
    let crypto;

    if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
        crypto = window.crypto;
    }
    else {
        crypto = global.crypto;
    }

    const data = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
}

function _filterKVs(unfilteredKvs: ConfigurationSetting[], listOptions: any) {
    const keyFilter = listOptions?.keyFilter ?? "*";
    const labelFilter = listOptions?.labelFilter ?? "*";
    const tagsFilter = listOptions?.tagsFilter ?? [];

    if (tagsFilter.length > 5) {
        throw new RestError("Invalid request parameter 'tags'. Maximum number of tag filters is 5.", { statusCode: 400 });
    }

    return unfilteredKvs.filter(kv => {
        const keyMatched = keyFilter.endsWith("*") ? kv.key.startsWith(keyFilter.slice(0, -1)) : kv.key === keyFilter;
        let labelMatched = false;
        if (labelFilter === "*") {
            labelMatched = true;
        } else if (labelFilter === "\0") {
            labelMatched = kv.label === undefined;
        } else if (labelFilter.endsWith("*")) {
            labelMatched = kv.label !== undefined && kv.label.startsWith(labelFilter.slice(0, -1));
        } else {
            labelMatched = kv.label === labelFilter;
        }
        let tagsMatched = true;
        if (tagsFilter.length > 0) {
            tagsMatched = tagsFilter.every((tag: string) => {
                const [tagName, tagValue] = tag.split("=");
                if (tagValue === "\0") {
                    return kv.tags && kv.tags[tagName] === null;
                }
                return kv.tags && kv.tags[tagName] === tagValue;
            });
        }
        return keyMatched && labelMatched && tagsMatched;
    });
}

function getMockedIterator(pages: ConfigurationSetting[][], kvs: ConfigurationSetting[], listOptions: any, useStringStatus: boolean = false) {
    const mockIterator: AsyncIterableIterator<any> & { byPage(): AsyncIterableIterator<any> } = {
        [Symbol.asyncIterator](): AsyncIterableIterator<any> {
            kvs = _filterKVs(pages.flat(), listOptions);
            return this;
        },
        next() {
            const value = kvs.shift();
            return Promise.resolve({ done: !value, value });
        },
        byPage(): AsyncIterableIterator<any> {
            let remainingPages: ConfigurationSetting[][];
            const pageEtags = listOptions?.pageEtags ? [...listOptions.pageEtags] : undefined; // a copy of the original list
            return {
                [Symbol.asyncIterator](): AsyncIterableIterator<any> {
                    remainingPages = [...pages];
                    return this;
                },
                async next() {
                    const pageItems = remainingPages.shift();
                    const pageEtag = pageEtags?.shift();
                    if (pageItems === undefined) {
                        return { done: true, value: undefined };
                    } else {
                        const items = _filterKVs(pageItems ?? [], listOptions);
                        const etag = await _sha256(JSON.stringify(items));
                        const statusCode = pageEtag === etag ? 304 : 200;
                        return {
                            done: false,
                            value: {
                                items,
                                etag,
                                _response: { status: useStringStatus ? `${statusCode}` : statusCode }
                            }
                        };
                    }
                }
            };
        }
    };

    return mockIterator as any;
}

function getCachedIterator(pages: Array<{
    items: ConfigurationSetting[];
    response?: any;
}>) {
    const iterator: AsyncIterableIterator<any> & { byPage(): AsyncIterableIterator<any> } = {
        [Symbol.asyncIterator](): AsyncIterableIterator<any> {
            return this;
        },
        next() {
            while (pages.length > 0) {
                pages.shift();
            }
            if (pages.length === 0) {
                return Promise.resolve({ done: true, value: undefined });
            }
            const value = pages[0].items.shift();
            return Promise.resolve({ done: !value, value });
        },
        byPage(): AsyncIterableIterator<any> {
            return {
                [Symbol.asyncIterator](): AsyncIterableIterator<any> { return this; },
                async next() {
                    const page = pages.shift();
                    if (!page) {
                        return { done: true, value: undefined };
                    }
                    const etag = await _sha256(JSON.stringify(page.items));

                    return {
                        done: false,
                        value: {
                            items: page.items,
                            etag,
                            _response: page.response
                        }
                    };
                }
            };
        }
    };
    return iterator as any;
}

function getMockedHeadIterator(pages: ConfigurationSetting[][], listOptions: any, useStringStatus: boolean = false) {
    const mockIterator: AsyncIterableIterator<any> & { byPage(): AsyncIterableIterator<any> } = {
        [Symbol.asyncIterator](): AsyncIterableIterator<any> {
            return this;
        },
        next() {
            return Promise.resolve({ done: true, value: undefined });
        },
        byPage(): AsyncIterableIterator<any> {
            let remainingPages;
            const pageEtags = listOptions?.pageEtags ? [...listOptions.pageEtags] : undefined;
            return {
                [Symbol.asyncIterator](): AsyncIterableIterator<any> {
                    remainingPages = [...pages];
                    return this;
                },
                async next() {
                    const pageItems = remainingPages.shift();
                    const pageEtag = pageEtags?.shift();
                    if (pageItems === undefined) {
                        return { done: true, value: undefined };
                    } else {
                        const items = _filterKVs(pageItems ?? [], listOptions);
                        const etag = await _sha256(JSON.stringify(items));
                        const statusCode = pageEtag === etag ? 304 : 200;
                        return {
                            done: false,
                            value: {
                                items: [], // HEAD request returns no items
                                etag,
                                _response: { status: useStringStatus ? `${statusCode}` : statusCode }
                            }
                        };
                    }
                }
            };
        }
    };

    return mockIterator as any;
}

function _filterFeatureFlags(featureFlags: any[], listOptions: any): any[] {
    const nameFilter: string | undefined = listOptions?.nameFilter;
    const labelFilter: string | undefined = listOptions?.labelFilter;
    const tagsFilter: string[] = listOptions?.tagsFilter ?? [];

    return featureFlags.filter((ff) => {
        // name filter: "*"/undefined matches all, trailing "*" is a prefix wildcard, otherwise exact match
        let nameMatched = true;
        if (nameFilter !== undefined && nameFilter !== "*") {
            if (nameFilter.endsWith("*")) {
                nameMatched = ff.name.startsWith(nameFilter.slice(0, -1));
            } else {
                nameMatched = ff.name === nameFilter;
            }
        }

        // label filter: "\0" (LabelFilter.Null) matches feature flags without a label
        let labelMatched = true;
        if (labelFilter !== undefined) {
            if (labelFilter === "\0") {
                labelMatched = ff.label === undefined || ff.label === "";
            } else {
                labelMatched = ff.label === labelFilter;
            }
        }

        // tag filters: every "key=value" must match
        let tagsMatched = true;
        tagsFilter.forEach((tagFilter: string) => {
            const [tagName, tagValue] = tagFilter.split("=");
            if (!ff.tags || ff.tags[tagName] !== tagValue) {
                tagsMatched = false;
            }
        });

        return nameMatched && labelMatched && tagsMatched;
    });
}

function getMockedFeatureFlagIterator(pages: any[][], listOptions: any, useStringStatus: boolean = false) {
    const mockIterator: AsyncIterableIterator<any> & { byPage(): AsyncIterableIterator<any> } = {
        [Symbol.asyncIterator](): AsyncIterableIterator<any> {
            return this;
        },
        next() {
            return Promise.resolve({ done: true, value: undefined });
        },
        byPage(): AsyncIterableIterator<any> {
            let remainingPages: any[][];
            const pageEtags = listOptions?.pageEtags ? [...listOptions.pageEtags] : undefined;
            return {
                [Symbol.asyncIterator](): AsyncIterableIterator<any> {
                    remainingPages = [...pages];
                    return this;
                },
                async next() {
                    const pageItems = remainingPages.shift();
                    const pageEtag = pageEtags?.shift();
                    if (pageItems === undefined) {
                        return { done: true, value: undefined };
                    } else {
                        const items = _filterFeatureFlags(pageItems ?? [], listOptions);
                        const etag = await _sha256(JSON.stringify(items));
                        const statusCode = pageEtag === etag ? 304 : 200;
                        return {
                            done: false,
                            value: {
                                items,
                                etag,
                                _response: { status: useStringStatus ? `${statusCode}` : statusCode }
                            }
                        };
                    }
                }
            };
        }
    };

    return mockIterator as any;
}

/**
 * Mocks the listFeatureFlags method of FeatureFlagClient to return the provided pages of feature flags.
 * @param pages List of pages, each page is a list of typed feature flags (see createMockedEnhancedFeatureFlag).
 */
function mockFeatureFlagClientListFeatureFlags(pages: any[][], customCallback?: (listOptions: any) => any) {
    sinon.stub(FeatureFlagClient.prototype, "listFeatureFlags").callsFake((listOptions) => {
        if (customCallback) {
            customCallback(listOptions);
        }
        return getMockedFeatureFlagIterator(pages, listOptions);
    });
}

/**
 * Mocks the listConfigurationSettings method of AppConfigurationClient to return the provided pages of ConfigurationSetting.
 * E.g.
 * - mockAppConfigurationClientListConfigurationSettings([item1, item2, item3])  // single page
 *
 * @param pages List of pages, each page is a list of ConfigurationSetting
 */
function mockAppConfigurationClientListConfigurationSettings(pages: ConfigurationSetting[][], customCallback?: (listOptions: any) => any) {

    sinon.stub(ConfigurationClient.prototype, "listConfigurationSettings").callsFake((listOptions) => {
        if (customCallback) {
            customCallback(listOptions);
        }

        const kvs = _filterKVs(pages.flat(), listOptions);
        return getMockedIterator(pages, kvs, listOptions);
    });

    sinon.stub(ConfigurationClient.prototype, "checkConfigurationSettings").callsFake((listOptions) => {
        if (customCallback) {
            customCallback(listOptions);
        }

        return getMockedHeadIterator(pages, listOptions);
    });

}

function mockAppConfigurationClientListConfigurationSettingsWithStringStatus(pages: ConfigurationSetting[][], customCallback?: (listOptions: any) => any) {

    sinon.stub(ConfigurationClient.prototype, "listConfigurationSettings").callsFake((listOptions) => {
        if (customCallback) {
            customCallback(listOptions);
        }

        const kvs = _filterKVs(pages.flat(), listOptions);
        return getMockedIterator(pages, kvs, listOptions, true);
    });

    sinon.stub(ConfigurationClient.prototype, "checkConfigurationSettings").callsFake((listOptions) => {
        if (customCallback) {
            customCallback(listOptions);
        }

        return getMockedHeadIterator(pages, listOptions, true);
    });

}

function mockAppConfigurationClientLoadBalanceMode(
    pages: ConfigurationSetting[][],
    clientWrapper: AppConfigurationClientWrapper,
    callCounts: { configurationSettings: number; enhancedFeatureFlags: number }
) {
    sinon.stub(clientWrapper.client, "listConfigurationSettings").callsFake((listOptions) => {
        callCounts.configurationSettings += 1;
        const kvs = _filterKVs(pages.flat(), listOptions);
        return getMockedIterator(pages, kvs, listOptions);
    });
    sinon.stub(clientWrapper.client, "checkConfigurationSettings").callsFake((listOptions) => {
        callCounts.configurationSettings += 1;
        return getMockedHeadIterator(pages, listOptions);
    });
    sinon.stub(clientWrapper.client, "listFeatureFlags").callsFake((listOptions) => {
        callCounts.enhancedFeatureFlags += 1;
        return getMockedFeatureFlagIterator([], listOptions);
    });
}

function mockConfigurationManagerGetClients(fakeClientWrappers: AppConfigurationClientWrapper[], isFailoverable: boolean, ...pages: ConfigurationSetting[][]) {
    // Stub the getClients method on the class prototype
    sinon.stub(AppConfigurationClientManager.prototype, "getClients").callsFake(async () => {
        if (fakeClientWrappers?.length > 0) {
            return fakeClientWrappers;
        }
        const clients: AppConfigurationClientWrapper[] = [];
        const fakeEndpoint = createMockedEndpoint("fake");
        const fakeStaticClientWrapper = new AppConfigurationClientWrapper(fakeEndpoint, new AppConfigurationClient(createMockedConnectionString(fakeEndpoint)));
        sinon.stub(fakeStaticClientWrapper.client, "listConfigurationSettings").callsFake(() => {
            throw new RestError("Internal Server Error", { statusCode: 500 });
        });
        sinon.stub(fakeStaticClientWrapper.client, "checkConfigurationSettings").callsFake(() => {
            throw new RestError("Internal Server Error", { statusCode: 500 });
        });
        sinon.stub(fakeStaticClientWrapper.client, "listFeatureFlags").callsFake(() => {
            throw new RestError("Internal Server Error", { statusCode: 500 });
        });
        clients.push(fakeStaticClientWrapper);

        if (!isFailoverable) {
            return clients;
        }

        const fakeReplicaEndpoint = createMockedEndpoint("fake-replica");
        const fakeDynamicClientWrapper = new AppConfigurationClientWrapper(fakeReplicaEndpoint, new AppConfigurationClient(createMockedConnectionString(fakeReplicaEndpoint)));
        clients.push(fakeDynamicClientWrapper);
        sinon.stub(fakeDynamicClientWrapper.client, "listConfigurationSettings").callsFake((listOptions) => {
            const kvs = _filterKVs(pages.flat(), listOptions);
            return getMockedIterator(pages, kvs, listOptions);
        });
        sinon.stub(fakeDynamicClientWrapper.client, "checkConfigurationSettings").callsFake((listOptions) => {
            return getMockedHeadIterator(pages, listOptions);
        });
        sinon.stub(fakeDynamicClientWrapper.client, "listFeatureFlags").callsFake((listOptions) => {
            return getMockedFeatureFlagIterator([], listOptions);
        });
        return clients;
    });
}

function mockAppConfigurationClientGetConfigurationSetting(kvList: any[], customCallback?: (options: any) => any) {
    sinon.stub(ConfigurationClient.prototype, "getConfigurationSetting").callsFake((settingId, options) => {
        if (customCallback) {
            customCallback(options);
        }

        const found = kvList.find(elem => elem.key === settingId.key && elem.label === settingId.label);
        if (found) {
            if (options?.onlyIfChanged && settingId.etag === found.etag) {
                return { statusCode: 304 };
            } else {
                return { statusCode: 200, ...found };
            }
        } else {
            throw new RestError("", { statusCode: 404 });
        }
    });
}

function mockAppConfigurationClientGetSnapshot(snapshotResponses: Map<string, any>, customCallback?: (options: any) => any) {
    sinon.stub(ConfigurationClient.prototype, "getSnapshot").callsFake((name, options) => {
        if (customCallback) {
            customCallback(options);
        }

        if (snapshotResponses.has(name)) {
            return snapshotResponses.get(name);
        } else {
            throw new RestError("", { statusCode: 404 });
        }
    });
}

function mockAppConfigurationClientListConfigurationSettingsForSnapshot(snapshotResponses: Map<string, ConfigurationSetting[][]>, customCallback?: (options: any) => any) {
    sinon.stub(ConfigurationClient.prototype, "listConfigurationSettingsForSnapshot").callsFake((name, listOptions) => {
        if (customCallback) {
            customCallback(listOptions);
        }

        if (snapshotResponses.has(name)) {
            const kvs = _filterKVs(snapshotResponses.get(name)!.flat(), listOptions);
            return getMockedIterator(snapshotResponses.get(name)!, kvs, listOptions);
        } else {
            throw new RestError("", { statusCode: 404 });
        }
    });
}

// uriValueList: [["<secretUri>", "value"], ...]
function mockSecretClientGetSecret(uriValueList: [string, string][]) {
    const dict = new Map();
    for (const [uri, value] of uriValueList) {
        dict.set(uri, value);
    }

    sinon.stub(SecretClient.prototype, "getSecret").callsFake(async function (this: SecretClient, secretName, options) {
        const url = new URL(this.vaultUrl);
        url.pathname = `/secrets/${secretName}`;
        if (options?.version) {
            url.pathname += `/${options.version}`;
        }
        return {
            name: secretName,
            value: dict.get(url.toString())
        } as KeyVaultSecret;
    });
}

function restoreMocks() {
    sinon.restore();
}

const createMockedEndpoint = (name = "azure") => `https://${name}.azconfig.io`;

const createMockedAzureFrontDoorEndpoint = (name = "appconfig") => `https://${name}.b01.azurefd.net`;

const createMockedConnectionString = (endpoint = createMockedEndpoint(), secret = "secret", id = "123456") => {
    return `Endpoint=${endpoint};Id=${id};Secret=${secret}`;
};

const createMockedTokenCredential = () => {
    const effectiveTenantId = uuid.v4();
    const effectiveClientId = uuid.v4();
    const effectiveClientSecret = uuid.v4();
    return new ClientSecretCredential(effectiveTenantId, effectiveClientId, effectiveClientSecret);
};

const createMockedKeyVaultReference = (key: string, vaultUri: string): ConfigurationSetting => ({
    // https://${vaultName}.vault.azure.net/secrets/${secretName}
    value: `{"uri":"${vaultUri}"}`,
    key,
    contentType: secretReferenceContentType,
    lastModified: new Date(),
    tags: {},
    etag: uuid.v4(),
    isReadOnly: false,
});

const createMockedJsonKeyValue = (key: string, value: any): ConfigurationSetting => ({
    value: value,
    key: key,
    contentType: "application/json",
    lastModified: new Date(),
    tags: {},
    etag: uuid.v4(),
    isReadOnly: false
});

const createMockedKeyValue = (props: { [key: string]: any }): ConfigurationSetting => (Object.assign({
    value: "TestValue",
    key: "TestKey",
    contentType: "",
    lastModified: new Date(),
    tags: {},
    etag: uuid.v4(),
    isReadOnly: false
}, props));

const createMockedFeatureFlag = (name: string, flagProps?: any, props?: any) => (Object.assign({
    key: `.appconfig.featureflag/${name}`,
    value: JSON.stringify(Object.assign({
        "id": name,
        "description": "",
        "enabled": true,
        "conditions": {
            "client_filters": []
        }
    }, flagProps)),
    contentType: featureFlagContentType,
    lastModified: new Date(),
    tags: {},
    etag: uuid.v4(),
    isReadOnly: false
}, props));

const createMockedSnapshotReference = (key: string, snapshotName: string): ConfigurationSetting => ({
    value: `{"snapshot_name":"${snapshotName}"}`,
    key,
    contentType: "application/json; profile=\"https://azconfig.io/mime-profiles/snapshot-ref\"; charset=utf-8",
    lastModified: new Date(),
    tags: {},
    etag: uuid.v4(),
    isReadOnly: false,
});

// Creates an enhanced feature flag as returned by the dedicated feature flag endpoint (FeatureFlagClient.listFeatureFlags).
const createMockedEnhancedFeatureFlag = (name: string, props?: any) => Object.assign({
    name,
    enabled: true,
    conditions: { filters: [] },
    lastModified: new Date(),
    etag: uuid.v4()
}, props);

class HttpRequestHeadersPolicy {
    headers: any;
    name: string;

    constructor() {
        this.headers = {};
        this.name = "HttpRequestHeadersPolicy";
    }
    sendRequest(req: PipelineRequest, next: SendRequest): Promise<PipelineResponse> {
        this.headers = req.headers;
        return next(req).then(resp => resp);
    }
}

export {
    sinon,
    mockAppConfigurationClientListConfigurationSettings,
    mockAppConfigurationClientListConfigurationSettingsWithStringStatus,
    mockFeatureFlagClientListFeatureFlags,
    mockAppConfigurationClientGetConfigurationSetting,
    mockAppConfigurationClientGetSnapshot,
    mockAppConfigurationClientListConfigurationSettingsForSnapshot,
    mockAppConfigurationClientLoadBalanceMode,
    mockConfigurationManagerGetClients,
    mockSecretClientGetSecret,
    getCachedIterator,
    restoreMocks,

    createMockedEndpoint,
    createMockedAzureFrontDoorEndpoint,
    createMockedConnectionString,
    createMockedTokenCredential,
    createMockedKeyVaultReference,
    createMockedJsonKeyValue,
    createMockedKeyValue,
    createMockedFeatureFlag,
    createMockedEnhancedFeatureFlag,
    createMockedSnapshotReference,

    sleepInMs,
    HttpRequestHeadersPolicy
};
