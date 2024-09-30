// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "./exportedApi.js";
import { mockAppConfigurationClientListConfigurationSettings, mockAppConfigurationClientGetConfigurationSetting, restoreMocks, createMockedConnectionString, createMockedKeyValue, sleepInMs, createMockedFeatureFlag } from "./utils/testHelper.js";
import * as uuid from "uuid";

let mockedKVs: any[] = [];
const replicaDiscoveryEnabled = false;

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

describe("dynamic refresh", function () {
    this.timeout(10000);

    beforeEach(() => {
        mockedKVs = [
            { value: "red", key: "app.settings.fontColor" },
            { value: "40", key: "app.settings.fontSize" },
            { value: "30", key: "app.settings.fontSize", label: "prod" }
        ].map(createMockedKeyValue);
        mockAppConfigurationClientListConfigurationSettings(mockedKVs);
        mockAppConfigurationClientGetConfigurationSetting(mockedKVs);
    });

    afterEach(() => {
        restoreMocks();
    });

    it("should throw error when refresh is not enabled but refresh is called", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            replicaDiscoveryEnabled: replicaDiscoveryEnabled
        });
        const refreshCall = settings.refresh();
        return expect(refreshCall).eventually.rejectedWith("Refresh is not enabled for key-values or feature flags.");
    });

    it("should only allow non-empty list of watched settings when refresh is enabled", async () => {
        const connectionString = createMockedConnectionString();
        const loadWithEmptyWatchedSettings = load(connectionString, {
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
            refreshOptions: {
                enabled: true,
                watchedSettings: []
            }
        });
        const loadWithUndefinedWatchedSettings = load(connectionString, {
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
            refreshOptions: {
                enabled: true
            }
        });
        return Promise.all([
            expect(loadWithEmptyWatchedSettings).eventually.rejectedWith("Refresh is enabled but no watched settings are specified."),
            expect(loadWithUndefinedWatchedSettings).eventually.rejectedWith("Refresh is enabled but no watched settings are specified.")
        ]);
    });

    it("should not allow refresh interval less than 1 second", async () => {
        const connectionString = createMockedConnectionString();
        const loadWithInvalidRefreshInterval = load(connectionString, {
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
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
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
            refreshOptions: {
                enabled: true,
                watchedSettings: [
                    { key: "app.settings.*" }
                ]
            }
        });
        const loadWithInvalidKey2 = load(connectionString, {
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
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
        const settings = await load(connectionString, {
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
        });
        expect(() => settings.onRefresh(() => { })).throws("Refresh is not enabled for key-values or feature flags.");
    });

    it("should only update values after refreshInterval", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.fontColor" }
                ]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");

        // change setting
        updateSetting("app.settings.fontColor", "blue");

        // within refreshInterval, should not really refresh
        await settings.refresh();
        expect(settings.get("app.settings.fontColor")).eq("red");

        // after refreshInterval, should really refresh
        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(settings.get("app.settings.fontColor")).eq("blue");
    });

    it("should update values when watched setting is deleted", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.fontColor" }
                ]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");

        // delete setting 'app.settings.fontColor'
        const newMockedKVs = mockedKVs.filter(elem => elem.key !== "app.settings.fontColor");
        restoreMocks();
        mockAppConfigurationClientListConfigurationSettings(newMockedKVs);
        mockAppConfigurationClientGetConfigurationSetting(newMockedKVs);

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(settings.get("app.settings.fontColor")).eq(undefined);
    });

    it("should not update values when unwatched setting changes", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.fontColor" }
                ]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");

        updateSetting("app.settings.fontSize", "50"); // unwatched setting
        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(settings.get("app.settings.fontSize")).eq("40");
    });

    it("should watch multiple settings if specified", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 2000,
                watchedSettings: [
                    { key: "app.settings.fontColor" },
                    { key: "app.settings.fontSize" }
                ]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");

        // change setting
        addSetting("app.settings.bgColor", "white");
        updateSetting("app.settings.fontSize", "50");
        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(settings.get("app.settings.fontSize")).eq("50");
        expect(settings.get("app.settings.bgColor")).eq("white");
    });

    it("should execute callbacks on successful refresh", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
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
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
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
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
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
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
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

        // update an unwatched setting
        updateSetting("app.settings.fontColor", "blue");
        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        // should not refresh
        expect(settings.get("app.settings.fontColor")).eq("red");
    });

});

describe("dynamic refresh feature flags", function () {
    this.timeout(10000);

    beforeEach(() => {
    });

    afterEach(() => {
        restoreMocks();
    });

    it("should refresh feature flags when enabled", async () => {
        mockedKVs = [
            createMockedFeatureFlag("Beta", { enabled: true })
        ];
        mockAppConfigurationClientListConfigurationSettings(mockedKVs);
        mockAppConfigurationClientGetConfigurationSetting(mockedKVs);

        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
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

        expect(settings.get<any>("feature_management").feature_flags[0].id).eq("Beta");
        expect(settings.get<any>("feature_management").feature_flags[0].enabled).eq(false);

    });

    it("should refresh feature flags only on change, based on page etags", async () => {
        // mock multiple pages of feature flags
        const page1 = [
            createMockedFeatureFlag("Alpha_1", { enabled: true }),
            createMockedFeatureFlag("Alpha_2", { enabled: true }),
        ];
        const page2 = [
            createMockedFeatureFlag("Beta_1", { enabled: true }),
            createMockedFeatureFlag("Beta_2", { enabled: true }),
        ];
        mockAppConfigurationClientListConfigurationSettings(page1, page2);
        mockAppConfigurationClientGetConfigurationSetting([...page1, ...page2]);

        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            replicaDiscoveryEnabled: replicaDiscoveryEnabled,
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

        let refreshSuccessfulCount = 0;
        settings.onRefresh(() => {
            refreshSuccessfulCount++;
        });

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(refreshSuccessfulCount).eq(0); // no change in feature flags, because page etags are the same.

        // change feature flag Beta_1 to false
        page2[0] = createMockedFeatureFlag("Beta_1", { enabled: false });
        restoreMocks();
        mockAppConfigurationClientListConfigurationSettings(page1, page2);
        mockAppConfigurationClientGetConfigurationSetting([...page1, ...page2]);

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(refreshSuccessfulCount).eq(1); // change in feature flags, because page etags are different.
    });
});
