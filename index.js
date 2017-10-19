"use strict";

let commander = require("commander");
let Tools = require("neat-base").Tools;
let Application = require("neat-base").Application;
let Promise = require("bluebird");
let _ = require("underscore");
let stripAnsi = require('strip-ansi');
let socketIOClient = require('socket.io-client');
let interceptStdout = require("intercept-stdout");

let EventEmitter = require('events');
let path = require("path");
let fs = require("fs");

let defaultConfig = {
    rootDir: __dirname + "/../../",
    scriptsPath: __dirname + "/../../scripts",
    modulesPath: __dirname + "/../../modules",
    configPath: __dirname + "/../../config",
    applicationConfigPath: __dirname + "/../../config/application",
    logDir: __dirname + "/../../logs",
    argv: process.argv
};

module.exports = class NeatCli extends EventEmitter {

    constructor(config) {
        super();

        if(!config) {
            config = {};
        }

        this.config = _.extend(defaultConfig, config);

        // resolve paths
        this.config.rootDir = path.resolve(this.config.rootDir);
        this.config.scriptsPath = path.resolve(this.config.scriptsPath);
        this.config.modulesPath = path.resolve(this.config.modulesPath);
        this.config.configPath = path.resolve(this.config.configPath);
        this.config.applicationConfigPath = path.resolve(this.config.applicationConfigPath);
        this.config.logDir = path.resolve(this.config.logDir);

        this.scriptData = null;

        commander.option("-v, --verbose", "Script verbosity");
        commander.option("-q, --quiet", "Disables script output");
        commander.option("-V, --view", "Enables view stage");
        commander.option("-d, --dev", "Enables dev stage");

        this.loadScripts().then(() => {

            this.emit('scriptsLoaded', this.scriptData);

            let parsed = commander.parseOptions(commander.normalize(this.config.argv.slice(2)));
            let allArgs = parsed.args.concat(parsed.unknown);

            for(let i = 0; i<allArgs.length; i++) {
                let arg = allArgs[i];

                for(let s = 0; s<this.scriptData.length; s++) {
                    let scriptName = this.scriptData[s].name;
                    if(scriptName === arg) {
                        this.runningScript = this.scriptData[s];
                        break;
                    }
                }
            }

            return this.initializeMonitoring().then(() => {
                return this.registerCommands();
            }).catch((e) => {
                console.log("Could not initialize monitoring for script " + this.runningScript.name);
                console.log(e);
                return this.registerCommands();
            });

        }).then(() => {

            this.parse(this.config.argv);
            this.startMonitoring();

        }).catch((e) => {
            console.log(e);
            commander.help();
        });
    }


    parse(argv) {

        commander.parse(argv);

        if (commander.verbose && commander.quiet) {
            throw new Error("Can't use --verbose and --quiet at the same time!");
        }

        if (commander.view && commander.dev) {
            throw new Error("Can't use --view and --dev at the same time!");
        }

        if (!this.commandRunning) {
            commander.outputHelp();
            process.exit(0);
        }
    }

    loadScripts() {
        return new Promise((resolve, reject) => {

            fs.readdir(this.config.scriptsPath, (err, directories) => {
                if (err) {
                    return reject(err);
                }

                Promise.map(directories, (directory) => {
                    return new Promise((res) => {
                        fs.readFile(this.config.scriptsPath + "/" + directory + "/package.json", (err, packageJson) => {
                            if (err) {
                                return reject(err);
                            }

                            packageJson = JSON.parse(packageJson.toString());
                            packageJson.scriptConfig = null;

                            fs.readFile(this.config.scriptsPath + "/" + directory + "/script.json", (err, scriptJson) => {

                                if (err) {
                                    return reject(err);
                                }

                                packageJson.scriptConfig = JSON.parse(scriptJson.toString());
                                packageJson.scriptConfig.arguments = packageJson.scriptConfig.arguments || [];
                                packageJson.scriptConfig.useLockFile = packageJson.scriptConfig.useLockFile || false;

                                return res(packageJson);
                            });
                        });
                    });
                }).then((scriptData) => {
                    this.scriptData = scriptData;
                    return resolve();
                });
            });
        });
    }

    registerCommands() {
        return new Promise((resolve, reject) => {
            if(!this.scriptData || !this.scriptData.length) {
                return reject(new Error("No scripts found"));
            }

            let self = this;

            Promise.map(this.scriptData, (script) => {
                let requiredArguments = [];
                let command = commander.command(script.name);

                command.description(script.description);
                command._helpInformation = command.helpInformation;

                command.helpInformation = function () {
                    let oldName = this._name;
                    this._name = this.parent.name() + " " + this._name;
                    let ret = this._helpInformation();
                    this._name = oldName;
                    return ret;
                };

                command.optionHelp = function () {
                    let width = Math.max(this.largestOptionLength(), this.parent.largestOptionLength());

                    // Prepend the help information
                    return [].concat(this.options.map(function (option) {
                        return Tools.pad(option.flags, width) + '  ' + option.description;
                    })).concat([
                        "",
                        "Global options:"
                    ]).concat([
                        Tools.pad("-h, --help", width) + "  output usage information"
                    ]).concat(this.parent.options.map(function (option) {
                        return Tools.pad(option.flags, width) + '  ' + option.description;
                    })).join('\n');
                };

                for (let i = 0; i < script.scriptConfig.arguments.length; i++) {

                    let argument = script.scriptConfig.arguments[i];
                    argument.shortName = argument.shortName ? argument.shortName[0].toLowerCase() : undefined;

                    if (argument.required) {
                        requiredArguments.push(argument.longName || argument.shortName)
                    }

                    if (argument.shortName) {
                        argument.shortName = "-" + argument.shortName[0].toLowerCase();
                    }
                    if (argument.longName) {
                        argument.longName = "--" + argument.longName;
                    }

                    if (argument.isArgument) {
                        command.arguments(argument.name);
                    } else {
                        command.option([
                            argument.shortName,
                            argument.longName
                        ].filter(val => !!val).join(", "), argument.description);
                    }
                }


                command.action(function() {

                    self.commandRunning = true;
                    let stage = process.env.STAGE || process.env.NODE_ENV || "dev";

                    if (this.parent.view) {
                        stage = "view";
                    } else if (this.parent.dev) {
                        stage = "dev"
                    }

                    let logLevel = "info";
                    if (this.parent.dev || this.parent.verbose) {
                        logLevel = "debug";
                    }
                    if (this.parent.quiet) {
                        logLevel = "error"
                    }

                    let opts = this.opts();
                    let args = {};

                    try {
                        for (let i = 0; i < requiredArguments.length; i++) {
                            let arg = requiredArguments[i];
                            if (!opts[arg]) {
                                throw new Error("Missing argument " + arg + "!");
                            }
                        }

                        for (let i = 0; i < arguments.length; i++) {
                            if (this._args[i]) {
                                let argName = this._args[i].name;
                                let argValue = arguments[i];

                                args[argName] = argValue;
                            }
                        }

                        Application.configure({
                            // STAGE
                            stage: stage,
                            stages: [
                                "prod",
                                "view",
                                "dev"
                            ],

                            // PATHS
                            root_path: self.config.rootDir,
                            modules_path: self.config.modulesPath,
                            config_path: self.config.configPath,
                            scripts_path: self.config.scriptsPath,
                            application_config_path: self.config.applicationConfigPath,
                            logDir: self.config.logDir,

                            // LOG LEVELS
                            logLevelConsole: logLevel,
                            logLevelFile: logLevel,
                            logLevelRemote: logLevel,
                            logFormat: "DD.MM.YYYY hh:mm:ss",
                            logDisabled: false,
                            quiet: !!this.parent.quiet,
                        });

                        script.options = opts;
                        script.arguments = args;

                        let socket = self.monitoringConnected ? self.socket : null;

                        Application.runScript(script, socket, function () {
                            self.emit('scriptFinished');
                            process.emit("status:finished",0);
                            if(!self.monitoringConnected) {
                                Application.stop();
                                process.exit(0);
                            }
                        });

                    } catch (err) {
                        command.help((helpText) => {
                            console.log(err);
                            return helpText;
                        })
                    }
                });

                return true;

            }).then(() => {
                return resolve();
            });
        });
    }

    initializeMonitoring() {
        return new Promise((resolve, reject) => {

            if(!this.runningScript) {
                return reject(new Error("no running script"));
            }

            let globalConfig = this.config.monitoring;

            if(this.runningScript.scriptConfig.monitoring && globalConfig) {
                this.runningScript.scriptConfig.monitoring = _.extend(globalConfig, this.runningScript.scriptConfig.monitoring);
            } else if(!this.runningScript.scriptConfig.monitoring && globalConfig) {
                this.runningScript.scriptConfig.monitoring = globalConfig;
            }

            if (!this.runningScript.scriptConfig.monitoring) {
                return reject(new Error("monitoring not configured"));
            }

            let projectFolderName = null;
            let root = path.normalize(this.config.rootDir);
            let dirParts = root.split("/");

            if(dirParts.length < 2) {
                dirParts = root.split("\\");
            }

            if(dirParts.length) {
                projectFolderName = dirParts[dirParts.length - 1];
            } else {
                projectFolderName = this.config.rootDir;
            }

            this.socket = socketIOClient(this.runningScript.scriptConfig.monitoring.statusUrl, {
                query: {
                    name: this.runningScript.name,
                    project: projectFolderName || "unknown"
                }
            });

            this.emit('socketOpened', this.socket);

            let connectionTimeout = setTimeout(() => {

                this.socketConnectionTimedOut = true;
                this.emit('socketConnectionTimeout');

                return reject("failed to connect to " + this.runningScript.scriptConfig.monitoring.statusUrl);

            }, (this.config.monitoring.socketConnectionTimeout || 5000));


            // wait for response from server
            this.socket.on('status:connected', (scriptRuleConfig) => {

                if(this.socketConnectionTimedOut) {
                    return this.socket.disconnect();
                }

                this.monitoringConnected = true;
                this.runningScript.scriptRuleConfig = scriptRuleConfig;
                this.socket.emit("status:starting");
                clearTimeout(connectionTimeout);

                this.emit('socketConnected', this.socket);

                return resolve();
            });

            this.socket.on('status:error', (e) => {

                this.emit('socketError', {
                    socket: this.socket,
                    error: e
                });
                return reject(e);
            });

            this.socket.on('disconnect', () => {
                this.emit('socketDisconnected', this.socket);
                console.log("Lost connection to monitoring server at " + this.runningScript.scriptConfig.monitoring.statusUrl);
            });
        });
    }

    startMonitoring() {

        if(!this.monitoringConnected) {
            return;
        }

        let monitorConfig = this.runningScript.scriptConfig.monitoring;
        let scriptId = this.runningScript.scriptRuleConfig._id;

        this.emit('monitoringStarted', this.socket);

        // pass some info to the server
        setInterval(() => {
            this.socket.emit('event:stats', {
                scriptId: scriptId,
                memoryUsage: process.memoryUsage(),
                upTime: process.uptime()
            });
        }, (this.config.monitoring.passStatsInterval || 500));

        // pass console output to server
        interceptStdout((data) => {
            this.socket.emit('event:console', {
                scriptId: scriptId,
                data: stripAnsi(data.toString())
            });
        });

        // script threw a warning
        process.on('warning', (warning) => {
            if(!monitorConfig.ignoreWarnings) {
                this.socket.emit('event:warning', {
                    scriptId: scriptId,
                    data: warning
                });
            }
        });

        // script threw a unhandled rejection
        process.on('unhandledRejection', (reason) => {
            this.socket.emit('event:unhandledRejection', {
                scriptId: scriptId,
                data: reason
            });
        });

        // script threw a handled rejection
        process.on('rejectionHandled', (reason) => {
            this.socket.emit('event:rejectionHandled', {
                scriptId: scriptId,
                data: reason
            })
        });

        // script threw an exception
        process.on('uncaughtException', (exception) => {
            this.socket.emit('event:uncaughtException', {
                scriptId: scriptId,
                data: exception
            })
        });

        // internal 'script finished' event
        process.on('status:finished', (code) => {
            if(this.monitoringConnected) {
                // let the server know we finished
                this.socket.emit("status:finished", {
                    scriptId: scriptId,
                    data: code
                });
                // wait for response from server
                this.socket.on("status:exit", () => {
                    process.exit(0);
                })
            } else {
                process.exit(0);
            }
        });

        // listen to actions
        this.socket.on("action:killProcess", () => {
            console.info("Received action:killProcess event. Calling process.exit()!");
            process.exit(0);
        });

        process.on('exit', () => {
            Application.stop();
        });
    }
};