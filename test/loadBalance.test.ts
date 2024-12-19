// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "./exportedApi.js";
import { MAX_TIME_OUT, restoreMocks, createMockedConnectionString, createMockedKeyValue, sleepInMs, createMockedEndpoint, mockConfigurationManagerGetClients, mockAppConfigurationClientLoadBalanceMode } from "./utils/testHelper.js";
import { AppConfigurationClient } from "@azure/app-configuration";
import { ConfigurationClientWrapper } from "../src/ConfigurationClientWrapper.js";

const mockedKVs = [
    { value: "red", key: "app.settings.fontColor" },
    { value: "40", key: "app.settings.fontSize" },
    { value: "30", key: "app.settings.fontSize", label: "prod" }
].map(createMockedKeyValue);
const fakeEndpoint_1 = createMockedEndpoint("fake_1");
const fakeEndpoint_2 = createMockedEndpoint("fake_2");
const fakeClientWrapper_1 = new ConfigurationClientWrapper(fakeEndpoint_1, new AppConfigurationClient(createMockedConnectionString(fakeEndpoint_1)));
const fakeClientWrapper_2 = new ConfigurationClientWrapper(fakeEndpoint_2, new AppConfigurationClient(createMockedConnectionString(fakeEndpoint_2)));
const clientRequestCounter_1 = {count: 0};
const clientRequestCounter_2 = {count: 0};

describe("load balance", function () {
    this.timeout(MAX_TIME_OUT);

    beforeEach(() => {
    });

    afterEach(() => {
        restoreMocks();
    });

    it("should load balance the request when loadBalancingEnabled", async () => {
        mockConfigurationManagerGetClients([fakeClientWrapper_1, fakeClientWrapper_2], false);
        mockAppConfigurationClientLoadBalanceMode([mockedKVs], fakeClientWrapper_1, clientRequestCounter_1);
        mockAppConfigurationClientLoadBalanceMode([mockedKVs], fakeClientWrapper_2, clientRequestCounter_2);

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
        expect(clientRequestCounter_1.count).eq(1);
        expect(clientRequestCounter_2.count).eq(1);

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        // refresh request for feature flags
        expect(clientRequestCounter_1.count).eq(2);
        expect(clientRequestCounter_2.count).eq(1);

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        expect(clientRequestCounter_1.count).eq(2);
        expect(clientRequestCounter_2.count).eq(2);
    });

    it("should not load balance the request when loadBalance disabled", async () => {
        clientRequestCounter_1.count = 0;
        clientRequestCounter_2.count = 0;
        mockConfigurationManagerGetClients([fakeClientWrapper_1, fakeClientWrapper_2], false);
        mockAppConfigurationClientLoadBalanceMode([mockedKVs], fakeClientWrapper_1, clientRequestCounter_1);
        mockAppConfigurationClientLoadBalanceMode([mockedKVs], fakeClientWrapper_2, clientRequestCounter_2);

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
        expect(clientRequestCounter_1.count).eq(2);
        expect(clientRequestCounter_2.count).eq(0);

        await sleepInMs(2 * 1000 + 1);
        await settings.refresh();
        // refresh request for feature flags
        expect(clientRequestCounter_1.count).eq(3);
        expect(clientRequestCounter_2.count).eq(0);
    });
});
