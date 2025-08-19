// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ConfigurationSetting, isSecretReference, parseSecretReference } from "@azure/app-configuration";
import { IKeyValueAdapter } from "../keyValueAdapter.js";
import { AzureKeyVaultSecretProvider } from "./keyVaultSecretProvider.js";
import { KeyVaultOptions } from "./keyVaultOptions.js";
import { RefreshTimer } from "../refresh/refreshTimer.js";
import { ArgumentError, KeyVaultReferenceError } from "../common/error.js";
import { KeyVaultSecretIdentifier, parseKeyVaultSecretIdentifier } from "@azure/keyvault-secrets";
import { isRestError } from "@azure/core-rest-pipeline";
import { AuthenticationError } from "@azure/identity";

export class AzureKeyVaultKeyValueAdapter implements IKeyValueAdapter {
    #keyVaultOptions: KeyVaultOptions | undefined;
    #keyVaultSecretProvider: AzureKeyVaultSecretProvider;

    constructor(keyVaultOptions: KeyVaultOptions | undefined, refreshTimer?: RefreshTimer) {
        this.#keyVaultOptions = keyVaultOptions;
        this.#keyVaultSecretProvider = new AzureKeyVaultSecretProvider(keyVaultOptions, refreshTimer);
    }

    canProcess(setting: ConfigurationSetting): boolean {
        return isSecretReference(setting);
    }

    async processKeyValue(setting: ConfigurationSetting): Promise<[string, unknown]> {
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
            const secretValue = await this.#keyVaultSecretProvider.getSecretValue(secretIdentifier);
            return [setting.key, secretValue];
        } catch (error) {
            if (isRestError(error) || error instanceof AuthenticationError) {
                throw new KeyVaultReferenceError(buildKeyVaultReferenceErrorMessage("Failed to resolve Key Vault reference.", setting, secretIdentifier.sourceId), { cause: error });
            }
            throw error;
        }
    }

    async onChangeDetected(): Promise<void> {
        this.#keyVaultSecretProvider.clearCache();
        return;
    }
}

function buildKeyVaultReferenceErrorMessage(message: string, setting: ConfigurationSetting, secretIdentifier?: string ): string {
    return `${message} Key: '${setting.key}' Label: '${setting.label ?? ""}' ETag: '${setting.etag ?? ""}' ${secretIdentifier ? ` SecretIdentifier: '${secretIdentifier}'` : ""}`;
}
