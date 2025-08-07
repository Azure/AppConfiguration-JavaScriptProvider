// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "./exportedApi.js";
import { MAX_TIME_OUT, mockAppConfigurationClientListConfigurationSettings, mockAppConfigurationClientGetConfigurationSetting, restoreMocks, createMockedConnectionString, createMockedKeyValue, sleepInMs, createMockedFeatureFlag } from "./utils/testHelper.js";
import * as uuid from "uuid";

let mockedKVs: any[] = [];

function updateSetting(key: string, value: any) {
    const setting = mockedKVs.find(elem => elem.key === key);
    if (setting) {
        setting.value = value;
        setting.etag = uuid.v4();
    }
}

function addSetting(key: string, value: any) {
    mockedKVs.push(createMockedKeyValue({ key, value }));
}

let listKvRequestCount = 0;
const listKvCallback = () => {
    listKvRequestCount++;
};
let getKvRequestCount = 0;
const getKvCallback = () => {
    getKvRequestCount++;
};

describe("dynamic refresh", function () {
    this.timeout(MAX_TIME_OUT);

    beforeEach(() => {
        mockedKVs = [
            { value: "red", key: "app.settings.fontColor" },
            { value: "40", key: "app.settings.fontSize" },
            { value: "30", key: "app.settings.fontSize", label: "prod" },
            { value: "someValue", key: "TestTagKey", tags: { "env": "dev" } }
        ].map(createMockedKeyValue);
        mockAppConfigurationClientListConfigurationSettings([mockedKVs], listKvCallback);
        mockAppConfigurationClientGetConfigurationSetting(mockedKVs, getKvCallback);
    });

    afterEach(() => {
        restoreMocks();
        listKvRequestCount = 0;
        getKvRequestCount = 0;
    });

    it("should throw error when refresh is not enabled but refresh is called", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        const refreshCall = settings.refresh();
        return expect(refreshCall).eventually.rejectedWith("Refresh is not enabled for key-values, feature flags or Key Vault secrets.");
    });

    it("should not allow refresh interval less than 1 second", async () => {
        const connectionString = createMockedConnectionString();
        const loadWithInvalidRefreshInterval = load(connectionString, {
            refreshOptions: {
                enabled: true,
                watchedSettings: [
                    { key: "app.settings.fontColor" }
                ],
                refreshIntervalInMs: 999
            }
        });
        return expect(loadWithInvalidRefreshInterval).eventually.rejectedWith("The refresh interval cannot be less than 1000 milliseconds.");
    });

    it("should not allow '*' in key or label", async () => {
        const connectionString = createMockedConnectionString();
        const loadWithInvalidKey = load(connectionString, {
            refreshOptions: {
                enabled: true,
                watchedSettings: [
                    { key: "app.settings.*" }
                ]
            }
        });
        const loadWithInvalidKey2 = load(connectionString, {
            refreshOptions: {
                enabled: true,
                watchedSettings: [
                    { key: "keyA,KeyB" }
                ]
            }
        });
        const loadWithInvalidLabel = load(connectionString, {
            refreshOptions: {
                enabled: true,
                watchedSettings: [
                    { key: "app.settings.fontColor", label: "*" }
                ]
            }
        });
        const loadWithInvalidLabel2 = load(connectionString, {
            refreshOptions: {
                enabled: true,
                watchedSettings: [
                    { key: "app.settings.fontColor", label: "labelA,labelB" }
                ]
            }
        });
        return Promise.all([
            expect(loadWithInvalidKey).eventually.rejectedWith("The characters '*' and ',' are not supported in key of watched settings."),
            expect(loadWithInvalidKey2).eventually.rejectedWith("The characters '*' and ',' are not supported in key of watched settings."),
            expect(loadWithInvalidLabel).eventually.rejectedWith("The characters '*' and ',' are not supported in label of watched settings."),
            expect(loadWithInvalidLabel2).eventually.rejectedWith("The characters '*' and ',' are not supported in label of watched settings.")
        ]);
    });

    it("should throw error when calling onRefresh when refresh is not enabled", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(() => settings.onRefresh(() => { })).throws("Refresh is not enabled for key-values, feature flags or Key Vault secrets.");
    });

    it("should only update values after refreshInterval", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.fontColor" }
                ]
            }
        });
        expect(listKvRequestCount).eq(1);
        expect(getKvRequestCount).eq(0);
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");

        // change setting
        updateSetting("app.settings.fontColor", "blue");

        // within refreshInterval, should not really refresh
        await settings.refresh();
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(listKvRequestCount).eq(1); // no more request should be sent during the refresh interval
        expect(getKvRequestCount).eq(0); // no more request should be sent during the refresh interval

        // after refreshInterval, should really refresh
        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(listKvRequestCount).eq(2);
        expect(getKvRequestCount).eq(1);
        expect(settings.get("app.settings.fontColor")).eq("blue");
    });

    it("should update values when watched setting is deleted", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.fontColor" }
                ]
            }
        });
        expect(listKvRequestCount).eq(1);
        expect(getKvRequestCount).eq(0);
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");

        // delete setting 'app.settings.fontColor'
        const newMockedKVs = mockedKVs.filter(elem => elem.key !== "app.settings.fontColor");
        restoreMocks();
        mockAppConfigurationClientListConfigurationSettings([newMockedKVs], listKvCallback);
        mockAppConfigurationClientGetConfigurationSetting(newMockedKVs, getKvCallback);

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(listKvRequestCount).eq(2);
        expect(getKvRequestCount).eq(2); // one conditional request to detect change and one request as part of loading all kvs (because app.settings.fontColor doesn't exist in the response of listKv request)
        expect(settings.get("app.settings.fontColor")).eq(undefined);
    });

    it("should not update values when unwatched setting changes", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.fontColor" }
                ]
            }
        });
        expect(listKvRequestCount).eq(1);
        expect(getKvRequestCount).eq(0);
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");

        updateSetting("app.settings.fontSize", "50"); // unwatched setting
        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(listKvRequestCount).eq(1);
        expect(getKvRequestCount).eq(1);
        expect(settings.get("app.settings.fontSize")).eq("40");
    });

    it("should watch multiple settings if specified", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.fontColor" },
                    { key: "app.settings.fontSize" }
                ]
            }
        });
        expect(listKvRequestCount).eq(1);
        expect(getKvRequestCount).eq(0);
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");

        // change setting
        addSetting("app.settings.bgColor", "white");
        updateSetting("app.settings.fontSize", "50");
        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(listKvRequestCount).eq(2);
        expect(getKvRequestCount).eq(2); // two getKv request for two watched settings
        expect(settings.get("app.settings.fontSize")).eq("50");
        expect(settings.get("app.settings.bgColor")).eq("white");
    });

    it("should execute callbacks on successful refresh", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.fontColor" }
                ]
            }
        });
        let count = 0;
        const callback = settings.onRefresh(() => count++);

        updateSetting("app.settings.fontColor", "blue");
        await settings.refresh();
        expect(count).eq(0);

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(count).eq(1);

        // can dispose callbacks
        callback.dispose();
        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(count).eq(1);
    });

    it("should not include watched settings into configuration if not specified in selectors", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [
                { keyFilter: "app.settings.fontColor" }
            ],
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.fontSize" }
                ]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).undefined;
    });

    it("should refresh when watched setting is added", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.bgColor" }
                ]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");

        // add setting 'app.settings.bgColor'
        addSetting("app.settings.bgColor", "white");
        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(settings.get("app.settings.bgColor")).eq("white");
    });

    it("should not refresh when watched setting keeps not existing", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.bgColor" }
                ]
            }
        });
        expect(listKvRequestCount).eq(1);
        expect(getKvRequestCount).eq(1); // app.settings.bgColor doesn't exist in the response of listKv request, so an additional getKv request is made to get it.
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");

        // update an unwatched setting
        updateSetting("app.settings.fontColor", "blue");
        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(listKvRequestCount).eq(1);
        expect(getKvRequestCount).eq(2);
        // should not refresh
        expect(settings.get("app.settings.fontColor")).eq("red");
    });

    it("should refresh key value based on page eTag, if no watched setting is specified", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000
            }
        });
        expect(listKvRequestCount).eq(1);
        expect(getKvRequestCount).eq(0);
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");

        // change setting
        updateSetting("app.settings.fontColor", "blue");

        // after refreshInterval, should really refresh
        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(listKvRequestCount).eq(3); // 1 + 2 more requests: one conditional request to detect change and one request to reload all key values
        expect(getKvRequestCount).eq(0);
        expect(settings.get("app.settings.fontColor")).eq("blue");
    });

    it("should refresh key value based on page Etag, only on change", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000
            }
        });
        expect(listKvRequestCount).eq(1);
        expect(getKvRequestCount).eq(0);

        let refreshSuccessfulCount = 0;
        settings.onRefresh(() => {
            refreshSuccessfulCount++;
        });

        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(listKvRequestCount).eq(2); // one more conditional request to detect change
        expect(getKvRequestCount).eq(0);
        expect(refreshSuccessfulCount).eq(0); // no change in key values, because page etags are the same.

        // change key value
        restoreMocks();
        const changedKVs = [
            { value: "blue", key: "app.settings.fontColor" },
            { value: "40", key: "app.settings.fontSize" }
        ].map(createMockedKeyValue);
        mockAppConfigurationClientListConfigurationSettings([changedKVs], listKvCallback);
        mockAppConfigurationClientGetConfigurationSetting(changedKVs, getKvCallback);

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(listKvRequestCount).eq(4); // 2 + 2 more requests: one conditional request to detect change and one request to reload all key values
        expect(getKvRequestCount).eq(0);
        expect(refreshSuccessfulCount).eq(1); // change in key values, because page etags are different.
        expect(settings.get("app.settings.fontColor")).eq("blue");
    });

    it("should not refresh any more when there is refresh in progress", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.fontColor" }
                ]
            }
        });
        expect(listKvRequestCount).eq(1);
        expect(getKvRequestCount).eq(0);
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");

        // change setting
        updateSetting("app.settings.fontColor", "blue");

        // after refreshInterval, should really refresh
        await sleepInMs(2 * 1000 + 1);
        for (let i = 0; i < 5; i++) { // in practice, refresh should not be used in this way
            settings.refresh(); // refresh "concurrently"
        }
        expect(listKvRequestCount).to.be.at.most(2);
        expect(getKvRequestCount).to.be.at.most(1);

        await sleepInMs(1000); // wait for all 5 refresh attempts to finish

        expect(listKvRequestCount).eq(2);
        expect(getKvRequestCount).eq(1);
        expect(settings.get("app.settings.fontColor")).eq("blue");
    });

    it("should refresh key values using tag filters", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "*",
                tagFilters: ["env=dev"]
            }],
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000
            }
        });

        expect(settings).not.undefined;

        // Verify only dev-tagged items are loaded
        expect(settings.get("TestTagKey")).eq("someValue");

        // Change the dev-tagged key value
        updateSetting("TestTagKey", "newValue");

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();

        // Verify changes are reflected
        expect(settings.get("TestTagKey")).eq("newValue");
    });
});

