// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ConfigurationSetting, isSecretReference, parseSecretReference } from "@azure/app-configuration";
import { IKeyValueAdapter } from "../IKeyValueAdapter.js";
import { KeyVaultOptions } from "./KeyVaultOptions.js";
import { getUrlHost } from "../common/utils.js";
import { ArgumentError } from "../error.js";
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

        // precedence: secret clients > credential > secret resolver
        const { name: secretName, vaultUrl, sourceId, version } = parseKeyVaultSecretIdentifier(
            parseSecretReference(setting).value.secretId
        );

        const client = this.#getSecretClient(new URL(vaultUrl));
        if (client) {
            // If the credential of the secret client is wrong, AuthenticationError will be thrown.
            const secret = await client.getSecret(secretName, { version });
            return [setting.key, secret.value];
        }

        if (this.#keyVaultOptions.secretResolver) {
            return [setting.key, await this.#keyVaultOptions.secretResolver(new URL(sourceId))];
        }

        // When code reaches here, it means the key vault secret reference is not resolved.

        throw new ArgumentError("Failed to process the key vault reference. No key vault credential or secret resolver callback is configured.");
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
