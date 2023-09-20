# Azure App Configuration - JavaScript Provider

The [Azure App Configuration](https://docs.microsoft.com/en-us/azure/azure-app-configuration/overview) provider for JavaScript enables developers to configure their applications using centralized configuration located in Azure App Configuration. 

## Getting started

### Prerequisites

- An [Azure Subscription](https://azure.microsoft.com)
- An [App Configuration](https://docs.microsoft.com/azure/azure-app-configuration/) resource

### Install the package

```bash
npm install @azure/app-configuration-provider
```

### Use the API

```js
import { load } from "@azure/app-configuration-provider";

// Load settings from App Configuration as a readonly Map.
const settings = await load("<app-configuration-connection-string>");

// Consume the settings by calling `get(key)`, e.g.
const value = settings.get("<key-of-a-config>");
```


## Examples

See code snippets under [examples/](./examples/) folder.

## Contributing

This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft 
trademarks or logos is subject to and must follow 
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
