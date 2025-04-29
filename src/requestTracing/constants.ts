// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { VERSION } from "../version.js";

export const ENV_AZURE_APP_CONFIGURATION_TRACING_DISABLED = "AZURE_APP_CONFIGURATION_TRACING_DISABLED";

// User Agent
export const USER_AGENT_PREFIX = `javascript-appconfiguration-provider/${VERSION}`;

// Correlation Context
export const CORRELATION_CONTEXT_HEADER_NAME = "Correlation-Context";

// Env
export const NODEJS_ENV_VAR = "NODE_ENV";
export const NODEJS_DEV_ENV_VAL = "development";
export const ENV_KEY = "Env";
export const DEV_ENV_VAL = "Dev";

// Host Type
export const HOST_TYPE_KEY = "Host";
export enum HostType {
    AZURE_FUNCTION = "AzureFunction",
    AZURE_WEB_APP = "AzureWebApp",
    CONTAINER_APP = "ContainerApp",
    KUBERNETES = "Kubernetes",
    SERVICE_FABRIC = "ServiceFabric",
    // Client-side
    BROWSER = "Web",
    WEB_WORKER = "WebWorker"
}

// Environment variables to identify Host type.
export const AZURE_FUNCTION_ENV_VAR = "FUNCTIONS_EXTENSION_VERSION";
export const AZURE_WEB_APP_ENV_VAR = "WEBSITE_SITE_NAME";
export const CONTAINER_APP_ENV_VAR = "CONTAINER_APP_NAME";
export const KUBERNETES_ENV_VAR = "KUBERNETES_PORT";
export const SERVICE_FABRIC_ENV_VAR = "Fabric_NodeName"; // See: https://docs.microsoft.com/en-us/azure/service-fabric/service-fabric-environment-variables-reference

// Request type
export const REQUEST_TYPE_KEY = "RequestType";
export enum RequestType {
    STARTUP = "Startup",
    WATCH = "Watch"
}

// Replica count
export const REPLICA_COUNT_KEY = "ReplicaCount";

// Tag names
export const KEY_VAULT_CONFIGURED_TAG = "UsesKeyVault";
export const CDN_USED_TAG = "CDN";
export const FAILOVER_REQUEST_TAG = "Failover";

// Compact feature tags
export const FEATURES_KEY = "Features";
export const LOAD_BALANCE_CONFIGURED_TAG = "LB";

// Feature management package
export const FM_PACKAGE_NAME = "@microsoft/feature-management";
export const FM_VERSION_KEY = "FMJsVer";

// Feature flag usage tracing
export const FEATURE_FILTER_TYPE_KEY = "Filter";
export const CUSTOM_FILTER_KEY = "CSTM";
export const TIME_WINDOW_FILTER_KEY = "TIME";
export const TARGETING_FILTER_KEY = "TRGT";

export const FF_TELEMETRY_USED_TAG = "Telemetry";
export const FF_MAX_VARIANTS_KEY = "MaxVariants";
export const FF_SEED_USED_TAG = "Seed";
export const FF_FEATURES_KEY = "FFFeatures";

// AI Configuration tracing
export const AI_CONFIGURATION_TAG = "AI";
export const AI_CHAT_COMPLETION_CONFIGURATION_TAG = "AICC";

export const AI_MIME_PROFILE = "https://azconfig.io/mime-profiles/ai";
export const AI_CHAT_COMPLETION_MIME_PROFILE = "https://azconfig.io/mime-profiles/ai/chat-completion";

export const DELIMITER = "+";
