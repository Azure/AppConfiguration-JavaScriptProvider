// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const expect = chai.expect;
const { load } = require("../dist/index");
const {
    mockAppConfigurationClientListConfigurationSettings,
    restoreMocks,
    createMockedConnectionString,
    createMockedEnpoint,
    createMockedTokenCredential,
} = require("./utils/testHelper");

const mockedKVs = [{
    value: 'red',
    key: 'app.settings.fontColor',
    label: null,
    contentType: '',
    lastModified: '2023-05-04T04:34:24.000Z',
    tags: {},
    etag: '210fjkPIWZMjFTi_qyEEmmsJjtUjj0YQl-Y3s1m6GLw',
    isReadOnly: false
}, {
    value: '40',
    key: 'app.settings.fontSize',
    label: null,
    contentType: '',
    lastModified: '2023-05-04T04:32:56.000Z',
    tags: {},
    etag: 'GdmsLWq3mFjFodVEXUYRmvFr3l_qRiKAW_KdpFbxZKk',
    isReadOnly: false
}, {
    value: 'TestValue',
    key: 'TestKey',
    label: 'Test',
    contentType: '',
    lastModified: '2023-05-04T04:32:56.000Z',
    tags: {},
    etag: 'GdmsLWq3mFjFodVEXUYRmvFr3l_qRiKAW_KdpFbxZKk',
    isReadOnly: false
}, {
    value: null,
    key: 'KeyForNullValue',
    label: '',
    contentType: '',
    lastModified: '2023-05-04T04:32:56.000Z',
    tags: {},
    etag: 'GdmsLWq3mFjFodVEXUYRmvFr3l_qRiKAW_KdpFbxZKk',
    isReadOnly: false
}, {
    value: "",
    key: 'KeyForEmptyValue',
    label: '',
    contentType: '',
    lastModified: '2023-05-04T04:32:56.000Z',
    tags: {},
    etag: 'GdmsLWq3mFjFodVEXUYRmvFr3l_qRiKAW_KdpFbxZKk',
    isReadOnly: false
}];

describe("load", function () {
    before(() => {
        mockAppConfigurationClientListConfigurationSettings(mockedKVs);
    });

    after(() => {
        restoreMocks();
    })
    it("should load data from config store with connection string", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");
    });

    it("should load data from config store with aad + endpoint URL", async () => {
        const endpoint = createMockedEnpoint();
        const credential = createMockedTokenCredential();
        const settings = await load(new URL(endpoint), credential);
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");
    });

    it("should load data from config store with aad + endpoint string", async () => {
        const endpoint = createMockedEnpoint();
        const credential = createMockedTokenCredential();
        const settings = await load(endpoint, credential);
        expect(settings).not.undefined;
        expect(settings.get("app.settings.fontColor")).eq("red");
        expect(settings.get("app.settings.fontSize")).eq("40");
    });

    it("should throw error given invalid connection string", async () => {
        expect(load("invalid-connection-string")).eventually.rejected;
    });

    it("should throw error given invalid endpoint URL", async () => {
        const credential = createMockedTokenCredential();
        expect(load("invalid-endpoint-url", credential)).eventually.rejected;
    });

    it("should trim key prefix if applicable", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "app.settings.*",
                labelFilter: "\0"
            }],
            trimKeyPrefixes: ["app.settings."]
        });
        expect(settings).not.undefined;
        expect(settings.has("fontColor")).eq(true);
        expect(settings.get("fontColor")).eq("red");
        expect(settings.has("fontSize")).eq(true);
        expect(settings.get("fontSize")).eq("40");
        expect(settings.has("TestKey")).eq(true);
        expect(settings.get("TestKey")).eq("TestValue");
    });

    it("should trim longest key prefix first", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString, {
            selectors: [{
                keyFilter: "app.*",
                labelFilter: "\0"
            }],
            trimKeyPrefixes: ["app.", "app.settings.", "Test"]
        });
        expect(settings).not.undefined;
        expect(settings.has("fontColor")).eq(true);
        expect(settings.get("fontColor")).eq("red");
        expect(settings.has("fontSize")).eq(true);
        expect(settings.get("fontSize")).eq("40");
        expect(settings.has("Key")).eq(true);
        expect(settings.get("Key")).eq("TestValue");
    });

    it("should support null/empty value", async () => {
        const connectionString = createMockedConnectionString();
        const settings = await load(connectionString);
        expect(settings).not.undefined;
        expect(settings.has("KeyForNullValue")).eq(true);
        expect(settings.get("KeyForNullValue")).eq(null);
        expect(settings.has("KeyForEmptyValue")).eq(true);
        expect(settings.get("KeyForEmptyValue")).eq("");
    });
})
