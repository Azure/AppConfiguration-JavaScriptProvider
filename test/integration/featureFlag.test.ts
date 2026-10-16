// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { setTimeout as delay } from "node:timers/promises";
import { assert } from "chai";
import { DefaultAzureCredential } from "@azure/identity";
import { load } from "../../src/index.js";
import type { AzureAppConfiguration } from "../../src/index.js";
import { createNotModifiedResponseTracker, getIntegrationTestEndpoint, IntegrationTestContext, REFRESH_INTERVAL_IN_MS, refreshUntil } from "./helpers.js";

interface FeatureFlag {
    id: string;
    enabled: boolean;
    conditions: {
        client_filters: unknown[];
        requirement_type: "Any" | "All";
    };
}

function getFeatureFlags(settings: AzureAppConfiguration): FeatureFlag[] {
    const featureManagement = settings.get<{ feature_flags: FeatureFlag[] }>("feature_management");
    if (featureManagement === undefined) {
        throw new Error("Expected the provider to return feature_management.feature_flags.");
    }
    assert.hasAllKeys(featureManagement, ["feature_flags"]);
    assert.isArray(featureManagement.feature_flags);
    return featureManagement.feature_flags;
}

describe("integration: feature flags", function () {
    let endpoint: string;
    let credential: DefaultAzureCredential;
    let context: IntegrationTestContext;

    before(() => {
        endpoint = getIntegrationTestEndpoint();
        credential = new DefaultAzureCredential();
    });

    beforeEach(() => {
        context = new IntegrationTestContext(endpoint, credential);
        console.info(`Integration test key prefix: ${context.keyPrefix}`);
    });

    afterEach(async () => {
        await context.cleanup();
    });

    it("loads only flags matching the selected IDs and label", async () => {
        await context.setSetting("message", "Ordinary value");
        await context.setFeatureFlag("selected-enabled", true, { label: "production" });
        await context.setFeatureFlag("selected-enabled", false, { label: "development" });
        await context.setFeatureFlag("selected-disabled", false, { label: "production" });
        await context.setFeatureFlag("excluded", true, { label: "production" });

        const settings = await load(endpoint, credential, {
            selectors: [{ keyFilter: context.key("*") }],
            featureFlagOptions: {
                enabled: true,
                selectors: [{ keyFilter: context.key("selected-*"), labelFilter: "production" }]
            }
        });

        assert.sameDeepMembers(getFeatureFlags(settings), [
            {
                id: context.key("selected-enabled"),
                enabled: true,
                conditions: { client_filters: [], requirement_type: "Any" }
            },
            {
                id: context.key("selected-disabled"),
                enabled: false,
                conditions: { client_filters: [], requirement_type: "Any" }
            }
        ]);
        assert.equal(settings.get(context.key("message")), "Ordinary value");
        assert.sameMembers([...settings.keys()], [context.key("message"), "feature_management"]);
    });

    it("refreshes changed, added, and deleted flags independently of ordinary settings", async () => {
        await context.setSetting("message", "Initial value");
        await context.setFeatureFlag("updated", true);
        await context.setFeatureFlag("removed", false);
        const notModified = createNotModifiedResponseTracker();
        const settings = await load(endpoint, credential, {
            selectors: [{ keyFilter: context.key("*") }],
            clientOptions: {
                additionalPolicies: [{ policy: notModified.policy, position: "perCall" }]
            },
            featureFlagOptions: {
                enabled: true,
                selectors: [{ keyFilter: context.key("*") }],
                refresh: { enabled: true, refreshIntervalInMs: REFRESH_INTERVAL_IN_MS }
            }
        });
        assert.sameDeepMembers(getFeatureFlags(settings), [
            {
                id: context.key("updated"),
                enabled: true,
                conditions: { client_filters: [], requirement_type: "Any" }
            },
            {
                id: context.key("removed"),
                enabled: false,
                conditions: { client_filters: [], requirement_type: "Any" }
            }
        ]);
        assert.equal(settings.get(context.key("message")), "Initial value");

        let notifications = 0;
        const listener = settings.onRefresh(() => notifications++);
        try {
            await context.setSetting("message", "Updated ordinary value");
            await context.setFeatureFlag("updated", false);
            await context.setFeatureFlag("added", true);
            await context.deleteFeatureFlag("removed");

            await refreshUntil(settings, () => {
                const flags = getFeatureFlags(settings);
                return flags.some(flag => flag.id === context.key("updated") && !flag.enabled) &&
                    flags.some(flag => flag.id === context.key("added") && flag.enabled) &&
                    !flags.some(flag => flag.id === context.key("removed"));
            }, "feature flag updates, additions, and deletions");

            assert.sameDeepMembers(getFeatureFlags(settings), [
                {
                    id: context.key("updated"),
                    enabled: false,
                    conditions: { client_filters: [], requirement_type: "Any" }
                },
                {
                    id: context.key("added"),
                    enabled: true,
                    conditions: { client_filters: [], requirement_type: "Any" }
                }
            ]);
            assert.equal(settings.get(context.key("message")), "Initial value");
            assert.equal(notifications, 1);

            const previousNotModifiedCount = notModified.count;
            await delay(REFRESH_INTERVAL_IN_MS);
            await settings.refresh();
            assert.isAbove(notModified.count, previousNotModifiedCount);
            assert.equal(notifications, 1);
        } finally {
            listener.dispose();
        }
    });
});
