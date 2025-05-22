// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "./exportedApi.js";
import { MAX_TIME_OUT, mockAppConfigurationClientListConfigurationSettings, mockAppConfigurationClientGetSnapshot, mockAppConfigurationClientListConfigurationSettingsForSnapshot, restoreMocks, createMockedConnectionString, createMockedEndpoint, createMockedTokenCredential, createMockedKeyValue } from "./utils/testHelper.js";

const mockedKVs = [{
    key: "app.settings.fontColor",
    value: "red",
}, {
    key: "app.settings.fontSize",
    value: "40",
}, {
    key: "app/settings/fontColor",
    value: "red",
}, {
    key: "app/settings/fontSize",
    value: "40",
}, {
    key: "app%settings%fontColor",
    value: "red",
}, {
    key: "app%settings%fontSize",
    value: "40",
}, {
    key: "TestKey",
    label: "Test",
    tags: {"testTag": ""},
    value: "TestValue",
}, {
    key: "TestKey",
    label: "Prod",
    tags: {"testTag": ""},
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
}, {
    key: "app5.settings.fontColor",
    value: "yellow"
}, {
    key: "app5.settings",
    value: "placeholder"
}, {
    key: ".appconfig.featureflag/Beta",
    value: JSON.stringify({
        "id": "Beta",
        "description": "",
        "enabled": true,
        "conditions": {
            "client_filters": []
        }
    }),
    contentType: "application/vnd.microsoft.appconfig.ff+json;charset=utf-8"
}, {
    key: "keyWithMultipleTags",
    value: "someValue",
    tags: {"tag1": "someValue", "tag2": "someValue"}
}, {
    key: "keyWithTag1",
    value: "someValue",
    tags: {"tag1": "someValue"}
}, {
    key: "keyWithTag2",
    value: "someValue",
    tags: {"tag2": "someValue"}
}
].map(createMockedKeyValue);

