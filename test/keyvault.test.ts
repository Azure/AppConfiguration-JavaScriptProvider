// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "./exportedApi.js";
import { sinon, createMockedConnectionString, createMockedTokenCredential, mockAppConfigurationClientListConfigurationSettings, mockSecretClientGetSecret, restoreMocks, createMockedKeyVaultReference } from "./utils/testHelper.js";
import { KeyVaultSecret, SecretClient } from "@azure/keyvault-secrets";

const mockedData = [
    // key, secretUri, value
    ["TestKey", "https://fake-vault-name.vault.azure.net/secrets/fakeSecretName", "SecretValue"],
    ["TestKeyFixedVersion", "https://fake-vault-name.vault.azure.net/secrets/fakeSecretName/741a0fc52610449baffd6e1c55b9d459", "OldSecretValue"],
    ["TestKey2", "https://fake-vault-name2.vault.azure.net/secrets/fakeSecretName2", "SecretValue2"]
];

function mockAppConfigurationClient() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const kvs = mockedData.map(([key, vaultUri, _value]) => createMockedKeyVaultReference(key, vaultUri));
    mockAppConfigurationClientListConfigurationSettings(kvs);
}

function mockNewlyCreatedKeyVaultSecretClients() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    mockSecretClientGetSecret(mockedData.map(([_key, secretUri, value]) => [secretUri, value]));
}
describe("key vault reference", function () {
    this.timeout(10000);

    beforeEach(() => {
        mockAppConfigurationClient();
        mockNewlyCreatedKeyVaultSecretClients();
    });

    afterEach(() => {
        restoreMocks();
    });

    it("require key vault options to resolve reference", async () => {
        return expect(load(createMockedConnectionString())).eventually.rejectedWith("Configure keyVaultOptions to resolve Key Vault Reference(s).");
    });

    it("should resolve key vault reference with credential", async () => {
        const settings = await load(createMockedConnectionString(), {
            keyVaultOptions: {
                credential: createMockedTokenCredential()
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("TestKey")).eq("SecretValue");
        expect(settings.get("TestKeyFixedVersion")).eq("OldSecretValue");
    });

    it("should resolve key vault reference with secret resolver", async () => {
        const settings = await load(createMockedConnectionString(), {
            keyVaultOptions: {
                secretResolver: (kvrUrl) => {
                    return "SecretResolver::" + kvrUrl.toString();
                }
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("TestKey")).eq("SecretResolver::https://fake-vault-name.vault.azure.net/secrets/fakeSecretName");
    });

    it("should resolve key vault reference with corresponding secret clients", async () => {
        sinon.restore();
        mockAppConfigurationClient();

        // mock specific behavior per secret client
        const client1 = new SecretClient("https://fake-vault-name.vault.azure.net", createMockedTokenCredential());
        sinon.stub(client1, "getSecret").returns(Promise.resolve({value: "SecretValueViaClient1" } as KeyVaultSecret));
        const client2 = new SecretClient("https://fake-vault-name2.vault.azure.net", createMockedTokenCredential());
        sinon.stub(client2, "getSecret").returns(Promise.resolve({value: "SecretValueViaClient2" } as KeyVaultSecret));
        const settings = await load(createMockedConnectionString(), {
            keyVaultOptions: {
                secretClients: [
                    client1,
                    client2,
                ]
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("TestKey")).eq("SecretValueViaClient1");
        expect(settings.get("TestKey2")).eq("SecretValueViaClient2");
    });

    it("should throw error when secret clients not provided for all key vault references", async () => {
        const loadKeyVaultPromise = load(createMockedConnectionString(), {
            keyVaultOptions: {
                secretClients: [
                    new SecretClient("https://fake-vault-name.vault.azure.net", createMockedTokenCredential()),
                ]
            }
        });
        return expect(loadKeyVaultPromise).eventually.rejectedWith("No key vault credential or secret resolver callback configured, and no matching secret client could be found.");
    });

    it("should fallback to use default credential when corresponding secret client not provided", async () => {
        const settings = await load(createMockedConnectionString(), {
            keyVaultOptions: {
                secretClients: [
                    new SecretClient("https://fake-vault-name.vault.azure.net", createMockedTokenCredential()),
                ],
                credential: createMockedTokenCredential()
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("TestKey")).eq("SecretValue");
        expect(settings.get("TestKey2")).eq("SecretValue2");
    });
});
