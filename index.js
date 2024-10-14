#!/usr/bin/env node
"use strict";
const meow = require("meow");
const stackTraceParser = require("stacktrace-parser");
const fs = require("fs-extra");
const clipboardy = require("clipboardy");
const { SourceMapConsumer } = require("source-map");

const cli = meow(
  `
  Usage
    $ stacktracify <map-path>

  Options
    --file, -f  (default is read from clipboard)
    --map, -m   (target map paths)
    --debug, -d (debug mode)

  Examples
    $ stacktracify --map /path/to/js.map --file /path/to/my-stacktrace.txt --debug
`,
  {
    flags: {
      file: {
        type: "string",
        alias: "f",
      },
      map: {
        type: "string",
        alias: "m",
        isMultiple: true,
      },
      debug: {
        type: "boolean",
        alias: "d"
      }
    },
  }
);

const { map: mapPathFlag, file: fileFlag, debug: debugFlag } = cli.flags;

/**
 * Writes an unminified stack trace to the console given a stack trace in a file or clipboard
 * @param {Object}   params
 * @param {string[]} params.mapPath Array of map file paths
 * @param {string}   params.file    Target stack trace file to map
 * @param {boolean}  params.debug   Enable debug logging
 * @returns null
 */
const stacktracify = async ({ mapPath, file, debug = false }) => {
  try {
    const consumers = [];
    let preferredConsumerOrder = false;
    if (!mapPath) cli.showHelp();

    try {
      // support multiple source map declarations
      if (Array.isArray(mapPath)) {
        for (const m of mapPath) {
            if (debug) {
              console.log(`Loading ${m} as source map consumer!`);
            }

            const file = await fs.readFile(m, "utf8");
            const mapContent = JSON.parse(file);
            const smc = await new SourceMapConsumer(mapContent);

            if (debug) {
              console.log(`Loaded source map consumer for ${m}!`);
            }

            consumers.push(smc);
        }

        if (debug) {
          console.log(`Loaded ${consumers.length} source map consumers!`);
        }
      } else {
        const mapContent = JSON.parse(await fs.readFile(mapPath, "utf-8"));
        const smc = await new SourceMapConsumer(mapContent);

        promises.push(Promise.resolve);

        consumers.push(smc);
      }
    } catch (err) {
      console.error(err);
    }

    if (!consumers?.length) {
      console.error("Unable to resolve source map consumers!", consumers);
      return;
    }

    let str;
    if (file !== undefined) {
      if (debug) {
        console.log(`Reading stack trace as file from ${file}!`);
      }

      str = await fs.readFile(file, "utf-8");
    } else {
      if (debug) {
        console.log(`Reading stack trace from clipboard!`);
      }
      str = await clipboardy.read();
    }

    // naive check for stack trace in clipboard
    if (!str?.length || !str.includes('at')) {
      console.error('Unable to identify stack trace! Add a target file param or copy the stack trace to the clipboard!', str);

      return;
    }

    function findPositionInAllSourceMaps(lookup) {
      if (!consumers.length) return;

      let index = 0;
      for (const consumer of consumers) {
        const lookupValue = consumer.originalPositionFor(lookup);

        debug && console.log(`Identifying source map consumer for lookup ${lookup}! ${lookupValue} result!`)

        if (lookupValue?.line) {
          if (!preferredConsumerOrder) {
            if (index === 0) {
              preferredConsumerOrder = true;
            } else {
              const swap = consumer[0];
              consumer[0] = lookupValue;
              consumer[index] = swap;
              preferredConsumerOrder = true;
            }
          }

          return lookupValue;
        }

        index++;
      }
    }

    let [header, ...lines] = str.trim().split(/\r?\n/);

    lines = lines.map((line) => {
      // stacktrace-parser doesn't seem to support stacktrace lines like this:
      // index-12345678.js:1:2 a
      const match = line.match(/^(\s+)([^\s]+:\d+:\d+)\s+([^\s]+)$/);
      if (match) {
        return `${match[1]}at ${match[3]} (${match[2]})`;
      }

      return line;
    });

    const stack = stackTraceParser.parse(lines.join("\n"));
    if (stack.length === 0) throw new Error("No stack found");

    if (header) console.log(header);

    stack.forEach(({ methodName, lineNumber, column }) => {
      try {
        if (lineNumber == null || lineNumber < 1) {
          console.log(`    at ${methodName || "[unknown]"}`);
        } else {
          const pos = findPositionInAllSourceMaps({ line: lineNumber, column });
          if (pos && pos.line != null) {
            console.log(
              `    at ${pos.name || methodName || "[unknown]"} (${pos.source}:${
                pos.line
              }:${pos.column})`
            );
          }
        }
      } catch (err) {
        console.log(err, `    at FAILED_TO_PARSE_LINE`);
      }
    });
  } catch (err) {
    console.error(err);
  }
}

if (require.main) {
  stacktracify({ mapPath: mapPathFlag, file: fileFlag, debug: debugFlag })
}

module.exports = {
  stacktracify
};