describe("dynamic refresh feature flags", function () {
    this.timeout(MAX_TIME_OUT);

    beforeEach(() => {
    });

    afterEach(() => {
        restoreMocks();
        listKvRequestCount = 0;
        getKvRequestCount = 0;
    });

    it("should refresh feature flags when enabled", async () => {
        mockedKVs = [
            createMockedFeatureFlag("Beta", { enabled: true })
        ];
        mockAppConfigurationClientListConfigurationSettings([mockedKVs], listKvCallback);
        mockAppConfigurationClientGetConfigurationSetting(mockedKVs, getKvCallback);

        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            featureFlagOptions: {
                enabled: true,
                selectors: [{
                    keyFilter: "Beta"
                }],
                refresh: {
                    enabled: true,
                    refreshIntervalInMs: 2000 // 2 seconds for quick test.
                }
            }
        });
        expect(listKvRequestCount).eq(2); // one listKv request for kvs and one listKv request for feature flags
        expect(getKvRequestCount).eq(0);
        expect(settings).not.undefined;
        expect(settings.get("feature_management")).not.undefined;
        expect(settings.get<any>("feature_management").feature_flags).not.undefined;
        expect(settings.get<any>("feature_management").feature_flags[0].id).eq("Beta");
        expect(settings.get<any>("feature_management").feature_flags[0].enabled).eq(true);

        // change feature flag Beta to false
        updateSetting(".appconfig.featureflag/Beta", JSON.stringify({
            "id": "Beta",
            "description": "",
            "enabled": false,
            "conditions": {
                "client_filters": []
            }
        }));

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(listKvRequestCount).eq(4); // 2 + 2 more requests: one conditional request to detect change and one request to reload all feature flags
        expect(getKvRequestCount).eq(0);

        expect(settings.get<any>("feature_management").feature_flags[0].id).eq("Beta");
        expect(settings.get<any>("feature_management").feature_flags[0].enabled).eq(false);

    });

    it("should refresh feature flags based on page etags, only on change", async () => {
        // mock multiple pages of feature flags
        const page1 = [
            createMockedFeatureFlag("Alpha_1", { enabled: true }),
            createMockedFeatureFlag("Alpha_2", { enabled: true }),
        ];
        const page2 = [
            createMockedFeatureFlag("Beta_1", { enabled: true }),
            createMockedFeatureFlag("Beta_2", { enabled: true }),
        ];
        mockAppConfigurationClientListConfigurationSettings([page1, page2], listKvCallback);
        mockAppConfigurationClientGetConfigurationSetting([...page1, ...page2], getKvCallback);

        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            featureFlagOptions: {
                enabled: true,
                selectors: [{
                    keyFilter: "*"
                }],
                refresh: {
                    enabled: true,
                    refreshIntervalInMs: 2000 // 2 seconds for quick test.
                }
            }
        });
        expect(listKvRequestCount).eq(2);
        expect(getKvRequestCount).eq(0);

        let refreshSuccessfulCount = 0;
        settings.onRefresh(() => {
            refreshSuccessfulCount++;
        });

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(listKvRequestCount).eq(3); // one conditional request to detect change
        expect(getKvRequestCount).eq(0);
        expect(refreshSuccessfulCount).eq(0); // no change in feature flags, because page etags are the same.

        // change feature flag Beta_1 to false
        page2[0] = createMockedFeatureFlag("Beta_1", { enabled: false });
        restoreMocks();
        mockAppConfigurationClientListConfigurationSettings([page1, page2], listKvCallback);
        mockAppConfigurationClientGetConfigurationSetting([...page1, ...page2], getKvCallback);

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(listKvRequestCount).eq(5); // 3 + 2 more requests: one conditional request to detect change and one request to reload all feature flags
        expect(getKvRequestCount).eq(0);
        expect(refreshSuccessfulCount).eq(1); // change in feature flags, because page etags are different.
    });

    it("should refresh feature flags using tag filters", async () => {
        mockedKVs = [
            createMockedFeatureFlag("DevFeature", { enabled: true }, { tags: { "env": "dev" } }),
            createMockedFeatureFlag("ProdFeature", { enabled: false }, { tags: { "env": "prod" } })
        ];
        mockAppConfigurationClientListConfigurationSettings([mockedKVs], listKvCallback);
        mockAppConfigurationClientGetConfigurationSetting(mockedKVs, getKvCallback);

        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            featureFlagOptions: {
                enabled: true,
                selectors: [{
                    keyFilter: "*",
                    tagFilters: ["env=dev"]
                }],
                refresh: {
                    enabled: true,
                    refreshIntervalInMs: 2000
                }
            }
        });

        expect(settings).not.undefined;

        const featureManagement = settings.get<any>("feature_management");
        expect(featureManagement).not.undefined;
        expect(featureManagement.feature_flags).not.undefined;
        expect(featureManagement.feature_flags.length).eq(1);
        expect(featureManagement.feature_flags[0].id).eq("DevFeature");
        expect(featureManagement.feature_flags[0].enabled).eq(true);

        // Change the dev-tagged feature flag
        updateSetting(".appconfig.featureflag/DevFeature", JSON.stringify({
            "id": "DevFeature",
            "enabled": false
        }));

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();

        const updatedFeatureManagement = settings.get<any>("feature_management");
        expect(updatedFeatureManagement.feature_flags[0].id).eq("DevFeature");
        expect(updatedFeatureManagement.feature_flags[0].enabled).eq(false);
    });
});
