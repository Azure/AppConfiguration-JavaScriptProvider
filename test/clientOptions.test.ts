// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "./exportedApi.js";
import { MAX_TIME_OUT, createMockedConnectionString } from "./utils/testHelper.js";
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
    this.timeout(MAX_TIME_OUT);

    const fakeEndpoint = "https://azure.azconfig.io";
    beforeEach(() => {
        // Thus here mock it to reply 500, in which case the retry mechanism works.
        nock(fakeEndpoint).persist().get(() => true).reply(500);
    });

    afterEach(() => {
        nock.restore();
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
