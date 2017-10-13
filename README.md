# neat-cli

## Setup

```
const NeatCli = require("neat-cli");
```
```
const config = {
    rootDir: __dirname, // required
    scriptRootPath: __dirname + "/scripts", // required
    argv: process.argv, // optional, default: process.argv
    monitoring: { // optional, default: no monitoring
        socketConnectionTimeout: 5000,
        statusUrl: "http://localhost:13338", // required - The URL to establish a socket connection to
        ignoreWarnings: true,
        passStatsInterval: 500
    }
};
```
```
const cli = new NeatCli(config);
```

## Events

```
cli.on('socketConnectionTimeout', () => {
    console.log("Could not establish a connection to " + config.monitoring.statusUrl);
});

cli.on('scriptsLoaded', (data) => {
    console.log("Loaded scripts. Total: " + data.length);
});

cli.on('socketConnected', (data) => {
    console.log("Established socket connection. Socket ID: " + data.id);
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