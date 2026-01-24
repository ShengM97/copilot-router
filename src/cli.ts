#!/usr/bin/env node

import { Command } from "commander"
import consola from "consola"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

// Get package.json location relative to this file
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const packageJsonPath = join(__dirname, "..", "package.json")
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"))

const program = new Command()

program
    .name("copilot-router")
    .description(packageJson.description)
    .version(packageJson.version)

program
    .command("start")
    .description("Start the Copilot Router server")
    .option("-p, --port <port>", "Port to listen on", "4242")
    .action(async (options) => {
        // Set port from CLI option if provided
        if (options.port) {
            process.env.PORT = options.port
        }

        // Set the package root for static files
        process.env.COPILOT_ROUTER_ROOT = join(__dirname, "..")

        consola.info("Starting Copilot Router via CLI...")

        // Dynamically import the main module to start the server
        await import("./main.js")
    })

program.parse()
