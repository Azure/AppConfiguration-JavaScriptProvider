// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const expect = chai.expect;
const { load } = require("../dist/index");
const {
    mockAppConfigurationClientListConfigurationSettings,
    restoreMocks,
    createMockedConnectionString,
    createMockedKeyVaultReference
} = require("./utils/testHelper");

const jsonKeyValue = {
    value: '{"Test":{"Level":"Debug"},"Prod":{"Level":"Warning"}}',
    key: "json.settings.logging",
    label: null,
    contentType: "application/json",
    lastModified: "2023-05-04T04:32:56.000Z",
    tags: {},
    etag: "GdmsLWq3mFjFodVEXUYRmvFr3l_qRiKAW_KdpFbxZKk",
    isReadOnly: false
};
const keyVaultKeyValue = createMockedKeyVaultReference("TestKey", "https://fake-vault-name.vault.azure.net/secrets/fakeSecretName");

describe("json", function () {
    beforeEach(() => {   
    });

    afterEach(() => {
        restoreMocks();
    })

    it("should load and parse if content type is application/json", async () => {
        mockAppConfigurationClientListConfigurationSettings([jsonKeyValue]);

        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;
        const logging = settings.get("json.settings.logging");
        expect(logging).not.undefined;
        expect(logging.Test).not.undefined;
        expect(logging.Test.Level).eq("Debug");
        expect(logging.Prod).not.undefined;
        expect(logging.Prod.Level).eq("Warning");
    });

    it("should not parse key-vault reference", async () => {
        mockAppConfigurationClientListConfigurationSettings([jsonKeyValue, keyVaultKeyValue]);
        
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            keyVaultOptions: {
                secretResolver: (url) => `Resolved: ${url.toString()}`
            }
        });
        expect(settings).not.undefined;
        const resolvedSecret = settings.get("TestKey");
        expect(resolvedSecret).not.undefined;
        expect(resolvedSecret.uri).undefined;
        expect(typeof resolvedSecret).eq("string");
    });
})
