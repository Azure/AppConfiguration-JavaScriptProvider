// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "./exportedApi.js";
import { mockAppConfigurationClientListConfigurationSettings, restoreMocks, createMockedConnectionString, sleepInMs, createMockedFeatureFlag, createMockedEndpoint, mockConfigurationManagerGetClients } from "./utils/testHelper.js";
import { AppConfigurationClient } from "@azure/app-configuration";
import { ConfigurationClientWrapper } from "../src/ConfigurationClientWrapper.js";

describe("load balance", function () {
    this.timeout(10000);

    beforeEach(() => {
    });

    afterEach(() => {
        restoreMocks();
    });

    it("should load balance the request when loadBalancingEnabled", async () => {
        // mock multiple pages of feature flags
        const page1 = [
            createMockedFeatureFlag("Alpha_1", { enabled: true }),
            createMockedFeatureFlag("Alpha_2", { enabled: true }),
        ];
        const page2 = [
            createMockedFeatureFlag("Beta_1", { enabled: true }),
            createMockedFeatureFlag("Beta_2", { enabled: true }),
        ];
        const fakeEndpoint_1 = createMockedEndpoint("fake_1");
        const fakeEndpoint_2 = createMockedEndpoint("fake_2");
        const fakeClientWrapper_1 = new ConfigurationClientWrapper(fakeEndpoint_1, new AppConfigurationClient(createMockedConnectionString(fakeEndpoint_1)));
        const fakeClientWrapper_2 = new ConfigurationClientWrapper(fakeEndpoint_2, new AppConfigurationClient(createMockedConnectionString(fakeEndpoint_2)));
        const mockedClientWrappers = [fakeClientWrapper_1, fakeClientWrapper_2];
        mockConfigurationManagerGetClients(mockedClientWrappers, false);
        mockAppConfigurationClientListConfigurationSettings(page1, page2);

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
        // one request for key values, one request for feature flags
        expect(fakeClientWrapper_1.failedAttempts).eq(-1);
        expect(fakeClientWrapper_2.failedAttempts).eq(-1);

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        // refresh request for feature flags
        expect(fakeClientWrapper_1.failedAttempts).eq(-2);
        expect(fakeClientWrapper_2.failedAttempts).eq(-1);

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(fakeClientWrapper_1.failedAttempts).eq(-2);
        expect(fakeClientWrapper_2.failedAttempts).eq(-2);
    });

    it("should load balance the request when loadBalancingEnabled", async () => {
        // mock multiple pages of feature flags
        const page1 = [
            createMockedFeatureFlag("Alpha_1", { enabled: true }),
            createMockedFeatureFlag("Alpha_2", { enabled: true }),
        ];
        const page2 = [
            createMockedFeatureFlag("Beta_1", { enabled: true }),
            createMockedFeatureFlag("Beta_2", { enabled: true }),
        ];
        const fakeEndpoint_1 = createMockedEndpoint("fake_1");
        const fakeEndpoint_2 = createMockedEndpoint("fake_2");
        const fakeClientWrapper_1 = new ConfigurationClientWrapper(fakeEndpoint_1, new AppConfigurationClient(createMockedConnectionString(fakeEndpoint_1)));
        const fakeClientWrapper_2 = new ConfigurationClientWrapper(fakeEndpoint_2, new AppConfigurationClient(createMockedConnectionString(fakeEndpoint_2)));
        const mockedClientWrappers = [fakeClientWrapper_1, fakeClientWrapper_2];
        mockConfigurationManagerGetClients(mockedClientWrappers, false);
        mockAppConfigurationClientListConfigurationSettings(page1, page2);

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
        // one request for key values, one request for feature flags
        expect(fakeClientWrapper_1.failedAttempts).eq(-2);
        expect(fakeClientWrapper_2.failedAttempts).eq(0);

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        // refresh request for feature flags
        expect(fakeClientWrapper_1.failedAttempts).eq(-3);
        expect(fakeClientWrapper_2.failedAttempts).eq(0);
    });
});
