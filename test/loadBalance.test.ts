// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "../src/index.js";
import { restoreMocks, createMockedConnectionString, createMockedKeyValue, sleepInMs, createMockedEndpoint, mockConfigurationManagerGetClients, mockAppConfigurationClientLoadBalanceMode } from "./utils/testHelper.js";
import { AppConfigurationClientWrapper } from "../src/appConfigurationClientWrapper.js";
import { AppConfigurationClient } from "../src/appConfigurationClient.js";

const mockedKVs = [
    { value: "red", key: "app.settings.fontColor" },
    { value: "40", key: "app.settings.fontSize" },
    { value: "30", key: "app.settings.fontSize", label: "prod" }
].map(createMockedKeyValue);
const fakeEndpoint_1 = createMockedEndpoint("fake_1");
const fakeEndpoint_2 = createMockedEndpoint("fake_2");
const fakeClientWrapper_1 = new AppConfigurationClientWrapper(fakeEndpoint_1, new AppConfigurationClient(createMockedConnectionString(fakeEndpoint_1)));
const fakeClientWrapper_2 = new AppConfigurationClientWrapper(fakeEndpoint_2, new AppConfigurationClient(createMockedConnectionString(fakeEndpoint_2)));
const clientCallCounts_1 = { configurationSettings: 0, enhancedFeatureFlags: 0 };
const clientCallCounts_2 = { configurationSettings: 0, enhancedFeatureFlags: 0 };

describe("load balance", function () {

    beforeEach(() => {
        clientCallCounts_1.configurationSettings = 0;
        clientCallCounts_1.enhancedFeatureFlags = 0;
        clientCallCounts_2.configurationSettings = 0;
        clientCallCounts_2.enhancedFeatureFlags = 0;
    });

    afterEach(() => {
        restoreMocks();
    });

    it("should load balance the request when loadBalancingEnabled", async () => {
        mockConfigurationManagerGetClients([fakeClientWrapper_1, fakeClientWrapper_2], false);
        mockAppConfigurationClientLoadBalanceMode([mockedKVs], fakeClientWrapper_1, clientCallCounts_1);
        mockAppConfigurationClientLoadBalanceMode([mockedKVs], fakeClientWrapper_2, clientCallCounts_2);

        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            loadBalancingEnabled: true,
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
        // Configuration-setting requests are split between clients; the dedicated feature-flag request rotates back to client 1.
        expect(clientCallCounts_1.configurationSettings).eq(1);
        expect(clientCallCounts_1.enhancedFeatureFlags).eq(1);
        expect(clientCallCounts_2.configurationSettings).eq(1);
        expect(clientCallCounts_2.enhancedFeatureFlags).eq(0);

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(clientCallCounts_1.configurationSettings).eq(1);
        expect(clientCallCounts_1.enhancedFeatureFlags).eq(2);
        expect(clientCallCounts_2.configurationSettings).eq(2);
        expect(clientCallCounts_2.enhancedFeatureFlags).eq(0);

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(clientCallCounts_1.configurationSettings).eq(1);
        expect(clientCallCounts_1.enhancedFeatureFlags).eq(3);
        expect(clientCallCounts_2.configurationSettings).eq(3);
        expect(clientCallCounts_2.enhancedFeatureFlags).eq(0);
    });

    it("should not load balance the request when loadBalance disabled", async () => {
        mockConfigurationManagerGetClients([fakeClientWrapper_1, fakeClientWrapper_2], false);
        mockAppConfigurationClientLoadBalanceMode([mockedKVs], fakeClientWrapper_1, clientCallCounts_1);
        mockAppConfigurationClientLoadBalanceMode([mockedKVs], fakeClientWrapper_2, clientCallCounts_2);

        const connectionString = createMockedConnectionString();
        // loadBalancingEnabled is default to false
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
        expect(clientCallCounts_1.configurationSettings).eq(2);
        expect(clientCallCounts_1.enhancedFeatureFlags).eq(1);
        expect(clientCallCounts_2.configurationSettings).eq(0);
        expect(clientCallCounts_2.enhancedFeatureFlags).eq(0);

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(clientCallCounts_1.configurationSettings).eq(3);
        expect(clientCallCounts_1.enhancedFeatureFlags).eq(2);
        expect(clientCallCounts_2.configurationSettings).eq(0);
        expect(clientCallCounts_2.enhancedFeatureFlags).eq(0);
    });
});
