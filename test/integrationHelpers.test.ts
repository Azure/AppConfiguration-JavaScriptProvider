// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import * as sinon from "sinon";
import { AppConfigurationClient, featureFlagContentType } from "@azure/app-configuration";
import { createHttpHeaders, createPipelineRequest } from "@azure/core-rest-pipeline";
import type { PipelineRequest, PipelineResponse } from "@azure/core-rest-pipeline";
import type { TokenCredential } from "@azure/identity";
import { createNotModifiedResponseTracker, IntegrationTestContext, REFRESH_INTERVAL_IN_MS, refreshUntil } from "./integration/helpers.js";

chai.use(chaiAsPromised);
const assert = chai.assert;

describe("integration test context", function () {
    const endpoint = "https://integration.azconfig.io";
    const credential: TokenCredential = {
        async getToken() {
            throw new Error("Fixture unit tests must not request credentials.");
        }
    };
    const sandbox = sinon.createSandbox();
    let setSetting: sinon.SinonStubbedFunction<AppConfigurationClient["setConfigurationSetting"]>;
    let deleteSetting: sinon.SinonStubbedFunction<AppConfigurationClient["deleteConfigurationSetting"]>;
    let context: IntegrationTestContext;

    beforeEach(() => {
        setSetting = sandbox.stub(AppConfigurationClient.prototype, "setConfigurationSetting").resolves();
        deleteSetting = sandbox.stub(AppConfigurationClient.prototype, "deleteConfigurationSetting").resolves();
        context = new IntegrationTestContext(endpoint, credential);
    });

    afterEach(() => {
        sandbox.restore();
    });

    it("uses a unique JS-test prefix for each context", () => {
        const otherContext = new IntegrationTestContext(endpoint, credential);
        assert.match(context.keyPrefix, /^jsprovider-it-[0-9a-f-]{36}-$/);
        assert.notEqual(context.keyPrefix, otherContext.keyPrefix);
        assert.equal(context.key("message"), `${context.keyPrefix}message`);
    });

    it("writes and cleans up exact key and label pairs without listing the store", async () => {
        const listSettings = sandbox.spy(AppConfigurationClient.prototype, "listConfigurationSettings");
        await context.setSetting("message", "Default value");
        await context.setSetting("message", "Production value", { label: "production" });

        sinon.assert.calledWithExactly(setSetting, {
            key: context.key("message"),
            value: "Default value"
        });
        sinon.assert.calledWithExactly(setSetting, {
            key: context.key("message"),
            label: "production",
            value: "Production value"
        });

        await context.cleanup();

        sinon.assert.calledTwice(deleteSetting);
        sinon.assert.calledWithExactly(deleteSetting, { key: context.key("message"), label: undefined });
        sinon.assert.calledWithExactly(deleteSetting, { key: context.key("message"), label: "production" });
        sinon.assert.notCalled(listSettings);
    });

    it("preserves content types when creating JSON fixtures", async () => {
        await context.setSetting("json", "{\"enabled\":true}", {
            label: "production",
            contentType: "application/json"
        });

        sinon.assert.calledOnceWithExactly(setSetting, {
            key: context.key("json"),
            label: "production",
            contentType: "application/json",
            value: "{\"enabled\":true}"
        });

        await context.cleanup();
        sinon.assert.calledOnceWithExactly(deleteSetting, { key: context.key("json"), label: "production" });
    });

    it("uses the reserved feature flag prefix and tracks each label for cleanup", async () => {
        await context.setFeatureFlag("enabled", true);
        await context.setFeatureFlag("enabled", false, { label: "production" });

        const key = `.appconfig.featureflag/${context.key("enabled")}`;
        assert.equal(context.featureFlagKey("enabled"), key);
        sinon.assert.calledWithExactly(setSetting, {
            key,
            contentType: featureFlagContentType,
            value: {
                id: context.key("enabled"),
                enabled: false,
                conditions: { clientFilters: [], requirementType: "Any" }
            },
            label: "production"
        });

        await context.cleanup();

        sinon.assert.calledTwice(deleteSetting);
        sinon.assert.calledWithExactly(deleteSetting, { key, label: undefined });
        sinon.assert.calledWithExactly(deleteSetting, { key, label: "production" });
    });

    it("keeps ordinary and feature flag keys with the same name separate", async () => {
        await context.setSetting("shared", "Ordinary value");
        await context.setFeatureFlag("shared", true);

        await context.cleanup();

        sinon.assert.calledTwice(deleteSetting);
        sinon.assert.calledWithExactly(deleteSetting, { key: context.key("shared"), label: undefined });
        sinon.assert.calledWithExactly(deleteSetting, { key: context.featureFlagKey("shared"), label: undefined });
    });

    it("scopes explicit deletions and retains the settings for final cleanup", async () => {
        await context.setSetting("removed", "Value", { label: "production" });
        await context.setFeatureFlag("removed", true, { label: "production" });

        await context.deleteSetting("removed", { label: "production" });
        await context.deleteFeatureFlag("removed", { label: "production" });

        sinon.assert.calledTwice(deleteSetting);
        sinon.assert.calledWithExactly(deleteSetting, { key: context.key("removed"), label: "production" });
        sinon.assert.calledWithExactly(deleteSetting, { key: context.featureFlagKey("removed"), label: "production" });

        deleteSetting.resetHistory();
        await context.cleanup();
        sinon.assert.calledTwice(deleteSetting);
        sinon.assert.calledWithExactly(deleteSetting, { key: context.key("removed"), label: "production" });
        sinon.assert.calledWithExactly(deleteSetting, { key: context.featureFlagKey("removed"), label: "production" });
    });

    it("tracks attempted feature flag writes when setup fails", async () => {
        setSetting.rejects(new Error("Feature flag write response was lost"));

        await assert.isRejected(context.setFeatureFlag("failed", true), "Feature flag write response was lost");
        await context.cleanup();

        sinon.assert.calledOnceWithExactly(deleteSetting, {
            key: context.featureFlagKey("failed"),
            label: undefined
        });
    });

    it("does not clean up another context's settings", async () => {
        const otherContext = new IntegrationTestContext(endpoint, credential);
        await context.setSetting("message", "First test");
        await otherContext.setSetting("message", "Second test");

        await context.cleanup();

        sinon.assert.calledOnceWithExactly(deleteSetting, { key: context.key("message"), label: undefined });
    });

    it("tracks repeated writes once and allows cleanup to be called again", async () => {
        await context.setSetting("message", "Initial value");
        await context.setSetting("message", "Updated value");

        await context.cleanup();
        await context.cleanup();

        sinon.assert.calledOnceWithExactly(deleteSetting, { key: context.key("message"), label: undefined });
    });

    it("cleans up attempted writes when setup fails", async () => {
        await context.setSetting("first", "Created value");
        setSetting.onSecondCall().rejects(new Error("Write response was lost"));

        await assert.isRejected(context.setSetting("second", "Possibly created value"), "Write response was lost");
        await context.cleanup();

        sinon.assert.calledTwice(deleteSetting);
        sinon.assert.calledWithExactly(deleteSetting, { key: context.key("first"), label: undefined });
        sinon.assert.calledWithExactly(deleteSetting, { key: context.key("second"), label: undefined });
    });

    it("reports cleanup failures, continues cleanup, and retains failed settings for retry", async () => {
        await context.setSetting("first", "First value");
        await context.setSetting("second", "Second value");
        deleteSetting.onFirstCall().rejects(new Error("Delete failed"));

        await assert.isRejected(context.cleanup(), AggregateError, "Failed to clean up integration test settings");

        sinon.assert.calledTwice(deleteSetting);
        sinon.assert.calledWithExactly(deleteSetting, { key: context.key("second"), label: undefined });

        deleteSetting.reset();
        deleteSetting.resolves();
        await context.cleanup();

        sinon.assert.calledOnceWithExactly(deleteSetting, { key: context.key("first"), label: undefined });
    });
});

