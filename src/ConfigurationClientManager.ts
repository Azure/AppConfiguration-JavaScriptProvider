// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AppConfigurationClient, AppConfigurationClientOptions } from "@azure/app-configuration";
import { ConfigurationClientWrapper } from "./ConfigurationClientWrapper.js";
import { TokenCredential } from "@azure/identity";
import { AzureAppConfigurationOptions } from "./AzureAppConfigurationOptions.js";
import { isBrowser, isWebWorker } from "./requestTracing/utils.js";
import * as RequestTracing from "./requestTracing/constants.js";
import { instanceOfTokenCredential, shuffleList } from "./common/utils.js";
import { ArgumentError } from "./error.js";

// Configuration client retry options
const CLIENT_MAX_RETRIES = 2;
const CLIENT_MAX_RETRY_DELAY = 60_000; // 1 minute in milliseconds

const TCP_ORIGIN_KEY_NAME = "_origin._tcp";
const ALT_KEY_NAME = "_alt";
const TCP_KEY_NAME = "_tcp";
const ENDPOINT_KEY_NAME = "Endpoint";
const ID_KEY_NAME = "Id";
const SECRET_KEY_NAME = "Secret";
const TRUSTED_DOMAIN_LABELS = [".azconfig.", ".appconfig."];
const FALLBACK_CLIENT_EXPIRE_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds
const MINIMAL_CLIENT_REFRESH_INTERVAL = 30_000; // 30 seconds in milliseconds
const DNS_RESOLVER_TIMEOUT = 3_000; // 3 seconds in milliseconds, in most cases, dns resolution should be within 200 milliseconds
const DNS_RESOLVER_TRIES = 2;
const MAX_ALTNATIVE_SRV_COUNT = 10;

export class ConfigurationClientManager {
    readonly endpoint: URL; // primary endpoint, which is the one specified in the connection string or passed in as a parameter
    #isFailoverable: boolean;
    #dns: any;
    #secret : string;
    #id : string;
    #credential: TokenCredential;
    #clientOptions: AppConfigurationClientOptions | undefined;
    #appConfigOptions: AzureAppConfigurationOptions | undefined;
    #validDomain: string; // valid domain for the primary endpoint, which is used to discover replicas
    #staticClients: ConfigurationClientWrapper[]; // there should always be only one static client
    #dynamicClients: ConfigurationClientWrapper[];
    #replicaCount: number = 0;
    #lastFallbackClientUpdateTime: number = 0; // enforce to discover fallback client when it is expired
    #lastFallbackClientRefreshAttempt: number = 0; // avoid refreshing clients before the minimal refresh interval

    // This property is public to allow recording the last successful endpoint for failover.
    endpoint: URL;

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
                this.endpoint = new URL(endpointFromConnectionStr);
                this.#id = regexMatch[2];
                this.#secret = regexMatch[3];
            } else {
                throw new ArgumentError(`Invalid connection string. Valid connection strings should match the regex '${ConnectionStringRegex.source}'.`);
            }
            staticClient = new AppConfigurationClient(connectionString, this.#clientOptions);
        } else if ((connectionStringOrEndpoint instanceof URL || typeof connectionStringOrEndpoint === "string") && credentialPassed) {
            let endpoint = connectionStringOrEndpoint;
            // ensure string is a valid URL.
            if (typeof endpoint === "string") {
                endpoint = new URL(endpoint);
            }

            const credential = credentialOrOptions as TokenCredential;
            this.#appConfigOptions = appConfigOptions as AzureAppConfigurationOptions;
            this.#clientOptions = getClientOptions(this.#appConfigOptions);
            this.endpoint = endpoint;
            this.#credential = credential;
            staticClient = new AppConfigurationClient(this.endpoint.origin, this.#credential, this.#clientOptions);
        } else {
            throw new ArgumentError("A connection string or an endpoint with credential must be specified to create a client.");
        }

        this.#staticClients = [new ConfigurationClientWrapper(this.endpoint.origin, staticClient)];
        this.#validDomain = getValidDomain(this.endpoint.hostname.toLowerCase());
    }

    async init() {
        if (this.#appConfigOptions?.replicaDiscoveryEnabled === false || isBrowser() || isWebWorker()) {
            this.#isFailoverable = false;
            return;
        }
        if (this.#dns) { // dns module is already loaded
            return;
        }

        // We can only know whether dns module is available during runtime.
        try {
            this.#dns = await import("dns/promises");
        } catch (error) {
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
            currentTime >= this.#lastFallbackClientUpdateTime + FALLBACK_CLIENT_EXPIRE_INTERVAL)) {
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
            currentTime >= this.#lastFallbackClientRefreshAttempt + MINIMAL_CLIENT_REFRESH_INTERVAL) {
            await this.#discoverFallbackClients(this.endpoint.hostname);
        }
    }

    async #discoverFallbackClients(host: string) {
        this.#lastFallbackClientRefreshAttempt = Date.now();
        let result: string[];
        try {
            result = await this.#querySrvTargetHost(host);
        } catch (error) {
            console.warn(`Failed to build fallback clients. ${error.message}`);
            return; // swallow the error when srv query fails
        }

        const srvTargetHosts = shuffleList(result);
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
        this.#lastFallbackClientUpdateTime = Date.now();
        this.#replicaCount = this.#dynamicClients.length;
    }

    /**
     * Queries SRV records for the given host and returns the target hosts.
     */
    async #querySrvTargetHost(host: string): Promise<string[]> {
        const results: string[] = [];

        try {
            // https://nodejs.org/api/dns.html#dnspromisesresolvesrvhostname
            const resolver = new this.#dns.Resolver({timeout: DNS_RESOLVER_TIMEOUT, tries: DNS_RESOLVER_TRIES});
            // On success, resolveSrv() returns an array of SrvRecord
            // On failure, resolveSrv() throws an error with code 'ENOTFOUND'.
            const originRecords = await resolver.resolveSrv(`${TCP_ORIGIN_KEY_NAME}.${host}`); // look up SRV records for the origin host
            const originHost = originRecords[0].name;
            results.push(originHost); // add the first origin record to results

            let index = 0;
            while (index < MAX_ALTNATIVE_SRV_COUNT) {
                const currentAlt = `${ALT_KEY_NAME}${index}`; // look up SRV records for alternate hosts
                const altRecords = await resolver.resolveSrv(`${currentAlt}.${TCP_KEY_NAME}.${originHost}`);

                altRecords.forEach(record => {
                    const altHost = record.name;
                    if (altHost) {
                        results.push(altHost);
                    }
                });
                index++;
            }
        } catch (error) {
            if (error.code === "ENOTFOUND") {
                // No more SRV records found, return results.
                return results;
            } else {
                throw new Error(`Failed to lookup SRV records: ${error.message}`);
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
        maxRetries: CLIENT_MAX_RETRIES,
        maxRetryDelayInMs: CLIENT_MAX_RETRY_DELAY,
    };
    const retryOptions = Object.assign({}, defaultRetryOptions, options?.clientOptions?.retryOptions);

    return Object.assign({}, options?.clientOptions, {
        retryOptions,
        userAgentOptions: {
            userAgentPrefix
        }
    });
}
