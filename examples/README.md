# Examples for Azure App Configuration JavaScript Provider

These examples show how to use the JavaScript Provider for Azure App Configuration in some common scenarios.

## Prerequisites

The sample programs are compatible with [LTS versions of Node.js](https://github.com/nodejs/release#release-schedule).

You need [an Azure subscription](https://azure.microsoft.com/free/) and the following Azure resources to run these sample programs:

- [Azure App Configuration store](https://learn.microsoft.com/en-us/azure/azure-app-configuration/quickstart-azure-app-configuration-create?tabs=azure-portal)

Samples retrieve credentials to accessyour App Configuration store from environment variables. Alternatively, edit the source code to include the appropriate credentials. See each individual sample for details on which environment variables/credentials it requires to function.

## Setup

To run the samples using the published version of the package:

1. Install the dependencies using `npm`:

```bash
npm install
```

2. Edit the file `.env.template`, adding the correct credentials to access the Azure service and rename the file from `.env.template` to just `.env`. Then run the samples, it will read this file automatically.

3. Run whichever samples you like:

```bash
node helloworld.mjs
```

Alternatively, run a single sample with the correct environment variables set (setting up the `.env` file is not required if you do this), for example (cross-platform):

```bash
npx cross-env APPCONFIG_CONNECTION_STRING="<appconfig connection string>" node helloworld.mjs
```
