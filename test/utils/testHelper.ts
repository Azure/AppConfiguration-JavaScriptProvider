// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as sinon from "sinon";
import { AppConfigurationClient } from "@azure/app-configuration";
import { ClientSecretCredential } from "@azure/identity";
import { KeyVaultSecret, SecretClient } from "@azure/keyvault-secrets";
import * as uuid from "uuid";

const TEST_CLIENT_ID = "62e76eb5-218e-4f90-8261-000000000000";
const TEST_TENANT_ID = "72f988bf-86f1-41af-91ab-000000000000";
const TEST_CLIENT_SECRET = "Q158Q~2JtUwVbuq0Mzm9ocH2umTB000000000000";

function mockAppConfigurationClientListConfigurationSettings(kvList: any[]) {
    function* testKvSetGnerator(kvs: any[]) {
        yield* kvs;
    }
    sinon.stub(AppConfigurationClient.prototype, "listConfigurationSettings").callsFake((listOptions) => {
        const keyFilter = listOptions?.keyFilter ?? "*";
        const labelFilter = listOptions?.labelFilter ?? "*";
        const kvs = kvList.filter(kv => {
            const keyMatched = keyFilter.endsWith("*") ? kv.key.startsWith(keyFilter.slice(0, keyFilter.length - 1)) : kv.key === keyFilter;
            const labelMatched = labelFilter.endsWith("*") ? kv.label.startsWith(labelFilter.slice(0, labelFilter.length - 1))
                : (labelFilter === "\0" ? kv.label === null : kv.label === labelFilter); // '\0' in labelFilter, null in config setting.
            return keyMatched && labelMatched;
        })
        return testKvSetGnerator(kvs) as any;
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
    })
}

function restoreMocks() {
    sinon.restore();
}

const createMockedEnpoint = (name = "azure") => `https://${name}.azconfig.io`;

const createMockedConnectionString = (endpoint = createMockedEnpoint(), secret = "secret", id = "b1d9b31") => {
    const toEncodeAsBytes = Buffer.from(secret);
    const returnValue = toEncodeAsBytes.toString("base64");
    return `Endpoint=${endpoint};Id=${id};Secret=${returnValue}`;
}

const createMockedTokenCredential = (tenantId = TEST_TENANT_ID, clientId = TEST_CLIENT_ID, clientSecret = TEST_CLIENT_SECRET) => {
    return new ClientSecretCredential(tenantId, clientId, clientSecret);
}

const createMockedKeyVaultReference = (key: string, vaultUri: string) => ({
    // https://${vaultName}.vault.azure.net/secrets/${secretName}
    value: `{"uri":"${vaultUri}"}`,
    key,
    label: null,
    contentType: "application/vnd.microsoft.appconfig.keyvaultref+json;charset=utf-8",
    lastModified: "2023-05-09T08:51:11.000Z",
    tags: {
    },
    etag: "SPJSMnJ2ph4BAjftWfdIctV2VIyQxtcIzRbh1oxTBkM",
    isReadOnly: false,
});

const createMockedJsonKeyValue = (key: string, value: any) => ({
    value: value,
    key: key,
    label: null,
    contentType: "application/json",
    lastModified: "2023-05-04T04:32:56.000Z",
    tags: {},
    etag: "GdmsLWq3mFjFodVEXUYRmvFr3l_qRiKAW_KdpFbxZKk",
    isReadOnly: false
});

const createMockedKeyValue = (props: {[key: string]: any}) => (Object.assign({
    value: "TestValue",
    key: "TestKey",
    label: null,
    contentType: "",
    lastModified: new Date().toISOString(),
    tags: {},
    etag: uuid.v4(),
    isReadOnly: false
}, props));

export {
    sinon,
    mockAppConfigurationClientListConfigurationSettings,
    mockSecretClientGetSecret,
    restoreMocks,

    createMockedEnpoint,
    createMockedConnectionString,
    createMockedTokenCredential,
    createMockedKeyVaultReference,
    createMockedJsonKeyValue,
    createMockedKeyValue
}