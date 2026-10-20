// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { assert } from "chai";
import { DefaultAzureCredential } from "@azure/identity";
import { load } from "../../src/index.js";
import { INTEGRATION_TEST_ENDPOINT as endpoint, IntegrationTestContext } from "./helpers.js";

describe("integration: JSON", function () {
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

    it("parses JSON values and constructs a hierarchical configuration object", async () => {
        const service = { enabled: true, retries: 3, endpoints: ["primary", "secondary"] };
        const values: [string, unknown][] = [
            ["settings.service", service],
            ["settings.enabled", false],
            ["settings.count", 0],
            ["settings.tags", ["one", "two"]],
            ["settings.empty", null]
        ];
        for (const [key, value] of values) {
            await context.setSetting(key, JSON.stringify(value), { contentType: "application/json" });
        }

        const settings = await load(endpoint, credential, {
            selectors: [{ keyFilter: context.key("*") }],
            trimKeyPrefixes: [context.keyPrefix]
        });

        assert.sameDeepMembers([...settings], values);
        assert.deepEqual(settings.constructConfigurationObject(), {
            settings: {
                service,
                enabled: false,
                count: 0,
                tags: ["one", "two"],
                empty: null
            }
        });
    });
});
