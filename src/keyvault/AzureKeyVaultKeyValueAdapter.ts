// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ConfigurationSetting, isSecretReference, parseSecretReference } from "@azure/app-configuration";
import { IKeyValueAdapter } from "../IKeyValueAdapter.js";
import { KeyVaultOptions } from "./KeyVaultOptions.js";
import { ArgumentError, KeyVaultReferenceError } from "../common/error.js";
import { KeyVaultSecretIdentifier, SecretClient, parseKeyVaultSecretIdentifier } from "@azure/keyvault-secrets";
import { isRestError } from "@azure/core-rest-pipeline";
import { AuthenticationError } from "@azure/identity";

export class AzureKeyVaultKeyValueAdapter implements IKeyValueAdapter {
    /**
     * Map vault hostname to corresponding secret client.
     */
    #secretClients: Map<string, SecretClient>;
    #keyVaultOptions: KeyVaultOptions | undefined;

    constructor(keyVaultOptions: KeyVaultOptions | undefined) {
        this.#keyVaultOptions = keyVaultOptions;
    }

    canProcess(setting: ConfigurationSetting): boolean {
        return isSecretReference(setting);
    }

    async processKeyValue(setting: ConfigurationSetting): Promise<[string, unknown]> {
        // TODO: cache results to save requests.
        if (!this.#keyVaultOptions) {
            throw new ArgumentError("Failed to process the Key Vault reference because Key Vault options are not configured.");
        }
        let secretIdentifier: KeyVaultSecretIdentifier;
        try {
            secretIdentifier = parseKeyVaultSecretIdentifier(
                parseSecretReference(setting).value.secretId
            );
        } catch (error) {
            throw new KeyVaultReferenceError(buildKeyVaultReferenceErrorMessage("Invalid Key Vault reference.", setting), { cause: error });
        }

        try {
            // precedence: secret clients > credential > secret resolver
            const client = this.#getSecretClient(new URL(secretIdentifier.vaultUrl));
            if (client) {
                const secret = await client.getSecret(secretIdentifier.name, { version: secretIdentifier.version });
                return [setting.key, secret.value];
            }
            if (this.#keyVaultOptions.secretResolver) {
                return [setting.key, await this.#keyVaultOptions.secretResolver(new URL(secretIdentifier.sourceId))];
            }
        } catch (error) {
            if (isRestError(error) || error instanceof AuthenticationError) {
                throw new KeyVaultReferenceError(buildKeyVaultReferenceErrorMessage("Failed to resolve Key Vault reference.", setting, secretIdentifier.sourceId), { cause: error });
            }
            throw error;
        }

        // When code reaches here, it means that the key vault reference cannot be resolved in all possible ways.
        throw new ArgumentError("Failed to process the key vault reference. No key vault secret client, credential or secret resolver callback is available to resolve the secret.");
    }

    /**
     *
     * @param vaultUrl - The url of the key vault.
     * @returns
     */
    #getSecretClient(vaultUrl: URL): SecretClient | undefined {
        if (this.#secretClients === undefined) {
            this.#secretClients = new Map();
            for (const client of this.#keyVaultOptions?.secretClients ?? []) {
                const clientUrl = new URL(client.vaultUrl);
                this.#secretClients.set(clientUrl.host, client);
            }
        }

        let client: SecretClient | undefined;
        client = this.#secretClients.get(vaultUrl.host);
        if (client !== undefined) {
            return client;
        }

        if (this.#keyVaultOptions?.credential) {
            client = new SecretClient(vaultUrl.toString(), this.#keyVaultOptions.credential);
            this.#secretClients.set(vaultUrl.host, client);
            return client;
        }

        return undefined;
    }
}

function buildKeyVaultReferenceErrorMessage(message: string, setting: ConfigurationSetting, secretIdentifier?: string ): string {
    return `${message} Key: '${setting.key}' Label: '${setting.label ?? ""}' ETag: '${setting.etag ?? ""}' ${secretIdentifier ? ` SecretIdentifier: '${secretIdentifier}'` : ""}`;
}
