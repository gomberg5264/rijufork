import http from "http";
import https from "https";
import path from "path";

import express from "express";
import ws from "express-ws";
import _ from "lodash";

import * as api from "./api.js";
import { langs } from "./langs.js";
import { log } from "./util.js";

const host = process.env.HOST || "localhost";
const port = parseInt(process.env.PORT || "") || 6119;
const tlsPort = parseInt(process.env.TLS_PORT || "") || 6120;
const useTLS = process.env.TLS ? true : false;
const analyticsEnabled = process.env.ANALYTICS ? true : false;

const app = express();

app.set("query parser", (qs) => new URLSearchParams(qs));
app.set("view engine", "ejs");

app.get("/", (_, res) => {
  res.render(path.resolve("frontend/pages/index"), {
    langs,
    analyticsEnabled,
  });
});
for (const [lang, { aliases }] of Object.entries(langs)) {
  if (aliases) {
    for (const alias of aliases) {
      app.get(`/${_.escapeRegExp(alias)}`, (_, res) => {
        res.redirect(301, `/${lang}`);
      });
    }
  }
}
app.get("/:lang", (req, res) => {
  const lang = req.params.lang;
  const lowered = lang.toLowerCase();
  if (lowered !== lang) {
    res.redirect(301, `/${lowered}`);
  } else if (langs[lang]) {
    res.render(path.resolve("frontend/pages/app"), {
      config: { id: lang, ...langs[lang] },
      analyticsEnabled,
    });
  } else {
    res.send(`No such language: ${lang}`);
  }
});
app.use("/css", express.static("frontend/styles"));
app.use("/js", express.static("frontend/out"));

function addWebsocket(baseApp, httpsServer) {
  const app = ws(baseApp, httpsServer).app;
  app.ws("/api/v1/ws", (ws, req) => {
    try {
      const lang = req.query.get("lang");
      if (!lang) {
        ws.send(
          JSON.stringify({
            event: "error",
            errorMessage: "No language specified",
          })
        );
        ws.close();
      } else if (!langs[lang]) {
        ws.send(
          JSON.stringify({
            event: "error",
            errorMessage: `No such language: ${lang}`,
          })
        );
        ws.close();
      } else {
        new api.Session(ws, lang, console.log).setup();
      }
    } catch (err) {
      log.error("Unexpected error while handling websocket:", err);
    }
  });
  return app;
}

if (useTLS) {
  const httpsServer = https.createServer(
    {
      key: Buffer.from(process.env.TLS_PRIVATE_KEY || "", "base64").toString(
        "ascii"
      ),
      cert: Buffer.from(process.env.TLS_CERTIFICATE || "", "base64").toString(
        "ascii"
      ),
    },
    app
  );
  addWebsocket(app, httpsServer);
  httpsServer.listen(tlsPort, host, () =>
    console.log(`Listening on https://${host}:${tlsPort}`)
  );
  const server = http
    .createServer((req, res) => {
      res.writeHead(301, {
        Location: "https://" + req.headers["host"] + req.url,
      });
      res.end();
    })
    .listen(port, host, () =>
      console.log(`Listening on http://${host}:${port}`)
    );
} else {
  addWebsocket(app, undefined);
  const server = app.listen(port, host, () =>
    console.log(`Listening on http://${host}:${port}`)
  );
}