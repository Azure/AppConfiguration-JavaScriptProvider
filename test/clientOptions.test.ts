// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/* eslint-disable @typescript-eslint/no-unused-expressions */
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "../src/index.js";
import { createMockedConnectionString } from "./utils/testHelper.js";
import { AppConfigurationClientManager, getClientOptions } from "../src/appConfigurationClientManager.js";
import { getFeatureFlagClientOptions } from "../src/appConfigurationClient.js";
import { KnownAppConfigurationApiVersion } from "@azure/app-configuration";
import { ErrorMessages } from "../src/common/errorMessages.js";
import nock from "nock";

class HttpRequestCountPolicy {
    count: number;
    name: string;

    constructor() {
        this.count = 0;
        this.name = "HttpRequestCountPolicy";
    }
    sendRequest(req, next) {
        this.count++;
        return next(req).then(resp => { resp.status = 500; return resp; });
    }
    resetCount() {
        this.count = 0;
    }
}

describe("custom client options", function () {

    const fakeEndpoint = "https://azure.azconfig.io";
    beforeEach(() => {
        // Thus here mock it to reply 500, in which case the retry mechanism works.
        nock(fakeEndpoint).persist().get(() => true).reply(500);
    });

    afterEach(() => {
        nock.restore();
    });

    it("should reject an unsupported API version", () => {
        const createClientManager = () => new AppConfigurationClientManager(createMockedConnectionString(fakeEndpoint), {
            clientOptions: {
                apiVersion: KnownAppConfigurationApiVersion.V20260401
            }
        });

        expect(createClientManager).throws(ErrorMessages.API_VERSION_NOT_SUPPORTED);
    });

    it("should reject a malformed API version", () => {
        const createFeatureFlagClientOptions = () => getFeatureFlagClientOptions({
            apiVersion: "2026-13-01-preview"
        });

        expect(createFeatureFlagClientOptions).throws(ErrorMessages.API_VERSION_NOT_SUPPORTED);
    });

    it("should allow the stable API version with the minimum date", () => {
        expect(() => getFeatureFlagClientOptions({ apiVersion: "2026-05-01" })).not.throws();
    });

    it("should allow an API version later than the minimum", () => {
        expect(() => getFeatureFlagClientOptions({ apiVersion: "2026-06-01-preview" })).not.throws();
    });

    it("should use equivalent options for configuration and feature flag clients", () => {
        const countPolicy = new HttpRequestCountPolicy();
        const configurationClientOptions = getClientOptions({
            clientOptions: {
                apiVersion: "2026-05-01-preview",
                audience: "https://appconfig.azure.com",
                allowInsecureConnection: true,
                additionalPolicies: [{
                    policy: countPolicy,
                    position: "perCall"
                }],
                retryOptions: {
                    maxRetries: 4,
                    maxRetryDelayInMs: 10_000
                },
                userAgentOptions: {
                    userAgentPrefix: "custom-user-agent"
                }
            }
        });
        const featureFlagClientOptions = getFeatureFlagClientOptions(configurationClientOptions)!;

        expect(featureFlagClientOptions).deep.equals(configurationClientOptions);
        expect(featureFlagClientOptions).not.equals(configurationClientOptions);
        expect(featureFlagClientOptions.retryOptions).not.equals(configurationClientOptions.retryOptions);
        expect(featureFlagClientOptions.userAgentOptions).not.equals(configurationClientOptions.userAgentOptions);
    });

    it("should retry 2 times by default", async () => {
        const countPolicy = new HttpRequestCountPolicy();
        const loadPromise = () => {
            return load(createMockedConnectionString(fakeEndpoint), {
                clientOptions: {
                    additionalPolicies: [{
                        policy: countPolicy,
                        position: "perRetry"
                    }]
                },
                startupOptions: {
                    timeoutInMs: 5_000
                }
            });
        };
        let error;
        try {
            await loadPromise();
        } catch (e) {
            error = e;
        }
        expect(error).not.undefined;
        expect(countPolicy.count).eq(3);
    });

    it("should override default retry options", async () => {
        const countPolicy = new HttpRequestCountPolicy();
        const loadWithMaxRetries = (maxRetries: number) => {
            return load(createMockedConnectionString(fakeEndpoint), {
                clientOptions: {
                    additionalPolicies: [{
                        policy: countPolicy,
                        position: "perRetry"
                    }],
                    retryOptions: {
                        maxRetries
                    }
                },
                startupOptions: {
                    timeoutInMs: 5_000
                }
            });
        };

        let error;
        try {
            error = undefined;
            await loadWithMaxRetries(0);
        } catch (e) {
            error = e;
        }
        expect(error).not.undefined;
        expect(countPolicy.count).eq(1);

        countPolicy.resetCount();
        try {
            error = undefined;
            await loadWithMaxRetries(1);
        } catch (e) {
            error = e;
        }
        expect(error).not.undefined;
        expect(countPolicy.count).eq(2);
    });

    it("should retry on DNS failure", async () => {
        nock.restore(); // stop mocking with 500 error but sending real requests which will fail with ENOTFOUND
        const countPolicy = new HttpRequestCountPolicy();
        const loadPromise = () => {
            return load(createMockedConnectionString(fakeEndpoint), {
                clientOptions: {
                    additionalPolicies: [{
                        policy: countPolicy,
                        position: "perRetry"
                    }]
                },
                startupOptions: {
                    timeoutInMs: 5_000
                }
            });
        };
        let error;
        try {
            await loadPromise();
        } catch (e) {
            error = e;
        }
        expect(error).not.undefined;
        expect(countPolicy.count).eq(3);
    });
});
/* eslint-enable @typescript-eslint/no-unused-expressions */
