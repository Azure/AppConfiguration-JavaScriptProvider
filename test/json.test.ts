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

    it("should parse json with single-line comments", async () => {
        const jsoncValue = `{
            // This is a single-line comment
            "database": {
                "host": "localhost", // Another comment
                "port": 5432
            },
            "debug": true
        }`;
        const jsoncKeyValue = createMockedJsonKeyValue("jsonc.settings.withComments", jsoncValue);
        mockAppConfigurationClientListConfigurationSettings([[jsoncKeyValue]]);

        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;
        const config = settings.get<any>("jsonc.settings.withComments");
        expect(config).not.undefined;
        expect(config.database).not.undefined;
        expect(config.database.host).eq("localhost");
        expect(config.database.port).eq(5432);
        expect(config.debug).eq(true);
    });

    it("should parse json with multi-line comments", async () => {
        const jsoncValue = `{
            /*
            * This is a multi-line comment
            * describing the configuration
            */
            "app": {
                "name": "TestApp",
                /* inline multi-line comment */ "version": "1.0.0"
            },
            /*
            "disabled": "this entire section is commented out"
            */
            "enabled": true
        }`;
        const jsoncKeyValue = createMockedJsonKeyValue("jsonc.settings.multilineComments", jsoncValue);
        mockAppConfigurationClientListConfigurationSettings([[jsoncKeyValue]]);

        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;
        const config = settings.get<any>("jsonc.settings.multilineComments");
        expect(config).not.undefined;
        expect(config.app).not.undefined;
        expect(config.app.name).eq("TestApp");
        expect(config.app.version).eq("1.0.0");
        expect(config.enabled).eq(true);
        expect(config.disabled).undefined; // Should be undefined as it's commented out
    });

    it("should parse json with mixed comment types", async () => {
        const jsoncValue = `{
            // Configuration for the application
            "application": {
                "name": "Azure App Config Test", // Application name
                "version": "2.0.0",
                /*
                * Environment settings
                * These can be overridden per environment
                */
                "environment": {
                    "development": {
                        "debug": true,
                        "logLevel": "debug"
                    },
                    "production": {
                        "debug": false,
                        "logLevel": "error"
                    }
                }
            },
            // Features configuration
            "features": [
                "authentication",
                "logging",
                /* "experimental-feature", */ // Commented out feature
                "monitoring"
            ]
        }`;
        const jsoncKeyValue = createMockedJsonKeyValue("jsonc.settings.complex", jsoncValue);
        mockAppConfigurationClientListConfigurationSettings([[jsoncKeyValue]]);

        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;
        const config = settings.get<any>("jsonc.settings.complex");
        expect(config).not.undefined;
        expect(config.application).not.undefined;
        expect(config.application.name).eq("Azure App Config Test");
        expect(config.application.version).eq("2.0.0");
        expect(config.application.environment).not.undefined;
        expect(config.application.environment.development).not.undefined;
        expect(config.application.environment.development.debug).eq(true);
        expect(config.application.environment.development.logLevel).eq("debug");
        expect(config.application.environment.production).not.undefined;
        expect(config.application.environment.production.debug).eq(false);
        expect(config.application.environment.production.logLevel).eq("error");
        expect(config.features).not.undefined;
        expect(Array.isArray(config.features)).eq(true);
        expect(config.features.length).eq(3);
        expect(config.features[0]).eq("authentication");
        expect(config.features[1]).eq("logging");
        expect(config.features[2]).eq("monitoring");
        // Should not contain the commented out "experimental-feature"
        expect(config.features.includes("experimental-feature")).eq(false);
    });

    it("should fallback to string value if json with comments parsing fails", async () => {
        const invalidJsoncValue = `{
            // This is invalid JSON with unclosed bracket
            "test": "value"`;
        const jsoncKeyValue = createMockedJsonKeyValue("jsonc.settings.invalid", invalidJsoncValue);
        mockAppConfigurationClientListConfigurationSettings([[jsoncKeyValue]]);

        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;
        const config = settings.get("jsonc.settings.invalid");
        expect(config).not.undefined;
        expect(typeof config).eq("string", "should fallback to string value");
        expect(config).eq(invalidJsoncValue);
    });
});
