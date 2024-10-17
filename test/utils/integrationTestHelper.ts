import { ConfigurationSetting } from "@azure/app-configuration";
import * as https from "https";
import * as selfsigned from "selfsigned";
import * as fs from "fs";

let server;

const domain = "localhost";
const port = 8443;

function startMockServer(settings: ConfigurationSetting[]) {
    const attrs = [{ name: "commonName", value: domain }];
    const certOptions = { keySize: 2048, selfSigned: true };
    const pems = selfsigned.generate(attrs, certOptions);

    fs.writeFileSync("server.key", pems.private);
    fs.writeFileSync("server.cert", pems.cert);

    const options = {
        key: fs.readFileSync("server.key"),
        cert: fs.readFileSync("server.cert")
    };

    const responseBody = {
        items: [...settings]
    };

    server = https.createServer(options, (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(responseBody));
    });

    server.listen(port);
}

function closeMockServer() {
    server.close();
}

const mockServerEndpoint = `https://localhost:${port}`;

export {
    startMockServer,
    closeMockServer,
    mockServerEndpoint
};