describe("integration refresh polling", function () {
    const sandbox = sinon.createSandbox();
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
        clock = sandbox.useFakeTimers();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it("retries at the refresh interval until the expected values are observed", async () => {
        const refresh = sandbox.stub<[], Promise<void>>().resolves();
        const result = refreshUntil({ refresh }, () => refresh.callCount === 3, "updated values");

        await clock.runAllAsync();
        await result;

        sinon.assert.calledThrice(refresh);
        assert.equal(Date.now(), 2 * REFRESH_INTERVAL_IN_MS);
    });

    it("fails at the deadline even when refresh resolves without changing values", async () => {
        const refresh = sandbox.stub<[], Promise<void>>().resolves();
        const rejection = assert.isRejected(
            refreshUntil({ refresh }, () => false, "updated values"),
            "Timed out after 30000 ms waiting for updated values."
        );

        await clock.runAllAsync();
        await rejection;

        assert.equal(Date.now(), 30_000);
        assert.equal(refresh.callCount, 30_000 / REFRESH_INTERVAL_IN_MS);
    });

    it("does not accept a change observed after the deadline", async () => {
        const refresh = sandbox.stub<[], Promise<void>>().callsFake(async () => {
            clock.setSystemTime(30_001);
        });

        await assert.isRejected(refreshUntil({ refresh }, () => true, "late values"), "Timed out after 30000 ms");
        sinon.assert.calledOnce(refresh);
    });

    it("propagates refresh failures without retrying", async () => {
        const refresh = sandbox.stub<[], Promise<void>>().rejects(new Error("Refresh failed"));

        await assert.isRejected(refreshUntil({ refresh }, () => false, "updated values"), "Refresh failed");
        sinon.assert.calledOnce(refresh);
    });

    it("propagates errors in the expected-state check", async () => {
        const refresh = sandbox.stub<[], Promise<void>>().resolves();

        await assert.isRejected(refreshUntil({ refresh }, () => {
            throw new Error("Invalid configuration shape");
        }, "updated values"), "Invalid configuration shape");
        sinon.assert.calledOnce(refresh);
    });
});

describe("integration response tracking", function () {
    it("observes only 304 responses without replacing requests, responses, or failures", async () => {
        const tracker = createNotModifiedResponseTracker();
        const request = createPipelineRequest({ url: "https://integration.azconfig.io/kv" });
        const notModifiedResponse = { request, headers: createHttpHeaders(), status: 304 };
        const next = sinon.stub<[PipelineRequest], Promise<PipelineResponse>>().resolves(notModifiedResponse);

        assert.strictEqual(await tracker.policy.sendRequest(request, next), notModifiedResponse);
        sinon.assert.calledOnceWithExactly(next, request);
        assert.equal(tracker.count, 1);

        const changedResponse = { request, headers: createHttpHeaders(), status: 200 };
        next.resolves(changedResponse);
        assert.strictEqual(await tracker.policy.sendRequest(request, next), changedResponse);
        assert.equal(tracker.count, 1);

        next.rejects(new Error("Request failed"));
        await assert.isRejected(tracker.policy.sendRequest(request, next), "Request failed");
        assert.equal(tracker.count, 1);
    });
});
