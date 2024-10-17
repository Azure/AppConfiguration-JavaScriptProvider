// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { createMockedConnectionString, createMockedFeatureFlag, HttpRequestHeadersPolicy, sleepInMs } from "./utils/testHelper";
import { mockServerEndpoint, startMockServer, closeMockServer } from "./utils/integrationTestHelper";
import { load } from "./exportedApi";

describe("integration test", function () {
    this.timeout(15000);

    const headerPolicy = new HttpRequestHeadersPolicy();
    const position: "perCall" | "perRetry" = "perCall";
    const clientOptions = {
        retryOptions: {
            maxRetries: 0 // save time
        },
        allowInsecureConnection: true,
        additionalPolicies: [{
            policy: headerPolicy,
            position
        }]
    };

    it("should have request type in correlation-context header if feature flags use feature filters", async () => {
        // We are using self-signed certificate
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

        startMockServer([
            createMockedFeatureFlag("Alpha_1", { conditions: { client_filters: [ { name: "Microsoft.TimeWindow" } ] } }),
            createMockedFeatureFlag("Alpha_2", { conditions: { client_filters: [ { name: "Microsoft.Targeting" } ] } }),
            createMockedFeatureFlag("Alpha_3", { conditions: { client_filters: [ { name: "CustomFilter" } ] } })
        ]);

        const settings = await load(createMockedConnectionString(mockServerEndpoint), {
            clientOptions,
            featureFlagOptions: {
                enabled: true,
                selectors: [ {keyFilter: "*"} ],
                refresh: {
                    enabled: true,
                    refreshIntervalInMs: 1000
                }
            }
        });
        await sleepInMs(1000 + 1);
        try {
            await settings.refresh();
        } catch (e) { /* empty */ }
        expect(headerPolicy.headers).not.undefined;
        const correlationContext = headerPolicy.headers.get("Correlation-Context");
        expect(correlationContext).not.undefined;
        expect(correlationContext.includes("RequestType=Watch")).eq(true);
        expect(correlationContext.includes("Filter=CSTM+TIME+TRGT")).eq(true);

        closeMockServer();
    });
});
