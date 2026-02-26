// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/* eslint-disable @typescript-eslint/no-unused-expressions */
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;

import { AppConfigurationClient } from "@azure/app-configuration";
import { load, loadFromAzureFrontDoor } from "../src/index.js";
import { ErrorMessages } from "../src/common/errorMessages.js";
import { createMockedKeyValue, createMockedFeatureFlag, HttpRequestHeadersPolicy, getCachedIterator, sinon, restoreMocks, createMockedConnectionString, createMockedAzureFrontDoorEndpoint, sleepInMs } from "./utils/testHelper.js";
import { X_MS_DATE_HEADER } from "../src/afd/constants.js";
import { isBrowser } from "../src/requestTracing/utils.js";

function createTimestampHeaders(timestamp: string | Date) {
    const value = timestamp instanceof Date ? timestamp.toUTCString() : new Date(timestamp).toUTCString();
    return {
        get: (name: string) => name.toLowerCase() === X_MS_DATE_HEADER ? value : undefined
    };
}

describe("loadFromAzureFrontDoor", function() {

    afterEach(() => {
        restoreMocks();
    });

    it("should throw if watched settings are provided", async () => {
        await expect(loadFromAzureFrontDoor(createMockedAzureFrontDoorEndpoint(), {
            refreshOptions: {
                enabled: true,
                watchedSettings: [{ key: "sentinel" }]
            }
        })).to.be.rejectedWith(ErrorMessages.WATCHED_SETTINGS_NOT_SUPPORTED);
    });

    it("should throw if replica discovery is enabled", async () => {
        await expect(loadFromAzureFrontDoor(createMockedAzureFrontDoorEndpoint(), {
            replicaDiscoveryEnabled: true
        })).to.be.rejectedWith(ErrorMessages.REPLICA_DISCOVERY_NOT_SUPPORTED);
    });

    it("should throw if load balancing is enabled", async () => {
        await expect(loadFromAzureFrontDoor(createMockedAzureFrontDoorEndpoint(), {
            loadBalancingEnabled: true
        })).to.be.rejectedWith(ErrorMessages.LOAD_BALANCING_NOT_SUPPORTED);
    });

    it("should not include authorization and sync-token header when loading from Azure Front Door", async () => {
        const headerPolicy = new HttpRequestHeadersPolicy();
        const position: "perCall" | "perRetry" = "perCall";
        const clientOptions = {
            retryOptions: {
                maxRetries: 0
            },
            additionalPolicies: [{
                policy: headerPolicy,
                position
            }],
            syncTokens: {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                addSyncTokenFromHeaderValue: (syncTokenHeaderValue) => {},
                getSyncTokenHeaderValue: () => { return "mockedSyncToken"; }
            }
        };

        try {
            await load(createMockedConnectionString(), {
                clientOptions,
                startupOptions: {
                    timeoutInMs: 1
                }
            });
        } catch { /* empty */ }

        expect(headerPolicy.headers).not.undefined;
        expect(headerPolicy.headers.get("Authorization")).not.undefined;
        expect(headerPolicy.headers.get("Sync-Token")).to.equal("mockedSyncToken");

        try {
            await loadFromAzureFrontDoor(createMockedAzureFrontDoorEndpoint(), {
                clientOptions,
                startupOptions: {
                    timeoutInMs: 1
                }
            });
        } catch { /* empty */ }

        expect(headerPolicy.headers).not.undefined;
        let userAgent;
        // https://github.com/Azure/azure-sdk-for-js/pull/6528
        if (isBrowser()) {
            userAgent = headerPolicy.headers.get("x-ms-useragent");
        } else {
            userAgent = headerPolicy.headers.get("User-Agent");
        }

        expect(userAgent).satisfy((ua: string) => ua.startsWith("javascript-appconfiguration-provider"));
        expect(headerPolicy.headers.get("Authorization")).to.be.undefined;
        expect(headerPolicy.headers.get("Sync-Token")).to.be.undefined;
    });

    it("should load key-values and feature flags", async () => {
        const kv1 = createMockedKeyValue({ key: "app.color", value: "red" });
        const kv2 = createMockedKeyValue({ key: "app.size", value: "large" });
        const ff = createMockedFeatureFlag("Beta");

        const stub = sinon.stub(AppConfigurationClient.prototype, "listConfigurationSettings");

        stub.onCall(0).returns(getCachedIterator([
            { items: [kv1, kv2], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));
        stub.onCall(1).returns(getCachedIterator([
            { items: [ff], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));

        const appConfig = await loadFromAzureFrontDoor(createMockedAzureFrontDoorEndpoint(), {
            selectors: [{ keyFilter: "app.*" }],
            featureFlagOptions: {
                enabled: true
            }
        });

        expect(appConfig.get("app.color")).to.equal("red");
        expect(appConfig.get("app.size")).to.equal("large");
        expect((appConfig.get<any>("feature_management").feature_flags as any[]).find(ff => ff.id === "Beta")).not.undefined;
    });

    it("should refresh key-values if any page changes", async () => {
        const kv1 = createMockedKeyValue({ key: "app.key1", value: "value1" });
        const kv2 = createMockedKeyValue({ key: "app.key2", value: "value2" });
        const kv2_updated = createMockedKeyValue({ key: "app.key2", value: "value2-updated" });
        const kv3 = createMockedKeyValue({ key: "app.key3", value: "value3" });

        const listStub = sinon.stub(AppConfigurationClient.prototype, "listConfigurationSettings");
        const checkStub = sinon.stub(AppConfigurationClient.prototype, "checkConfigurationSettings" as any);

        // Initial load
        listStub.onCall(0).returns(getCachedIterator([
            { items: [kv1, kv2], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));

        // 1st refresh: check (HEAD) detects change, then reload (GET)
        checkStub.onCall(0).returns(getCachedIterator([
            { items: [kv1, kv2_updated], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:01Z") } }
        ]));
        listStub.onCall(1).returns(getCachedIterator([
            { items: [kv1, kv2_updated], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:01Z") } }
        ]));

        // 2nd refresh: check (HEAD) detects change, then reload (GET)
        checkStub.onCall(1).returns(getCachedIterator([
            { items: [kv1], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:03Z") } }
        ]));
        listStub.onCall(2).returns(getCachedIterator([
            { items: [kv1], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:03Z") } }
        ]));

        // 3rd refresh: check (HEAD) detects change, then reload (GET)
        checkStub.onCall(2).returns(getCachedIterator([
            { items: [kv1, kv3], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:05Z") } }
        ]));
        listStub.onCall(3).returns(getCachedIterator([
            { items: [kv1, kv3], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:05Z") } }
        ]));

        const appConfig = await loadFromAzureFrontDoor(createMockedAzureFrontDoorEndpoint(), {
            selectors: [{ keyFilter: "app.*" }],
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 1000
            }
        }); // 1 call listConfigurationSettings

        expect(appConfig.get("app.key1")).to.equal("value1");
        expect(appConfig.get("app.key2")).to.equal("value2");

        await sleepInMs(1500); // key2 updated
        await appConfig.refresh(); // 1 call listConfigurationSettings for watching changes and 1 call for reloading

        expect(appConfig.get("app.key2")).to.equal("value2-updated");

        await sleepInMs(1500); // key2 deleted
        await appConfig.refresh(); // 1 call listConfigurationSettings for watching changes and 1 call for reloading

        expect(appConfig.get("app.key2")).to.be.undefined;

        await sleepInMs(1500); // key3 added
        await appConfig.refresh(); // 1 call listConfigurationSettings for watching changes and 1 call for reloading

        expect(appConfig.get("app.key3")).to.equal("value3");
    });

    it("should refresh feature flags if any page changes", async () => {
        const ff = createMockedFeatureFlag("Beta");
        const ff_updated = createMockedFeatureFlag("Beta", { enabled: false });

        const listStub = sinon.stub(AppConfigurationClient.prototype, "listConfigurationSettings");
        const checkStub = sinon.stub(AppConfigurationClient.prototype, "checkConfigurationSettings" as any);

        // Initial load: onCall(0) = default KV selector, onCall(1) = feature flags
        listStub.onCall(0).returns(getCachedIterator([
            { items: [ff], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));
        listStub.onCall(1).returns(getCachedIterator([
            { items: [ff], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));

        // 1st refresh: check (HEAD) detects change, then reload (GET)
        checkStub.onCall(0).returns(getCachedIterator([
            { items: [ff_updated], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:03Z") } }
        ]));
        listStub.onCall(2).returns(getCachedIterator([
            { items: [ff_updated], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:03Z") } }
        ]));

        const appConfig = await loadFromAzureFrontDoor(createMockedAzureFrontDoorEndpoint(), {
            featureFlagOptions: {
                enabled: true,
                refresh: {
                    enabled: true,
                    refreshIntervalInMs: 1000
                }
            }
        });

        let featureFlags = appConfig.get<any>("feature_management").feature_flags;
        expect(featureFlags[0].id).to.equal("Beta");
        expect(featureFlags[0].enabled).to.equal(true);

        await sleepInMs(1500);
        await appConfig.refresh();

        featureFlags = appConfig.get<any>("feature_management").feature_flags;
        expect(featureFlags[0].id).to.equal("Beta");
        expect(featureFlags[0].enabled).to.equal(false);
    });

    it("should not refresh if the response is stale", async () => {
        const kv1 = createMockedKeyValue({ key: "app.key1", value: "value1" });
        const kv1_stale = createMockedKeyValue({ key: "app.key1", value: "stale-value" });
        const kv1_new = createMockedKeyValue({ key: "app.key1", value: "new-value" });

        const listStub = sinon.stub(AppConfigurationClient.prototype, "listConfigurationSettings");
        const checkStub = sinon.stub(AppConfigurationClient.prototype, "checkConfigurationSettings" as any);

        // Initial load
        listStub.onCall(0).returns(getCachedIterator([
            { items: [kv1], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:01Z") } }
        ]));

        // 1st refresh: check (HEAD) returns stale response, should not trigger refresh
        checkStub.onCall(0).returns(getCachedIterator([
            { items: [kv1_stale], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));
        // 2nd refresh: check (HEAD) detects change, then reload (GET)
        checkStub.onCall(1).returns(getCachedIterator([
            { items: [kv1_new], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:02Z") } }
        ]));
        listStub.onCall(1).returns(getCachedIterator([
            { items: [kv1_new], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:02Z") } }
        ]));

        const appConfig = await loadFromAzureFrontDoor(createMockedAzureFrontDoorEndpoint(), {
            selectors: [{ keyFilter: "app.*" }],
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 1000
            }
        }); // 1 call listConfigurationSettings

        expect(appConfig.get("app.key1")).to.equal("value1");

        await sleepInMs(1500);
        await appConfig.refresh(); // 1 call listConfigurationSettings for watching changes
        expect(appConfig.get("app.key1")).to.equal("value1"); // value should not be updated

        await sleepInMs(1500);
        await appConfig.refresh(); // 1 call listConfigurationSettings for watching changes and 1 call for reloading
        expect(appConfig.get("app.key1")).to.equal("new-value");
    });
});
/* eslint-ensable @typescript-eslint/no-unused-expressions */
