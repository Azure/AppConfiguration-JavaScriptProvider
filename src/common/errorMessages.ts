// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { MIN_REFRESH_INTERVAL_IN_MS } from "../refresh/refreshOptions.js";
import { MIN_SECRET_REFRESH_INTERVAL_IN_MS } from "../keyvault/keyVaultOptions.js";

export const enum ErrorMessages {
    INVALID_WATCHED_SETTINGS_KEY = "The characters '*' and ',' are not supported in key of watched settings.",
    INVALID_WATCHED_SETTINGS_LABEL = "The characters '*' and ',' are not supported in label of watched settings.",
    INVALID_REFRESH_INTERVAL = `The refresh interval cannot be less than ${MIN_REFRESH_INTERVAL_IN_MS} milliseconds.`,
    INVALID_FEATURE_FLAG_REFRESH_INTERVAL = `The feature flag refresh interval cannot be less than ${MIN_REFRESH_INTERVAL_IN_MS} milliseconds.`,
    INVALID_SECRET_REFRESH_INTERVAL = `The Key Vault secret refresh interval cannot be less than ${MIN_SECRET_REFRESH_INTERVAL_IN_MS} milliseconds.`,
    LOAD_OPERATION_TIMEOUT = "The load operation timed out.",
    LOAD_OPERATION_FAILED = "The load operation failed.",
    REFRESH_NOT_ENABLED = "Refresh is not enabled for key-values, feature flags or Key Vault secrets.",
    ALL_FALLBACK_CLIENTS_FAILED = "All fallback clients failed to get configuration settings.",
    CONFIGURATION_SETTING_VALUE_UNDEFINED = "The value of configuration setting cannot be undefined.",
    INVALID_SNAPSHOT_SELECTOR = "Key, label or tag filters should not be specified while selecting a snapshot.",
    INVALID_KEY_FILTER = "Key filter cannot be null or empty.",
    INVALID_LABEL_FILTER = "The characters '*' and ',' are not supported in label filters.",
    INVALID_TAG_FILTER = "Tag filter must follow the format 'tagName=tagValue'",
    CONNECTION_STRING_OR_ENDPOINT_MISSED = "A connection string or an endpoint with credential must be specified to create a client.",
}

export const enum KeyVaultReferenceErrorMessages {
    KEY_VAULT_OPTIONS_UNDEFINED = "Failed to process the Key Vault reference because Key Vault options are not configured.",
    KEY_VAULT_REFERENCE_UNRESOLVABLE = "Failed to resolve the key vault reference. No key vault secret client, credential or secret resolver callback is available to resolve the secret."
}
