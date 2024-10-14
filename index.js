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

  Examples
    $ stacktracify --map /path/to/js.map --file /path/to/my-stacktrace.txt
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
    },
  }
);

const { map: mapPathFlag, file: fileFlag } = cli.flags;

const stacktracify = async ({ mapPath, file}) => {
  try {
    console.log(mapPath, file);
    const consumers = [];
    let preferredConsumerOrder = false;
    if (!mapPath) cli.showHelp();

    try {
      if (Array.isArray(mapPath)) {
        await Promise.all(
          mapPath.map(async (m) => {
            const mapContent = JSON.parse(await fs.readFile(m, "utf-8"));
            const smc = await new SourceMapConsumer(mapContent);

            consumers.push(smc);
          })
        );
      } else {
        const mapContent = JSON.parse(await fs.readFile(mapPath, "utf-8"));
        const smc = await new SourceMapConsumer(mapContent);

        consumers.push(smc);
      }
    } catch (err) {
      console.log("An error occurred loading source map consumers!", err);
    }
    // support multiple source map declarations

    if (!consumers?.length) {
      throw new Error("Unable to resolve source map consumer!");
    }

    let str;
    if (file !== undefined) {
      str = await fs.readFile(file, "utf-8");
    } else {
      str = await clipboardy.read();
    }

    function findPositionInAllSourceMaps(lookup) {
      if (!consumers.length) return;

      let index = 0;
      for (const consumer of consumers) {
        const lookupValue = consumer.originalPositionFor(lookup);

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
  await stacktracify({ mapPath: mapPathFlag, file: fileFlag })
}

module.exports = {
  stacktracify
};
