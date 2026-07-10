// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ConfigurationSetting, isSecretReference, parseSecretReference } from "@azure/app-configuration";
import { IKeyValueAdapter } from "../keyValueAdapter.js";
import { AzureKeyVaultSecretProvider } from "./keyVaultSecretProvider.js";
import { KeyVaultOptions } from "./keyVaultOptions.js";
import { RefreshTimer } from "../refresh/refreshTimer.js";
import { ArgumentError, KeyVaultReferenceError } from "../common/errors.js";
import { KeyVaultReferenceErrorMessages } from "../common/errorMessages.js";
import { KeyVaultSecretIdentifier, parseKeyVaultSecretIdentifier } from "@azure/keyvault-secrets";
import { isRestError } from "@azure/core-rest-pipeline";
import { AuthenticationError } from "@azure/identity";

export class AzureKeyVaultKeyValueAdapter implements IKeyValueAdapter {
    #keyVaultOptions: KeyVaultOptions | undefined;
    #keyVaultSecretProvider: AzureKeyVaultSecretProvider;

    constructor(keyVaultOptions?: KeyVaultOptions, refreshTimer?: RefreshTimer) {
        this.#keyVaultOptions = keyVaultOptions;
        this.#keyVaultSecretProvider = new AzureKeyVaultSecretProvider(keyVaultOptions, refreshTimer);
    }

    canProcess(setting: ConfigurationSetting): boolean {
        return isSecretReference(setting);
    }

    async processKeyValue(setting: ConfigurationSetting): Promise<[string, unknown]> {
        if (!this.#keyVaultOptions) {
            throw new ArgumentError(KeyVaultReferenceErrorMessages.KEY_VAULT_OPTIONS_UNDEFINED);
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
            const secretValue = await this.#keyVaultSecretProvider.getSecretValue(secretIdentifier);
            return [setting.key, secretValue];
        } catch (error) {
            if (isRestError(error) || error instanceof AuthenticationError) {
                throw new KeyVaultReferenceError(buildKeyVaultReferenceErrorMessage("Failed to resolve Key Vault reference.", setting, secretIdentifier.sourceId), { cause: error });
            }
            throw error;
        }
    }

    /**
     * Returns the normalized Key Vault secret identifier (sourceId) for a secret reference setting,
     * or undefined if the reference cannot be parsed. Used to deduplicate references that resolve to
     * the same secret before resolving them.
     */
    getSecretReferenceId(setting: ConfigurationSetting): string | undefined {
        try {
            return parseKeyVaultSecretIdentifier(
                parseSecretReference(setting).value.secretId
            ).sourceId;
        } catch {
            return undefined;
        }
    }

    /**
     * Clears the cached secret values, throttled by the minimum secret refresh interval.
     */
    clearCache(): void {
        this.#keyVaultSecretProvider.clearCache();
    }

    async onChangeDetected(): Promise<void> {
        this.#keyVaultSecretProvider.clearCache();
        return;
    }
}

function buildKeyVaultReferenceErrorMessage(message: string, setting: ConfigurationSetting, secretIdentifier?: string ): string {
    return `${message} Key: '${setting.key}' Label: '${setting.label ?? ""}' ETag: '${setting.etag ?? ""}' ${secretIdentifier ? ` SecretIdentifier: '${secretIdentifier}'` : ""}`;
}
