// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "./exportedApi";
import { mockAppConfigurationClientListConfigurationSettings, restoreMocks, createMockedConnectionString, createMockedKeyVaultReference, createMockedJsonKeyValue } from "./utils/testHelper";

const jsonKeyValue = createMockedJsonKeyValue("json.settings.logging", '{"Test":{"Level":"Debug"},"Prod":{"Level":"Warning"}}');
const keyVaultKeyValue = createMockedKeyVaultReference("TestKey", "https://fake-vault-name.vault.azure.net/secrets/fakeSecretName");

describe("json", function () {
    beforeEach(() => {
    });

    afterEach(() => {
        restoreMocks();
    });

    it("should load and parse if content type is application/json", async () => {
        mockAppConfigurationClientListConfigurationSettings([jsonKeyValue]);

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
        mockAppConfigurationClientListConfigurationSettings([jsonKeyValue, keyVaultKeyValue]);

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
        mockAppConfigurationClientListConfigurationSettings([
            /**
             * A JSON value MUST be an object, array, number, or string, false, null, true
             * See https://www.ietf.org/rfc/rfc4627.txt
             */
            createMockedJsonKeyValue("json.settings.object", "{}"),
            createMockedJsonKeyValue("json.settings.array", "[]"),
            createMockedJsonKeyValue("json.settings.number", "8"),
            createMockedJsonKeyValue("json.settings.string", "string"),
            createMockedJsonKeyValue("json.settings.false", "false"),
            createMockedJsonKeyValue("json.settings.true", "true"),
            createMockedJsonKeyValue("json.settings.null", "null"),
            createMockedJsonKeyValue("json.settings.literalNull", null), // possible value via Portal's advanced edit.
            // Special tricky values related to JavaScript
            // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Boolean#boolean_coercion
            createMockedJsonKeyValue("json.settings.zero", 0),
            createMockedJsonKeyValue("json.settings.emptyString", ""), // should fail JSON.parse and use string value as fallback
            createMockedJsonKeyValue("json.settings.illegalString", "[unclosed"), // should fail JSON.parse

        ]);
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
});
