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
}, {
    key: "app2.settings",
    value: JSON.stringify({ fontColor: "blue", fontSize: 20 }),
    contentType: "application/json"
}, {
    key: "app3.settings",
    value: "placeholder"
}, {
    key: "app3.settings.fontColor",
    value: "yellow"
}, {
    key: "app4.excludedFolders.0",
    value: "node_modules"
}, {
    key: "app4.excludedFolders.1",
    value: "dist"
}
].map(createMockedKeyValue);

describe("load", function () {
    this.timeout(10000);

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
        return expect(load("invalid-connection-string")).eventually.rejectedWith("Invalid connection string.");
    });

    it("should throw error given invalid endpoint URL", async () => {
        const credential = createMockedTokenCredential();
        return expect(load("invalid-endpoint-url", credential)).eventually.rejectedWith("Invalid endpoint URL.");
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
        expect(settings.get("fontColor")).eq("red");
        expect(settings.get("fontSize")).eq("40");
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
        expect(settings.get("fontColor")).eq("red");
        expect(settings.get("fontSize")).eq("40");
    });

    it("should support null/empty value", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;
        expect(settings.get("KeyForNullValue")).eq(null);
        expect(settings.get("KeyForEmptyValue")).eq("");
    });

    it("should not support * in label filters", async () => {
        const connectionString = createMockedConnectionString();
        const loadWithWildcardLabelFilter = load(connectionString, {
            selectors: [{
                keyFilter: "app.*",
                labelFilter: "*"
            }]
        });
        return expect(loadWithWildcardLabelFilter).to.eventually.rejectedWith("The characters '*' and ',' are not supported in label filters.");
    });

    it("should not support , in label filters", async () => {
        const connectionString = createMockedConnectionString();
        const loadWithMultipleLabelFilter = load(connectionString, {
            selectors: [{
                keyFilter: "app.*",
                labelFilter: "labelA,labelB"
            }]
        });
        return expect(loadWithMultipleLabelFilter).to.eventually.rejectedWith("The characters '*' and ',' are not supported in label filters.");
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
        expect(settings.get("TestKey")).eq("TestValueForProd");
    });

    it("should dedup exact same selectors but keeping the precedence", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "Test*",
                labelFilter: "Prod"
            }, {
                keyFilter: "Test*",
                labelFilter: "Test"
            }, {
                keyFilter: "Test*",
                labelFilter: "Prod"
            }]
        });
        expect(settings).not.undefined;
        expect(settings.get("TestKey")).eq("TestValueForProd");
    });

    // access data property
    it("should directly access data property", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "app.settings.*"
            }]
        });
        expect(settings).not.undefined;
        const data = settings.constructConfigurationObject();
        expect(data).not.undefined;
        expect(data.app.settings.fontColor).eq("red");
        expect(data.app.settings.fontSize).eq("40");
    });

    it("should access property of JSON object content-type with data accessor", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "app2.*"
            }]
        });
        expect(settings).not.undefined;
        const data = settings.constructConfigurationObject();
        expect(data).not.undefined;
        expect(data.app2.settings.fontColor).eq("blue");
        expect(data.app2.settings.fontSize).eq(20);
    });

    it("should not access property of JSON content-type object with get()", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "app2.*"
            }]
        });
        expect(settings).not.undefined;
        expect(settings.get("app2.settings")).not.undefined; // JSON object accessed as a whole
        expect(settings.get("app2.settings.fontColor")).undefined;
        expect(settings.get("app2.settings.fontSize")).undefined;
    });

    /**
     * Edge case: Hierarchical key-value pairs with overlapped key prefix.
     * key: "app3.settings" => value: "placeholder"
     * key: "app3.settings.fontColor" => value: "yellow"
     *
     * get() will return "placeholder" for "app3.settings" and "yellow" for "app3.settings.fontColor", as expected.
     * data.app3.settings will return "placeholder" as a whole JSON object, which is not guarenteed to be correct.
     */
    it("Edge case: Hierarchical key-value pairs with overlapped key prefix.", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "app3.settings*"
            }]
        });
        expect(settings).not.undefined;
        expect(() => {
            settings.constructConfigurationObject();
        }).to.throw("The key 'app3.settings' is not a valid path.");
    });

    it("should construct configuration object with array", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "app4.*"
            }]
        });
        expect(settings).not.undefined;
        const data = settings.constructConfigurationObject();
        expect(data).not.undefined;
        // Both { '0': 'node_modules', '1': 'dist' } and ['node_modules', 'dist'] are valid.
        expect(data.app4.excludedFolders[0]).eq("node_modules");
        expect(data.app4.excludedFolders[1]).eq("dist");
    });
});
