import * as path from "path";
import * as process from "process";

import { v4 as getUUID } from "uuid";

import * as api from "./api";
import { LangConfig, langs } from "./langs";

const TIMEOUT_MS = 3000;

class Test {
  lang: string;
  type: string;
  messages: any[] = [];
  timedOut: boolean = false;
  handledMessages: number = 0;
  handleUpdate: () => void = () => {};

  get config() {
    return langs[this.lang];
  }

  ws: any = null;

  send = (msg: any) => {
    this.ws.onMessage(JSON.stringify(msg));
  };

  constructor(lang: string, type: string) {
    this.lang = lang;
    this.type = type;
  }

  getLog = () => {
    return this.messages.map((msg: any) => JSON.stringify(msg)).join("\n");
  };

  run = async () => {
    let session = null;
    let timeout = null;
    try {
      const that = this;
      this.ws = {
        on: function (type: string, handler: any) {
          switch (type) {
            case "message":
              this.onMessage = handler;
              for (const msg of this.messageQueue) {
                this.onMessage(msg);
              }
              this.messageQueue = [];
              break;
            case "close":
            case "error":
              // No need to clean up, we'll call teardown() explicitly.
              break;
            default:
              throw new Error(`unexpected websocket handler type: ${type}`);
          }
        },
        onMessage: function (msg: any) {
          this.messageQueue.push(msg);
        },
        messageQueue: [] as any[],
        send: function (data: string) {
          that.messages.push(JSON.parse(data));
          that.handleUpdate();
        },
        terminate: function () {},
      };
      session = new api.Session(this.ws, this.lang, (msg: string) => {
        this.messages.push({ event: "serverLog", message: msg });
      });
      timeout = setTimeout(() => {
        this.timedOut = true;
        this.handleUpdate();
      }, TIMEOUT_MS);
      switch (this.type) {
        case "ensure":
          await this.testEnsure();
          break;
        case "hello":
          await this.testHello();
          break;
        case "repl":
          await this.testRepl();
          break;
        case "scope":
          await this.testScope();
          break;
        case "format":
          await this.testFormat();
          break;
        case "lsp":
          await this.testLsp();
          break;
        default:
          throw new Error(`Unexpected test type: ${this.type}`);
      }
    } finally {
      this.ws = null;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (session) {
        await session.teardown();
      }
    }
  };

  wait = async (handler: (msg: any) => boolean) => {
    return await new Promise((resolve, reject) => {
      this.handleUpdate = () => {
        if (this.timedOut) {
          reject("timeout");
        } else {
          while (this.handledMessages < this.messages.length) {
            const msg = this.messages[this.handledMessages];
            const result = handler(msg);
            if (result) {
              resolve(result);
            }
            this.handledMessages += 1;
          }
        }
      };
      this.handleUpdate();
    });
  };

  waitForOutput = async (pattern: string) => {
    let output = "";
    return await this.wait((msg: any) => {
      const prevLength = output.length;
      if (msg.event === "terminalOutput") {
        output += msg.output;
      }
      return output.indexOf(pattern, prevLength - pattern.length) != -1;
    });
  };

  testEnsure = async () => {
    this.send({ event: "ensure" });
    const code = await this.wait((msg: any) => {
      if (msg.event === "ensured") {
        return msg.code;
      }
    });
    if (code !== 0) {
      throw new Error(`ensure failed with code ${code}`);
    }
  };
  testHello = async () => {
    const pattern =
      ((this.config.test || {}).hello || {}).pattern || "Hello, world!";
    this.send({ event: "runCode", code: this.config.template });
    await this.waitForOutput(pattern);
  };
  testRepl = async () => {
    const input =
      ((this.config.test || {}).repl || {}).input || "111111 + 111111";
    const output = ((this.config.test || {}).repl || {}).output || "222222";
    this.send({ event: "terminalInput", input: input + "\r" });
    await this.waitForOutput(output);
  };
  testRunRepl = async () => {
    const input =
      ((this.config.test || {}).repl || {}).input || "111111 + 111111";
    const output = ((this.config.test || {}).repl || {}).output || "222222";
    this.send({ event: "runCode", code: this.config.template });
    this.send({ event: "terminalInput", input: input + "\r" });
    await this.waitForOutput(output);
  };
  testScope = async () => {
    const code = this.config.test!.scope!.code;
    const after = this.config.test!.scope!.after;
    const input = this.config.test!.scope!.input || "x";
    const output = this.config.test!.scope!.output || "222222";
    let allCode = this.config.template;
    if (!allCode.endsWith("\n")) {
      allCode += "\n";
    }
    if (after) {
      allCode = allCode.replace(after + "\n", after + "\n" + code + "\n");
    } else {
      allCode = allCode + code + "\n";
    }
    this.send({ event: "runCode", code: allCode });
    this.send({ event: "terminalInput", input: input + "\r" });
    await this.waitForOutput(output);
  };
  testFormat = async () => {
    const input = this.config.test!.format!.input;
    const output =
      ((this.config.test || {}).format || { output: undefined }).output ||
      this.config.template;
    this.send({ event: "formatCode", code: input });
    const result = await this.wait((msg: any) => {
      if (msg.event === "formattedCode") {
        return msg.code;
      }
    });
    if (output !== result) {
      throw new Error("formatted code did not match");
    }
  };
  testLsp = async () => {};
}

function lint(lang: string) {
  const config = langs[lang];
  if (!config.template.endsWith("\n")) {
    throw new Error("template is missing a trailing newline");
  }
  if (config.format && !(config.test && config.test.format)) {
    throw new Error("formatter is missing test");
  }
  if (config.lsp && !(config.test && config.test.lsp)) {
    throw new Error("LSP is missing test");
  }
}

const testTypes: {
  [key: string]: {
    pred: (cfg: LangConfig) => boolean;
  };
} = {
  ensure: {
    pred: ({ test }) => (test && test.ensure ? true : false),
  },
  hello: { pred: (config) => true },
  repl: {
    pred: ({ repl }) => (repl ? true : false),
  },
  runrepl: {
    pred: ({ repl }) => (repl ? true : false),
  },
  scope: {
    pred: ({ test }) => (test && test.scope ? true : false),
  },
  format: {
    pred: ({ format }) => (format ? true : false),
  },
  lsp: { pred: ({ lsp }) => (lsp ? true : false) },
};

function getTestList() {
  const tests: { lang: string; test: string }[] = [];
  for (const [id, cfg] of Object.entries(langs)) {
    for (const [test, { pred }] of Object.entries(testTypes)) {
      if (pred(cfg)) {
        tests.push({ lang: id, test });
      }
    }
  }
  return tests;
}

async function main() {
  let tests = getTestList();
  const args = process.argv.slice(2);
  for (const arg of args) {
    tests = tests.filter(({ lang, test }) =>
      [lang, test].concat(langs[lang].aliases || []).includes(arg)
    );
  }
  for (const { lang, test: type } of tests) {
    console.error(`===== LANGUAGE ${lang}, TEST ${type}`);
    const test = new Test(lang, type);
    try {
      await test.run();
      console.error("succeeded");
    } catch (err) {
      console.error("failed:");
      console.error(test.getLog());
    }
  }
}

main().catch(console.error);
