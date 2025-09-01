// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as sinon from "sinon";
import { AppConfigurationClient, ConfigurationSetting, featureFlagContentType } from "@azure/app-configuration";
import { ClientSecretCredential } from "@azure/identity";
import { KeyVaultSecret, SecretClient } from "@azure/keyvault-secrets";
import * as uuid from "uuid";
import { RestError } from "@azure/core-rest-pipeline";
import { promisify } from "util";
const sleepInMs = promisify(setTimeout);
import * as crypto from "crypto";
import { ConfigurationClientManager } from "../../src/configurationClientManager.js";
import { ConfigurationClientWrapper } from "../../src/configurationClientWrapper.js";

const MAX_TIME_OUT = 100_000;

const TEST_CLIENT_ID = "00000000-0000-0000-0000-000000000000";
const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const TEST_CLIENT_SECRET = "0000000000000000000000000000000000000000";

function _sha256(input) {
    return crypto.createHash("sha256").update(input).digest("hex");
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
            tagsMatched = tagsFilter.every(tag => {
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

function getMockedIterator(pages: ConfigurationSetting[][], kvs: ConfigurationSetting[], listOptions: any) {
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
            let remainingPages;
            const pageEtags = listOptions?.pageEtags ? [...listOptions.pageEtags] : undefined; // a copy of the original list
            return {
                [Symbol.asyncIterator](): AsyncIterableIterator<any> {
                    remainingPages = [...pages];
                    return this;
                },
                next() {
                    const pageItems = remainingPages.shift();
                    const pageEtag = pageEtags?.shift();
                    if (pageItems === undefined) {
                        return Promise.resolve({ done: true, value: undefined });
                    } else {
                        const items = _filterKVs(pageItems ?? [], listOptions);
                        const etag = _sha256(JSON.stringify(items));
                        const statusCode = pageEtag === etag ? 304 : 200;
                        return Promise.resolve({
                            done: false,
                            value: {
                                items,
                                etag,
                                _response: { status: statusCode }
                            }
                        });
                    }
                }
            };
        }
    };

    return mockIterator as any;
}

/**
 * Mocks the listConfigurationSettings method of AppConfigurationClient to return the provided pages of ConfigurationSetting.
 * E.g.
 * - mockAppConfigurationClientListConfigurationSettings([item1, item2, item3])  // single page
 *
 * @param pages List of pages, each page is a list of ConfigurationSetting
 */
function mockAppConfigurationClientListConfigurationSettings(pages: ConfigurationSetting[][], customCallback?: (listOptions) => any) {

    sinon.stub(AppConfigurationClient.prototype, "listConfigurationSettings").callsFake((listOptions) => {
        if (customCallback) {
            customCallback(listOptions);
        }

        const kvs = _filterKVs(pages.flat(), listOptions);
        return getMockedIterator(pages, kvs, listOptions);
    });
}

function mockAppConfigurationClientLoadBalanceMode(pages: ConfigurationSetting[][], clientWrapper: ConfigurationClientWrapper, countObject: { count: number }) {
    sinon.stub(clientWrapper.client, "listConfigurationSettings").callsFake((listOptions) => {
        countObject.count += 1;
        const kvs = _filterKVs(pages.flat(), listOptions);
        return getMockedIterator(pages, kvs, listOptions);
    });
}

function mockConfigurationManagerGetClients(fakeClientWrappers: ConfigurationClientWrapper[], isFailoverable: boolean, ...pages: ConfigurationSetting[][]) {
    // Stub the getClients method on the class prototype
    sinon.stub(ConfigurationClientManager.prototype, "getClients").callsFake(async () => {
        if (fakeClientWrappers?.length > 0) {
            return fakeClientWrappers;
        }
        const clients: ConfigurationClientWrapper[] = [];
        const fakeEndpoint = createMockedEndpoint("fake");
        const fakeStaticClientWrapper = new ConfigurationClientWrapper(fakeEndpoint, new AppConfigurationClient(createMockedConnectionString(fakeEndpoint)));
        sinon.stub(fakeStaticClientWrapper.client, "listConfigurationSettings").callsFake(() => {
            throw new RestError("Internal Server Error", { statusCode: 500 });
        });
        clients.push(fakeStaticClientWrapper);

        if (!isFailoverable) {
            return clients;
        }

        const fakeReplicaEndpoint = createMockedEndpoint("fake-replica");
        const fakeDynamicClientWrapper = new ConfigurationClientWrapper(fakeReplicaEndpoint, new AppConfigurationClient(createMockedConnectionString(fakeReplicaEndpoint)));
        clients.push(fakeDynamicClientWrapper);
        sinon.stub(fakeDynamicClientWrapper.client, "listConfigurationSettings").callsFake((listOptions) => {
            const kvs = _filterKVs(pages.flat(), listOptions);
            return getMockedIterator(pages, kvs, listOptions);
        });
        return clients;
    });
}

function mockAppConfigurationClientGetConfigurationSetting(kvList: any[], customCallback?: (options) => any) {
    sinon.stub(AppConfigurationClient.prototype, "getConfigurationSetting").callsFake((settingId, options) => {
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

function mockAppConfigurationClientGetSnapshot(snapshotName: string, mockedResponse: any, customCallback?: (options) => any) {
    sinon.stub(AppConfigurationClient.prototype, "getSnapshot").callsFake((name, options) => {
        if (customCallback) {
            customCallback(options);
        }

        if (name === snapshotName) {
            return mockedResponse;
        } else {
            throw new RestError("", { statusCode: 404 });
        }
    });
}

function mockAppConfigurationClientListConfigurationSettingsForSnapshot(snapshotName: string, pages: ConfigurationSetting[][], customCallback?: (options) => any) {
    sinon.stub(AppConfigurationClient.prototype, "listConfigurationSettingsForSnapshot").callsFake((name, listOptions) => {
        if (customCallback) {
            customCallback(listOptions);
        }

        if (name === snapshotName) {
            const kvs = _filterKVs(pages.flat(), listOptions);
            return getMockedIterator(pages, kvs, listOptions);
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

    sinon.stub(SecretClient.prototype, "getSecret").callsFake(async function (secretName, options) {
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

const createMockedConnectionString = (endpoint = createMockedEndpoint(), secret = "secret", id = "b1d9b31") => {
    const toEncodeAsBytes = Buffer.from(secret);
    const returnValue = toEncodeAsBytes.toString("base64");
    return `Endpoint=${endpoint};Id=${id};Secret=${returnValue}`;
};

const createMockedTokenCredential = (tenantId = TEST_TENANT_ID, clientId = TEST_CLIENT_ID, clientSecret = TEST_CLIENT_SECRET) => {
    return new ClientSecretCredential(tenantId, clientId, clientSecret);
};

const createMockedKeyVaultReference = (key: string, vaultUri: string): ConfigurationSetting => ({
    // https://${vaultName}.vault.azure.net/secrets/${secretName}
    value: `{"uri":"${vaultUri}"}`,
    key,
    contentType: "application/vnd.microsoft.appconfig.keyvaultref+json;charset=utf-8",
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

class HttpRequestHeadersPolicy {
    headers: any;
    name: string;

    constructor() {
        this.headers = {};
        this.name = "HttpRequestHeadersPolicy";
    }
    sendRequest(req, next) {
        this.headers = req.headers;
        return next(req).then(resp => resp);
    }
}

export {
    sinon,
    mockAppConfigurationClientListConfigurationSettings,
    mockAppConfigurationClientGetConfigurationSetting,
    mockAppConfigurationClientGetSnapshot,
    mockAppConfigurationClientListConfigurationSettingsForSnapshot,
    mockAppConfigurationClientLoadBalanceMode,
    mockConfigurationManagerGetClients,
    mockSecretClientGetSecret,
    restoreMocks,

    createMockedEndpoint,
    createMockedConnectionString,
    createMockedTokenCredential,
    createMockedKeyVaultReference,
    createMockedJsonKeyValue,
    createMockedKeyValue,
    createMockedFeatureFlag,

    sleepInMs,
    MAX_TIME_OUT,
    HttpRequestHeadersPolicy
};
