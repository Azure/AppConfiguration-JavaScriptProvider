// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ConfigurationSetting, isSecretReference, parseSecretReference } from "@azure/app-configuration";
import { IKeyValueAdapter } from "../IKeyValueAdapter.js";
import { KeyVaultOptions } from "./KeyVaultOptions.js";
import { getUrlHost } from "../common/utils.js";
import { ArgumentError, KeyVaultReferenceError } from "../error.js";
import { SecretClient, parseKeyVaultSecretIdentifier } from "@azure/keyvault-secrets";

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
            throw new ArgumentError("Failed to process the key vault reference. The keyVaultOptions is not configured.");
        }

        const { name: secretName, vaultUrl, sourceId, version } = parseKeyVaultSecretIdentifier(
            parseSecretReference(setting).value.secretId
        );
        try {
            // precedence: secret clients > credential > secret resolver
            const client = this.#getSecretClient(new URL(vaultUrl));
            if (client) {
                const secret = await client.getSecret(secretName, { version });
                return [setting.key, secret.value];
            }
            if (this.#keyVaultOptions.secretResolver) {
                return [setting.key, await this.#keyVaultOptions.secretResolver(new URL(sourceId))];
            }
        } catch (error) {
            throw new KeyVaultReferenceError(buildKeyVaultReferenceErrorMessage(error.message, setting, sourceId));
        }

        // When code reaches here, it means that the key vault reference cannot be resolved in all possible ways.
        throw new ArgumentError("Failed to process the key vault reference. No key vault secret client, credential or secret resolver callback is configured.");
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
                this.#secretClients.set(getUrlHost(client.vaultUrl), client);
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
    return `${message} Key: ${setting.key} Label: ${setting.label ?? ""} ETag: ${setting.etag ?? ""} SecretIdentifier: ${secretIdentifier ?? ""}`;
}
