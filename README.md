# neat-cli

## Setup

```
const NeatCli = require("neat-cli");

const config = {
    rootDir: __dirname + "/../../",
    scriptsPath: __dirname + "/../../scripts",
    modulesPath: __dirname + "/../../modules",
    configPath: __dirname + "/../../config",
    applicationConfigPath: __dirname + "/../../config/application",
    logDir: __dirname + "/../../logs",
    argv: process.argv
    monitoring: { // optional, default: no monitoring
        socketConnectionTimeout: 5000,
        statusUrl: "http://localhost:13338", // required - The URL to establish a socket connection to
        ignoreWarnings: true,
        passStatsInterval: 500
    }
};

const cli = new NeatCli(config);
```

## Events

```
cli.on('socketOpened', (socket) => {
    console.log("Trying to establish a socket connection to " + config.monitoring.statusUrl);
});

cli.on('socketConnectionTimeout', () => {
    console.log("Could not establish a connection to " + config.monitoring.statusUrl);
});

cli.on('socketConnected', (socket) => {
    console.log("Established socket connection. Socket ID: " + socket.id);
});

cli.on('socketDisonnected', (socket) => {
    console.log("Lost connection to monitoring server.");
});

cli.on('socketError', (data) => {
    console.log("Monitoring Server rejected monitoring with error.");
    console.log(data.error);
});

cli.on('scriptsLoaded', (scripts) => {
    console.log("Loaded scripts. Total: " + scripts.length);
});

cli.on('monitoringStarted', (socket) => {
    console.log("Script is now monitored by server at " + config.monitoring.statusUrl);
});

cli.on('scriptFinished', () => {
    console.log("Script finished.");
});
```

## Usage

Start the file with node in which you created a new instance of NeatCli,
for example 'cli.js':

```
node cli.js ScriptName --argument1 --argument2
```
