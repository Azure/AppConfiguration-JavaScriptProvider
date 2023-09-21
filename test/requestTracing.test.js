// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const expect = chai.expect;
const { load } = require("../dist/index");
const { createMockedConnectionString, createMockedTokenCredential } = require("./utils/testHelper");

class HttpRequestHeadersPolicy {
    constructor() {
        this.headers = {};
        this.name = "HttpRequestHeadersPolicy";
    }
    sendRequest(req, next) {
        this.headers = req.headers;
        return next(req).then(resp => resp);
    }
}

describe("request tracing", function () {
    const fakeEndpoint = "https://127.0.0.1"; // sufficient to test the request it sends out
    const headerPolicy = new HttpRequestHeadersPolicy();
    const clientOptions = {
        retryOptions: {
            maxRetries: 0 // save time
        },
        additionalPolicies: [{
            policy: headerPolicy,
            position: "perCall"
        }]
    };

    before(() => {
    });

    after(() => {
    })

    it("should have correct user agent prefix", async () => {
        try {
            await load(createMockedConnectionString(fakeEndpoint), { clientOptions });
        } catch (e) { /* empty */ }
        expect(headerPolicy.headers).not.undefined;
        expect(headerPolicy.headers.get("User-Agent")).satisfy(ua => ua.startsWith("javascript-appconfiguration-provider"));
    });

    it("should have request type in correlation-context header", async () => {
        try {
            await load(createMockedConnectionString(fakeEndpoint), {
                clientOptions
            });
        } catch (e) { /* empty */ }
        expect(headerPolicy.headers).not.undefined;
        expect(headerPolicy.headers.get("Correlation-Context")).eq("RequestType=Startup");
    });

    it("should have key vault tag in correlation-context header", async () => {
        try {
            await load(createMockedConnectionString(fakeEndpoint), {
                clientOptions,
                keyVaultOptions: {
                    credential: createMockedTokenCredential()
                }
            });
        } catch (e) { /* empty */ }
        expect(headerPolicy.headers).not.undefined;
        const correlationContext = headerPolicy.headers.get("Correlation-Context");
        expect(correlationContext).not.undefined;
        expect(correlationContext.includes("UsesKeyVault")).eq(true);
    });

    it("should detect env in correlation-context header", async () => {
        process.env.NODE_ENV = "development";
        try {
            await load(createMockedConnectionString(fakeEndpoint), {
                clientOptions
            });
        } catch (e) { /* empty */ }
        expect(headerPolicy.headers).not.undefined;
        const correlationContext = headerPolicy.headers.get("Correlation-Context");
        expect(correlationContext).not.undefined;
        expect(correlationContext.includes("Env=Dev")).eq(true);
        delete process.env.NODE_ENV;
    });

    it("should detect host type in correlation-context header", async () => {
        process.env.WEBSITE_SITE_NAME = "website-name";
        try {
            await load(createMockedConnectionString(fakeEndpoint), {
                clientOptions
            });
        } catch (e) { /* empty */ }
        expect(headerPolicy.headers).not.undefined;
        const correlationContext = headerPolicy.headers.get("Correlation-Context");
        expect(correlationContext).not.undefined;
        expect(correlationContext.includes("Host=AzureWebApp")).eq(true);
        delete process.env.WEBSITE_SITE_NAME;
    });
});