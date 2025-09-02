// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/* eslint-disable @typescript-eslint/no-unused-expressions */
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { load } from "../src/index.js";
import { MAX_TIME_OUT, sinon, createMockedConnectionString, createMockedTokenCredential, mockAppConfigurationClientListConfigurationSettings, mockSecretClientGetSecret, restoreMocks, createMockedKeyVaultReference, sleepInMs } from "./utils/testHelper.js";
import { KeyVaultSecret, SecretClient } from "@azure/keyvault-secrets";
import { ErrorMessages, KeyVaultReferenceErrorMessages } from "../src/common/errorMessages.js";

const mockedData = [
    // key, secretUri, value
    ["TestKey", "https://fake-vault-name.vault.azure.net/secrets/fakeSecretName", "SecretValue"],
    ["TestKeyFixedVersion", "https://fake-vault-name.vault.azure.net/secrets/fakeSecretName/741a0fc52610449baffd6e1c55b9d459", "OldSecretValue"],
    ["TestKey2", "https://fake-vault-name2.vault.azure.net/secrets/fakeSecretName2", "SecretValue2"]
];

function mockAppConfigurationClient() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const kvs = mockedData.map(([key, vaultUri, _value]) => createMockedKeyVaultReference(key, vaultUri));
    mockAppConfigurationClientListConfigurationSettings([kvs]);
}

function mockNewlyCreatedKeyVaultSecretClients() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    mockSecretClientGetSecret(mockedData.map(([_key, secretUri, value]) => [secretUri, value]));
}

describe("key vault reference", function () {
    this.timeout(MAX_TIME_OUT);

    beforeEach(() => {
        mockAppConfigurationClient();
        mockNewlyCreatedKeyVaultSecretClients();
    });

    afterEach(() => {
        restoreMocks();
    });

    it("require key vault options to resolve reference", async () => {
        try {
            await load(createMockedConnectionString());
        } catch (error) {
            expect(error.message).eq(ErrorMessages.LOAD_OPERATION_FAILED);
            expect(error.cause.message).eq(KeyVaultReferenceErrorMessages.KEY_VAULT_OPTIONS_UNDEFINED);
            return;
        }
        // we should never reach here, load should throw an error
        throw new Error("Expected load to throw.");
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
        try {
            await load(createMockedConnectionString(), {
                keyVaultOptions: {
                    secretClients: [
                        new SecretClient("https://fake-vault-name.vault.azure.net", createMockedTokenCredential()),
                    ]
                }
            });
        } catch (error) {
            expect(error.message).eq(ErrorMessages.LOAD_OPERATION_FAILED);
            expect(error.cause.message).eq(KeyVaultReferenceErrorMessages.KEY_VAULT_REFERENCE_UNRESOLVABLE);
            return;
        }
        // we should never reach here, load should throw an error
        throw new Error("Expected load to throw.");
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

    it("should resolve key vault reference in parallel", async () => {
        const settings = await load(createMockedConnectionString(), {
            keyVaultOptions: {
                credential: createMockedTokenCredential(),
                parallelSecretResolutionEnabled: true
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("TestKey")).eq("SecretValue");
        expect(settings.get("TestKeyFixedVersion")).eq("OldSecretValue");
    });
});

describe("key vault secret refresh", function () {
    this.timeout(MAX_TIME_OUT);

    beforeEach(() => {
        const data = [
            ["TestKey", "https://fake-vault-name.vault.azure.net/secrets/fakeSecretName", "SecretValue"]
        ];
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const kvs = data.map(([key, vaultUri, _value]) => createMockedKeyVaultReference(key, vaultUri));
        mockAppConfigurationClientListConfigurationSettings([kvs]);
    });

    afterEach(() => {
        restoreMocks();
    });

    it("should not allow secret refresh interval less than 1 minute", async () => {
        const connectionString = createMockedConnectionString();
        const loadWithInvalidSecretRefreshInterval = load(connectionString, {
            keyVaultOptions: {
                secretClients: [
                    new SecretClient("https://fake-vault-name.vault.azure.net", createMockedTokenCredential()),
                ],
                secretRefreshIntervalInMs: 59999 // less than 60_000 milliseconds
            }
        });
        return expect(loadWithInvalidSecretRefreshInterval).eventually.rejectedWith(ErrorMessages.INVALID_SECRET_REFRESH_INTERVAL);
    });

    it("should reload key vault secret when there is no change to key-values", async () => {
        const client = new SecretClient("https://fake-vault-name.vault.azure.net", createMockedTokenCredential());
        const stub = sinon.stub(client, "getSecret");
        stub.onCall(0).resolves({ value: "SecretValue" } as KeyVaultSecret);
        stub.onCall(1).resolves({ value: "SecretValue - Updated" } as KeyVaultSecret);

        const settings = await load(createMockedConnectionString(), {
            keyVaultOptions: {
                secretClients: [
                    client
                ],
                credential: createMockedTokenCredential(),
                secretRefreshIntervalInMs: 60_000
            }
        });
        expect(settings).not.undefined;
        expect(settings.get("TestKey")).eq("SecretValue");

        await sleepInMs(30_000);
        await settings.refresh();
        // use cached value
        expect(settings.get("TestKey")).eq("SecretValue");

        await sleepInMs(30_000);
        await settings.refresh();
        // secret refresh interval expires, reload secret value
        expect(settings.get("TestKey")).eq("SecretValue - Updated");
    });
});
/* eslint-enable @typescript-eslint/no-unused-expressions */
