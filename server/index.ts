import "dotenv/config";
import http from "node:http";
import { app } from "./app";

const port = Number(process.env.PORT ?? 3000);
const server = http.createServer(app);

server.listen(port);

function shutdown(): void {
  app.close();
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
