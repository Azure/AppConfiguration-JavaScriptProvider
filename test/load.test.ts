// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "./exportedApi";
import { mockAppConfigurationClientListConfigurationSettings, restoreMocks, createMockedConnectionString, createMockedEnpoint, createMockedTokenCredential, createMockedKeyValue } from "./utils/testHelper";

const mockedKVs = [{
    key: "app.settings.fontColor",
    value: "red",
}, {
    key: "app.settings.fontSize",
    value: "40",
}, {
    key: "TestKey",
    label: "Test",
    value: "TestValue",
}, {
    key: "TestKey",
    label: "Prod",
    value: "TestValueForProd",
}, {
    key: "KeyForNullValue",
    value: null,
}, {
    key: "KeyForEmptyValue",
    value: "",
}].map(createMockedKeyValue);

describe("load", function () {
    before(() => {
        mockAppConfigurationClientListConfigurationSettings(mockedKVs);
    });

    after(() => {
        restoreMocks();
    })
    it("should load data from config store with connection string", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");
    });

    it("should load data from config store with aad + endpoint URL", async () => {
        const endpoint = createMockedEnpoint();
        const credential = createMockedTokenCredential();
        const settings = await load(new URL(endpoint), credential);
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");
    });

    it("should load data from config store with aad + endpoint string", async () => {
        const endpoint = createMockedEnpoint();
        const credential = createMockedTokenCredential();
        const settings = await load(endpoint, credential);
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");
    });

    it("should throw error given invalid connection string", async () => {
        expect(load("invalid-connection-string")).eventually.rejected;
    });

    it("should throw error given invalid endpoint URL", async () => {
        const credential = createMockedTokenCredential();
        expect(load("invalid-endpoint-url", credential)).eventually.rejected;
    });

    it("should trim key prefix if applicable", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "app.settings.*",
                labelFilter: "\0"
            }],
            trimKeyPrefixes: ["app.settings."]
        });
        expect(settings).not.undefined;
        expect(settings.has("fontColor")).eq(true);
        expect(settings.get("fontColor")).eq("red");
        expect(settings.has("fontSize")).eq(true);
        expect(settings.get("fontSize")).eq("40");
        expect(settings.has("TestKey")).eq(false);
    });

    it("should trim longest key prefix first", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "app.*",
                labelFilter: "\0"
            }],
            trimKeyPrefixes: ["app.", "app.settings.", "Test"]
        });
        expect(settings).not.undefined;
        expect(settings.has("fontColor")).eq(true);
        expect(settings.get("fontColor")).eq("red");
        expect(settings.has("fontSize")).eq(true);
        expect(settings.get("fontSize")).eq("40");
        expect(settings.has("TestKey")).eq(false);
    });

    it("should support null/empty value", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;
        expect(settings.has("KeyForNullValue")).eq(true);
        expect(settings.get("KeyForNullValue")).eq(null);
        expect(settings.has("KeyForEmptyValue")).eq(true);
        expect(settings.get("KeyForEmptyValue")).eq("");
    });

    it("should not support * or , in label filters", async () => {
        const connectionString = createMockedConnectionString();
        const loadWithWildcardLabelFilter = load(connectionString, {
            selectors: [{
                keyFilter: "app.*",
                labelFilter: "*"
            }]
        });
        expect(loadWithWildcardLabelFilter).to.eventually.rejected;

        const loadWithMultipleLabelFilter = load(connectionString, {
            selectors: [{
                keyFilter: "app.*",
                labelFilter: "labelA,labelB"
            }]
        });
        expect(loadWithMultipleLabelFilter).to.eventually.rejected;
    });

    it("should override config settings with same key but different label", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "Test*",
                labelFilter: "Test"
            }, {
                keyFilter: "Test*",
                labelFilter: "Prod"
            }]
        });
        expect(settings).not.undefined;
        expect(settings.has("TestKey")).eq(true);
        expect(settings.get("TestKey")).eq("TestValueForProd");
    });
})
