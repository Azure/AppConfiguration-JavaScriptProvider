// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { assert } from "chai";
import { DefaultAzureCredential } from "@azure/identity";
import { load } from "../../src/index.js";
import { getIntegrationTestEndpoint, IntegrationTestContext } from "./helpers.js";

describe("integration: load", function () {
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

    it("loads unlabeled string and empty values using an endpoint and credential", async () => {
        await context.setSetting("message", "Hello from App Configuration");
        await context.setSetting("empty", "");
        await context.setSetting("message", "Labeled value", { label: "production" });

        const settings = await load(endpoint, credential, {
            selectors: [{ keyFilter: context.key("*") }]
        });

        assert.sameDeepMembers([...settings], [
            [context.key("message"), "Hello from App Configuration"],
            [context.key("empty"), ""]
        ]);
    });

    it("selects only settings matching the key and label filters", async () => {
        await context.setSetting("selected:message", "Production value", { label: "production" });
        await context.setSetting("selected:message", "Development value", { label: "development" });
        await context.setSetting("selected:unlabeled", "Default value");
        await context.setSetting("excluded:message", "Excluded value", { label: "production" });

        const settings = await load(endpoint, credential, {
            selectors: [{
                keyFilter: context.key("selected:*"),
                labelFilter: "production"
            }]
        });

        assert.deepEqual([...settings], [
            [context.key("selected:message"), "Production value"]
        ]);
    });
});
