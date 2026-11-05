// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { setTimeout as delay } from "node:timers/promises";
import { assert } from "chai";
import { DefaultAzureCredential } from "@azure/identity";
import { LabelFilter, load } from "../../src/index.js";
import { createNotModifiedResponseTracker, getFeatureFlags, INTEGRATION_TEST_ENDPOINT as endpoint, IntegrationTestContext, REFRESH_INTERVAL_IN_MS, refreshUntil } from "./helpers.js";

describe("integration: enhanced feature flags", function () {
    let credential: DefaultAzureCredential;
    let context: IntegrationTestContext;

    before(() => {
        credential = new DefaultAzureCredential();
    });

    beforeEach(() => {
        context = new IntegrationTestContext(endpoint, credential);
        console.info(`Integration test key prefix: ${context.keyPrefix}`);
    });

    afterEach(async () => {
        await context.cleanup();
    });

    it("loads enhanced flags matching the selected names and label without classic flags", async () => {
        await context.setEnhancedFeatureFlag("selected-enabled", true, { label: "production" });
        await context.setEnhancedFeatureFlag("selected-enabled", false, { label: "development" });
        await context.setEnhancedFeatureFlag("selected-disabled", false, { label: "production" });
        await context.setEnhancedFeatureFlag("selected-unlabeled", true);
        await context.setEnhancedFeatureFlag("excluded", true, { label: "production" });

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
                conditions: { client_filters: [], requirement_type: "Any" },
                variants: []
            },
            {
                id: context.key("selected-disabled"),
                enabled: false,
                conditions: { client_filters: [], requirement_type: "Any" },
                variants: []
            }
        ]);
        assert.deepEqual([...settings.keys()], ["feature_management"]);
    });

    it("loads classic and enhanced flags with distinct names together", async () => {
        await context.setSetting("message", "Ordinary value");
        await context.setFeatureFlag("classic-only", true);
        await context.setEnhancedFeatureFlag("enhanced-only", false);

        const settings = await load(endpoint, credential, {
            selectors: [{ keyFilter: context.key("*") }],
            featureFlagOptions: {
                enabled: true,
                selectors: [{ keyFilter: context.key("*") }]
            }
        });

        assert.sameDeepMembers(getFeatureFlags(settings), [
            {
                id: context.key("classic-only"),
                enabled: true,
                conditions: { client_filters: [], requirement_type: "Any" }
            },
            {
                id: context.key("enhanced-only"),
                enabled: false,
                conditions: { client_filters: [], requirement_type: "Any" },
                variants: []
            }
        ]);
        assert.equal(settings.get(context.key("message")), "Ordinary value");
        assert.sameMembers([...settings.keys()], [context.key("message"), "feature_management"]);
    });

    for (const enhancedEnabled of [false, true]) {
        it(`prefers a same-name enhanced flag with enabled=${enhancedEnabled} over the opposite classic value`, async () => {
            const enhancedOptions = {
                description: "Enhanced definition",
                conditions: {
                    requirementType: "All",
                    filters: [{ name: "Microsoft.Percentage", parameters: { Value: "25" } }]
                }
            };
            if (enhancedEnabled) {
                await context.setEnhancedFeatureFlag("shared", enhancedEnabled, enhancedOptions);
                await context.setFeatureFlag("shared", !enhancedEnabled);
            } else {
                await context.setFeatureFlag("shared", !enhancedEnabled);
                await context.setEnhancedFeatureFlag("shared", enhancedEnabled, enhancedOptions);
            }

            const settings = await load(endpoint, credential, {
                selectors: [{ keyFilter: context.key("*") }],
                featureFlagOptions: {
                    enabled: true,
                    selectors: [{ keyFilter: context.key("*") }]
                }
            });

            assert.deepEqual(getFeatureFlags(settings), [{
                id: context.key("shared"),
                enabled: enhancedEnabled,
                description: "Enhanced definition",
                conditions: {
                    requirement_type: "All",
                    client_filters: [{ name: "Microsoft.Percentage", parameters: { Value: "25" } }]
                },
                variants: []
            }]);
        });
    }

    it("does not let an unselected enhanced label hide a selected classic flag", async () => {
        await context.setFeatureFlag("shared", true, { label: "production" });
        await context.setEnhancedFeatureFlag("shared", false, { label: "development" });

        const settings = await load(endpoint, credential, {
            selectors: [{ keyFilter: context.key("*") }],
            featureFlagOptions: {
                enabled: true,
                selectors: [{ keyFilter: context.key("*"), labelFilter: "production" }]
            }
        });

        assert.deepEqual(getFeatureFlags(settings), [{
            id: context.key("shared"),
            enabled: true,
            conditions: { client_filters: [], requirement_type: "Any" }
        }]);
    });

    it("gives enhanced flags precedence across selected labels regardless of selector order", async () => {
        await context.setFeatureFlag("shared", true, { label: "production" });
        await context.setEnhancedFeatureFlag("shared", false);
        const selectors = [
            { keyFilter: context.key("*"), labelFilter: LabelFilter.Null },
            { keyFilter: context.key("*"), labelFilter: "production" }
        ];

        for (const orderedSelectors of [selectors, [...selectors].reverse()]) {
            const settings = await load(endpoint, credential, {
                selectors: [{ keyFilter: context.key("*") }],
                featureFlagOptions: {
                    enabled: true,
                    selectors: orderedSelectors
                }
            });

            assert.deepEqual(getFeatureFlags(settings), [{
                id: context.key("shared"),
                enabled: false,
                conditions: { client_filters: [], requirement_type: "Any" },
                variants: []
            }]);
        }
    });

    it("refreshes enhanced updates, additions, and deletions independently of classic flags and ordinary settings", async () => {
        await context.setSetting("message", "Initial value");
        await context.setFeatureFlag("classic", true);
        await context.setEnhancedFeatureFlag("updated", true);
        await context.setEnhancedFeatureFlag("removed", false);
        const notModified = createNotModifiedResponseTracker("/ff");
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
        const classicFlag = {
            id: context.key("classic"),
            enabled: true,
            conditions: { client_filters: [], requirement_type: "Any" }
        };
        assert.sameDeepMembers(getFeatureFlags(settings), [
            classicFlag,
            {
                id: context.key("updated"),
                enabled: true,
                conditions: { client_filters: [], requirement_type: "Any" },
                variants: []
            },
            {
                id: context.key("removed"),
                enabled: false,
                conditions: { client_filters: [], requirement_type: "Any" },
                variants: []
            }
        ]);
        assert.equal(settings.get(context.key("message")), "Initial value");

        let notifications = 0;
        const listener = settings.onRefresh(() => notifications++);
        try {
            await context.setSetting("message", "Updated ordinary value");
            await context.setEnhancedFeatureFlag("updated", false);
            await context.setEnhancedFeatureFlag("added", true);
            await context.deleteEnhancedFeatureFlag("removed");

            await refreshUntil(settings, () => {
                const flags = getFeatureFlags(settings);
                return flags.some(flag => flag.id === context.key("updated") && !flag.enabled) &&
                    flags.some(flag => flag.id === context.key("added") && flag.enabled) &&
                    !flags.some(flag => flag.id === context.key("removed"));
            }, "enhanced flag updates, additions, and deletions");

            assert.sameDeepMembers(getFeatureFlags(settings), [
                classicFlag,
                {
                    id: context.key("updated"),
                    enabled: false,
                    conditions: { client_filters: [], requirement_type: "Any" },
                    variants: []
                },
                {
                    id: context.key("added"),
                    enabled: true,
                    conditions: { client_filters: [], requirement_type: "Any" },
                    variants: []
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

    it("refreshes precedence and restores the latest classic flag after enhanced deletion", async () => {
        await context.setFeatureFlag("shared", true);
        const settings = await load(endpoint, credential, {
            selectors: [{ keyFilter: context.key("*") }],
            featureFlagOptions: {
                enabled: true,
                selectors: [{ keyFilter: context.key("*") }],
                refresh: { enabled: true, refreshIntervalInMs: REFRESH_INTERVAL_IN_MS }
            }
        });
        const classicFlag = {
            id: context.key("shared"),
            enabled: true,
            conditions: { client_filters: [], requirement_type: "Any" }
        };
        const enhancedFlag = { ...classicFlag, enabled: false, description: "Enhanced definition", variants: [] };
        assert.deepEqual(getFeatureFlags(settings), [classicFlag]);

        let notifications = 0;
        const listener = settings.onRefresh(() => notifications++);
        try {
            await context.setEnhancedFeatureFlag("shared", false, { description: "Enhanced definition" });
            await refreshUntil(settings, () =>
                getFeatureFlags(settings).some(flag => flag.description === "Enhanced definition"),
            "an enhanced flag to supersede the loaded classic flag");
            assert.deepEqual(getFeatureFlags(settings), [enhancedFlag]);

            const previousNotifications = notifications;
            await context.setFeatureFlag("shared", false);
            await refreshUntil(settings, () => notifications > previousNotifications, "the shadowed classic flag change to be checked");
            assert.deepEqual(getFeatureFlags(settings), [enhancedFlag]);

            await context.deleteEnhancedFeatureFlag("shared");
            await refreshUntil(settings, () => {
                const flags = getFeatureFlags(settings);
                return flags.length === 1 && flags[0].enabled === false && flags[0].description === undefined;
            }, "enhanced deletion to restore the latest classic flag");
            assert.deepEqual(getFeatureFlags(settings), [{ ...classicFlag, enabled: false }]);

            await context.deleteFeatureFlag("shared");
            await refreshUntil(settings, () => getFeatureFlags(settings).length === 0, "deletion of both flag types");
            assert.deepEqual(getFeatureFlags(settings), []);
        } finally {
            listener.dispose();
        }
    });

    it("converts enhanced filters, variants, and allocation to the feature management schema", async () => {
        const audience = { Users: ["test-user"], Groups: [], DefaultRolloutPercentage: 0 };
        await context.setEnhancedFeatureFlag("rich", true, {
            label: "production",
            description: "Enhanced configuration",
            conditions: {
                requirementType: "All",
                filters: [
                    { name: "Microsoft.Targeting", parameters: { Audience: JSON.stringify(audience) } },
                    { name: "Microsoft.Percentage", parameters: { Value: "50" } }
                ]
            },
            variants: [
                { name: "Control", value: "control", contentType: "text/plain", statusOverride: "Disabled" },
                { name: "Treatment", value: "{\"color\":\"blue\",\"size\":2}", contentType: "application/json", statusOverride: "None" }
            ],
            allocation: {
                defaultWhenEnabled: "Treatment",
                defaultWhenDisabled: "Control",
                percentile: [
                    { variant: "Control", from: 0, to: 50 },
                    { variant: "Treatment", from: 50, to: 100 }
                ],
                user: [{ variant: "Treatment", users: ["test-user"] }],
                group: [{ variant: "Control", groups: ["test-group"] }],
                seed: "integration-seed"
            },
            telemetry: { enabled: false }
        });

        const settings = await load(endpoint, credential, {
            selectors: [{ keyFilter: context.key("*") }],
            featureFlagOptions: {
                enabled: true,
                selectors: [{ keyFilter: context.key("*"), labelFilter: "production" }]
            }
        });

        // The service lowercases status overrides and omits the default "None" override.
        assert.deepEqual(getFeatureFlags(settings), [{
            id: context.key("rich"),
            enabled: true,
            description: "Enhanced configuration",
            conditions: {
                requirement_type: "All",
                client_filters: [
                    { name: "Microsoft.Targeting", parameters: { Audience: audience } },
                    { name: "Microsoft.Percentage", parameters: { Value: "50" } }
                ]
            },
            variants: [
                { name: "Control", configuration_value: "control", status_override: "disabled" },
                { name: "Treatment", configuration_value: { color: "blue", size: 2 } }
            ],
            allocation: {
                default_when_enabled: "Treatment",
                default_when_disabled: "Control",
                percentile: [
                    { variant: "Control", from: 0, to: 50 },
                    { variant: "Treatment", from: 50, to: 100 }
                ],
                user: [{ variant: "Treatment", users: ["test-user"] }],
                group: [{ variant: "Control", groups: ["test-group"] }],
                seed: "integration-seed"
            },
            telemetry: { enabled: false, metadata: {} }
        }]);
    });
});
