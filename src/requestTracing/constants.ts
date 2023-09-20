// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Version } from "../version";

export const RequestTracingDisabledEnvironmentVariable = "AZURE_APP_CONFIGURATION_TRACING_DISABLED";

// User Agent
export const UserAgentPrefix = `javascript-appconfiguration-provider/${Version}`;

// Correlation Context
export const CorrelationContextHeaderName = "Correlation-Context";

// Env
export const NodeJSEnvironmentVariable = "NODE_ENV";
export const NodeJSDevEnvironmentVariableValue = "development";
export const EnvironmentKey = "Env";
export const DevEnvironmentValue = "Dev";

// Host Type
export const HostTypeKey = "Host";
export enum HostType {
    AzureFunction = "AzureFunction",
    AzureWebApp = "AzureWebApp",
    ContainerApp = "ContainerApp",
    Kubernetes = "Kubernetes",
    ServiceFabric = "ServiceFabric"
}

// Environment variables to identify Host type.
export const AzureFunctionEnvironmentVariable = "FUNCTIONS_EXTENSION_VERSION";
export const AzureWebAppEnvironmentVariable = "WEBSITE_SITE_NAME";
export const ContainerAppEnvironmentVariable = "CONTAINER_APP_NAME";
export const KubernetesEnvironmentVariable = "KUBERNETES_PORT";
export const ServiceFabricEnvironmentVariable = "Fabric_NodeName"; // See: https://docs.microsoft.com/en-us/azure/service-fabric/service-fabric-environment-variables-reference

// Request Type
export const RequestTypeKey = "RequestType";
export enum RequestType {
    Startup = "Startup",
    Watch = "Watch"
}

// Tag names
export const KeyVaultConfiguredTag = "UsesKeyVault";
