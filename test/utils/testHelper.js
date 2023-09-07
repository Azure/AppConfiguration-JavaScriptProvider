// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const sinon = require("sinon");
const { AppConfigurationClient } = require("@azure/app-configuration");
const { ClientSecretCredential } = require("@azure/identity");

const TEST_CLIENT_ID = "62e76eb5-218e-4f90-8261-000000000000";
const TEST_TENANT_ID = "72f988bf-86f1-41af-91ab-000000000000";
const TEST_CLIENT_SECRET = "Q158Q~2JtUwVbuq0Mzm9ocH2umTB000000000000";

function mockAppConfigurationClientListConfigurationSettings(kvList) {
    function* testKvSetGnerator() {
        yield* kvList;
    }
    sinon.stub(AppConfigurationClient.prototype, "listConfigurationSettings").callsFake(() => testKvSetGnerator());
}
function restoreMocks() {
    sinon.restore();
}

const createMockedEnpoint = (name = "azure") => `https://${name}.azconfig.io`;

const createMockedConnectionString = (endpoint = createMockedEnpoint(), secret="secret", id="b1d9b31") => {
    const toEncodeAsBytes = Buffer.from(secret);
    const returnValue = toEncodeAsBytes.toString("base64");
    return `Endpoint=${endpoint};Id=${id};Secret=${returnValue}`;
}

const createMockedTokenCredential = (tenantId = TEST_TENANT_ID, clientId = TEST_CLIENT_ID, clientSecret = TEST_CLIENT_SECRET) => {
    return new ClientSecretCredential(tenantId, clientId, clientSecret);
}

module.exports = {
    sinon,
    mockAppConfigurationClientListConfigurationSettings,
    restoreMocks,

    createMockedEnpoint,
    createMockedConnectionString,
    createMockedTokenCredential,
}