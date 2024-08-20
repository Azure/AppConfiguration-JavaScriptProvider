// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as sinon from "sinon";
import { AppConfigurationClient, ConfigurationSetting } from "@azure/app-configuration";
import { ClientSecretCredential } from "@azure/identity";
import { KeyVaultSecret, SecretClient } from "@azure/keyvault-secrets";
import * as uuid from "uuid";
import { RestError } from "@azure/core-rest-pipeline";
import { promisify } from "util";
const sleepInMs = promisify(setTimeout);
import * as crypto from "crypto";

const TEST_CLIENT_ID = "00000000-0000-0000-0000-000000000000";
const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const TEST_CLIENT_SECRET = "0000000000000000000000000000000000000000";

function _sha256(input) {
    return crypto.createHash("sha256").update(input).digest("hex");
}

function _filterKVs(unfilteredKvs: ConfigurationSetting[], listOptions: any) {
    const keyFilter = listOptions?.keyFilter ?? "*";
    const labelFilter = listOptions?.labelFilter ?? "*";
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
        return keyMatched && labelMatched;
    });
}

/**
 * Mocks the listConfigurationSettings method of AppConfigurationClient to return the provided pages of ConfigurationSetting.
 * E.g.
 * - mockAppConfigurationClientListConfigurationSettings([item1, item2, item3])  // single page
 * - mockAppConfigurationClientListConfigurationSettings([item1, item2], [item3], [item4])  // multiple pages
 *
 * @param pages List of pages, each page is a list of ConfigurationSetting
 */
function mockAppConfigurationClientListConfigurationSettings(...pages: ConfigurationSetting[][]) {

    sinon.stub(AppConfigurationClient.prototype, "listConfigurationSettings").callsFake((listOptions) => {
        let kvs = _filterKVs(pages.flat(), listOptions);
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
    });
}

function mockAppConfigurationClientGetConfigurationSetting(kvList) {
    sinon.stub(AppConfigurationClient.prototype, "getConfigurationSetting").callsFake((settingId, options) => {
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
    tags: {
    },
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
    contentType: "application/vnd.microsoft.appconfig.ff+json;charset=utf-8",
    lastModified: new Date(),
    tags: {},
    etag: uuid.v4(),
    isReadOnly: false
}, props));

export {
    sinon,
    mockAppConfigurationClientListConfigurationSettings,
    mockAppConfigurationClientGetConfigurationSetting,
    mockSecretClientGetSecret,
    restoreMocks,

    createMockedEndpoint,
    createMockedConnectionString,
    createMockedTokenCredential,
    createMockedKeyVaultReference,
    createMockedJsonKeyValue,
    createMockedKeyValue,
    createMockedFeatureFlag,

    sleepInMs
};
