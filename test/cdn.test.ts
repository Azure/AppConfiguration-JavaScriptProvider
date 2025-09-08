// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/* eslint-disable @typescript-eslint/no-unused-expressions */
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;

import { AppConfigurationClient } from "@azure/app-configuration";
import { loadFromAzureFrontDoor } from "../src/index.js";
import { createMockedKeyValue, createMockedFeatureFlag, HttpRequestHeadersPolicy, getCachedIterator, sinon, restoreMocks, createMockedAzureFrontDoorEndpoint, sleepInMs } from "./utils/testHelper.js";
import { TIMESTAMP_HEADER } from "../src/cdn/constants.js";

function createTimestampHeaders(timestamp: string | Date) {
    const value = timestamp instanceof Date ? timestamp.toUTCString() : new Date(timestamp).toUTCString();
    return {
        get: (name: string) => name.toLowerCase() === TIMESTAMP_HEADER ? value : undefined
    };
}

describe("loadFromAzureFrontDoor", function() {

    afterEach(() => {
        restoreMocks();
    });

    it("should not include authorization headers", async () => {
        const headerPolicy = new HttpRequestHeadersPolicy();
        const position: "perCall" | "perRetry" = "perCall";
        const clientOptions = {
            retryOptions: {
                maxRetries: 0 // save time
            },
            additionalPolicies: [{
                policy: headerPolicy,
                position
            }]
        };

        const endpoint = createMockedAzureFrontDoorEndpoint();
        try {
            await loadFromAzureFrontDoor(endpoint, {
                clientOptions,
                startupOptions: {
                    timeoutInMs: 1
                }
            });
        } catch { /* empty */ }

        expect(headerPolicy.headers).not.undefined;
        expect(headerPolicy.headers.get("User-Agent")).satisfy((ua: string) => ua.startsWith("javascript-appconfiguration-provider"));
        expect(headerPolicy.headers.get("authorization")).to.be.undefined;
        expect(headerPolicy.headers.get("Authorization")).to.be.undefined;
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

        const endpoint = createMockedAzureFrontDoorEndpoint();
        const appConfig = await loadFromAzureFrontDoor(endpoint, {
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

        const stub = sinon.stub(AppConfigurationClient.prototype, "listConfigurationSettings");

        stub.onCall(0).returns(getCachedIterator([
            { items: [kv1, kv2], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));

        stub.onCall(1).returns(getCachedIterator([
            { items: [kv1, kv2_updated], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));
        stub.onCall(2).returns(getCachedIterator([
            { items: [kv1, kv2_updated], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));

        stub.onCall(3).returns(getCachedIterator([
            { items: [kv1], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));
        stub.onCall(4).returns(getCachedIterator([
            { items: [kv1], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));

        stub.onCall(5).returns(getCachedIterator([
            { items: [kv1, kv3], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));
        stub.onCall(6).returns(getCachedIterator([
            { items: [kv1, kv3], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));

        const endpoint = createMockedAzureFrontDoorEndpoint();
        const appConfig = await loadFromAzureFrontDoor(endpoint, {
            selectors: [{ keyFilter: "app.*" }],
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 1000
            }
        });

        expect(appConfig.get("app.key1")).to.equal("value1");
        expect(appConfig.get("app.key2")).to.equal("value2");

        await sleepInMs(1000);
        await appConfig.refresh();

        expect(appConfig.get("app.key2")).to.equal("value2-updated");

        await sleepInMs(1000);
        await appConfig.refresh();

        expect(appConfig.get("app.key2")).to.be.undefined;

        await sleepInMs(1000);
        await appConfig.refresh();

        expect(appConfig.get("app.key3")).to.equal("value3");
    });

    it("should refresh feature flags if any page changes", async () => {
        const ff = createMockedFeatureFlag("Beta");
        const ff_updated = createMockedFeatureFlag("Beta", { enabled: false });

        const stub = sinon.stub(AppConfigurationClient.prototype, "listConfigurationSettings");

        stub.onCall(0).returns(getCachedIterator([
            { items: [ff], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));
        stub.onCall(1).returns(getCachedIterator([
            { items: [ff], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));

        stub.onCall(2).returns(getCachedIterator([
            { items: [ff_updated], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));
        stub.onCall(3).returns(getCachedIterator([
            { items: [ff_updated], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));

        const endpoint = createMockedAzureFrontDoorEndpoint();
        const appConfig = await loadFromAzureFrontDoor(endpoint, {
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

        await sleepInMs(1000);
        await appConfig.refresh();

        featureFlags = appConfig.get<any>("feature_management").feature_flags;
        expect(featureFlags[0].id).to.equal("Beta");
        expect(featureFlags[0].enabled).to.equal(false);
    });

    it("should keep refreshing key value until cache expires", async () => {
        const sentinel = createMockedKeyValue({ key: "sentinel", value: "initial value" });
        const sentinel_updated = createMockedKeyValue({ key: "sentinel", value: "updated value" });
        const kv1 = createMockedKeyValue({ key: "app.key1", value: "value1" });
        const kv2 = createMockedKeyValue({ key: "app.key2", value: "value2" });
        const kv2_updated = createMockedKeyValue({ key: "app.key2", value: "value2-updated" });

        const getStub = sinon.stub(AppConfigurationClient.prototype, "getConfigurationSetting");
        const listStub = sinon.stub(AppConfigurationClient.prototype, "listConfigurationSettings");

        getStub.onCall(0).returns(Promise.resolve({ statusCode: 200, _response: { headers: createTimestampHeaders("2025-09-07T00:00:00Z") }, ...sentinel } as any));
        getStub.onCall(1).returns(Promise.resolve({ statusCode: 200, _response: { headers: createTimestampHeaders("2025-09-07T00:00:01Z") }, ...sentinel_updated } as any));
        getStub.onCall(2).returns(Promise.resolve({ statusCode: 200, _response: { headers: createTimestampHeaders("2025-09-07T00:00:01Z") }, ...sentinel_updated } as any));

        getStub.onCall(3).returns(Promise.resolve({ statusCode: 200, _response: { headers: createTimestampHeaders("2025-09-07T00:00:01Z") }, ...sentinel_updated } as any));
        getStub.onCall(4).returns(Promise.resolve({ statusCode: 200, _response: { headers: createTimestampHeaders("2025-09-07T00:00:01Z") }, ...sentinel_updated } as any));

        listStub.onCall(0).returns(getCachedIterator([
            { items: [kv1, kv2], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } }
        ]));
        listStub.onCall(1).returns(getCachedIterator([
            { items: [kv1, kv2], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:00Z") } } // cache has not expired
        ]));
        listStub.onCall(2).returns(getCachedIterator([
            { items: [kv1, kv2_updated], response: { status: 200, headers: createTimestampHeaders("2025-09-07T00:00:02Z") } } // cache has expired
        ]));

        const endpoint = createMockedAzureFrontDoorEndpoint();
        const appConfig = await loadFromAzureFrontDoor(endpoint, {
            selectors: [{ keyFilter: "app.*" }],
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: 1000,
                watchedSettings: [
                    { key: "sentinel" }
                ]
            }
        });

        expect(appConfig.get("app.key2")).to.equal("value2");

        await sleepInMs(1000);
        await appConfig.refresh();

        // cdn cache hasn't expired, even if the sentinel key changed, key2 should still return the old value
        expect(appConfig.get("app.key2")).to.equal("value2");

        await sleepInMs(1000);
        await appConfig.refresh();

        // cdn cache has expired, key2 should return the updated value even if sentinel remains the same
        expect(appConfig.get("app.key2")).to.equal("value2-updated");
    });
});
/* eslint-ensable @typescript-eslint/no-unused-expressions */
