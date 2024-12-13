// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient, AppConfigurationClientOptions } from "@azure/app-configuration";
import { ConfigurationClientWrapper } from "./ConfigurationClientWrapper.js";
import { TokenCredential } from "@azure/identity";
import { AzureAppConfigurationOptions, MaxRetries, MaxRetryDelayInMs } from "./AzureAppConfigurationOptions.js";
import { isBrowser, isWebWorker } from "./requestTracing/utils.js";
import * as RequestTracing from "./requestTracing/constants.js";
import { shuffleList } from "./common/utils.js";

const TCP_ORIGIN_KEY_NAME = "_origin._tcp";
const ALT_KEY_NAME = "_alt";
const TCP_KEY_NAME = "_tcp";
const ENDPOINT_KEY_NAME = "Endpoint";
const ID_KEY_NAME = "Id";
const SECRET_KEY_NAME = "Secret";
const TRUSTED_DOMAIN_LABELS = [".azconfig.", ".appconfig."];
const FALLBACK_CLIENT_REFRESH_EXPIRE_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds
const MINIMAL_CLIENT_REFRESH_INTERVAL = 30 * 1000; // 30 seconds in milliseconds
const SRV_QUERY_TIMEOUT = 30 * 1000; // 30 seconds in milliseconds

export class ConfigurationClientManager {
    #isFailoverable: boolean;
    #dns: any;
    endpoint: URL;
    #secret : string;
    #id : string;
    #credential: TokenCredential;
    #clientOptions: AppConfigurationClientOptions | undefined;
    #appConfigOptions: AzureAppConfigurationOptions | undefined;
    #validDomain: string;
    #staticClients: ConfigurationClientWrapper[]; // there should always be only one static client
    #dynamicClients: ConfigurationClientWrapper[];
    #replicaCount: number = 0;
    #lastFallbackClientRefreshTime: number = 0;
    #lastFallbackClientRefreshAttempt: number = 0;

