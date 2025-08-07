// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "./exportedApi.js";
import { MAX_TIME_OUT, mockAppConfigurationClientListConfigurationSettings, restoreMocks, createMockedConnectionString, createMockedKeyVaultReference, createMockedJsonKeyValue } from "./utils/testHelper.js";

const jsonKeyValue = createMockedJsonKeyValue("json.settings.logging", '{"Test":{"Level":"Debug"},"Prod":{"Level":"Warning"}}');
const keyVaultKeyValue = createMockedKeyVaultReference("TestKey", "https://fake-vault-name.vault.azure.net/secrets/fakeSecretName");

describe("json", function () {
    this.timeout(MAX_TIME_OUT);

    beforeEach(() => {
    });

    afterEach(() => {
        restoreMocks();
    });

    it("should load and parse if content type is application/json", async () => {
        mockAppConfigurationClientListConfigurationSettings([[jsonKeyValue]]);

        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;
        const logging = settings.get<any>("json.settings.logging");
        expect(logging).not.undefined;
        expect(logging.Test).not.undefined;
        expect(logging.Test.Level).eq("Debug");
        expect(logging.Prod).not.undefined;
        expect(logging.Prod.Level).eq("Warning");
    });

    it("should not parse key-vault reference", async () => {
        mockAppConfigurationClientListConfigurationSettings([[jsonKeyValue, keyVaultKeyValue]]);

        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            keyVaultOptions: {
                secretResolver: (url) => `Resolved: ${url.toString()}`
            }
        });
        expect(settings).not.undefined;
        const resolvedSecret = settings.get<any>("TestKey");
        expect(resolvedSecret).not.undefined;
        expect(resolvedSecret.uri).undefined;
        expect(typeof resolvedSecret).eq("string");
    });

    it("should parse different kinds of legal values", async () => {
        mockAppConfigurationClientListConfigurationSettings([[
            /**
             * A JSON value MUST be an object, array, number, or string, false, null, true
             * See https://www.ietf.org/rfc/rfc4627.txt
             */
            createMockedJsonKeyValue("json.settings.object", "{}"),
            createMockedJsonKeyValue("json.settings.array", "[]"),
            createMockedJsonKeyValue("json.settings.number", "8"),
            createMockedJsonKeyValue("json.settings.string", "\"string\""),
            createMockedJsonKeyValue("json.settings.false", "false"),
            createMockedJsonKeyValue("json.settings.true", "true"),
            createMockedJsonKeyValue("json.settings.null", "null"),
            createMockedJsonKeyValue("json.settings.literalNull", null), // possible value via Portal's advanced edit.
            // Special tricky values related to JavaScript
            // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Boolean#boolean_coercion
            createMockedJsonKeyValue("json.settings.zero", 0),
            createMockedJsonKeyValue("json.settings.emptyString", ""), // should fail JSON.parse and use string value as fallback
            createMockedJsonKeyValue("json.settings.illegalString", "[unclosed"), // should fail JSON.parse

        ]]);
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;
        expect(typeof settings.get("json.settings.object")).eq("object", "is object");
        expect(Object.keys(settings.get<any>("json.settings.object")).length).eq(0, "is empty object");
        expect(Array.isArray(settings.get("json.settings.array"))).eq(true, "is array");
        expect(settings.get("json.settings.number")).eq(8, "is number");
        expect(settings.get("json.settings.string")).eq("string", "is string");
        expect(settings.get("json.settings.false")).eq(false, "is false");
        expect(settings.get("json.settings.true")).eq(true, "is true");
        expect(settings.get("json.settings.null")).eq(null, "is null");
        expect(settings.get("json.settings.literalNull")).eq(null, "is literal null");
        expect(settings.get("json.settings.zero")).eq(0, "is zero");
        expect(settings.get("json.settings.emptyString")).eq("", "is empty string");
        expect(settings.get("json.settings.illegalString")).eq("[unclosed", "is illegal string");
    });

    it("should load json values with comments", async () => {
        // Test various comment styles and positions
        const mixedCommentStylesValue = `{
            // Single line comment at start
            "ApiSettings": {
                "BaseUrl": "https://api.example.com", // Inline single line
                /* Multi-line comment
                   spanning multiple lines */
                "ApiKey": "secret-key",
                "Endpoints": [
                    // Comment before array element
                    "/users",
                    /* Comment between elements */
                    "/orders",
                    "/products" // Comment after element
                ]
            },
            // Test edge cases
            "StringWithSlashes": "This is not a // comment",
            "StringWithStars": "This is not a /* comment */",
            "UrlValue": "https://example.com/path", // This is a real comment
            "EmptyComment": "value", //
            /**/
            "AfterEmptyComment": "value2"
            /* Final multi-line comment */
        }`;

        // Test invalid JSON with comments
        const invalidJsonWithCommentsValue = `// This is a comment
                { invalid json structure
                // Another comment
                missing quotes and braces`;

        // Test only comments (should be invalid JSON)
        const onlyCommentsValue = `
                // Just comments
                /* No actual content */
            `;

        const keyValues = [
            createMockedJsonKeyValue("MixedCommentStyles", mixedCommentStylesValue),
            createMockedJsonKeyValue("InvalidJsonWithComments", invalidJsonWithCommentsValue),
            createMockedJsonKeyValue("OnlyComments", onlyCommentsValue)
        ];

        mockAppConfigurationClientListConfigurationSettings([keyValues]);

        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;

        // Verify mixed comment styles are properly parsed
        const mixedConfig = settings.get<any>("MixedCommentStyles");
        expect(mixedConfig).not.undefined;
        expect(mixedConfig.ApiSettings).not.undefined;
        expect(mixedConfig.ApiSettings.BaseUrl).eq("https://api.example.com");
        expect(mixedConfig.ApiSettings.ApiKey).eq("secret-key");
        expect(mixedConfig.ApiSettings.Endpoints).not.undefined;
        expect(Array.isArray(mixedConfig.ApiSettings.Endpoints)).eq(true);
        expect(mixedConfig.ApiSettings.Endpoints[0]).eq("/users");
        expect(mixedConfig.ApiSettings.Endpoints[1]).eq("/orders");
        expect(mixedConfig.ApiSettings.Endpoints[2]).eq("/products");

        // Verify edge cases where comment-like text appears in strings
        expect(mixedConfig.StringWithSlashes).eq("This is not a // comment");
        expect(mixedConfig.StringWithStars).eq("This is not a /* comment */");
        expect(mixedConfig.UrlValue).eq("https://example.com/path");
        expect(mixedConfig.EmptyComment).eq("value");
        expect(mixedConfig.AfterEmptyComment).eq("value2");

        // Invalid JSON should fall back to string value
        const invalidConfig = settings.get("InvalidJsonWithComments");
        expect(invalidConfig).not.undefined;
        expect(typeof invalidConfig).eq("string");
        expect(invalidConfig).eq(invalidJsonWithCommentsValue);

        // Only comments should be treated as string value (invalid JSON)
        const onlyCommentsConfig = settings.get("OnlyComments");
        expect(onlyCommentsConfig).not.undefined;
        expect(typeof onlyCommentsConfig).eq("string");
        expect(onlyCommentsConfig).eq(onlyCommentsValue);
    });
});