describe("load", function () {
    this.timeout(MAX_TIME_OUT);

    before(() => {
        mockAppConfigurationClientListConfigurationSettings([mockedKVs]);
    });

    after(() => {
        restoreMocks();
    });

    it("should load data from config store with connection string", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");
    });

    it("should load data from config store with aad + endpoint URL", async () => {
        const endpoint = createMockedEndpoint();
        const credential = createMockedTokenCredential();
        const settings = await load(new URL(endpoint), credential);
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");
    });

    it("should load data from config store with aad + endpoint string", async () => {
        const endpoint = createMockedEndpoint();
        const credential = createMockedTokenCredential();
        const settings = await load(endpoint, credential);
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");
    });

    it("should throw error given invalid connection string", async () => {
        return expect(load("invalid-connection-string")).eventually.rejectedWith("Invalid connection string");
    });

    it("should throw error given invalid endpoint URL", async () => {
        const credential = createMockedTokenCredential();
        return expect(load("invalid-endpoint-url", credential)).eventually.rejectedWith("Invalid URL");
    });

    it("should throw error given invalid selector", async () => {
        const connectionString = createMockedConnectionString();
        return expect(load(connectionString, {
            selectors: [{
                labelFilter: "\0"
            }]
        })).eventually.rejectedWith("Key filter cannot be null or empty.");
    });

    it("should throw error given invalid snapshot selector", async () => {
        const connectionString = createMockedConnectionString();
        return expect(load(connectionString, {
            selectors: [{
                snapshotName: "Test",
                labelFilter: "\0"
            }]
        })).eventually.rejectedWith("Key or label filter should not be used for a snapshot.");
    });

    it("should not include feature flags directly in the settings", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;
        expect(settings.get(".appconfig.featureflag/Beta")).undefined;
    });

    it("should filter by key and label, has(key) and get(key) should work", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "app.settings.*",
                labelFilter: "\0"
            }]
        });
        expect(settings).not.undefined;
        expect(settings.has("app.settings.fontColor")).true;
        expect(settings.has("app.settings.fontSize")).true;
        expect(settings.has("app.settings.fontFamily")).false;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");
        expect(settings.get("app.settings.fontFamily")).undefined;
    });

    it("should filter by tags, has(key) and get(key) should work", async () => {
        const connectionString = createMockedConnectionString();
        const loadWithTag1 = await load(connectionString, {
            selectors: [{
                tagFilters: ["tag1=someValue"]
            }]
        });
        expect(loadWithTag1.has("keyWithTag1")).true;
        expect(loadWithTag1.get("keyWithTag1")).eq("someValue");
        expect(loadWithTag1.has("keyWithTag2")).false;
        expect(loadWithTag1.has("keyWithMultipleTags")).true;
        expect(loadWithTag1.get("keyWithMultipleTags")).eq("someValue");

        const loadWithMultipleTags = await load(connectionString, {
            selectors: [{
                tagFilters: ["tag1=someValue", "tag2=someValue"]
            }]
        });
        expect(loadWithMultipleTags.has("keyWithTag1")).false;
        expect(loadWithMultipleTags.has("keyWithTag2")).false;
        expect(loadWithMultipleTags.has("keyWithMultipleTags")).true;
        expect(loadWithMultipleTags.get("keyWithMultipleTags")).eq("someValue");
    });

    it("should also work with other ReadonlyMap APIs", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "app.settings.*",
                labelFilter: "\0"
            }]
        });
        expect(settings).not.undefined;
        // size
        expect(settings.size).eq(2);
        // keys()
        expect(Array.from(settings.keys())).deep.eq(["app.settings.fontColor", "app.settings.fontSize"]);
        // values()
        expect(Array.from(settings.values())).deep.eq(["red", "40"]);
        // entries()
        expect(Array.from(settings.entries())).deep.eq([["app.settings.fontColor", "red"], ["app.settings.fontSize", "40"]]);
        // forEach()
        const keys: string[] = [];
        const values: string[] = [];
        settings.forEach((value, key) => {
            keys.push(key);
            values.push(value);
        });
        expect(keys).deep.eq(["app.settings.fontColor", "app.settings.fontSize"]);
        expect(values).deep.eq(["red", "40"]);
        // [Symbol.iterator]()
        const entries: [string, string][] = [];
        for (const [key, value] of settings) {
            entries.push([key, value]);
        }
        expect(entries).deep.eq([["app.settings.fontColor", "red"], ["app.settings.fontSize", "40"]]);
    });

    it("should be read-only, set(key, value) should not work", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "app.settings.*",
                labelFilter: "\0"
            }]
        });
        expect(settings).not.undefined;
        expect(() => {
            // Here force to turn if off for testing purpose, as JavaScript does not have type checking.
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            settings.set("app.settings.fontColor", "blue");
        }).to.throw("settings.set is not a function");
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

    it("should throw exception when there is any invalid tag filter", async () => {
        const connectionString = createMockedConnectionString();
        const loadWithInvalidTagFilter = load(connectionString, {
            selectors: [{
                tagFilters: ["testTag"]
            }]
        });
        return expect(loadWithInvalidTagFilter).to.eventually.rejectedWith("Tag filter must follow the format \"tagName=tagValue\"");
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

    it("should deduplicate exact same selectors but keeping the precedence", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "Test*",
                labelFilter: "Prod",
                tagFilters: ["testTag="]
            }, {
                keyFilter: "Test*",
                labelFilter: "Test"
            }, {
                keyFilter: "Test*",
                labelFilter: "Prod",
                tagFilters: ["testTag="]
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
     * data.app3.settings will return "placeholder" as a whole JSON object, which is not guaranteed to be correct.
     */
    it("Edge case 1: Hierarchical key-value pairs with overlapped key prefix.", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "app3.settings*"
            }]
        });
        expect(settings).not.undefined;
        expect(() => {
            settings.constructConfigurationObject();
        }).to.throw("Ambiguity occurs when constructing configuration object from key 'app3.settings.fontColor', value 'yellow'. The path 'app3.settings' has been occupied.");
    });

    /**
     * Edge case: Hierarchical key-value pairs with overlapped key prefix.
     * key: "app5.settings.fontColor" => value: "yellow"
     * key: "app5.settings" => value: "placeholder"
     *
     * When constructConfigurationObject() is called, it first constructs from key "app5.settings.fontColor" and then from key "app5.settings".
     * An error will be thrown when constructing from key "app5.settings" because there is ambiguity between the two keys.
     */
    it("Edge case 2: Hierarchical key-value pairs with overlapped key prefix.", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "app5.settings*"
            }]
        });
        expect(settings).not.undefined;
        expect(() => {
            settings.constructConfigurationObject();
        }).to.throw("Ambiguity occurs when constructing configuration object from key 'app5.settings', value 'placeholder'. The key should not be part of another key.");
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

    it("should construct configuration object with customized separator", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "app/settings/*"
            }]
        });
        expect(settings).not.undefined;
        const data = settings.constructConfigurationObject({ separator: "/" });
        expect(data).not.undefined;
        expect(data.app.settings.fontColor).eq("red");
        expect(data.app.settings.fontSize).eq("40");
    });

    it("should throw error when construct configuration object with invalid separator", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "app%settings%*"
            }]
        });
        expect(settings).not.undefined;

        expect(() => {
            // Below line will throw error because of type checking, i.e. Type '"%"' is not assignable to type '"/" | "." | "," | ";" | "-" | "_" | "__" | ":" | undefined'.ts(2322)
            // Here force to turn if off for testing purpose, as JavaScript does not have type checking.
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            settings.constructConfigurationObject({ separator: "%" });
        }).to.throw("Invalid separator '%'. Supported values: '.', ',', ';', '-', '_', '__', '/', ':'.");
    });

    it("should load key values from snapshot", async () => {
        const snapshotName = "Test";
        mockAppConfigurationClientGetSnapshot(snapshotName, {compositionType: "key"});
        mockAppConfigurationClientListConfigurationSettingsForSnapshot(snapshotName, [[{key: "TestKey", value: "TestValue"}].map(createMockedKeyValue)]);
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                snapshotName: snapshotName
            }]
        });
        expect(settings).not.undefined;
        expect(settings).not.undefined;
        expect(settings.get("TestKey")).eq("TestValue");
        restoreMocks();
    });
});
