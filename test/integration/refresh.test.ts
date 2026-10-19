// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { setTimeout as delay } from "node:timers/promises";
import { assert } from "chai";
import { DefaultAzureCredential } from "@azure/identity";
import { load } from "../../src/index.js";
import { createNotModifiedResponseTracker, INTEGRATION_TEST_ENDPOINT as endpoint, IntegrationTestContext, REFRESH_INTERVAL_IN_MS, refreshUntil } from "./helpers.js";

describe("integration: refresh", function () {
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

    it("refreshes collection updates, additions, and deletions", async () => {
        await context.setSetting("updated", "Initial value");
        await context.setSetting("removed", "Removed value");
        const settings = await load(endpoint, credential, {
            selectors: [{ keyFilter: context.key("*") }],
            trimKeyPrefixes: [context.keyPrefix],
            refreshOptions: { enabled: true, refreshIntervalInMs: REFRESH_INTERVAL_IN_MS }
        });
        assert.sameDeepMembers([...settings], [["updated", "Initial value"], ["removed", "Removed value"]]);

        let notifications = 0;
        const listener = settings.onRefresh(() => notifications++);
        try {
            await context.setSetting("updated", "Updated value");
            await context.setSetting("added", "Added value");
            await context.deleteSetting("removed");

            await refreshUntil(settings, () =>
                settings.get("updated") === "Updated value" &&
                settings.get("added") === "Added value" &&
                !settings.has("removed"),
            "collection updates, additions, and deletions");

            assert.sameDeepMembers([...settings], [["updated", "Updated value"], ["added", "Added value"]]);
            assert.equal(notifications, 1);
        } finally {
            listener.dispose();
        }
    });

    it("reloads selected values only when the watched sentinel label changes", async () => {
        await context.setSetting("data:updated", "Initial value");
        await context.setSetting("data:removed", "Removed value");
        await context.setSetting("sentinel", "Initial sentinel", { label: "production" });
        await context.setSetting("sentinel", "Unwatched sentinel");
        const notModified = createNotModifiedResponseTracker();
        const settings = await load(endpoint, credential, {
            selectors: [{ keyFilter: context.key("data:*") }],
            trimKeyPrefixes: [context.key("data:")],
            clientOptions: {
                additionalPolicies: [{ policy: notModified.policy, position: "perCall" }]
            },
            refreshOptions: {
                enabled: true,
                refreshIntervalInMs: REFRESH_INTERVAL_IN_MS,
                watchedSettings: [{ key: context.key("sentinel"), label: "production" }]
            }
        });
        const initialValues: [string, string][] = [["updated", "Initial value"], ["removed", "Removed value"]];
        assert.sameDeepMembers([...settings], initialValues);

        let notifications = 0;
        const listener = settings.onRefresh(() => notifications++);
        try {
            await context.setSetting("data:updated", "Updated value");
            await context.setSetting("data:added", "Added value");
            await context.deleteSetting("data:removed");
            await context.setSetting("sentinel", "Changed unwatched sentinel");
            const previousNotModifiedCount = notModified.count;
            await delay(REFRESH_INTERVAL_IN_MS);
            await settings.refresh();

            assert.isAbove(notModified.count, previousNotModifiedCount);
            assert.sameDeepMembers([...settings], initialValues);
            assert.equal(notifications, 0);

            await context.setSetting("sentinel", "Changed watched sentinel", { label: "production" });
            await refreshUntil(settings, () =>
                settings.get("updated") === "Updated value" &&
                settings.get("added") === "Added value" &&
                !settings.has("removed"),
            "the watched sentinel to reload the selected collection");

            assert.sameDeepMembers([...settings], [["updated", "Updated value"], ["added", "Added value"]]);
            assert.equal(notifications, 1);
        } finally {
            listener.dispose();
        }
    });
});