    constructor (
        connectionStringOrEndpoint?: string | URL,
        credentialOrOptions?: TokenCredential | AzureAppConfigurationOptions,
        appConfigOptions?: AzureAppConfigurationOptions
    ) {
        let staticClient: AppConfigurationClient;
        const credentialPassed = instanceOfTokenCredential(credentialOrOptions);

        if (typeof connectionStringOrEndpoint === "string" && !credentialPassed) {
            const connectionString = connectionStringOrEndpoint;
            this.#appConfigOptions = credentialOrOptions as AzureAppConfigurationOptions;
            this.#clientOptions = getClientOptions(this.#appConfigOptions);
            const ConnectionStringRegex = /Endpoint=(.*);Id=(.*);Secret=(.*)/;
            const regexMatch = connectionString.match(ConnectionStringRegex);
            if (regexMatch) {
                const endpointFromConnectionStr = regexMatch[1];
                this.endpoint = getValidUrl(endpointFromConnectionStr);
                this.#id = regexMatch[2];
                this.#secret = regexMatch[3];
            } else {
                throw new Error(`Invalid connection string. Valid connection strings should match the regex '${ConnectionStringRegex.source}'.`);
            }
            staticClient = new AppConfigurationClient(connectionString, this.#clientOptions);
        } else if ((connectionStringOrEndpoint instanceof URL || typeof connectionStringOrEndpoint === "string") && credentialPassed) {
            let endpoint = connectionStringOrEndpoint;
            // ensure string is a valid URL.
            if (typeof endpoint === "string") {
                endpoint = getValidUrl(endpoint);
            }

            const credential = credentialOrOptions as TokenCredential;
            this.#appConfigOptions = appConfigOptions as AzureAppConfigurationOptions;
            this.#clientOptions = getClientOptions(this.#appConfigOptions);
            this.endpoint = endpoint;
            this.#credential = credential;
            staticClient = new AppConfigurationClient(this.endpoint.origin, this.#credential, this.#clientOptions);
        } else {
            throw new Error("A connection string or an endpoint with credential must be specified to create a client.");
        }

        this.#staticClients = [new ConfigurationClientWrapper(this.endpoint.origin, staticClient)];
        this.#validDomain = getValidDomain(this.endpoint.hostname.toLowerCase());
    }

    async init() {
        if (this.#appConfigOptions?.replicaDiscoveryEnabled === false || isBrowser() || isWebWorker()) {
            this.#isFailoverable = false;
            return;
        }

        try {
            this.#dns = await import("dns/promises");
        }catch (error) {
            this.#isFailoverable = false;
            console.warn("Failed to load the dns module:", error.message);
            return;
        }

        this.#isFailoverable = true;
    }

    getReplicaCount(): number {
        return this.#replicaCount;
    }

    async getClients(): Promise<ConfigurationClientWrapper[]> {
        if (!this.#isFailoverable) {
            return this.#staticClients;
        }

        const currentTime = Date.now();
        // Filter static clients whose backoff time has ended
        let availableClients = this.#staticClients.filter(client => client.backoffEndTime <= currentTime);
        if (currentTime >= this.#lastFallbackClientRefreshAttempt + MINIMAL_CLIENT_REFRESH_INTERVAL &&
            (!this.#dynamicClients ||
            // All dynamic clients are in backoff means no client is available
            this.#dynamicClients.every(client => currentTime < client.backoffEndTime) ||
            currentTime >= this.#lastFallbackClientRefreshTime + FALLBACK_CLIENT_REFRESH_EXPIRE_INTERVAL)) {
            this.#lastFallbackClientRefreshAttempt = currentTime;
            await this.#discoverFallbackClients(this.endpoint.hostname);
            return availableClients.concat(this.#dynamicClients);
        }

        // If there are dynamic clients, filter and concatenate them
        if (this.#dynamicClients && this.#dynamicClients.length > 0) {
            availableClients = availableClients.concat(
                this.#dynamicClients
                    .filter(client => client.backoffEndTime <= currentTime));
        }

        return availableClients;
    }

    async refreshClients() {
        const currentTime = Date.now();
        if (this.#isFailoverable &&
            currentTime >= new Date(this.#lastFallbackClientRefreshAttempt + MINIMAL_CLIENT_REFRESH_INTERVAL).getTime()) {
            this.#lastFallbackClientRefreshAttempt = currentTime;
            await this.#discoverFallbackClients(this.endpoint.hostname);
        }
    }

    async #discoverFallbackClients(host: string) {
        let result;
        try {
            result = await Promise.race([
                new Promise((_, reject) => setTimeout(() => reject(new Error("SRV record query timed out.")), SRV_QUERY_TIMEOUT)),
                this.#querySrvTargetHost(host)
            ]);
        } catch (error) {
            throw new Error(`Failed to build fallback clients, ${error.message}`);
        }

        const srvTargetHosts = shuffleList(result) as string[];
        const newDynamicClients: ConfigurationClientWrapper[] = [];
        for (const host of srvTargetHosts) {
            if (isValidEndpoint(host, this.#validDomain)) {
                const targetEndpoint = `https://${host}`;
                if (host.toLowerCase() === this.endpoint.hostname.toLowerCase()) {
                    continue;
                }
                const client = this.#credential ?
                                new AppConfigurationClient(targetEndpoint, this.#credential, this.#clientOptions) :
                                new AppConfigurationClient(buildConnectionString(targetEndpoint, this.#secret, this.#id), this.#clientOptions);
                newDynamicClients.push(new ConfigurationClientWrapper(targetEndpoint, client));
            }
        }

        this.#dynamicClients = newDynamicClients;
        this.#lastFallbackClientRefreshTime = Date.now();
        this.#replicaCount = this.#dynamicClients.length;
    }

    /**
     * Query SRV records and return target hosts.
     */
    async #querySrvTargetHost(host: string): Promise<string[]> {
        const results: string[] = [];

        try {
            // Look up SRV records for the origin host
            const originRecords = await this.#dns.resolveSrv(`${TCP_ORIGIN_KEY_NAME}.${host}`);
            if (originRecords.length === 0) {
                return results;
            }

            // Add the first origin record to results
            const originHost = originRecords[0].name;
            results.push(originHost);

            // Look up SRV records for alternate hosts
            let index = 0;
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const currentAlt = `${ALT_KEY_NAME}${index}`;
                const altRecords = await this.#dns.resolveSrv(`${currentAlt}.${TCP_KEY_NAME}.${originHost}`);
                if (altRecords.length === 0) {
                    break; // No more alternate records, exit loop
                }

                altRecords.forEach(record => {
                    const altHost = record.name;
                    if (altHost) {
                        results.push(altHost);
                    }
                });
                index++;
            }
        } catch (err) {
            if (err.code === "ENOTFOUND") {
                return results; // No more SRV records found, return results
            } else {
                throw new Error(`Failed to lookup SRV records: ${err.message}`);
            }
        }

        return results;
    }
}

/**
 * Builds a connection string from the given endpoint, secret, and id.
 * Returns an empty string if either secret or id is empty.
 */
function buildConnectionString(endpoint, secret, id: string): string {
    if (!secret || !id) {
        return "";
    }

    return `${ENDPOINT_KEY_NAME}=${endpoint};${ID_KEY_NAME}=${id};${SECRET_KEY_NAME}=${secret}`;
}

/**
 * Extracts a valid domain from the given endpoint URL based on trusted domain labels.
 */
export function getValidDomain(host: string): string {
    for (const label of TRUSTED_DOMAIN_LABELS) {
        const index = host.lastIndexOf(label);
        if (index !== -1) {
            return host.substring(index);
        }
    }

    return "";
}

/**
 * Checks if the given host ends with the valid domain.
 */
export function isValidEndpoint(host: string, validDomain: string): boolean {
    if (!validDomain) {
        return false;
    }

    return host.toLowerCase().endsWith(validDomain.toLowerCase());
}

function getClientOptions(options?: AzureAppConfigurationOptions): AppConfigurationClientOptions | undefined {
    // user-agent
    let userAgentPrefix = RequestTracing.USER_AGENT_PREFIX; // Default UA for JavaScript Provider
    const userAgentOptions = options?.clientOptions?.userAgentOptions;
    if (userAgentOptions?.userAgentPrefix) {
        userAgentPrefix = `${userAgentOptions.userAgentPrefix} ${userAgentPrefix}`; // Prepend if UA prefix specified by user
    }

    // retry options
    const defaultRetryOptions = {
        maxRetries: MaxRetries,
        maxRetryDelayInMs: MaxRetryDelayInMs,
    };
    const retryOptions = Object.assign({}, defaultRetryOptions, options?.clientOptions?.retryOptions);

    return Object.assign({}, options?.clientOptions, {
        retryOptions,
        userAgentOptions: {
            userAgentPrefix
        }
    });
}

function getValidUrl(endpoint: string): URL {
    try {
        return new URL(endpoint);
    } catch (error) {
        if (error.code === "ERR_INVALID_URL") {
            throw new Error("Invalid endpoint URL.", { cause: error });
        } else {
            throw error;
        }
    }
}

export function instanceOfTokenCredential(obj: unknown) {
    return obj && typeof obj === "object" && "getToken" in obj && typeof obj.getToken === "function";
}

